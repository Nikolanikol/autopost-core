"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { upsertAccount } from "@/lib/accounts";
import { encrypt, newApiKey } from "@/lib/crypto";
import { defaultWorkspaceId, one, q } from "@/lib/db";
import { registerUpload } from "@/lib/media";
import { emit, getTelegram, sendTelegram, type EventName } from "@/lib/notify";
import { cancelPost, createPost, reschedulePost, retryTarget, ValidationError } from "@/lib/posts";
import { nextFreeSlot, workspaceTz } from "@/lib/slots";
import { fmtIn, normalizeTz, tzLabel } from "@/lib/tz";

export type FormState = { ok?: string; error?: string; issues?: string[]; secret?: string } | null;

const msg = (e: unknown) =>
  e instanceof ValidationError ? e.issues.map((i) => i.message) : [(e as Error).message ?? String(e)];

/* ───────── Посты ───────── */

export async function createPostAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ws = await defaultWorkspaceId();
    const type = String(fd.get("type") || "auto");
    const accountIds = fd.getAll("account_id").map(String);
    if (accountIds.length === 0) return { error: "Выберите хотя бы один аккаунт" };
    const mediaId = String(fd.get("media_id") || "");
    const mediaUrl = String(fd.get("media_url") || "").trim();
    if (!mediaId && !mediaUrl) return { error: "Выберите медиа из медиатеки или укажите URL" };
    const r = await createPost(
      ws,
      {
        caption: String(fd.get("caption") ?? ""),
        media_ids: mediaId ? [mediaId] : [],
        media_urls: !mediaId && mediaUrl ? [mediaUrl] : [],
        targets: accountIds.map((account_id) => ({ account_id, options: type === "auto" ? {} : { type } })),
        schedule: String(fd.get("schedule_iso") || "now"),
      },
      "ui"
    );
    revalidatePath("/");
    revalidatePath("/calendar");
    const tz = await workspaceTz(ws);
    return {
      ok: `Пост поставлен в очередь на ${fmtIn(r.post?.scheduled_at ?? null, tz)} (${tzLabel(tz)})`,
      issues: (r.warnings ?? []).map((w) => w.message),
    };
  } catch (e) {
    return { error: "Не удалось создать пост", issues: msg(e) };
  }
}

export async function retryTargetAction(fd: FormData) {
  await retryTarget(String(fd.get("target_id")));
  revalidatePath("/");
}

export async function cancelPostAction(fd: FormData) {
  await cancelPost(String(fd.get("post_id")));
  revalidatePath("/");
  revalidatePath("/calendar");
}

/** Перенос из календаря: новая дата, то же время суток. */
export async function reschedulePostAction(postId: string, isoAt: string) {
  const at = new Date(isoAt);
  if (Number.isNaN(at.getTime()) || at.getTime() < Date.now()) return { error: "Нельзя перенести в прошлое" };
  const ok = await reschedulePost(postId, at);
  revalidatePath("/calendar");
  revalidatePath("/");
  return ok ? { ok: true } : { error: "Переносить можно только запланированные посты" };
}

export async function previewNextSlotAction(accountId: string) {
  const at = await nextFreeSlot(await defaultWorkspaceId(), accountId);
  return at ? at.toISOString() : null;
}

/* ───────── Медиатека ───────── */

export async function uploadMediaAction(_: FormState, fd: FormData): Promise<FormState> {
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Выберите файл" };
  const ws = await defaultWorkspaceId();
  const issues: string[] = [];
  let ok = 0;
  for (const f of files) {
    try {
      const m: any = await registerUpload(ws, f);
      ok++;
      for (const w of m.validation?.warnings ?? []) issues.push(`${f.name}: ${w}`);
    } catch (e) {
      issues.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  revalidatePath("/media");
  return ok ? { ok: `Загружено файлов: ${ok}`, issues } : { error: "Не удалось загрузить", issues };
}

export async function deleteMediaAction(fd: FormData) {
  await q(
    "delete from media m where id=$1 and not exists (select 1 from post_targets t where m.id = any(t.media_ids))",
    [String(fd.get("media_id"))]
  );
  revalidatePath("/media");
}

/* ───────── Аккаунты и слоты ───────── */

export async function addAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const acc = await upsertAccount(
      await defaultWorkspaceId(),
      String(fd.get("platform")),
      String(fd.get("external_id") ?? ""),
      String(fd.get("token") ?? "")
    );
    revalidatePath("/accounts");
    return { ok: `Подключён @${acc.username}` };
  } catch (e) {
    return { error: "Токен не прошёл проверку", issues: msg(e) };
  }
}

export async function toggleAccountAction(fd: FormData) {
  await q(
    `update social_accounts set status = case when status='disabled' then 'active' else 'disabled' end, updated_at=now()
      where id=$1`,
    [String(fd.get("account_id"))]
  );
  revalidatePath("/accounts");
}

