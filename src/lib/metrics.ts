// Периодический сбор статистики. Запускается из worker'а по таймеру.
// Свежие посты (< 3 дней) — каждый проход, постарше (до 30 дней) — раз в сутки.
import { decrypt } from "./crypto";
import { q } from "./db";
import { publisherFor } from "@/publishers";

export async function collectMetrics(log: (msg: string) => void = console.log) {
  const targets = await q(
    `select t.id, t.external_id as media_id, t.published_at, a.platform, a.token_enc,
            (select max(fetched_at) from post_metrics m where m.target_id = t.id) as last_at
       from post_targets t join social_accounts a on a.id = t.account_id
      where t.status = 'published' and t.external_id is not null and a.status = 'active'
        and t.published_at > now() - interval '30 days'`
  );
  let posts = 0;
  const notes = new Set<string>();
  for (const t of targets) {
    const ageH = (Date.now() - new Date(t.published_at).getTime()) / 3600e3;
    const sinceH = t.last_at ? (Date.now() - new Date(t.last_at).getTime()) / 3600e3 : Infinity;
    if (ageH > 72 && sinceH < 23) continue;
    const pub = publisherFor(t.platform);
    if (!pub.postMetrics) continue;
    try {
      const m = await pub.postMetrics(t.media_id, decrypt(t.token_enc));
      m.notes.forEach((n) => notes.add(n));
      await q(
        `insert into post_metrics (target_id, likes, comments, saves, shares, reach, views, raw)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [t.id, m.likes ?? null, m.comments ?? null, m.saves ?? null, m.shares ?? null, m.reach ?? null, m.views ?? null,
         JSON.stringify({ ...m.raw, notes: m.notes })]
      );
      posts++;
    } catch (e) {
      notes.add(`пост ${t.media_id}: ${(e as Error).message}`);
    }
  }

  const accounts = await q(`select id, platform, external_id, token_enc from social_accounts where status = 'active'`);
  let accs = 0;
  for (const a of accounts) {
    const pub = publisherFor(a.platform);
    if (!pub.accountMetrics) continue;
    try {
      const m = await pub.accountMetrics(a.external_id, decrypt(a.token_enc));
      m.notes.forEach((n) => notes.add(n));
      await q(
        `insert into account_metrics (account_id, followers, media_count, reach_day, views_day, raw)
         values ($1,$2,$3,$4,$5,$6)`,
        [a.id, m.followers ?? null, m.media_count ?? null, m.reach_day ?? null, m.views_day ?? null,
         JSON.stringify({ ...m.raw, notes: m.notes })]
      );
      accs++;
    } catch (e) {
      notes.add(`аккаунт ${a.external_id}: ${(e as Error).message}`);
    }
  }
  log(`📊 метрики: постов ${posts}, аккаунтов ${accs}${notes.size ? ` | заметки: ${[...notes].slice(0, 3).join(" · ")}` : ""}`);
  return { posts, accounts: accs, notes: [...notes] };
}
