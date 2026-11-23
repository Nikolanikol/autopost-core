// Комментарии Instagram: приём (вебхук и опрос), правила, ответы, скрытие, личные сообщения.
// Автоответ срабатывает ТОЛЬКО по правилу с галочкой auto и только один раз — при первом появлении комментария.
import { decrypt } from "./crypto";
import { one, q } from "./db";
import { publisherFor } from "@/publishers";

const AUTO_PER_HOUR = Number(process.env.COMMENT_AUTO_PER_HOUR) || 15;
const AUTO_MAX_AGE_MIN = Number(process.env.COMMENT_AUTO_MAX_AGE_MIN) || 120;

export type CommentRow = {
  id: string;
  account_id: string;
  external_id: string;
  media_id: string | null;
  parent_id: string | null;
  username: string | null;
  from_id: string | null;
  text: string;
  status: string;
  matched_rule_id: string | null;
};

export type Rule = {
  id: string;
  name: string;
  keywords: string[];
  action: "reply" | "reply_dm" | "dm" | "hide";
  reply_text: string | null;
  dm_text: string | null;
  auto: boolean;
};

type AccountCtx = { id: string; workspace_id: string; external_id: string; username: string | null; platform: string; token: string };

async function accountCtx(accountId: string): Promise<AccountCtx> {
  const a = await one<any>(
    "select id, workspace_id, external_id, username, platform, token_enc from social_accounts where id=$1 and status='active'",
    [accountId]
  );
  if (!a) throw new Error("Аккаунт не найден или не активен");
  return { id: a.id, workspace_id: a.workspace_id, external_id: a.external_id, username: a.username, platform: a.platform, token: decrypt(a.token_enc) };
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Подстановки в шаблонах: {username} → @автор. */
export function render(tpl: string | null | undefined, c: { username?: string | null }) {
  return (tpl ?? "").replace(/\{username\}/gi, c.username ? `@${c.username}` : "").replace(/\s+/g, " ").trim();
}

/** Первое подходящее правило: аккаунтное раньше общего, дальше по приоритету. Ключевое слово «*» — любой комментарий. */
export async function findRule(workspaceId: string, accountId: string, text: string): Promise<Rule | null> {
  const rules = await q<Rule & { account_id: string | null }>(
    `select id, name, keywords, action, reply_text, dm_text, auto, account_id from comment_rules
      where workspace_id=$1 and active and (account_id is null or account_id=$2)
      order by (account_id is null), priority, created_at`,
    [workspaceId, accountId]
  );
  const t = norm(text);
  return rules.find((r) => r.keywords.some((k) => k.trim() === "*" || (k.trim() && t.includes(norm(k.trim()))))) ?? null;
}

async function log(commentId: string, action: string, ok: boolean, detail: unknown, auto: boolean) {
  await q("insert into comment_log (comment_id, action, ok, detail, auto) values ($1,$2,$3,$4,$5)", [
    commentId, action, ok, JSON.stringify(detail ?? {}), auto,
  ]);
}

/** Новый комментарий: сохраняем, подбираем правило, при необходимости отвечаем автоматически. */
export async function ingestComment(
  acc: AccountCtx,
  c: { external_id: string; media_id?: string | null; media_permalink?: string | null; parent_id?: string | null; username?: string | null; from_id?: string | null; text: string; commented_at?: string | null; hidden?: boolean; already_replied?: boolean },
  source: "webhook" | "poll" | "test"
): Promise<{ id: string; created: boolean } | null> {
  const own =
    (c.username && acc.username && c.username.toLowerCase() === acc.username.toLowerCase()) || (c.from_id && c.from_id === acc.external_id);
  const status = own || c.parent_id ? "ignored" : c.already_replied ? "replied" : "new"; // свои комментарии и ответы в ветках не обрабатываем
  const row = await one<{ id: string }>(
    `insert into ig_comments (account_id, external_id, media_id, media_permalink, parent_id, username, from_id, text, commented_at, status, hidden, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9::timestamptz, now()),$10,$11,$12)
     on conflict (account_id, external_id) do nothing returning id`,
    [acc.id, c.external_id, c.media_id ?? null, c.media_permalink ?? null, c.parent_id ?? null, c.username ?? null, c.from_id ?? null,
     c.text, c.commented_at ?? null, status, Boolean(c.hidden), source]
  );
  if (!row) return null; // уже был — повторно не обрабатываем (вебхуки могут приходить дважды)
  if (status !== "new") return { id: row.id, created: true };

  const rule = await findRule(acc.workspace_id, acc.id, c.text);
  if (rule) {
    await q("update ig_comments set matched_rule_id=$2, suggested_reply=$3, suggested_dm=$4, updated_at=now() where id=$1", [
      row.id, rule.id, rule.action === "hide" || rule.action === "dm" ? null : render(rule.reply_text, c),
      rule.action === "reply_dm" || rule.action === "dm" ? render(rule.dm_text, c) : null,
    ]);
    if (rule.auto && source !== "test") await autoRun(acc, row.id, rule);
  }
  return { id: row.id, created: true };
}

/** Автоответ с защитой: лимит в час и не более одного ответа одному автору под одним постом за сутки. */
async function autoRun(acc: AccountCtx, commentId: string, rule: Rule) {
  const c = (await one<any>("select * from ig_comments where id=$1", [commentId]))!;
  // Автоответ только на свежие комментарии: старые (например, найденные первым опросом) оставляем человеку.
  const ageMin = c.commented_at ? (Date.now() - new Date(c.commented_at).getTime()) / 60000 : 0;
  if (ageMin > AUTO_MAX_AGE_MIN) {
    await q("update ig_comments set last_error=$2 where id=$1", [commentId, "Автоответ пропущен: комментарий старше " + AUTO_MAX_AGE_MIN + " мин"]);
    return;
  }
  const used = await one<{ n: string }>(
    "select count(*) as n from ig_comments where account_id=$1 and auto_acted and updated_at > now() - interval '1 hour'",
    [acc.id]
  );
  if (Number(used?.n ?? 0) >= AUTO_PER_HOUR) {
    await q("update ig_comments set last_error=$2 where id=$1", [commentId, `Автоответ пропущен: лимит ${AUTO_PER_HOUR} в час`]);
    return;
  }
  if (c.from_id || c.username) {
    const dup = await one(
      `select 1 from ig_comments where account_id=$1 and media_id is not distinct from $2 and id<>$3 and status in ('replied','hidden')
         and (from_id = $4 or username = $5) and updated_at > now() - interval '24 hours' limit 1`,
      [acc.id, c.media_id, commentId, c.from_id, c.username]
    );
    if (dup) {
      await q("update ig_comments set last_error=$2 where id=$1", [commentId, "Автоответ пропущен: этому автору уже отвечали под этим постом"]);
      return;
    }
  }
  await perform(commentId, {
    reply: rule.action === "reply" || rule.action === "reply_dm" ? render(rule.reply_text, c) : undefined,
    dm: rule.action === "reply_dm" || rule.action === "dm" ? render(rule.dm_text, c) : undefined,
    hide: rule.action === "hide",
  }, true);
}

/** Выполнить действия над комментарием. Каждый шаг журналируется; ошибки не теряются. */
export async function perform(
  commentId: string,
  what: { reply?: string; dm?: string; hide?: boolean; unhide?: boolean },
  auto = false
): Promise<{ ok: boolean; errors: string[] }> {
  const c = await one<any>("select * from ig_comments where id=$1", [commentId]);
  if (!c) throw new Error("Комментарий не найден");
  const acc = await accountCtx(c.account_id);
  const pub = publisherFor(acc.platform);
  const errors: string[] = [];
  let status: string = c.status;
  const sets: string[] = [];
  const vals: unknown[] = [commentId];
  const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };

  if (what.hide || what.unhide) {
    try {
      await pub.hideComment!(c.external_id, Boolean(what.hide), acc.token);
      set("hidden", Boolean(what.hide));
      if (what.hide) status = "hidden";
      await log(commentId, what.hide ? "hide" : "unhide", true, {}, auto);
    } catch (e) {
      errors.push(`скрыть: ${(e as Error).message}`);
      await log(commentId, "hide", false, { error: (e as Error).message }, auto);
    }
  }
  if (what.reply?.trim()) {
    try {
      const r = await pub.replyToComment!(c.external_id, what.reply.trim(), acc.token);
      set("reply_text", what.reply.trim());
      set("reply_external_id", r.id);
      sets.push("replied_at=now()");
      status = "replied";
      await log(commentId, "reply", true, { id: r.id, text: what.reply.trim() }, auto);
    } catch (e) {
      errors.push(`ответ: ${(e as Error).message}`);
      await log(commentId, "reply", false, { error: (e as Error).message }, auto);
    }
  }
  if (what.dm?.trim()) {
    try {
      await pub.privateReply!(acc.external_id, c.external_id, what.dm.trim(), acc.token);
      sets.push("dm_sent_at=now()");
      if (status === "new") status = "replied";
      await log(commentId, "dm", true, { text: what.dm.trim() }, auto);
    } catch (e) {
      errors.push(`личное сообщение: ${(e as Error).message}`);
      await log(commentId, "dm", false, { error: (e as Error).message }, auto);
    }
  }
  const anyDone = status !== c.status || sets.length > 0;
  set("status", errors.length && !anyDone ? "failed" : status);
  set("last_error", errors.length ? errors.join(" · ") : null);
  if (auto && !errors.length) sets.push("auto_acted=true");
  await q(`update ig_comments set ${sets.join(", ")}, updated_at=now() where id=$1`, vals);
  return { ok: errors.length === 0, errors };
}

