// Instagram через Graph API (проверено 12.11.2026: фото и Reels, токен системного пользователя).
import {
  PlatformError,
  type AccountMetrics,
  type ErrorClass,
  type Issue,
  type MediaItem,
  type CommentItem,
  type MediaListItem,
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
      const o = options as Record<string, unknown>;
      if (o.first_comment != null && (typeof o.first_comment !== "string" || o.first_comment.length > 2200))
        issues.push({ level: "error", message: "Первый комментарий: текст до 2200 символов" });
      if (o.ai_generated != null && typeof o.ai_generated !== "boolean")
        issues.push({ level: "error", message: "ai_generated: нужно true или false" });
      if (o.cover_offset_ms != null) {
        const n = Number(o.cover_offset_ms);
        if (!Number.isFinite(n) || n < 0) issues.push({ level: "error", message: "Кадр обложки: время в миллисекундах от начала, не меньше 0" });
        else if (m.duration_sec != null && n / 1000 > m.duration_sec)
          issues.push({ level: "error", message: `Кадр обложки (${(n / 1000).toFixed(1)} с) за пределами видео (${m.duration_sec} с)` });
        if (type !== "reel") issues.push({ level: "warning", message: "Обложка по кадру применяется только к Reels" });
        if (typeof o.cover_url === "string") issues.push({ level: "warning", message: "Заданы и cover_url, и кадр обложки — Instagram использует cover_url" });
      }
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
    // Метка «создано ИИ» (AI info): параметр контейнера публикации.
    if (ctx.options.ai_generated === true) params.is_ai_generated = "true";
    if (type === "story") {
      params.media_type = "STORIES";
      params[m.kind === "video" ? "video_url" : "image_url"] = m.public_url;
    } else if (type === "reel") {
      params.media_type = "REELS";
      params.video_url = m.public_url;
      params.caption = ctx.caption;
      if (ctx.options.share_to_feed === false) params.share_to_feed = "false";
      if (typeof ctx.options.cover_url === "string") params.cover_url = ctx.options.cover_url;
      // Обложка по кадру видео: смещение в миллисекундах (cover_url, если задан, имеет приоритет).
      else if (ctx.options.cover_offset_ms != null && Number.isFinite(Number(ctx.options.cover_offset_ms)))
        params.thumb_offset = String(Math.max(0, Math.round(Number(ctx.options.cover_offset_ms))));
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

  /** Все публикации аккаунта (лента и Reels), новые первыми. Истории сюда не попадают. */
  async listMedia(externalId, token, limit) {
    const items: MediaListItem[] = [];
    let after: string | undefined;
    while (items.length < limit) {
      const r = await api<{
        data: any[];
        paging?: { cursors?: { after?: string }; next?: string };
      }>(token, "GET", `${externalId}/media`, {
        fields: "id,media_product_type,media_type,caption,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count",
        limit: "50",
        ...(after ? { after } : {}),
      });
      for (const m of r.data ?? []) {
        items.push({
          external_id: m.id,
          product_type: m.media_product_type ?? null,
          media_type: m.media_type ?? null,
          caption: m.caption ?? null,
          permalink: m.permalink ?? null,
          thumbnail_url: m.thumbnail_url ?? (m.media_type === "IMAGE" ? m.media_url : null) ?? null,
          posted_at: m.timestamp ?? null,
          likes: m.like_count ?? null,
          comments: m.comments_count ?? null,
        });
      }
      after = r.paging?.next ? r.paging.cursors?.after : undefined;
      if (!after || !r.data?.length) break;
    }
    return items.slice(0, limit);
  },

  async mediaInsights(mediaId, productType, token) {
    const notes: string[] = [];
    const reel = productType === "REELS";
    const metrics = ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions"];
    if (reel) metrics.push("ig_reels_avg_watch_time", "ig_reels_video_view_total_time");
    const ins = await insights(token, `${mediaId}/insights`, metrics, {}, notes);
    return {
      reach: ins.reach ?? null,
      views: ins.views ?? null,
      likes: ins.likes ?? null,
      comments: ins.comments ?? null,
      shares: ins.shares ?? null,
      saves: ins.saved ?? null,
      total_interactions: ins.total_interactions ?? null,
      avg_watch_ms: ins.ig_reels_avg_watch_time ?? null,
      total_watch_ms: ins.ig_reels_video_view_total_time ?? null,
      notes,
    };
  },

  /** Итоги аккаунта за одни сутки (UTC): окно since…until = [день, день+24ч). */
  async dailyInsights(externalId, token, dayStartUtc) {
    const notes: string[] = [];
    const since = Math.floor(dayStartUtc.getTime() / 1000);
    const ins = await insights(
      token,
      `${externalId}/insights`,
      ["reach", "views", "likes", "comments", "shares", "saves", "total_interactions", "profile_views", "accounts_engaged"],
      { period: "day", metric_type: "total_value", since: String(since), until: String(since + 86400) },
      notes
    );
    const win = { since: String(since), until: String(since + 86400) };
    // Подписки/отписки: FOLLOWER — подписались, NON_FOLLOWER — отписались (по данным Meta).
    const fu = await breakdown(token, `${externalId}/insights`, "follows_and_unfollows", "follow_type", win, notes);
    // Клики по ссылке и кнопкам профиля (звонок, SMS, письмо, маршрут …).
    const taps = await breakdown(token, `${externalId}/insights`, "profile_links_taps", "contact_button_type", win, notes);
    const tapsMap = Object.fromEntries(taps.results.map((r) => [r.key, r.value]));
    return {
      reach: ins.reach ?? null,
      views: ins.views ?? null,
      likes: ins.likes ?? null,
      comments: ins.comments ?? null,
      shares: ins.shares ?? null,
      saves: ins.saves ?? null,
      total_interactions: ins.total_interactions ?? null,
      profile_views: ins.profile_views ?? null,
      accounts_engaged: ins.accounts_engaged ?? null,
      follows: fu.results.length || fu.total != null ? (fu.results.find((r) => r.key === "FOLLOWER")?.value ?? 0) : null,
      unfollows: fu.results.length || fu.total != null ? (fu.results.find((r) => r.key === "NON_FOLLOWER")?.value ?? 0) : null,
      link_taps_total: taps.total ?? taps.results.reduce((a, r) => a + r.value, 0),
      link_taps: tapsMap,
      notes,
    };
  },

  /** Когда подписчики онлайн: часы 0–23 по каждому дню за последние 28 дней. */
  async onlineFollowers(externalId, token) {
    const until = Math.floor(Date.now() / 86400e3) * 86400;
    const r = await api<{ data: { values?: { value: Record<string, number>; end_time: string }[] }[] }>(
      token,
      "GET",
      `${externalId}/insights`,
      { metric: "online_followers", period: "lifetime", since: String(until - 28 * 86400), until: String(until) }
    );
    return (r.data?.[0]?.values ?? [])
      .filter((v) => v.value && Object.keys(v.value).length > 0)
      .map((v) => ({ day: new Date(new Date(v.end_time).getTime() - 86400e3).toISOString().slice(0, 10), hours: v.value }));
  },

  /** Чужие публикации с отметкой нашего аккаунта. */
  async listTags(externalId, token) {
    const r = await api<{ data: any[] }>(token, "GET", `${externalId}/tags`, {
      fields: "id,username,caption,permalink,media_url,timestamp,like_count,comments_count",
      limit: "50",
    });
    return (r.data ?? []).map((m) => ({
      external_id: m.id,
      username: m.username ?? null,
      caption: m.caption ?? null,
      permalink: m.permalink ?? null,
      media_url: m.media_url ?? null,
      posted_at: m.timestamp ?? null,
      like_count: m.like_count ?? null,
      comments_count: m.comments_count ?? null,
    }));
  },

  async listRecentComments(externalId, token, { maxMedia, sinceDays }) {
    const out: CommentItem[] = [];
    const media = await api<{ data: { id: string; permalink?: string; comments_count?: number; timestamp?: string }[] }>(
      token, "GET", `${externalId}/media`, { fields: "id,permalink,comments_count,timestamp", limit: "30" }
    );
    const since = Date.now() - sinceDays * 86400e3;
    const targets = (media.data ?? [])
      .filter((m) => (m.comments_count ?? 0) > 0 && (!m.timestamp || new Date(m.timestamp).getTime() >= since))
      .slice(0, maxMedia);
    for (const m of targets) {
      const r = await api<{ data: any[] }>(token, "GET", `${m.id}/comments`, {
        fields: "id,text,username,timestamp,hidden,replies{id,text,username}",
        limit: "50",
      });
      for (const c of r.data ?? []) {
        out.push({
          external_id: c.id,
          media_id: m.id,
          media_permalink: m.permalink ?? null,
          parent_id: null,
          username: c.username ?? null,
          from_id: null,
          text: c.text ?? "",
          timestamp: c.timestamp ?? null,
          hidden: Boolean(c.hidden),
          replies: (c.replies?.data ?? []).map((x: any) => ({ id: x.id, username: x.username ?? null, text: x.text ?? "" })),
        });
      }
    }
    return out;
  },

  async commentOnMedia(mediaId, text, token) {
    const r = await api<{ id: string }>(token, "POST", `${mediaId}/comments`, { message: text });
    return { id: r.id };
  },

  async replyToComment(commentId, text, token) {
    const r = await api<{ id: string }>(token, "POST", `${commentId}/replies`, { message: text });
    return { id: r.id };
  },

  async hideComment(commentId, hide, token) {
    await api(token, "POST", commentId, { hide: hide ? "true" : "false" });
  },

  async listConversations(externalId, token, { limit, messagesPerConversation }) {
    const r = await api<{ data: any[] }>(token, "GET", `${externalId}/conversations`, {
      platform: "instagram",
      fields: `id,updated_time,participants,messages.limit(${messagesPerConversation}){id,created_time,from,message,attachments,is_unsupported}`,
      limit: String(limit),
    });
    return (r.data ?? []).map((c) => ({
      external_id: String(c.id),
      updated_time: c.updated_time ?? null,
      participants: (c.participants?.data ?? []).map((p: any) => ({ id: String(p.id), username: p.username ?? null })),
      messages: (c.messages?.data ?? []).map((m: any) => ({
        external_id: String(m.id),
        from_id: m.from?.id ? String(m.from.id) : null,
        from_username: m.from?.username ?? null,
        text: String(m.message ?? ""),
        attachments: [
          ...(m.attachments?.data ?? []).map((x: any) => ({
            type: x.image_data ? "image" : x.video_data ? "video" : x.file_url ? "file" : "attachment",
            url: x.image_data?.url ?? x.video_data?.url ?? x.file_url ?? null,
          })),
          // Репосты, голосовые, стикеры и т. п.: Instagram сообщает, что сообщение было, но содержимое не отдаёт.
          ...(m.is_unsupported && !m.message && !m.attachments?.data?.length ? [{ type: "unsupported", url: null }] : []),
        ],
        timestamp: m.created_time ?? null,
      })),
    }));
  },

  async sendMessage(externalId, recipientId, text, token) {
    const r = await api<{ message_id: string }>(token, "POST", `${externalId}/messages`, {
      recipient: JSON.stringify({ id: recipientId }),
      message: JSON.stringify({ text }),
    });
    return { id: String(r.message_id) };
  },

  async profileUsername(userId, token) {
    const r = await api<{ username?: string }>(token, "GET", userId, { fields: "username" });
    return r.username ?? null;
  },

  async privateReply(externalId, commentId, text, token) {
    await api(token, "POST", `${externalId}/messages`, {
      recipient: JSON.stringify({ comment_id: commentId }),
      message: JSON.stringify({ text }),
    });
  },

  /** Демография подписчиков. Instagram отдаёт её только от 100 подписчиков. */
  async demographics(externalId, token) {
    const data: Record<string, { key: string; value: number }[]> = {};
    const notes: string[] = [];
    for (const breakdown of ["country", "city", "age", "gender"]) {
      try {
        const r = await api<{ data: { total_value?: { breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] } }[] }>(
          token,
          "GET",
          `${externalId}/insights`,
          { metric: "follower_demographics", period: "lifetime", metric_type: "total_value", breakdown }
        );
        const results = r.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
        data[breakdown] = results
          .map((x) => ({ key: x.dimension_values.join(" / "), value: x.value }))
          .sort((a, b) => b.value - a.value);
      } catch (e) {
        notes.push(`демография ${breakdown}: ${(e as Error).message}`);
      }
    }
    return { data, notes };
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

/** Метрика с разбивкой (breakdown): итог + строки «значение → число». Ошибки прав/параметров не роняют сбор. */
async function breakdown(
  token: string,
  path: string,
  metric: string,
  by: string,
  extra: Record<string, string>,
  notes: string[]
): Promise<{ total: number | null; results: { key: string; value: number }[] }> {
  try {
    const r = await api<{
      data: { total_value?: { value?: number; breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] } }[];
    }>(token, "GET", path, { metric, period: "day", metric_type: "total_value", breakdown: by, ...extra });
    const tv = r.data?.[0]?.total_value;
    return {
      total: tv?.value ?? null,
      results: (tv?.breakdowns?.[0]?.results ?? []).map((x) => ({ key: x.dimension_values.join("/"), value: x.value })),
    };
  } catch (e) {
    notes.push(`${metric}: ${(e as Error).message}`);
    return { total: null, results: [] };
  }
}
