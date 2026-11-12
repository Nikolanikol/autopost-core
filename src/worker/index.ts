// Worker публикаций: забирает задачи из pg-boss и проводит цель через фазы
// start (контейнер) → poll (обработка) → finish (публикация).
import { decrypt } from "@/lib/crypto";
import { one, pool, q } from "@/lib/db";
import { getBoss, enqueueTarget, PUBLISH_QUEUE, type PublishJob } from "@/lib/queue";
import { refreshPostStatus } from "@/lib/posts";
import { emit } from "@/lib/notify";
import { collectMetrics } from "@/lib/metrics";
import { publisherFor, PlatformError, type MediaItem, type PublishContext } from "@/publishers";

const POLL_INTERVAL_S = 10;
const MAX_POLLS = 90; // ~15 минут на обработку видео

async function log(targetId: string, step: string, ok: boolean, detail: Record<string, unknown> = {}) {
  await q("insert into publish_logs (target_id, step, ok, detail) values ($1,$2,$3,$4)", [
    targetId,
    step,
    ok,
    JSON.stringify(detail),
  ]);
}

async function setTarget(id: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  await q(
    `update post_targets set ${keys.map((k, i) => `${k}=$${i + 2}`).join(", ")}, updated_at=now() where id=$1`,
    [id, ...keys.map((k) => fields[k])]
  );
}

const errInfo = (e: unknown) =>
  e instanceof PlatformError
    ? { message: e.message, status: e.status, code: e.code, subcode: e.subcode }
    : { message: (e as Error)?.message ?? String(e) };

