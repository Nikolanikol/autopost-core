import { NextResponse } from "next/server";
import { handler, requireApiKey } from "@/lib/apiAuth";
import { createPost, listPosts } from "@/lib/posts";

export const runtime = "nodejs";

/** Создать пост. Повтор с тем же idempotency_key вернёт уже созданный пост (200 вместо 201). */
export const POST = handler(async (req: Request) => {
  const ws = await requireApiKey(req);
  const body = await req.json();
  const source = req.headers.get("x-source") === "generator" ? "generator" : "api";
  const r = await createPost(ws, body, source);
  return NextResponse.json(r, { status: r.created ? 201 : 200 });
});

export const GET = handler(async (req: Request) => {
  const ws = await requireApiKey(req);
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 50, 200);
  return NextResponse.json({ data: await listPosts(ws, limit) });
});
