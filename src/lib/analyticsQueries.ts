// Выборки аналитики для внешних клиентов (MCP / API): те же данные, что на странице /analytics.
import { one, q } from "./db";

export type MediaSort = "date" | "views" | "reach" | "likes" | "comments" | "shares" | "saves" | "er";
const SORT_SQL: Record<MediaSort, string> = {
  date: "posted_at desc nulls last",
  views: "views desc nulls last",
  reach: "reach desc nulls last",
  likes: "likes desc nulls last",
  comments: "comments desc nulls last",
  shares: "shares desc nulls last",
  saves: "saves desc nulls last",
  er: "(total_interactions::float / nullif(reach, 0)) desc nulls last",
};

export async function accountSummary(accountId: string, days: number) {
  const since = new Date(Date.now() - (days - 1) * 86400e3).toISOString().slice(0, 10);
  const t = await one<any>(
    `select count(*)::int as days_covered,
            sum(views)::int views, sum(reach)::int reach_sum_by_days, sum(likes)::int likes, sum(comments)::int comments,
            sum(shares)::int shares, sum(saves)::int saves, sum(total_interactions)::int interactions,
            sum(profile_views)::int profile_views, sum(follows)::int follows, sum(unfollows)::int unfollows,
            sum(link_taps_total)::int button_taps
       from account_daily where account_id=$1 and day >= $2`,
    [accountId, since]
  );
  const taps = await q<{ link_taps: Record<string, number> | null }>(
    "select link_taps from account_daily where account_id=$1 and day >= $2 and link_taps is not null",
    [accountId, since]
  );
  const tapsBy: Record<string, number> = {};
  for (const r of taps) for (const [k, v] of Object.entries(r.link_taps ?? {})) tapsBy[k] = (tapsBy[k] ?? 0) + Number(v);
  const snap = await one<any>(
    "select followers, media_count, fetched_at from account_metrics where account_id=$1 and followers is not null order by fetched_at desc limit 1",
    [accountId]
  );
  const last = await one<{ t: Date | null }>("select max(metrics_at) as t from account_media where account_id=$1", [accountId]);
  return {
    period_days: days,
    days_with_data: t?.days_covered ?? 0,
    followers: snap?.followers ?? null,
    media_count: snap?.media_count ?? null,
    totals: {
      views: t?.views ?? null,
      reach_sum_by_days: t?.reach_sum_by_days ?? null, // сумма охватов по дням: аудитории пересекаются
      likes: t?.likes ?? null,
      comments: t?.comments ?? null,
      shares: t?.shares ?? null,
      saves: t?.saves ?? null,
      interactions: t?.interactions ?? null,
      profile_views: t?.profile_views ?? null,
      follows: t?.follows ?? null,
      unfollows: t?.unfollows ?? null,
      button_taps: t?.button_taps ?? null,
      button_taps_by_type: tapsBy,
    },
    data_updated_at: last?.t ?? null,
    note: "Дни считаются по UTC. Instagram отдаёт подписки/отписки и демографию только от 100 подписчиков.",
  };
}

export async function dailySeries(accountId: string, days: number) {
  const since = new Date(Date.now() - (days - 1) * 86400e3).toISOString().slice(0, 10);
  return q(
    `select to_char(day, 'YYYY-MM-DD') as day, views, reach, likes, comments, shares, saves, total_interactions as interactions,
            profile_views, follows, unfollows, link_taps_total as button_taps
       from account_daily where account_id=$1 and day >= $2 order by day`,
    [accountId, since]
  );
}

export async function topMedia(accountId: string, o: { sort: MediaSort; type: "all" | "reels" | "feed"; limit: number; since_days?: number }) {
  const typeSql = o.type === "reels" ? "product_type = 'REELS'" : o.type === "feed" ? "coalesce(product_type, '') <> 'REELS'" : "true";
  const rows = await q<any>(
    `select external_id, product_type, media_type, left(caption, 140) as caption, permalink, posted_at,
            views, reach, likes, comments, shares, saves, total_interactions, avg_watch_ms, metrics_at
       from account_media
      where account_id=$1 and ${typeSql} and ($3::int is null or posted_at >= now() - ($3::int || ' days')::interval)
      order by ${SORT_SQL[o.sort]} limit $2`,
    [accountId, o.limit, o.since_days ?? null]
  );
  return rows.map((r) => ({
    ...r,
    type: r.product_type === "REELS" ? "reel" : r.media_type === "CAROUSEL_ALBUM" ? "carousel" : "photo",
    engagement_rate_pct: r.reach ? Math.round(((r.total_interactions ?? 0) / r.reach) * 1000) / 10 : null,
    avg_watch_sec: r.avg_watch_ms != null ? Math.round(r.avg_watch_ms / 100) / 10 : null,
  }));
}

export async function audience(accountId: string) {
  const rows = await q<{ breakdown: string; data: { key: string; value: number }[]; fetched_at: Date }>(
    "select breakdown, data, fetched_at from account_demographics where account_id=$1",
    [accountId]
  );
  const out: Record<string, { key: string; share_pct: number }[]> = {};
  for (const r of rows) {
    const total = r.data.reduce((s, x) => s + x.value, 0) || 1;
    out[r.breakdown] = r.data.slice(0, 10).map((x) => ({ key: x.key, share_pct: Math.round((x.value / total) * 1000) / 10 }));
  }
  return { demographics: out, available: rows.length > 0, note: rows.length ? undefined : "Данных нет: Instagram отдаёт демографию от 100 подписчиков." };
}

export async function onlineHours(accountId: string) {
  const rows = await q<{ hours: Record<string, number> }>("select hours from account_online where account_id=$1", [accountId]);
  if (rows.length === 0) return { available: false, note: "Данных нет (нужно от 100 подписчиков, обновляется раз в 6 часов)." };
  const avg = Array.from({ length: 24 }, (_, h) => {
    const v = rows.map((r) => Number(r.hours?.[String(h)])).filter(Number.isFinite);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
  });
  const best = avg.map((v, h) => ({ hour: h, avg_online: v })).sort((a, b) => b.avg_online - a.avg_online).slice(0, 5);
  return {
    available: true,
    days_averaged: rows.length,
    best_hours: best.map((b) => `${String(b.hour).padStart(2, "0")}:00 (≈${b.avg_online})`),
    by_hour: avg,
    note: "Часы — по часовому поясу аккаунта в Instagram.",
  };
}
