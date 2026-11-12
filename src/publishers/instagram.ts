// Instagram через Graph API (проверено 12.11.2026: фото и Reels, токен системного пользователя).
import {
  PlatformError,
  type AccountMetrics,
  type ErrorClass,
  type Issue,
  type MediaItem,
  type PostMetrics,
  type PublishContext,
  type Publisher,
} from "./types";

const VERSION = process.env.GRAPH_VERSION || "v24.0";

// Токены входа через Instagram начинаются с "IG", токены Facebook/системного пользователя — с "EAA".
const hostFor = (token: string) =>
  process.env.GRAPH_HOST || (token.startsWith("IG") ? "graph.instagram.com" : "graph.facebook.com");

async function api<T = any>(token: string, method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://${hostFor(token)}/${VERSION}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  let res: Response;
  try {
    res = method === "GET" ? await fetch(`${url}?${body}`) : await fetch(url, { method, body });
  } catch (e) {
    throw new PlatformError(`network: ${(e as Error).message}`, 0, undefined, undefined, true);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    throw new PlatformError(
      [e.message ?? `HTTP ${res.status}`, e.error_user_msg].filter(Boolean).join(" — "),
      res.status,
      e.code,
      e.error_subcode,
      Boolean(e.is_transient)
    );
  }
  return data as T;
}

const RATIO_MIN = 4 / 5;
const RATIO_MAX = 1.91;

