"use server";

import { revalidatePath } from "next/cache";
import { ignoreComment, perform, syncComments } from "@/lib/comments";
import { defaultWorkspaceId, one, q } from "@/lib/db";

/** Проверяем, что комментарий принадлежит аккаунту текущего workspace. */
async function ownComment(id: string) {
  const ws = await defaultWorkspaceId();
  return one<{ id: string }>(
    "select c.id from ig_comments c join social_accounts a on a.id=c.account_id where c.id=$1 and a.workspace_id=$2",
    [id, ws]
  );
}

const done = () => revalidatePath("/comments");

/** Ответить (и/или отправить личное сообщение) — текст берётся из формы, его можно править перед отправкой. */
export async function replyCommentAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!(await ownComment(id))) return;
  const reply = String(fd.get("reply") ?? "").trim();
  const dm = String(fd.get("dm") ?? "").trim();
  const withDm = fd.get("with_dm") === "on" && dm;
  if (!reply && !withDm) return;
  await perform(id, { reply: reply || undefined, dm: withDm ? dm : undefined });
  done();
}

export async function hideCommentAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!(await ownComment(id))) return;
  await perform(id, { hide: true });
  done();
}

export async function unhideCommentAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!(await ownComment(id))) return;
  await perform(id, { unhide: true });
  done();
}

export async function ignoreCommentAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!(await ownComment(id))) return;
  await ignoreComment(id);
  done();
}

export async function syncCommentsAction(fd: FormData) {
  const accountId = String(fd.get("account_id") ?? "");
  const ws = await defaultWorkspaceId();
  if (!(await one("select 1 from social_accounts where id=$1 and workspace_id=$2", [accountId, ws]))) return;
  try {
    await syncComments(accountId);
  } catch (e) {
    console.error("[comments] sync failed:", (e as Error).message);
  }
  done();
}

// ---- Правила ----

const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function createRuleAction(fd: FormData) {
  const ws = await defaultWorkspaceId();
  const keywords = clean(fd.get("keywords")).split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
  const action = clean(fd.get("action"));
  const reply = clean(fd.get("reply_text"));
  const dm = clean(fd.get("dm_text"));
  if (!clean(fd.get("name")) || keywords.length === 0 || !["reply", "reply_dm", "dm", "hide"].includes(action)) return;
  if ((action === "reply" || action === "reply_dm") && !reply) return;
  if ((action === "reply_dm" || action === "dm") && !dm) return;
  const accountId = clean(fd.get("account_id")) || null;
  if (accountId && !(await one("select 1 from social_accounts where id=$1 and workspace_id=$2", [accountId, ws]))) return;
  await q(
    `insert into comment_rules (workspace_id, account_id, name, keywords, action, reply_text, dm_text, auto, priority)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ws, accountId, clean(fd.get("name")), keywords, action, reply || null, dm || null, fd.get("auto") === "on", Number(clean(fd.get("priority"))) || 100]
  );
  revalidatePath("/comments/rules");
}

export async function toggleRuleAction(fd: FormData) {
  const ws = await defaultWorkspaceId();
  const field = clean(fd.get("field"));
  if (field !== "active" && field !== "auto") return;
  await q(`update comment_rules set ${field} = not ${field} where id=$1 and workspace_id=$2`, [clean(fd.get("id")), ws]);
  revalidatePath("/comments/rules");
}

export async function deleteRuleAction(fd: FormData) {
  const ws = await defaultWorkspaceId();
  await q("delete from comment_rules where id=$1 and workspace_id=$2", [clean(fd.get("id")), ws]);
  revalidatePath("/comments/rules");
}
