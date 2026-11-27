// Личные сообщения Instagram: приём (вебхук и опрос), диалоги, ответы.
// Отвечать можно только в течение 24 часов после последнего сообщения человека — дальше Instagram не даст.
import { decrypt } from "./crypto";
import { one, q } from "./db";
import { publisherFor } from "@/publishers";

export const REPLY_WINDOW_H = 24;

type AccountCtx = { id: string; external_id: string; username: string | null; platform: string; token: string };

async function accountCtx(accountId: string): Promise<AccountCtx> {
  const a = await one<any>("select id, external_id, username, platform, token_enc from social_accounts where id=$1 and status='active'", [accountId]);
  if (!a) throw new Error("Аккаунт не найден или не активен");
  return { id: a.id, external_id: a.external_id, username: a.username, platform: a.platform, token: decrypt(a.token_enc) };
}

type InMessage = {
  external_id: string;
  direction: "in" | "out";
  text: string;
  attachments?: { type: string; url: string | null }[];
  sent_at: Date;
};

/** Диалог по (аккаунт, собеседник): создаём при первом сообщении. */
async function upsertConversation(accountId: string, participantId: string, username: string | null, externalId: string | null) {
  const row = await one<{ id: string }>(
    `insert into ig_conversations (account_id, participant_id, participant_username, external_id)
     values ($1,$2,$3,$4)
     on conflict (account_id, participant_id) do update
       set participant_username = coalesce(ig_conversations.participant_username, excluded.participant_username),
           external_id = coalesce(ig_conversations.external_id, excluded.external_id)
     returning id`,
    [accountId, participantId, username, externalId]
  );
  return row!.id;
}

/** Сохранить сообщение. false — такое уже есть (вебхук и опрос присылают одно и то же). */
async function addMessage(accountId: string, conversationId: string, m: InMessage, source: "webhook" | "poll" | "api"): Promise<boolean> {
  // Идентификатор из вебхука и из опроса может отличаться — страхуемся совпадением по тексту и времени
  // (только среди сообщений из другого источника: два одинаковых «?» подряд от человека не склеиваем).
  const twin = await one(
    `select 1 from ig_messages where conversation_id=$1 and direction=$2 and text=$3 and source<>$5
        and abs(extract(epoch from (sent_at - $4::timestamptz))) < 120 limit 1`,
    [conversationId, m.direction, m.text, m.sent_at.toISOString(), source]
  );
  if (twin) return false;
  const row = await one<{ id: string }>(
    `insert into ig_messages (conversation_id, account_id, external_id, direction, text, attachments, sent_at, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (account_id, external_id) do nothing returning id`,
    [conversationId, accountId, m.external_id, m.direction, m.text, JSON.stringify(m.attachments ?? []), m.sent_at.toISOString(), source]
  );
  return Boolean(row);
}

/** Пересчитать «шапку» диалога по последнему сообщению. Новое входящее возвращает отложенный диалог в «новые». */
async function refreshConversation(conversationId: string) {
  const last = await one<any>("select direction, text, sent_at, attachments from ig_messages where conversation_id=$1 order by sent_at desc limit 1", [conversationId]);
  if (!last) return;
  const lastIn = await one<any>("select max(sent_at) as t from ig_messages where conversation_id=$1 and direction='in'", [conversationId]);
  const conv = await one<any>("select status, last_message_at from ig_conversations where id=$1", [conversationId]);
  const hasNewIncoming = last.direction === "in" && (!conv.last_message_at || new Date(last.sent_at) > new Date(conv.last_message_at));
  let status: string = last.direction === "out" ? "replied" : conv.status === "ignored" && !hasNewIncoming ? "ignored" : "new";
  const preview = last.text || (last.attachments?.length ? "[вложение]" : "");
  await q(
    `update ig_conversations set status=$2, last_message_at=$3, last_incoming_at=$4, last_text=$5, updated_at=now() where id=$1`,
    [conversationId, status, last.sent_at, lastIn?.t ?? null, preview.slice(0, 300)]
  );
}