async function handle(job: PublishJob, retryCount: number, retryLimit: number) {
  const t = await one(
    `select t.*, p.workspace_id, p.scheduled_at, a.platform, a.external_id, a.username, a.token_enc, a.status as account_status
       from post_targets t
       join posts p on p.id = t.post_id
       join social_accounts a on a.id = t.account_id
      where t.id = $1`,
    [job.targetId]
  );
  if (!t || ["published", "canceled", "failed"].includes(t.status)) return;
  // Пост перенесли на более позднее время — эта задача устарела, сработает новая.
  if (!job.pollCount && t.status === "queued" && t.scheduled_at && t.scheduled_at.getTime() > Date.now() + 5000) return;

  const ev = { post_id: t.post_id, target_id: t.id, platform: t.platform, username: t.username };

  if (t.account_status !== "active") {
    await setTarget(t.id, { status: "failed", last_error: "Аккаунт требует переподключения" });
    await refreshPostStatus(t.post_id);
    await emit(t.workspace_id, "post.failed", { ...ev, error: "Аккаунт требует переподключения" });
    return;
  }

  const pub = publisherFor(t.platform);
  const media = await q<MediaItem>("select * from media where id = any($1)", [t.media_ids]);
  const ctx: PublishContext = {
    account: { id: t.account_id, external_id: t.external_id, username: t.username, token: decrypt(t.token_enc) },
    caption: t.caption_override ?? (await one("select base_caption from posts where id=$1", [t.post_id]))!.base_caption,
    media: t.media_ids.map((id: string) => media.find((m) => m.id === id)!),
    options: t.options ?? {},
    containerId: t.container_id,
  };

  if (t.status !== "processing") {
    await setTarget(t.id, { status: "processing", attempts: t.attempts + 1 });
    await refreshPostStatus(t.post_id);
  }

  try {
    if (!ctx.containerId) {
      const { containerId } = await pub.start(ctx);
      ctx.containerId = containerId;
      await setTarget(t.id, { container_id: containerId });
      await log(t.id, "start", true, { containerId });
    }

    if (pub.poll && ctx.containerId) {
      const r = await pub.poll(ctx);
      if (r.state === "pending") {
        const pollCount = (job.pollCount ?? 0) + 1;
        if (pollCount > MAX_POLLS) throw new Error("Платформа слишком долго обрабатывает медиа");
        await enqueueTarget({ targetId: t.id, pollCount }, POLL_INTERVAL_S);
        return;
      }
      if (r.state === "error") {
        // Контейнер испорчен — при ручном повторе начнём с нуля.
        await setTarget(t.id, { container_id: null });
        throw Object.assign(new Error(`Обработка медиа: ${r.message}`), { fatal: true });
      }
      if (r.state === "published") {
        await setTarget(t.id, { status: "published", published_at: new Date(), last_error: null });
        await log(t.id, "finish", true, { note: "контейнер уже опубликован ранее" });
        await emit(t.workspace_id, "post.published", { ...ev, permalink: t.permalink });
        return;
      }
      await log(t.id, "poll", true, { polls: job.pollCount ?? 0 });
    }

    const { externalId, permalink } = await pub.finish(ctx);
    await setTarget(t.id, {
      status: "published",
      external_id: externalId,
      permalink,
      published_at: new Date(),
      last_error: null,
    });
    await log(t.id, "finish", true, { externalId, permalink });
    console.log(`✅ ${t.platform} @${t.username}: ${permalink ?? externalId}`);
    await emit(t.workspace_id, "post.published", { ...ev, external_id: externalId, permalink });
  } catch (e) {
    const cls = (e as any)?.fatal ? "fatal" : pub.classifyError(e);
    const info = errInfo(e);
    await log(t.id, "error", false, { class: cls, ...info });
    console.error(`❌ ${t.platform} @${t.username} [${cls}]: ${info.message}`);

    if (cls === "rate_limit") {
      await setTarget(t.id, { status: "queued", last_error: `Лимит платформы, повтор через час: ${info.message}` });
      await enqueueTarget({ targetId: t.id }, 3600);
    } else if (cls === "reauth") {
      await q("update social_accounts set status='needs_reauth', updated_at=now() where id=$1", [t.account_id]);
      await setTarget(t.id, { status: "failed", last_error: `Нужно переподключить аккаунт: ${info.message}` });
      await emit(t.workspace_id, "account.needs_reauth", { ...ev, error: info.message });
    } else if (cls === "retry" && retryCount < retryLimit) {
      await setTarget(t.id, { status: "queued", last_error: `Повтор ${retryCount + 1}/${retryLimit}: ${info.message}` });
      await refreshPostStatus(t.post_id);
      throw e; // pg-boss повторит с нарастающей паузой
    } else {
      await setTarget(t.id, { status: "failed", last_error: info.message });
      await emit(t.workspace_id, "post.failed", { ...ev, error: info.message });
    }
  } finally {
    await refreshPostStatus(t.post_id);
  }
}

const boss = await getBoss({ supervise: true });
// Один обработчик = публикации идут последовательно (на MVP этого достаточно и
// гарантирует «одна публикация за раз на аккаунт»).
await boss.work<PublishJob>(PUBLISH_QUEUE, { batchSize: 1, pollingIntervalSeconds: 2, includeMetadata: true }, async ([job]) => {
  await handle(job.data, job.retryCount, job.retryLimit);
});
console.log("worker запущен, очередь:", PUBLISH_QUEUE);

// Сбор статистики: через минуту после старта, затем каждые METRICS_INTERVAL_MIN (по умолчанию 3 часа).
const METRICS_INTERVAL_MIN = Number(process.env.METRICS_INTERVAL_MIN) || 180;
let metricsRunning = false;
const runMetrics = async () => {
  if (metricsRunning) return;
  metricsRunning = true;
  try {
    await collectMetrics();
  } catch (e) {
    console.error("📊 сбор метрик упал:", (e as Error).message);
  } finally {
    metricsRunning = false;
  }
};
setTimeout(runMetrics, 60_000);
const metricsTimer = setInterval(runMetrics, METRICS_INTERVAL_MIN * 60_000);

const shutdown = async () => {
  console.log("останавливаюсь…");
  clearInterval(metricsTimer);
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