export async function addSlotsAction(fd: FormData) {
  const accountId = String(fd.get("account_id"));
  const time = String(fd.get("at_time") || "");
  if (!/^\d{2}:\d{2}$/.test(time)) return;
  for (const wd of fd.getAll("weekday").map(Number).filter((n) => n >= 1 && n <= 7))
    await q(
      "insert into posting_slots (account_id, weekday, at_time) values ($1,$2,$3) on conflict do nothing",
      [accountId, wd, time]
    );
  revalidatePath("/accounts");
}

export async function deleteSlotAction(fd: FormData) {
  await q("delete from posting_slots where id=$1", [String(fd.get("slot_id"))]);
  revalidatePath("/accounts");
}

/* ───────── Настройки ───────── */

export async function saveWorkspaceAction(_: FormState, fd: FormData): Promise<FormState> {
  const raw = String(fd.get("timezone") || "");
  const tz = normalizeTz(raw);
  if (!tz) return { error: `Неизвестный часовой пояс: ${raw}` };
  await q("update workspaces set timezone=$2 where id=$1", [await defaultWorkspaceId(), tz]);
  for (const p of ["/settings", "/", "/calendar", "/accounts"]) revalidatePath(p);
  return { ok: `Сохранено: ${tz} (${tzLabel(tz)}). Слоты и календарь теперь считаются по этому поясу.` };
}

export async function createApiKeyAction(_: FormState, fd: FormData): Promise<FormState> {
  const name = String(fd.get("name") ?? "").trim() || "генератор";
  const k = newApiKey();
  await q("insert into api_keys (workspace_id, name, prefix, key_hash) values ($1,$2,$3,$4)", [
    await defaultWorkspaceId(),
    name,
    k.prefix,
    k.hash,
  ]);
  revalidatePath("/settings");
  return { ok: `Ключ «${name}» создан. Скопируйте его сейчас — больше он не покажется.`, secret: k.secret };
}

export async function revokeApiKeyAction(fd: FormData) {
  await q("update api_keys set revoked_at=now() where id=$1", [String(fd.get("key_id"))]);
  revalidatePath("/settings");
}

export async function saveTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  const name = String(fd.get("name") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  const kind = String(fd.get("kind")) === "hashtags" ? "hashtags" : "caption";
  if (!name || !body) return { error: "Заполните название и текст" };
  await q("insert into templates (workspace_id, kind, name, body) values ($1,$2,$3,$4)", [
    await defaultWorkspaceId(),
    kind,
    name,
    body,
  ]);
  revalidatePath("/settings");
  return { ok: `Шаблон «${name}» сохранён` };
}

export async function deleteTemplateAction(fd: FormData) {
  await q("delete from templates where id=$1", [String(fd.get("template_id"))]);
  revalidatePath("/settings");
}

export async function saveTelegramAction(_: FormState, fd: FormData): Promise<FormState> {
  const ws = await defaultWorkspaceId();
  const current = await getTelegram(ws);
  const token = String(fd.get("bot_token") ?? "").trim();
  const chatId = String(fd.get("chat_id") ?? "").trim();
  const events = fd.getAll("events").map(String) as EventName[];
  const tg = { ...current, chat_id: chatId || undefined, events, ...(token ? { bot_token_enc: encrypt(token) } : {}) };
  if (fd.get("disable")) delete tg.bot_token_enc;
  await q("update workspaces set settings = jsonb_set(settings, '{telegram}', $2::jsonb) where id=$1", [ws, JSON.stringify(tg)]);
  revalidatePath("/settings");
  if (fd.get("test") && tg.bot_token_enc && tg.chat_id) {
    try {
      await sendTelegram(tg.bot_token_enc, tg.chat_id, "🔔 Autopost: тестовое уведомление");
      return { ok: "Сохранено, тестовое сообщение отправлено" };
    } catch (e) {
      return { error: "Сохранено, но Telegram не принял сообщение", issues: [(e as Error).message] };
    }
  }
  return { ok: "Сохранено" };
}

export async function createWebhookAction(_: FormState, fd: FormData): Promise<FormState> {
  const url = String(fd.get("url") ?? "").trim();
  if (!/^https?:\/\//.test(url)) return { error: "Укажите URL (https://…)" };
  const events = fd.getAll("events").map(String);
  if (events.length === 0) return { error: "Выберите события" };
  const secret = "whsec_" + randomBytes(24).toString("base64url");
  await q("insert into webhooks (workspace_id, url, secret, events) values ($1,$2,$3,$4)", [
    await defaultWorkspaceId(),
    url,
    secret,
    events,
  ]);
  revalidatePath("/settings");
  return { ok: "Вебхук добавлен. Секрет для проверки подписи (X-Autopost-Signature, HMAC-SHA256):", secret };
}

export async function deleteWebhookAction(fd: FormData) {
  await q("delete from webhooks where id=$1", [String(fd.get("webhook_id"))]);
  revalidatePath("/settings");
}

export async function testWebhooksAction() {
  const ws = await defaultWorkspaceId();
  const acc = await one("select platform, username from social_accounts where workspace_id=$1 limit 1", [ws]);
  await emit(ws, "post.published", {
    test: true,
    platform: acc?.platform ?? "instagram",
    username: acc?.username ?? "test",
    permalink: null,
  });
  revalidatePath("/settings");
}
