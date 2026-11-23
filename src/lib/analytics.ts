// Сбор аналитики аккаунта: все публикации, дневные итоги, демография.
// Вызывается из collectMetrics (по таймеру worker'а) и кнопкой «Обновить» на странице /analytics.
import { decrypt } from "./crypto";
import { one, q } from "./db";
import { publisherFor } from "@/publishers";

const MEDIA_LIMIT = 200; // сколько последних публикаций держим
const MEDIA_CALLS_PER_RUN = 60; // потолок запросов insights за один проход
const BACKFILL_DAYS = 30;

const HOUR = 3600e3;

/** Пора ли обновлять insights публикации: свежие — часто, старые — редко. */
function dueForInsights(postedAt: Date | null, metricsAt: Date | null, now: number): boolean {
  if (!metricsAt) return true;
  const ageH = postedAt ? (now - postedAt.getTime()) / HOUR : Infinity;
  const sinceH = (now - metricsAt.getTime()) / HOUR;
  if (ageH <= 72) return sinceH >= 2.5;
  if (ageH <= 24 * 30) return sinceH >= 23;
  return sinceH >= 24 * 7;
}

const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function syncAccountAnalytics(accountId: string, log: (m: string) => void = () => {}) {
  const acc = await one<{ id: string; platform: string; external_id: string; token_enc: string; username: string | null }>(
    "select id, platform, external_id, token_enc, username from social_accounts where id=$1 and status='active'",
    [accountId]
  );
  if (!acc) throw new Error("Аккаунт не найден или не активен");
  const pub = publisherFor(acc.platform);
  const token = decrypt(acc.token_enc);
  const notes = new Set<string>();
  const stats = { media: 0, insights: 0, days: 0, demographics: false, online: 0, tags: 0 };

  // 1. Публикации аккаунта (список + базовые счётчики).
  if (pub.listMedia) {
    const list = await pub.listMedia(acc.external_id, token, MEDIA_LIMIT);
    for (const m of list) {
      await q(
        `insert into account_media (account_id, external_id, product_type, media_type, caption, permalink, thumbnail_url, posted_at, likes, comments)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (account_id, external_id) do update set
           product_type=excluded.product_type, media_type=excluded.media_type, caption=excluded.caption,
           permalink=excluded.permalink, thumbnail_url=coalesce(excluded.thumbnail_url, account_media.thumbnail_url),
           posted_at=excluded.posted_at,
           likes=coalesce(excluded.likes, account_media.likes), comments=coalesce(excluded.comments, account_media.comments),
           updated_at=now()`,
        [acc.id, m.external_id, m.product_type, m.media_type, m.caption, m.permalink, m.thumbnail_url, m.posted_at, m.likes, m.comments]
      );
    }
    stats.media = list.length;
  }

  // 2. Insights публикаций (с потолком запросов за проход, самые «просроченные» первыми).
  if (pub.mediaInsights) {
    const rows = await q<{ id: string; external_id: string; product_type: string | null; posted_at: Date | null; metrics_at: Date | null }>(
      "select id, external_id, product_type, posted_at, metrics_at from account_media where account_id=$1 order by posted_at desc nulls last",
      [acc.id]
    );
    const now = Date.now();
    const due = rows
      .filter((r) => dueForInsights(r.posted_at, r.metrics_at, now))
      .sort((a, b) => (a.metrics_at?.getTime() ?? 0) - (b.metrics_at?.getTime() ?? 0))
      .slice(0, MEDIA_CALLS_PER_RUN);
    for (const r of due) {
      try {
        const m = await pub.mediaInsights(r.external_id, r.product_type, token);
        m.notes.forEach((n) => notes.add(n));
        await q(
          `update account_media set
             likes=coalesce($2, likes), comments=coalesce($3, comments), saves=$4, shares=$5, reach=$6, views=$7,
             total_interactions=$8, avg_watch_ms=$9, total_watch_ms=$10, metrics_at=now(), updated_at=now()
           where id=$1`,
          [r.id, m.likes ?? null, m.comments ?? null, m.saves ?? null, m.shares ?? null, m.reach ?? null, m.views ?? null,
           m.total_interactions ?? null, m.avg_watch_ms != null ? Math.round(m.avg_watch_ms) : null,
           m.total_watch_ms != null ? Math.round(m.total_watch_ms) : null]
        );
        stats.insights++;
      } catch (e) {
        notes.add(`пост ${r.external_id}: ${(e as Error).message}`);
      }
    }
  }

  // 3. Дневные итоги: при первом запуске — 30 дней назад, дальше — последние 3 дня.
  if (pub.dailyInsights) {
    const have = await one<{ n: string }>("select count(*) as n from account_daily where account_id=$1 and link_taps is not null", [acc.id]);
    const back = Number(have?.n ?? 0) < BACKFILL_DAYS - 3 ? BACKFILL_DAYS : 3;
    const today = utcMidnight(new Date());
    for (let i = back; i >= 0; i--) {
      const day = new Date(today.getTime() - i * 86400e3);
      try {
        const d = await pub.dailyInsights(acc.external_id, token, day);
        d.notes.forEach((n) => notes.add(n));
        await q(
          `insert into account_daily (account_id, day, reach, views, likes, comments, shares, saves, total_interactions, profile_views, accounts_engaged,
                                     follows, unfollows, link_taps_total, link_taps)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           on conflict (account_id, day) do update set
             reach=excluded.reach, views=excluded.views, likes=excluded.likes, comments=excluded.comments, shares=excluded.shares,
             saves=excluded.saves, total_interactions=excluded.total_interactions, profile_views=excluded.profile_views,
             accounts_engaged=excluded.accounts_engaged, follows=excluded.follows, unfollows=excluded.unfollows,
             link_taps_total=excluded.link_taps_total, link_taps=excluded.link_taps, fetched_at=now()`,
          [acc.id, day.toISOString().slice(0, 10), d.reach ?? null, d.views ?? null, d.likes ?? null, d.comments ?? null,
           d.shares ?? null, d.saves ?? null, d.total_interactions ?? null, d.profile_views ?? null, d.accounts_engaged ?? null,
           d.follows ?? null, d.unfollows ?? null, d.link_taps_total ?? null, JSON.stringify(d.link_taps ?? {})]
        );
        stats.days++;
      } catch (e) {
        notes.add(`день ${day.toISOString().slice(0, 10)}: ${(e as Error).message}`);
      }
    }
  }

  // 4. Демография — раз в сутки.
  if (pub.demographics) {
    const last = await one<{ t: Date | null }>("select max(fetched_at) as t from account_demographics where account_id=$1", [acc.id]);
    if (!last?.t || Date.now() - last.t.getTime() > 23 * HOUR) {
      try {
        const r = await pub.demographics(acc.external_id, token);
        r.notes.forEach((n) => notes.add(n));
        for (const [breakdown, data] of Object.entries(r.data)) {
          await q(
            `insert into account_demographics (account_id, breakdown, data) values ($1,$2,$3)
             on conflict (account_id, breakdown) do update set data=excluded.data, fetched_at=now()`,
            [acc.id, breakdown, JSON.stringify(data)]
          );
        }
        stats.demographics = Object.keys(r.data).length > 0;
      } catch (e) {
        notes.add(`демография: ${(e as Error).message}`);
      }
    }
  }

  // 5. Подписчики онлайн (по часам) — раз в 6 часов.
  if (pub.onlineFollowers) {
    const last = await one<{ t: Date | null }>("select max(fetched_at) as t from account_online where account_id=$1", [acc.id]);
    if (!last?.t || Date.now() - last.t.getTime() > 6 * HOUR) {
      try {
        const days = await pub.onlineFollowers(acc.external_id, token);
        for (const d of days)
          await q(
            `insert into account_online (account_id, day, hours) values ($1,$2,$3)
             on conflict (account_id, day) do update set hours=excluded.hours, fetched_at=now()`,
            [acc.id, d.day, JSON.stringify(d.hours)]
          );
        stats.online = days.length;
      } catch (e) {
        notes.add(`онлайн подписчиков: ${(e as Error).message}`);
      }
    }
  }

  // 6. Отметки аккаунта в чужих публикациях.
  if (pub.listTags) {
    try {
      const tags = await pub.listTags(acc.external_id, token);
      for (const t of tags)
        await q(
          `insert into account_tags (account_id, external_id, username, caption, permalink, media_url, posted_at, like_count, comments_count)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict (account_id, external_id) do update set username=excluded.username, caption=excluded.caption,
             permalink=excluded.permalink, media_url=excluded.media_url, like_count=excluded.like_count,
             comments_count=excluded.comments_count, fetched_at=now()`,
          [acc.id, t.external_id, t.username, t.caption, t.permalink, t.media_url, t.posted_at, t.like_count, t.comments_count]
        );
      stats.tags = tags.length;
    } catch (e) {
      notes.add(`отметки: ${(e as Error).message}`);
    }
  }

  log(
    `📈 аналитика @${acc.username ?? acc.external_id}: публикаций ${stats.media}, insights ${stats.insights}, дней ${stats.days}` +
      `${notes.size ? ` | заметки: ${[...notes].slice(0, 3).join(" · ")}` : ""}`
  );
  return { ...stats, notes: [...notes] };
}
