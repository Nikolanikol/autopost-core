import Link from "next/link";
import { defaultWorkspaceId, one, q } from "@/lib/db";
import { PAGE_SIZE, Pager, pageFrom } from "../Pager";
import { refreshAnalyticsAction } from "./actions";
import { Button } from "@/components/ui";

export const dynamic = "force-dynamic";

const PERIODS = [7, 14, 30] as const;
const SORTS: Record<string, { label: string; sql: string }> = {
  date: { label: "Дата", sql: "posted_at desc nulls last" },
  views: { label: "Просмотры", sql: "views desc nulls last" },
  reach: { label: "Охват", sql: "reach desc nulls last" },
  likes: { label: "Лайки", sql: "likes desc nulls last" },
  comments: { label: "Комментарии", sql: "comments desc nulls last" },
  shares: { label: "Репосты", sql: "shares desc nulls last" },
  saves: { label: "Сохранения", sql: "saves desc nulls last" },
  er: { label: "ER", sql: "(total_interactions::float / nullif(reach, 0)) desc nulls last" },
};
const TYPES: Record<string, { label: string; sql: string }> = {
  all: { label: "Все", sql: "true" },
  reels: { label: "Reels", sql: "product_type = 'REELS'" },
  feed: { label: "Фото и карусели", sql: "coalesce(product_type, '') <> 'REELS'" },
};

