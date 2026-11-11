import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { one, q } from "./db";
import { saveUpload } from "./storage";

const run = promisify(execFile);

export interface ProbeResult {
  kind: "image" | "video";
  mime: string | null;
  size: number | null;
  width?: number;
  height?: number;
  duration?: number;
  codecs?: string[];
  warnings: string[];
}

const kindOf = (mime: string | null, name: string): "image" | "video" =>
  mime?.startsWith("video/") || /\.(mp4|mov)(\?|$)/i.test(name) ? "video" : "image";

/** ffprobe: размеры, длительность, кодеки. Работает и с локальным файлом, и с URL. */
async function ffprobe(input: string, res: ProbeResult) {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", input],
      { timeout: 30_000 }
    );
    const info = JSON.parse(stdout);
    const v = info.streams?.find((s: any) => s.codec_type === "video");
    if (v) {
      res.width = v.width;
      res.height = v.height;
    }
    if (res.kind === "video") {
      res.duration = Number(info.format?.duration) || undefined;
      res.codecs = info.streams?.map((s: any) => s.codec_name);
      if (v && v.codec_name !== "h264" && v.codec_name !== "hevc")
        res.warnings.push(`Видео-кодек ${v.codec_name}: для Reels нужен H.264/HEVC`);
      const a = info.streams?.find((s: any) => s.codec_type === "audio");
      if (a && a.codec_name !== "aac") res.warnings.push(`Аудио-кодек ${a.codec_name}: для Reels нужен AAC`);
    }
  } catch {
    res.warnings.push("ffprobe недоступен — размеры и длительность не проверены");
  }
}

function mimeWarnings(res: ProbeResult) {
  if (res.kind === "image" && res.mime && res.mime !== "image/jpeg")
    res.warnings.push(`Instagram принимает только JPEG (сейчас ${res.mime})`);
}

/** Проверяет, что URL публичный, и снимает метаданные. */
export async function probeUrl(url: string): Promise<ProbeResult> {
  if (!/^https:\/\//.test(url)) throw new Error("Медиа должно быть доступно по публичному https-URL");
  const head = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    headers: { "user-agent": "autopost-core/0.1 (media check)" },
  }).catch(() => null);
  if (!head || !head.ok) throw new Error(`URL недоступен (HTTP ${head?.status ?? "ошибка сети"})`);
  const mime = head.headers.get("content-type")?.split(";")[0].trim() ?? null;
  const res: ProbeResult = { kind: kindOf(mime, url), mime, size: Number(head.headers.get("content-length")) || null, warnings: [] };
  mimeWarnings(res);
  await ffprobe(url, res);
  return res;
}

const INSERT = `insert into media (workspace_id, kind, public_url, storage_key, mime, size_bytes, width, height,
                                   duration_sec, validation, source, filename)
                values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`;

export async function registerMediaUrl(workspaceId: string, url: string) {
  // Тот же URL уже регистрировали — переиспользуем запись, а не плодим дубли в медиатеке.
  const existing = await one<{ id: string }>(
    "select * from media where workspace_id=$1 and public_url=$2 order by created_at desc limit 1",
    [workspaceId, url]
  );
  if (existing) return existing;
  const p = await probeUrl(url);
  return one<{ id: string }>(INSERT, [
    workspaceId, p.kind, url, null, p.mime, p.size, p.width ?? null, p.height ?? null, p.duration ?? null,
    JSON.stringify({ warnings: p.warnings, codecs: p.codecs ?? null }), "url", null,
  ]);
}

/** Сохраняет загруженный файл в хранилище и регистрирует его. */
export async function registerUpload(workspaceId: string, file: File) {
  if (file.size > 300 * 1024 * 1024) throw new Error("Файл больше 300 МБ");
  const s = await saveUpload(file);
  const p: ProbeResult = { kind: kindOf(s.mime, s.key), mime: s.mime, size: s.size, warnings: [] };
  mimeWarnings(p);
  await ffprobe(s.path, p);
  return one<{ id: string }>(INSERT, [
    workspaceId, p.kind, s.url, s.key, p.mime, p.size, p.width ?? null, p.height ?? null, p.duration ?? null,
    JSON.stringify({ warnings: p.warnings, codecs: p.codecs ?? null }), "upload", file.name || null,
  ]);
}

export function listMedia(workspaceId: string, limit = 60) {
  return q(
    `select m.*, (select count(*) from post_targets t where m.id = any(t.media_ids))::int as used
       from media m where workspace_id=$1 order by created_at desc limit $2`,
    [workspaceId, limit]
  );
}
