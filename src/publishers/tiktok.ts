// TikTok: Content Posting API, режим «загрузка в черновики» (inbox upload, scope video.upload).
// Видео попадает в черновики приложения TikTok на телефоне владельца аккаунта, публикует его человек
// (подпись и настройки добавляются там). Аудит приложения для этого режима не нужен.
// Файл передаётся напрямую (FILE_UPLOAD, чанками) — проверять домен в кабинете TikTok не требуется.
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathFor } from "@/lib/storage";
import {
  PlatformError,
  type ErrorClass,
  type Issue,
  type MediaItem,
  type PollResult,
  type PublishContext,
  type Publisher,
} from "./types";

export const TIKTOK_API = "https://open.tiktokapis.com";

/** Ошибка TikTok: строковый код из поля error.code (access_token_invalid, rate_limit_exceeded …). */
export class TikTokError extends PlatformError {
  constructor(message: string, status: number, public tcode: string) {
    super(message, status, undefined, undefined, status === 0 || status >= 500);
  }
}

export async function tiktokApi<T = any>(
  token: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${TIKTOK_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json; charset=UTF-8" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new TikTokError(`network: ${(e as Error).message}`, 0, "network");
  }
  const data: any = await res.json().catch(() => ({}));
  const code: string = data?.error?.code ?? (res.ok ? "ok" : "http_error");
  if (!res.ok || code !== "ok") {
    throw new TikTokError(data?.error?.message || `HTTP ${res.status}`, res.status, code);
  }
  return data as T;
}

const MB = 1024 * 1024;
const MAX_DURATION_SEC = 600; // 10 минут — безопасный потолок для загрузки через API

/** Размер чанков по правилам TikTok: до 64 МБ — одним куском, иначе по 32 МБ (последний — с остатком, < 64 МБ). */
export function chunkPlan(size: number) {
  if (size <= 64 * MB) return { chunk: size, count: 1 };
  const chunk = 32 * MB;
  return { chunk, count: Math.floor(size / chunk) };
}

/** Локальный путь к файлу: из хранилища, либо скачиваем по URL во временный файл. */
async function materialize(m: MediaItem): Promise<{ path: string; size: number; cleanup: () => Promise<void> }> {
  const local = m.storage_key ? pathFor(m.storage_key) : null;
  if (local) {
    const s = await stat(local).catch(() => null);
    if (s?.isFile()) return { path: local, size: s.size, cleanup: async () => {} };
  }
  const dir = await mkdtemp(join(tmpdir(), "tiktok-"));
  const path = join(dir, "video");
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const res = await fetch(m.public_url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(path));
    return { path, size: (await stat(path)).size, cleanup };
  } catch (e) {
    await cleanup();
    throw new TikTokError(`Не удалось скачать видео ${m.public_url}: ${(e as Error).message}`, 0, "download_failed");
  }
}

async function putChunks(uploadUrl: string, path: string, size: number, mime: string, plan: { chunk: number; count: number }) {
  const fh = await open(path, "r");
  try {
    for (let i = 0; i < plan.count; i++) {
      const start = i * plan.chunk;
      const end = i === plan.count - 1 ? size - 1 : start + plan.chunk - 1;
      const buf = Buffer.alloc(end - start + 1);
      await fh.read(buf, 0, buf.length, start);
      let res: Response;
      try {
        res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "content-type": mime,
            "content-length": String(buf.length),
            "content-range": `bytes ${start}-${end}/${size}`,
          },
          body: buf,
          signal: AbortSignal.timeout(10 * 60_000),
        });
      } catch (e) {
        throw new TikTokError(`Загрузка файла: ${(e as Error).message}`, 0, "network");
      }
      if (res.status !== 201 && res.status !== 206 && res.status !== 200)
        throw new TikTokError(`Загрузка файла: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`, res.status, "upload_failed");
    }
  } finally {
    await fh.close();
  }
}

