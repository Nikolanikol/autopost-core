import { NextResponse } from "next/server";
import { handler, HttpError, requireApiKey } from "@/lib/apiAuth";
import { z } from "zod";
import { cancelPost, getPost, reschedulePost } from "@/lib/posts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function load(req: Request, ctx: Ctx) {
  const ws = await requireApiKey(req);
  const { id } = await ctx.params;
  const post = /^[0-9a-f-]{36}$/i.test(id) ? await getPost(id) : null;
  if (!post || post.workspace_id !== ws) throw new HttpError(404, "Пост не найден");
  return post;
}

export const GET = handler(async (req: Request, ctx: Ctx) => NextResponse.json(await load(req, ctx)));

/**
 * Перенести запланированный пост: { "scheduled_at": "2026-11-15T10:00:00+09:00" }.
 * Работает только для постов в статусе scheduled и только на будущее время.
 */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const post = await load(req, ctx);
  const { scheduled_at } = z.object({ scheduled_at: z.string().datetime({ offset: true }) }).parse(await req.json());
  const at = new Date(scheduled_at);
  if (at.getTime() < Date.now()) throw new HttpError(422, "Нельзя перенести в прошлое");
  if (!(await reschedulePost(post.id, at)))
    throw new HttpError(409, `Переносить можно только запланированные посты (сейчас: ${post.status})`);
  return NextResponse.json(await getPost(post.id));
});

/** Отменить ещё не опубликованные цели поста. */
export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const post = await load(req, ctx);
  await cancelPost(post.id);
  return NextResponse.json(await getPost(post.id));
});