export const instagram: Publisher = {
  platform: "instagram",

  validate(media: MediaItem[], options) {
    const issues: Issue[] = [];
    const type = (options.type as string) ?? (media[0]?.kind === "video" ? "reel" : "feed");
    if (media.length === 0) issues.push({ level: "error", message: "Instagram требует хотя бы одно медиа" });
    if (media.length > 1) issues.push({ level: "error", message: "Карусели пока не поддерживаются (этап 2)" });
    const m = media[0];
    if (m) {
      if (!m.public_url.startsWith("https://"))
        issues.push({
          level: "error",
          message: "Файл доступен только локально: Instagram скачивает медиа сам, нужен PUBLIC_BASE_URL с https (сервер или туннель)",
        });
      if (type === "reel" && m.kind !== "video") issues.push({ level: "error", message: "Reel должен быть видео" });
      if (type === "feed" && m.kind === "video")
        issues.push({ level: "error", message: "Видео в ленту публикуется как Reel (type=reel)" });
      if (m.kind === "image" && m.width && m.height) {
        const r = m.width / m.height;
        if (r < RATIO_MIN || r > RATIO_MAX)
          issues.push({ level: "error", message: `Пропорции фото ${r.toFixed(2)} вне диапазона 0.8–1.91` });
      }
      if (m.kind === "video" && m.duration_sec != null) {
        if (m.duration_sec < 3) issues.push({ level: "error", message: "Reel короче 3 секунд" });
        if (m.duration_sec > 900) issues.push({ level: "error", message: "Reel длиннее 15 минут" });
      }
      if (m.kind === "video" && m.width && m.height && Math.abs(m.width / m.height - 9 / 16) > 0.05)
        issues.push({ level: "warning", message: "Для Reels рекомендуется 9:16 — будут поля" });
    }
    return issues;
  },

  async start(ctx: PublishContext) {
    const m = ctx.media[0];
    const type = (ctx.options.type as string) ?? (m.kind === "video" ? "reel" : "feed");
    const params: Record<string, string> = {};
    if (type === "story") {
      params.media_type = "STORIES";
      params[m.kind === "video" ? "video_url" : "image_url"] = m.public_url;
    } else if (type === "reel") {
      params.media_type = "REELS";
      params.video_url = m.public_url;
      params.caption = ctx.caption;
      if (ctx.options.share_to_feed === false) params.share_to_feed = "false";
      if (typeof ctx.options.cover_url === "string") params.cover_url = ctx.options.cover_url;
    } else {
      params.image_url = m.public_url;
      params.caption = ctx.caption;
    }
    const r = await api<{ id: string }>(ctx.account.token, "POST", `${ctx.account.external_id}/media`, params);
    return { containerId: r.id };
  },

  async poll(ctx) {
    const s = await api<{ status_code: string; status?: string }>(ctx.account.token, "GET", ctx.containerId!, {
      fields: "status_code,status",
    });
    switch (s.status_code) {
      case "FINISHED":
        return { state: "ready" };
      case "PUBLISHED":
        return { state: "published" };
      case "IN_PROGRESS":
        return { state: "pending" };
      default:
        return { state: "error", message: `${s.status_code}: ${s.status ?? ""}`.trim() };
    }
  },

  async finish(ctx) {
    const { id } = await api<{ id: string }>(ctx.account.token, "POST", `${ctx.account.external_id}/media_publish`, {
      creation_id: ctx.containerId!,
    });
    const m = await api<{ permalink?: string }>(ctx.account.token, "GET", id, { fields: "permalink" }).catch(() => ({}) as { permalink?: string });
    return { externalId: id, permalink: m.permalink ?? null };
  },

  classifyError(e): ErrorClass {
    if (!(e instanceof PlatformError)) return "retry";
    if (e.code === 190 || e.code === 102 || e.code === 10 || e.code === 200) return "reauth";
    if ([4, 17, 32, 613].includes(e.code ?? -1) || e.subcode === 2207042) return "rate_limit";
    if (e.isTransient || e.status === 0 || e.status >= 500 || e.code === 1 || e.code === 2) return "retry";
    return "fatal";
  },

  async verifyAccount(externalId, token) {
    const me = await api<{ username: string }>(token, "GET", externalId, { fields: "id,username" });
    return { username: me.username };
  },

  async quota(externalId, token) {
    const r = await api<{ data: { quota_usage: number; config?: { quota_total: number } }[] }>(
      token,
      "GET",
      `${externalId}/content_publishing_limit`,
      { fields: "quota_usage,config" }
    );
    const d = r.data?.[0];
    return d ? { used: d.quota_usage, total: d.config?.quota_total ?? 100 } : null;
  },

  async postMetrics(mediaId, token) {
    const out: PostMetrics = { raw: {}, notes: [] };
    // Базовые счётчики доступны с instagram_basic.
    const basic = await api<{ like_count?: number; comments_count?: number; media_product_type?: string }>(
      token,
      "GET",
      mediaId,
      { fields: "like_count,comments_count,media_product_type" }
    );
    out.likes = basic.like_count ?? null;
    out.comments = basic.comments_count ?? null;
    out.raw.basic = basic;
    // Расширенные — нужен instagram_manage_insights (или instagram_business_manage_insights).
    const ins = await insights(token, `${mediaId}/insights`, ["reach", "saved", "shares", "views"], {}, out.notes);
    out.raw.insights = ins;
    out.reach = ins.reach ?? null;
    out.saves = ins.saved ?? null;
    out.shares = ins.shares ?? null;
    out.views = ins.views ?? null;
    return out;
  },

  async accountMetrics(externalId, token) {
    const out: AccountMetrics = { raw: {}, notes: [] };
    const basic = await api<{ followers_count?: number; media_count?: number }>(token, "GET", externalId, {
      fields: "followers_count,media_count",
    });
    out.followers = basic.followers_count ?? null;
    out.media_count = basic.media_count ?? null;
    out.raw.basic = basic;
    const ins = await insights(token, `${externalId}/insights`, ["reach", "views"], { period: "day", metric_type: "total_value" }, out.notes);
    out.raw.insights = ins;
    out.reach_day = ins.reach ?? null;
    out.views_day = ins.views ?? null;
    return out;
  },
};

/**
 * Запрашивает insights; при «неизвестной метрике» пробует метрики по одной,
 * при нехватке прав — возвращает пусто и пишет заметку (аккаунт не трогаем).
 */
async function insights(
  token: string,
  path: string,
  metrics: string[],
  extra: Record<string, string>,
  notes: string[]
): Promise<Record<string, number>> {
  const parse = (r: { data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }) =>
    Object.fromEntries(
      (r.data ?? []).map((m) => [m.name, m.total_value?.value ?? m.values?.[m.values.length - 1]?.value ?? 0])
    ) as Record<string, number>;
  try {
    return parse(await api(token, "GET", path, { metric: metrics.join(","), ...extra }));
  } catch (e) {
    if (e instanceof PlatformError && (e.code === 10 || e.code === 200 || e.code === 190)) {
      notes.push(`insights недоступны: ${e.message}`);
      return {};
    }
    if (metrics.length === 1) {
      notes.push(`${metrics[0]}: ${(e as Error).message}`);
      return {};
    }
    const res: Record<string, number> = {};
    for (const m of metrics) Object.assign(res, await insights(token, path, [m], extra, notes));
    return res;
  }
}
