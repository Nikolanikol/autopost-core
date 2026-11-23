// Вебхук Instagram: Meta сюда присылает события (комментарии, упоминания, сообщения).
//   GET  — проверка адреса при настройке (hub.challenge, сверяем IG_WEBHOOK_VERIFY_TOKEN).
//   POST — события; подлинность проверяем подписью X-Hub-Signature-256 (секрет приложения META_APP_SECRET).
// События складываются в ig_events «как есть» — из них потом строятся раздел комментариев и плашка упоминаний.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestWebhookComment } from "@/lib/comments";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const expected = process.env.IG_WEBHOOK_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === expected) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export async function POST(req: Request) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "META_APP_SECRET не задан" }, { status: 503 });
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), secret))
    return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  for (const entry of body.entry ?? []) {
    const igId = String(entry.id ?? "");
    const acc = igId ? (await q<{ id: string }>("select id from social_accounts where platform='instagram' and external_id=$1 limit 1", [igId]))[0] : undefined;
    const items: { field: string; payload: unknown }[] = [
      ...(entry.changes ?? []).map((c: any) => ({ field: String(c.field), payload: c.value ?? {} })),
      ...(entry.messaging ?? []).map((m: any) => ({ field: "messages", payload: m })),
    ];
    for (const it of items) {
      await q("insert into ig_events (account_id, ig_user_id, field, payload) values ($1,$2,$3,$4)", [
        acc?.id ?? null,
        igId || null,
        it.field,
        JSON.stringify(it.payload),
      ]);
      // Комментарий → в раздел «Комментарии» (+ правила автоответа). Ошибка тут не должна ронять приём события.
      if (it.field === "comments" && igId) {
        try {
          await ingestWebhookComment(igId, it.payload);
        } catch (e) {
          console.error("[webhook] comment ingest failed:", (e as Error).message);
        }
      }
    }
  }
  // Meta ждёт быстрый 200, иначе повторяет доставку.
  return NextResponse.json({ ok: true });
}
