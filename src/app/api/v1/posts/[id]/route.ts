import { NextResponse } from "next/server";
import { handler, HttpError, requireApiKey } from "@/lib/apiAuth";
import { cancelPost, getPost } from "@/lib/posts";

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

/** Отменить ещё не опубликованные цели поста. */
export const DELETE = handler(async (req: Request, ctx: Ctx) => {
  const post = await load(req, ctx);
  await cancelPost(post.id);
  return NextResponse.json(await getPost(post.id));
});
