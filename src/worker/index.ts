// Worker публикаций: забирает задачи из pg-boss и проводит цель через фазы
// start (контейнер) → poll (обработка) → finish (публикация).
import { decrypt } from "@/lib/crypto";
import { one, pool, q } from "@/lib/db";
import { getBoss, enqueueTarget, PUBLISH_QUEUE, type PublishJob } from "@/lib/queue";
import { refreshPostStatus } from "@/lib/posts";
import { emit, notifyDraft } from "@/lib/notify";
import { tiktokAccessToken } from "@/lib/tiktokAuth";
import { collectMetrics } from "@/lib/metrics";
import { syncComments } from "@/lib/comments";
import { syncMessages } from "@/lib/messages";
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
    // TikTok: access-токен живёт сутки — берём действующий (при необходимости обновляем).
    if (t.platform === "tiktok") ctx.account.token = await tiktokAccessToken(t.account_id);

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
    if (pub.draftOnly) {
      // Видео лежит в черновиках приложения — подпись отправляем в Telegram, чтобы вставить при публикации.
      await notifyDraft(t.workspace_id, { ...ev, caption: ctx.caption });
    } else {
      await emit(t.workspace_id, "post.published", { ...ev, external_id: externalId, permalink });
    }

    // Первый комментарий: после публикации, с повторами. Неудача не отменяет публикацию — пишем причину в карточку цели.
    const fc = typeof ctx.options.first_comment === "string" ? ctx.options.first_comment.trim() : "";
    if (fc && pub.commentOnMedia && !(await one("select 1 from publish_logs where target_id=$1 and step='first_comment' and ok limit 1", [t.id]))) {
      let lastErr = "";
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 4000 : 8000 * i));
        try {
          const c = await pub.commentOnMedia(externalId, fc, ctx.account.token);
          await log(t.id, "first_comment", true, { id: c.id });
          lastErr = "";
          break;
        } catch (e) {
          lastErr = errInfo(e).message;
        }
      }
      if (lastErr) {
        await log(t.id, "first_comment", false, { error: lastErr });
        await setTarget(t.id, { last_error: `Пост опубликован, но первый комментарий не отправлен: ${lastErr}` });
        console.error(`⚠️ первый комментарий @${t.username}: ${lastErr}`);
      }
    }
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

// Комментарии: страховочный опрос на случай пропущенных вебхуков (по умолчанию каждые 15 минут).
const COMMENTS_INTERVAL_MIN = Number(process.env.COMMENTS_INTERVAL_MIN) || 15;
let commentsRunning = false;
const runComments = async () => {
  if (commentsRunning) return;
  commentsRunning = true;
  try {
    const accs = await q<{ id: string; username: string | null }>("select id, username from social_accounts where platform='instagram' and status='active'");
    for (const a of accs) {
      try {
        const r = await syncComments(a.id);
        if (r.added || r.marked) console.log(`💬 @${a.username}: новых комментариев ${r.added}, уже отвеченных ${r.marked}`);
      } catch (e) {
        console.error(`💬 опрос комментариев @${a.username}:`, (e as Error).message);
      }
    }
  } finally {
    commentsRunning = false;
  }
};
setTimeout(runComments, 90_000);
const commentsTimer = setInterval(runComments, COMMENTS_INTERVAL_MIN * 60_000);

// Личные сообщения: тот же страховочный опрос (по умолчанию каждые 15 минут).
const MESSAGES_INTERVAL_MIN = Number(process.env.MESSAGES_INTERVAL_MIN) || 15;
let messagesRunning = false;
const runMessages = async () => {
  if (messagesRunning) return;
  messagesRunning = true;
  try {
    const accs = await q<{ id: string; username: string | null }>("select id, username from social_accounts where platform='instagram' and status='active'");
    for (const a of accs) {
      try {
        const r = await syncMessages(a.id);
        if (r.added) console.log(`✉️ @${a.username}: новых сообщений ${r.added} в ${r.conversations} диалогах`);
      } catch (e) {
        console.error(`✉️ опрос сообщений @${a.username}:`, (e as Error).message);
      }
    }
  } finally {
    messagesRunning = false;
  }
};
setTimeout(runMessages, 120_000);
const messagesTimer = setInterval(runMessages, MESSAGES_INTERVAL_MIN * 60_000);

const shutdown = async () => {
  console.log("останавливаюсь…");
  clearInterval(metricsTimer);
  clearInterval(commentsTimer);
  clearInterval(messagesTimer);
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
