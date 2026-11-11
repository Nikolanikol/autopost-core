import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { EXT_MIME, pathFor } from "@/lib/storage";

export const runtime = "nodejs";

// Публичная раздача загруженных файлов (Instagram/TikTok скачивают их отсюда).
// Ключи — случайные UUID, перечислить файлы нельзя. Поддерживается Range для видео.
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const path = pathFor(key.join("/"));
  const info = path ? await stat(path).catch(() => null) : null;
  if (!path || !info?.isFile()) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "content-type": EXT_MIME[extname(path).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
  };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${info.size}` } });
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${info.size}` },
    });
  }
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "content-length": String(info.size) } });
}

export async function HEAD(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const r = await GET(req, ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