/** Вебхук: одно событие messaging. Реакции, прочтения и т. п. (без message) пропускаем. */
export async function ingestWebhookMessage(igUserId: string, ev: any) {
  const msg = ev?.message;
  const senderId = ev?.sender?.id ? String(ev.sender.id) : "";
  const recipientId = ev?.recipient?.id ? String(ev.recipient.id) : "";
  if (!msg?.mid || !senderId || !recipientId) return null;
  const a = await one<{ id: string }>("select id from social_accounts where platform='instagram' and external_id=$1 and status='active' limit 1", [igUserId]);
  if (!a) return null;
  const acc = await accountCtx(a.id);

  const out = senderId === acc.external_id || Boolean(msg.is_echo);
  const participantId = out ? recipientId : senderId;
  const existing = await one<{ participant_username: string | null }>(
    "select participant_username from ig_conversations where account_id=$1 and participant_id=$2",
    [acc.id, participantId]
  );
  let username = existing?.participant_username ?? null;
  if (!username) {
    try {
      username = (await publisherFor(acc.platform).profileUsername?.(participantId, acc.token)) ?? null;
    } catch {
      /* имя подтянет опрос */
    }
  }
  const convId = await upsertConversation(acc.id, participantId, username, null);
  const attachments = (msg.attachments ?? []).map((x: any) => ({ type: String(x.type ?? "attachment"), url: x.payload?.url ?? null }));
  const added = await addMessage(
    acc.id,
    convId,
    {
      external_id: String(msg.mid),
      direction: out ? "out" : "in",
      text: String(msg.text ?? ""),
      attachments,
      sent_at: ev.timestamp ? new Date(Number(ev.timestamp)) : new Date(),
    },
    "webhook"
  );
  if (added) await refreshConversation(convId);
  return { conversationId: convId, added };
}

/** Опрос: подхватывает диалоги и сообщения, которые не дошли вебхуком или были написаны с телефона. */
export async function syncMessages(accountId: string, opts: { sinceDays?: number } = {}) {
  const acc = await accountCtx(accountId);
  const pub = publisherFor(acc.platform);
  if (!pub.listConversations) return { conversations: 0, added: 0 };
  const since = Date.now() - (opts.sinceDays ?? 30) * 86400e3;
  const list = await pub.listConversations(acc.external_id, acc.token, { limit: 25, messagesPerConversation: 15 });
  let added = 0, conversations = 0;
  for (const c of list) {
    if (c.updated_time && new Date(c.updated_time).getTime() < since) continue;
    const other = c.participants.find((p) => p.id !== acc.external_id);
    if (!other) continue;
    const convId = await upsertConversation(acc.id, other.id, other.username, c.external_id);
    conversations++;
    let changed = false;
    // Сначала старые: иначе «последнее» сообщение определится неверно, если часть уже сохранена вебхуком.
    for (const m of [...c.messages].sort((x, y) => new Date(x.timestamp ?? 0).getTime() - new Date(y.timestamp ?? 0).getTime())) {
      if (!m.from_id) continue;
      const ok = await addMessage(
        acc.id,
        convId,
        {
          external_id: m.external_id,
          direction: m.from_id === acc.external_id ? "out" : "in",
          text: m.text,
          attachments: m.attachments,
          sent_at: m.timestamp ? new Date(m.timestamp) : new Date(),
        },
        "poll"
      );
      if (ok) { added++; changed = true; }
    }
    const conv = await one<{ last_message_at: string | null }>("select last_message_at from ig_conversations where id=$1", [convId]);
    if (changed || !conv?.last_message_at) await refreshConversation(convId);
  }
  return { conversations, added };
}

/** Можно ли ещё ответить: прошло меньше суток с последнего сообщения человека. */
export function replyWindow(lastIncomingAt: string | Date | null): { open: boolean; hoursLeft: number } {
  if (!lastIncomingAt) return { open: false, hoursLeft: 0 };
  const left = REPLY_WINDOW_H - (Date.now() - new Date(lastIncomingAt).getTime()) / 3600e3;
  return { open: left > 0, hoursLeft: Math.max(0, Math.round(left * 10) / 10) };
}

/** Ответить в диалог. Ошибка возвращается текстом, а не бросается — как в perform() для комментариев. */
export async function replyToConversation(conversationId: string, text: string): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const c = await one<any>("select * from ig_conversations where id=$1", [conversationId]);
  if (!c) throw new Error("Диалог не найден");
  const body = text.trim();
  if (!body) return { ok: false, error: "Пустой текст" };
  const w = replyWindow(c.last_incoming_at);
  if (!w.open) {
    const err = `Окно ответа закрыто: человек писал больше ${REPLY_WINDOW_H} часов назад — Instagram не принимает такие сообщения`;
    await q("update ig_conversations set last_error=$2, updated_at=now() where id=$1", [conversationId, err]);
    return { ok: false, error: err };
  }
  const acc = await accountCtx(c.account_id);
  const pub = publisherFor(acc.platform);
  try {
    const r = await pub.sendMessage!(acc.external_id, c.participant_id, body, acc.token);
    await addMessage(acc.id, conversationId, { external_id: r.id, direction: "out", text: body, sent_at: new Date() }, "api");
    await q("update ig_conversations set last_error=null where id=$1", [conversationId]);
    await refreshConversation(conversationId);
    return { ok: true, messageId: r.id };
  } catch (e) {
    const err = (e as Error).message;
    await q("update ig_conversations set last_error=$2, updated_at=now() where id=$1", [conversationId, err]);
    return { ok: false, error: err };
  }
}

/** Не требует ответа. Новое сообщение от человека вернёт диалог в «новые». */
export async function ignoreConversation(conversationId: string) {
  await q("update ig_conversations set status='ignored', updated_at=now() where id=$1", [conversationId]);
}
