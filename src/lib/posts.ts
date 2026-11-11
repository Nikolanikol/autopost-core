import { z } from "zod";
import { one, q, tx } from "./db";
import { enqueueTarget } from "./queue";
import { registerMediaUrl } from "./media";
import { nextFreeSlot } from "./slots";
import { publisherFor, type Issue, type MediaItem } from "@/publishers";

export const CreatePostSchema = z
  .object({
    caption: z.string().max(2200).default(""),
    media_ids: z.array(z.string().uuid()).default([]),
    media_urls: z.array(z.string().url()).default([]),
    targets: z
      .array(
        z.object({
          account_id: z.string().uuid(),
          caption: z.string().max(2200).optional(),
          options: z.record(z.unknown()).default({}),
        })
      )
      .min(1),
    schedule: z
      .union([z.literal("now"), z.literal("next_slot"), z.string().datetime({ offset: true })])
      .default("now"),
    idempotency_key: z.string().max(200).optional(),
  })
  .refine((v) => v.media_ids.length + v.media_urls.length > 0, { message: "Нужно хотя бы одно медиа" });

export type CreatePostInput = z.input<typeof CreatePostSchema>;

export class ValidationError extends Error {
  constructor(public issues: (Issue & { target?: string })[]) {
    super(issues.map((i) => i.message).join("; "));
  }
}

export async function createPost(workspaceId: string, raw: CreatePostInput, source: "ui" | "api" | "generator") {
  const input = CreatePostSchema.parse(raw);

  if (input.idempotency_key) {
    const existing = await one<{ id: string }>(
      "select id from posts where workspace_id=$1 and idempotency_key=$2",
      [workspaceId, input.idempotency_key]
    );
    if (existing) return { post: await getPost(existing.id), created: false };
  }

  const mediaIds = [...input.media_ids];
  for (const url of input.media_urls) {
    try {
      mediaIds.push((await registerMediaUrl(workspaceId, url))!.id);
    } catch (e) {
      throw new ValidationError([{ level: "error", message: `Медиа ${url}: ${(e as Error).message}` }]);
    }
  }
  const media = await q<MediaItem>("select * from media where workspace_id=$1 and id = any($2)", [workspaceId, mediaIds]);
  if (media.length !== mediaIds.length) throw new ValidationError([{ level: "error", message: "Медиа не найдено" }]);
  const ordered = mediaIds.map((id) => media.find((m) => m.id === id)!);

  const accounts = await q<{ id: string; platform: string; username: string; status: string }>(
    "select id, platform, username, status from social_accounts where workspace_id=$1 and id = any($2)",
    [workspaceId, input.targets.map((t) => t.account_id)]
  );
  const issues: (Issue & { target?: string })[] = [];
  for (const t of input.targets) {
    const acc = accounts.find((a) => a.id === t.account_id);
    if (!acc) {
      issues.push({ level: "error", message: `Аккаунт ${t.account_id} не найден`, target: t.account_id });
      continue;
    }
    if (acc.status !== "active")
      issues.push({ level: "error", message: `@${acc.username}: аккаунт требует переподключения`, target: acc.id });
    for (const i of publisherFor(acc.platform).validate(ordered, t.options))
      issues.push({ ...i, message: `@${acc.username}: ${i.message}`, target: acc.id });
  }
  if (issues.some((i) => i.level === "error")) throw new ValidationError(issues);

  let scheduledAt: Date;
  if (input.schedule === "now") scheduledAt = new Date();
  else if (input.schedule === "next_slot") {
    // Слот берётся по первому аккаунту из targets.
    const slot = await nextFreeSlot(workspaceId, input.targets[0].account_id);
    if (!slot)
      throw new ValidationError([
        { level: "error", message: "У аккаунта не настроены слоты расписания (Аккаунты → Слоты)" },
      ]);
    scheduledAt = slot;
  } else scheduledAt = new Date(input.schedule);

  const postId = await tx(async (c) => {
    const { rows } = await c.query(
      `insert into posts (workspace_id, base_caption, status, scheduled_at, source, idempotency_key)
       values ($1,$2,'scheduled',$3,$4,$5) returning id`,
      [workspaceId, input.caption, scheduledAt, source, input.idempotency_key ?? null]
    );
    const id = rows[0].id as string;
    for (const t of input.targets) {
      const r = await c.query(
        `insert into post_targets (post_id, account_id, caption_override, media_ids, options)
         values ($1,$2,$3,$4,$5) returning id`,
        [id, t.account_id, t.caption ?? null, mediaIds, JSON.stringify(t.options)]
      );
      await enqueueTarget({ targetId: r.rows[0].id }, scheduledAt, c);
    }
    return id;
  });

  return { post: await getPost(postId), created: true, warnings: issues };
}

