// Локальное хранилище медиа: файлы в STORAGE_DIR, раздаются публично по /media/<key>.
// Instagram и TikTok скачивают медиа сами, поэтому PUBLIC_BASE_URL должен быть публичным https.
// Позже сюда же добавится драйвер Cloudflare R2 с тем же интерфейсом.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";

export const STORAGE_DIR = resolve(process.env.STORAGE_DIR || "storage");

const MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

export const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([m, e]) => [e, m])
);
EXT_MIME[".jpeg"] = "image/jpeg";

export function publicBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
}

export async function saveUpload(file: File) {
  const ext = MIME_EXT[file.type] ?? extname(file.name).toLowerCase();
  if (!EXT_MIME[ext]) throw new Error(`Формат ${file.type || ext} не поддерживается (JPEG, PNG, WebP, MP4, MOV)`);
  const now = new Date();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}${ext}`;
  const path = pathFor(key)!;
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  return { key, path, url: `${publicBaseUrl()}/media/${key}`, mime: EXT_MIME[ext], size: (await stat(path)).size };
}

/** Безопасно превращает ключ в путь (без выхода за STORAGE_DIR). */
export function pathFor(key: string): string | null {
  const p = resolve(STORAGE_DIR, key);
  return p.startsWith(STORAGE_DIR + "/") ? p : null;
}
