// Уведомления о событиях: Telegram (людям) и вебхуки (генераторам/системам).
import { createHmac } from "node:crypto";
import { decrypt } from "./crypto";
import { one, q } from "./db";

export type EventName = "post.published" | "post.failed" | "account.needs_reauth";

export const EVENTS: { name: EventName; label: string }[] = [
  { name: "post.published", label: "Пост опубликован" },
  { name: "post.failed", label: "Ошибка публикации" },
  { name: "account.needs_reauth", label: "Аккаунт нужно переподключить" },
];

export interface TelegramSettings {
  bot_token_enc?: string;
  chat_id?: string;
  events?: EventName[];
}

export async function getTelegram(workspaceId: string): Promise<TelegramSettings> {
  const r = await one<{ settings: any }>("select settings from workspaces where id=$1", [workspaceId]);
  return r?.settings?.telegram ?? {};
}

export async function sendTelegram(tokenEnc: string, chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${decrypt(tokenEnc)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description ?? `Telegram HTTP ${res.status}`);
}

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);

function telegramText(event: EventName, p: Record<string, any>) {
  const who = `${p.platform === "instagram" ? "Instagram" : p.platform} @${p.username}`;
  if (event === "post.published") return `✅ Опубликовано: ${esc(who)}${p.permalink ? `\n${p.permalink}` : ""}`;
  if (event === "post.failed") return `❌ Ошибка публикации: ${esc(who)}\n${esc(String(p.error ?? ""))}`;
  return `⚠️ Нужно переподключить аккаунт ${esc(who)}\n${esc(String(p.error ?? ""))}`;
}

export function signBody(secret: string, body: string) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Отправляет событие во все каналы. Ошибки доставки не роняют публикацию. */
export async function emit(workspaceId: string, event: EventName, payload: Record<string, any>) {
  const tasks: Promise<unknown>[] = [];

  const tg = await getTelegram(workspaceId);
  if (tg.bot_token_enc && tg.chat_id && (tg.events ?? ["post.failed", "account.needs_reauth"]).includes(event))
    tasks.push(sendTelegram(tg.bot_token_enc, tg.chat_id, telegramText(event, payload)));

  const hooks = await q<{ id: string; url: string; secret: string }>(
    "select id, url, secret from webhooks where workspace_id=$1 and active and $2 = any(events)",
    [workspaceId, event]
  );
  for (const h of hooks) {
    const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
    tasks.push(
      fetch(h.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-autopost-event": event, "x-autopost-signature": signBody(h.secret, body) },
        body,
        signal: AbortSignal.timeout(10_000),
      })
        .then((r) => q("update webhooks set last_status=$2, last_at=now() where id=$1", [h.id, r.status]))
        .catch(() => q("update webhooks set last_status=0, last_at=now() where id=$1", [h.id]))
    );
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === "rejected") console.error(`[notify ${event}]`, r.reason?.message ?? r.reason);
}