export async function ignoreComment(commentId: string) {
  await q("update ig_comments set status='ignored', updated_at=now() where id=$1", [commentId]);
  await log(commentId, "ignore", true, {}, false);
}

/** Вебхук: value поля comments. */
export async function ingestWebhookComment(igUserId: string, value: any) {
  const a = await one<{ id: string }>("select id from social_accounts where platform='instagram' and external_id=$1 and status='active' limit 1", [igUserId]);
  if (!a || !value?.id) return null;
  const acc = await accountCtx(a.id);
  return ingestComment(
    acc,
    {
      external_id: String(value.id),
      media_id: value.media?.id ? String(value.media.id) : null,
      parent_id: value.parent_id ? String(value.parent_id) : null,
      username: value.from?.username ?? null,
      from_id: value.from?.id ? String(value.from.id) : null,
      text: String(value.text ?? ""),
    },
    "webhook"
  );
}

/** Опрос: подхватывает комментарии, которые не дошли вебхуком, и отмечает те, на которые мы уже ответили. */
export async function syncComments(accountId: string) {
  const acc = await accountCtx(accountId);
  const pub = publisherFor(acc.platform);
  if (!pub.listRecentComments) return { added: 0, marked: 0 };
  const list = await pub.listRecentComments(acc.external_id, acc.token, { maxMedia: 12, sinceDays: 14 });
  let added = 0, marked = 0;
  for (const c of list) {
    const ours = c.replies.some((r) => r.username && acc.username && r.username.toLowerCase() === acc.username.toLowerCase());
    const r = await ingestComment(
      acc,
      { external_id: c.external_id, media_id: c.media_id, media_permalink: c.media_permalink, username: c.username, text: c.text, commented_at: c.timestamp, hidden: c.hidden, already_replied: ours },
      "poll"
    );
    if (r) added++;
    // Мы уже отвечали (например, с телефона) — не показываем в «Новых».
    const done = await q(
      "update ig_comments set status='replied', media_permalink=coalesce(media_permalink,$3), updated_at=now() where account_id=$1 and external_id=$2 and status='new' and $4::boolean returning id",
      [acc.id, c.external_id, c.media_permalink, ours]
    );
    marked += done.length;
    await q("update ig_comments set media_permalink=coalesce(media_permalink,$3), hidden=$4 where account_id=$1 and external_id=$2", [
      acc.id, c.external_id, c.media_permalink, c.hidden,
    ]);
  }
  return { added, marked };
}