export const tiktok: Publisher = {
  platform: "tiktok",
  draftOnly: true,

  validate(media: MediaItem[], options) {
    const issues: Issue[] = [];
    if (media.length === 0) issues.push({ level: "error", message: "TikTok требует видео" });
    if (media.length > 1) issues.push({ level: "error", message: "TikTok: одно видео на пост" });
    const m = media[0];
    if (m) {
      if (m.kind !== "video") issues.push({ level: "error", message: "TikTok: пока только видео (фото-посты не поддерживаются)" });
      if (m.kind === "video" && m.duration_sec != null && m.duration_sec > MAX_DURATION_SEC)
        issues.push({ level: "error", message: `Видео длиннее ${MAX_DURATION_SEC / 60} минут` });
      if (m.kind === "video" && m.width && m.height && Math.abs(m.width / m.height - 9 / 16) > 0.05)
        issues.push({ level: "warning", message: "Для TikTok рекомендуется 9:16 — будут поля" });
    }
    if (options.first_comment) issues.push({ level: "warning", message: "TikTok: первый комментарий не поддерживается — игнорируется" });
    issues.push({
      level: "warning",
      message: "TikTok: видео попадёт в черновики приложения, подпись нужно вставить и опубликовать вручную (текст придёт в Telegram)",
    });
    return issues;
  },

  /** Загружает видео в черновики. containerId = publish_id. */
  async start(ctx: PublishContext) {
    const m = ctx.media[0];
    const file = await materialize(m);
    try {
      const plan = chunkPlan(file.size);
      const init = await tiktokApi<{ data: { publish_id: string; upload_url: string } }>(
        ctx.account.token,
        "POST",
        "/v2/post/publish/inbox/video/init/",
        {
          source_info: {
            source: "FILE_UPLOAD",
            video_size: file.size,
            chunk_size: plan.chunk,
            total_chunk_count: plan.count,
          },
        }
      );
      await putChunks(init.data.upload_url, file.path, file.size, (m as any).mime || "video/mp4", plan);
      return { containerId: init.data.publish_id };
    } finally {
      await file.cleanup();
    }
  },

  async poll(ctx): Promise<PollResult> {
    const r = await tiktokApi<{ data: { status: string; fail_reason?: string } }>(
      ctx.account.token,
      "POST",
      "/v2/post/publish/status/fetch/",
      { publish_id: ctx.containerId }
    );
    switch (r.data.status) {
      case "SEND_TO_USER_INBOX":
        return { state: "ready" };
      case "PUBLISH_COMPLETE":
        return { state: "published" };
      case "FAILED":
        return { state: "error", message: r.data.fail_reason ?? "FAILED" };
      default:
        return { state: "pending" }; // PROCESSING_UPLOAD / PROCESSING_DOWNLOAD
    }
  },

  async finish(ctx) {
    // Публиковать нечего: видео уже в черновиках, дальше — человек в приложении.
    return { externalId: ctx.containerId!, permalink: null };
  },

  classifyError(e): ErrorClass {
    if (!(e instanceof TikTokError)) return "retry";
    switch (e.tcode) {
      case "access_token_invalid":
      case "scope_not_authorized":
      case "scope_permission_missed":
      case "invalid_grant":
      case "token_not_authorized_for_specified_user":
        return "reauth";
      case "rate_limit_exceeded":
      case "spam_risk_too_many_pending_share": // слишком много неопубликованных черновиков
      case "spam_risk_too_many_posts":
        return "rate_limit";
      case "internal_error":
      case "network":
        return "retry";
    }
    if (e.status === 401) return "reauth";
    if (e.status === 429) return "rate_limit";
    if (e.isTransient || e.status === 0 || e.status >= 500) return "retry";
    return "fatal";
  },

  async verifyAccount(externalId, token) {
    const r = await tiktokApi<{ data: { user: { open_id: string; display_name?: string; username?: string } } }>(
      token,
      "GET",
      "/v2/user/info/?fields=open_id,display_name"
    );
    return { username: r.data.user.username ?? r.data.user.display_name ?? externalId };
  },
};
