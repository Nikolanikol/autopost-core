"use server";

import { revalidatePath } from "next/cache";
import { defaultWorkspaceId, one } from "@/lib/db";
import { ignoreConversation, replyToConversation, syncMessages } from "@/lib/messages";

/** Проверяем, что диалог принадлежит аккаунту текущего workspace. */
async function ownConversation(id: string) {
  const ws = await defaultWorkspaceId();
  return one<{ id: string }>(
    "select c.id from ig_conversations c join social_accounts a on a.id=c.account_id where c.id=$1 and a.workspace_id=$2",
    [id, ws]
  );
}

const done = () => revalidatePath("/messages");

/** Ответить человеку. Текст берётся из формы; ошибка (например, закрытое окно 24 часа) сохраняется в диалоге и видна на странице. */
export async function replyMessageAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const text = String(fd.get("text") ?? "").trim();
  if (!text || !(await ownConversation(id))) return;
  await replyToConversation(id, text);
  done();
}

export async function ignoreConversationAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!(await ownConversation(id))) return;
  await ignoreConversation(id);
  done();
}

export async function syncMessagesAction(fd: FormData) {
  const accountId = String(fd.get("account_id") ?? "");
  const ws = await defaultWorkspaceId();
  if (!(await one("select 1 from social_accounts where id=$1 and workspace_id=$2", [accountId, ws]))) return;
  try {
    await syncMessages(accountId);
  } catch (e) {
    console.error("[messages] sync failed:", (e as Error).message);
  }
  done();
}