export async function getPost(id: string) {
  const post = await one("select * from posts where id=$1", [id]);
  if (!post) return null;
  const targets = await q(
    `select t.id, t.status, t.permalink, t.external_id, t.last_error, t.attempts, t.published_at, t.options,
            t.caption_override, a.platform, a.username, a.id as account_id
       from post_targets t join social_accounts a on a.id = t.account_id
      where t.post_id=$1 order by a.platform`,
    [id]
  );
  return { ...post, targets };
}

/** Пересчитывает статус поста из статусов его целей (идея Mixpost/Postiz). */
export async function refreshPostStatus(postId: string) {
  const rows = await q<{ status: string }>("select status from post_targets where post_id=$1", [postId]);
  const post = await one<{ scheduled_at: Date | null }>("select scheduled_at from posts where id=$1", [postId]);
  const s = rows.map((r) => r.status);
  const count = (x: string) => s.filter((v) => v === x).length;
  let status: string;
  if (s.length === 0 || count("canceled") === s.length) status = "canceled";
  else if (count("queued") + count("processing") > 0)
    status = count("processing") > 0 || (post?.scheduled_at && post.scheduled_at <= new Date()) ? "publishing" : "scheduled";
  else if (count("failed") === 0) status = "published";
  else status = count("published") > 0 ? "partial" : "failed";
  await q("update posts set status=$2, updated_at=now() where id=$1", [postId, status]);
  return status;
}

export async function retryTarget(targetId: string) {
  const t = await one<{ post_id: string }>(
    `update post_targets set status='queued', last_error=null, updated_at=now()
      where id=$1 and status='failed' returning post_id`,
    [targetId]
  );
  if (!t) return false;
  await enqueueTarget({ targetId });
  await refreshPostStatus(t.post_id);
  return true;
}

export async function cancelPost(postId: string) {
  await q("update post_targets set status='canceled', updated_at=now() where post_id=$1 and status='queued'", [postId]);
  return refreshPostStatus(postId);
}

/**
 * Перенос поста. Новая задача ставится на новое время; старая, сработав,
 * увидит, что время поста ещё не наступило, и пропустит себя.
 */
export async function reschedulePost(postId: string, at: Date) {
  return tx(async (c) => {
    const { rows } = await c.query(
      "update posts set scheduled_at=$2, updated_at=now() where id=$1 and status='scheduled' returning id",
      [postId, at]
    );
    if (rows.length === 0) return false;
    const targets = await c.query("select id from post_targets where post_id=$1 and status='queued'", [postId]);
    for (const t of targets.rows) await enqueueTarget({ targetId: t.id }, at, c);
    return true;
  });
}

export async function listPostsBetween(workspaceId: string, from: Date, to: Date) {
  return q(
    `select p.id, p.status, p.scheduled_at, p.base_caption,
            json_agg(json_build_object('platform', a.platform, 'username', a.username, 'status', t.status)) as targets
       from posts p join post_targets t on t.post_id = p.id join social_accounts a on a.id = t.account_id
      where p.workspace_id=$1 and p.scheduled_at >= $2 and p.scheduled_at < $3
      group by p.id order by p.scheduled_at`,
    [workspaceId, from, to]
  );
}

export async function listPosts(workspaceId: string, limit = 50) {
  const posts = await q(
    "select * from posts where workspace_id=$1 order by coalesce(scheduled_at, created_at) desc limit $2",
    [workspaceId, limit]
  );
  if (posts.length === 0) return [];
  const targets = await q(
    `select t.*, a.platform, a.username from post_targets t join social_accounts a on a.id=t.account_id
      where t.post_id = any($1)`,
    [posts.map((p) => p.id)]
  );
  const media = await q("select id, kind, public_url from media where id = any($1)", [
    [...new Set(targets.flatMap((t) => t.media_ids))],
  ]);
  return posts.map((p) => ({
    ...p,
    targets: targets.filter((t) => t.post_id === p.id),
    media: media.filter((m) => targets.some((t) => t.post_id === p.id && t.media_ids.includes(m.id))),
  }));
}