const GENDER: Record<string, string> = { M: "Мужчины", F: "Женщины", U: "Не указан" };
const nf = new Intl.NumberFormat("ru-RU");
const num = (v: number | null | undefined) => (v == null ? "—" : nf.format(v));
const dt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "2-digit" });
const cut = (t: string, n: number) => Array.from(t.replace(/\s+/g, " ")).slice(0, n).join("");
const sec = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} с`);

type Daily = {
  day: string; reach: number | null; views: number | null; total_interactions: number | null;
  follows: number | null; unfollows: number | null; link_taps_total: number | null; link_taps: Record<string, number> | null;
};

const TAP_LABELS: Record<string, string> = {
  CALL: "Позвонить", TEXT: "SMS", EMAIL: "Письмо", DIRECTIONS: "Маршрут", BOOK_NOW: "Записаться",
  INSTANT_EXPERIENCE: "Быстрая услуга", UNDEFINED: "Ссылка в профиле / другое",
};
const TAP_ALWAYS = ["CALL", "TEXT", "EMAIL", "DIRECTIONS"];

/** Столбчатая диаграмма на чистом SVG: без зависимостей, одинаково в светлой и тёмной теме. */
function Bars({ data, title }: { data: { label: string; value: number }[]; title: string }) {
  const W = 520, H = 130, pad = 4;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = data.length ? (W - pad * 2) / data.length : 0;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="card chart">
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <b>{title}</b>
        <span className="muted small">за период: {nf.format(total)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="img" aria-label={title}>
        {data.map((d, i) => {
          const h = Math.round((d.value / max) * H);
          return (
            <g key={d.label}>
              <rect x={pad + i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} rx={2} fill="var(--accent)" opacity={0.85}>
                <title>{`${d.label}: ${nf.format(d.value)}`}</title>
              </rect>
            </g>
          );
        })}
        <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--line)" />
        {data.length > 0 && (
          <>
            <text x={pad} y={H + 14} fontSize="10" fill="var(--muted)">{data[0].label}</text>
            <text x={W - pad} y={H + 14} fontSize="10" fill="var(--muted)" textAnchor="end">{data[data.length - 1].label}</text>
          </>
        )}
      </svg>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="kpi">
      <div className="muted small">{label}</div>
      <div className="kpi-v">{value}</div>
      {hint && <div className="muted small">{hint}</div>}
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; d?: string; s?: string; t?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const ws = await defaultWorkspaceId();
  const accounts = await q<{ id: string; username: string | null; platform: string; status: string }>(
    "select id, username, platform, status from social_accounts where workspace_id=$1 and platform='instagram' order by username",
    [ws]
  );
  if (accounts.length === 0) {
    return (
      <>
        <h1>Аналитика</h1>
        <div className="card muted">Нет Instagram-аккаунтов. Подключите аккаунт на странице «Аккаунты».</div>
      </>
    );
  }
  const acc = accounts.find((a) => a.id === sp.account) ?? accounts.find((a) => a.status === "active") ?? accounts[0];
  const days = PERIODS.includes(Number(sp.d) as any) ? Number(sp.d) : 30;
  const sortKey = sp.s && SORTS[sp.s] ? sp.s : "date";
  const typeKey = sp.t && TYPES[sp.t] ? sp.t : "all";
  const href = (o: Record<string, string | number>) => {
    const p = new URLSearchParams({ account: acc.id, d: String(days), s: sortKey, t: typeKey, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    return `/analytics?${p}`;
  };

  const sinceDay = new Date(Date.now() - (days - 1) * 86400e3).toISOString().slice(0, 10);
  const daily = await q<Daily>(
    `select to_char(day, 'YYYY-MM-DD') as day, reach, views, total_interactions, follows, unfollows,
            link_taps_total, link_taps, likes, comments, shares, saves, profile_views, accounts_engaged
       from account_daily where account_id=$1 and day >= $2 order by day`,
    [acc.id, sinceDay]
  );
  const sum = (k: string) => daily.reduce((s, r: any) => s + (r[k] ?? 0), 0);
  const covered = daily.length;

  const snap = await one<{ followers: number | null; media_count: number | null; fetched_at: Date }>(
    "select followers, media_count, fetched_at from account_metrics where account_id=$1 and followers is not null order by fetched_at desc limit 1",
    [acc.id]
  );
  const base = await one<{ followers: number | null }>(
    `select followers from account_metrics where account_id=$1 and followers is not null and fetched_at >= now() - ($2 || ' days')::interval
      order by fetched_at asc limit 1`,
    [acc.id, String(days)]
  );
  // Подписки и отписки за период (по дневным итогам Instagram).
  const hasFollows = daily.some((r) => r.follows != null);
  const follows = sum("follows");
  const unfollows = sum("unfollows");
  const followerDelta = hasFollows
    ? follows - unfollows
    : snap?.followers != null && base?.followers != null && base.followers !== snap.followers
      ? snap.followers - base.followers
      : null;
  // Клики по ссылке и кнопкам профиля — по типам.
  const taps: Record<string, number> = {};
  for (const r of daily) for (const [k, v] of Object.entries(r.link_taps ?? {})) taps[k] = (taps[k] ?? 0) + Number(v);
  const tapKeys = [...new Set([...TAP_ALWAYS, ...Object.keys(taps)])];

  // Когда подписчики онлайн: среднее по дням, часы 0–23.
  const onlineRows = await q<{ day: string; hours: Record<string, number> }>(
    "select to_char(day, 'YYYY-MM-DD') as day, hours from account_online where account_id=$1 order by day",
    [acc.id]
  );
  const hourAvg = Array.from({ length: 24 }, (_, h) => {
    const vals = onlineRows.map((r) => Number(r.hours?.[String(h)])).filter((v) => Number.isFinite(v));
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });
  const topHours = hourAvg.map((v, h) => ({ v, h })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.h).sort((a, b) => a - b);

  // Отметки и упоминания (если есть) + события вебхука.
  const tags = await q<any>(
    "select external_id, username, caption, permalink, posted_at from account_tags where account_id=$1 order by posted_at desc nulls last limit 10",
    [acc.id]
  );
  const mentions = await q<any>(
    "select payload, received_at from ig_events where account_id=$1 and field='mentions' order by received_at desc limit 10",
    [acc.id]
  );

  const totalMedia = Number(
    (await one<{ n: string }>(`select count(*) as n from account_media where account_id=$1 and ${TYPES[typeKey].sql}`, [acc.id]))?.n ?? 0
  );
  const pg = pageFrom(sp.p, totalMedia);
  const media = await q<any>(
    `select external_id, product_type, media_type, caption, permalink, thumbnail_url, posted_at,
            likes, comments, saves, shares, reach, views, total_interactions, avg_watch_ms, metrics_at
       from account_media where account_id=$1 and ${TYPES[typeKey].sql}
      order by ${SORTS[sortKey].sql} limit ${PAGE_SIZE} offset $2`,
    [acc.id, pg.offset]
  );
  const lastSync = await one<{ t: Date | null }>("select max(metrics_at) as t from account_media where account_id=$1", [acc.id]);
  const demo = await q<{ breakdown: string; data: { key: string; value: number }[] }>(
    "select breakdown, data from account_demographics where account_id=$1",
    [acc.id]
  );
  const demoBy = Object.fromEntries(demo.map((d) => [d.breakdown, d.data]));

  const label = (iso: string) => iso.slice(8, 10) + "." + iso.slice(5, 7);
  const series = (k: keyof Daily) => daily.map((r) => ({ label: label(r.day), value: Number(r[k] ?? 0) }));
  const er = (m: any) => (m.reach ? ((m.total_interactions ?? 0) / m.reach) * 100 : null);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Аналитика</h1>
        <form action={refreshAnalyticsAction} className="row" style={{ gap: 8 }}>
          <input type="hidden" name="account_id" value={acc.id} />
          <span className="muted small hide-sm">
            {lastSync?.t ? `Обновлено: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(lastSync.t)}` : "Данных ещё нет"}
          </span>
          <Button className="ghost small" style={{ padding: "4px 12px" }}>Обновить</Button>
        </form>
      </div>

      <div className="row" style={{ margin: "12px 0", gap: 8 }}>
        {accounts.map((a) => (
          <Link key={a.id} href={href({ account: a.id })} className={`pill ${a.id === acc.id ? "on" : ""}`}>
            @{a.username}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        {PERIODS.map((p) => (
          <Link key={p} href={href({ d: p })} className={`pill ${p === days ? "on" : ""}`}>{p} дн.</Link>
        ))}
      </div>

      {covered === 0 && media.length === 0 ? (
        <div className="card">
          Данных по @{acc.username} ещё нет. Нажмите «Обновить» (первая загрузка берёт 30 дней и все публикации — до минуты)
          или дождитесь сбора worker'ом.
        </div>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Подписчики" value={num(snap?.followers)} hint={followerDelta == null ? undefined : `${followerDelta >= 0 ? "+" : ""}${followerDelta} за период`} />
            <Kpi label="Просмотры" value={num(sum("views"))} />
            <Kpi label="Охват" value={num(sum("reach"))} hint="сумма по дням, аудитории пересекаются" />
            <Kpi label="Лайки" value={num(sum("likes"))} />
            <Kpi label="Комментарии" value={num(sum("comments"))} />
            <Kpi label="Репосты" value={num(sum("shares"))} />
            <Kpi label="Сохранения" value={num(sum("saves"))} />
            <Kpi label="Визиты в профиль" value={num(sum("profile_views"))} />
            <Kpi label="Подписались" value={hasFollows ? num(follows) : "—"} />
            <Kpi label="Отписались" value={hasFollows ? num(unfollows) : "—"} />
            <Kpi label="Клики по кнопкам" value={num(sum("link_taps_total"))} hint="звонок, SMS, письмо, маршрут, ссылка" />
          </div>
          <p className="muted small">
            Дни считаются по UTC{covered < days ? `; данных за ${covered} из ${days} дней` : ""}. Публикаций в аккаунте: {num(snap?.media_count)}.
          </p>

          <div className="charts">
            <Bars title="Просмотры по дням" data={series("views")} />
            <Bars title="Охват по дням" data={series("reach")} />
            <Bars title="Взаимодействия по дням" data={series("total_interactions")} />
            <Bars title="Подписались по дням" data={series("follows")} />
            <Bars title="Отписались по дням" data={series("unfollows")} />
            <Bars title="Клики по кнопкам профиля по дням" data={series("link_taps_total")} />
          </div>

          <h2>Звонки и кнопки профиля</h2>
          <div className="card">
            {tapKeys.map((k) => (
              <div key={k} className="bar-row" style={{ gridTemplateColumns: "180px 1fr 50px" }}>
                <span className="small">{TAP_LABELS[k] ?? k}</span>
                <span className="bar"><i style={{ width: `${(((taps[k] ?? 0) / Math.max(1, ...Object.values(taps))) * 100).toFixed(0)}%` }} /></span>
                <span className="small muted">{num(taps[k] ?? 0)}</span>
              </div>
            ))}
            <p className="muted small" style={{ marginBottom: 0 }}>
              Нажатия на «Позвонить», «Написать», «Маршрут» и ссылку в профиле за {days} дн. Если везде нули — их не было.
            </p>
          </div>

          <h2>Когда подписчики онлайн</h2>
          <div className="card">
            {onlineRows.length === 0 ? (
              <span className="muted small">Данных пока нет: Instagram отдаёт их аккаунтам от 100 подписчиков, плашка заполнится после сбора.</span>
            ) : (
              <>
                <b>Лучшие часы для постов: {topHours.map((h) => `${String(h).padStart(2, "0")}:00`).join(", ")}</b>
                <svg viewBox="0 0 520 150" width="100%" role="img" aria-label="Подписчики онлайн по часам" style={{ marginTop: 8, display: "block" }}>
                  {hourAvg.map((v, h) => {
                    const max = Math.max(1, ...hourAvg);
                    const bh = Math.round((v / max) * 120);
                    return (
                      <g key={h}>
                        <rect x={4 + h * 21.5} y={120 - bh} width={19} height={bh} rx={2} fill="var(--accent)" opacity={topHours.includes(h) ? 1 : 0.45}>
                          <title>{`${String(h).padStart(2, "0")}:00 — в среднем ${nf.format(v)} онлайн`}</title>
                        </rect>
                        {h % 3 === 0 && <text x={4 + h * 21.5 + 9} y={138} fontSize="10" fill="var(--muted)" textAnchor="middle">{h}</text>}
                      </g>
                    );
                  })}
                  <line x1={0} x2={520} y1={120.5} y2={120.5} stroke="var(--line)" />
                </svg>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Среднее число подписчиков в сети по часам за {onlineRows.length} дн. Часы — по часовому поясу аккаунта в Instagram.
                </p>
              </>
            )}
          </div>

          <h2>Отметки и упоминания</h2>
          <div className="card">
            {tags.length === 0 && mentions.length === 0 ? (
              <span className="muted small">Пока нет. Когда вас отметят в чужой публикации или упомянут, это появится здесь.</span>
            ) : (
              <>
                {tags.map((t: any) => (
                  <div key={t.external_id} className="small" style={{ margin: "6px 0" }}>
                    <a href={t.permalink ?? "#"} target="_blank" rel="noreferrer">@{t.username ?? "?"}</a>
                    <span className="muted"> отметил(а) вас{t.posted_at ? ` · ${dt.format(t.posted_at)}` : ""}</span>
                    {t.caption && <div className="muted">{cut(String(t.caption), 120)}</div>}
                  </div>
                ))}
                {mentions.map((m: any, i: number) => (
                  <div key={i} className="small" style={{ margin: "6px 0" }}>
                    Упоминание в {m.payload?.comment_id ? "комментарии" : "публикации"}
                    <span className="muted"> · {dt.format(m.received_at)}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <h2>Публикации</h2>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            {Object.entries(TYPES).map(([k, v]) => (
              <Link key={k} href={href({ t: k })} className={`pill ${k === typeKey ? "on" : ""}`}>{v.label}</Link>
            ))}
            <span style={{ flex: 1 }} />
            <span className="muted small">Сортировка:</span>
            {Object.entries(SORTS).map(([k, v]) => (
              <Link key={k} href={href({ s: k })} className={`pill ${k === sortKey ? "on" : ""}`}>{v.label}</Link>
            ))}
          </div>
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Публикация</th>
                  <th>Просм.</th>
                  <th>Охват</th>
                  <th>♥</th>
                  <th>💬</th>
                  <th>↗</th>
                  <th>🔖</th>
                  <th title="Взаимодействия / охват">ER</th>
                  <th className="hide-sm" title="Среднее время просмотра Reels">Ср. время</th>
                </tr>
              </thead>
              <tbody>
                {media.length === 0 && (
                  <tr><td colSpan={9} className="muted">Публикаций нет</td></tr>
                )}
                {media.map((m: any) => (
                  <tr key={m.external_id}>
                    <td>
                      <a href={m.permalink ?? "#"} target="_blank" rel="noreferrer" className="row" style={{ gap: 10, flexWrap: "nowrap", color: "inherit" }}>
                        {m.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className="thumb" src={m.thumbnail_url} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="thumb">{m.product_type === "REELS" ? "🎬" : "🖼"}</div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div className="small" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.caption ? cut(m.caption, 90) : <span className="muted">без подписи</span>}
                          </div>
                          <div className="muted small">
                            {m.product_type === "REELS" ? "Reels" : m.media_type === "CAROUSEL_ALBUM" ? "Карусель" : "Фото"}
                            {m.posted_at ? ` · ${dt.format(m.posted_at)}` : ""}
                          </div>
                        </div>
                      </a>
                    </td>
                    <td>{num(m.views)}</td>
                    <td>{num(m.reach)}</td>
                    <td>{num(m.likes)}</td>
                    <td>{num(m.comments)}</td>
                    <td>{num(m.shares)}</td>
                    <td>{num(m.saves)}</td>
                    <td>{er(m) == null ? "—" : `${er(m)!.toFixed(1)}%`}</td>
                    <td className="hide-sm">{m.product_type === "REELS" ? sec(m.avg_watch_ms) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={pg.page} pages={pg.pages} total={totalMedia} href={(n) => href({ p: n })} />

          <h2>Аудитория</h2>
          {demo.length === 0 ? (
            <div className="card muted small">
              Демография пока недоступна: Instagram отдаёт её аккаунтам от 100 подписчиков, данные появляются после первого сбора.
            </div>
          ) : (
            <div className="charts">
              {([["country", "Страны"], ["city", "Города"], ["age", "Возраст"], ["gender", "Пол"]] as const).map(([k, title]) => {
                const rows = (demoBy[k] ?? []).slice(0, 8);
                const total = (demoBy[k] ?? []).reduce((s, r) => s + r.value, 0) || 1;
                return (
                  <div key={k} className="card">
                    <b>{title}</b>
                    {rows.length === 0 && <div className="muted small">нет данных</div>}
                    {rows.map((r) => (
                      <div key={r.key} className="bar-row">
                        <span className="small">{k === "gender" ? GENDER[r.key] ?? r.key : r.key}</span>
                        <span className="bar"><i style={{ width: `${(r.value / total) * 100}%` }} /></span>
                        <span className="small muted">{((r.value / total) * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
