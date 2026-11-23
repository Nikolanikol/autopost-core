import Link from "next/link";
import { defaultWorkspaceId } from "@/lib/db";
import { listPosts } from "@/lib/posts";
import { workspaceTz } from "@/lib/slots";
import { fmtIn, tzLabel } from "@/lib/tz";
import { cancelPostAction, retryTargetAction } from "./actions";
import { AccountFilter } from "./AccountFilter";
import { AutoRefresh } from "./AutoRefresh";
import { Button } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  scheduled: "запланирован",
  publishing: "публикуется",
  published: "опубликован",
  partial: "частично",
  failed: "ошибка",
  canceled: "отменён",
  queued: "в очереди",
  processing: "обработка",
  draft: "черновик",
};


export default async function QueuePage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const ws = await defaultWorkspaceId();
  const account = (await searchParams).account && /^[0-9a-f-]{36}$/i.test((await searchParams).account!) ? (await searchParams).account! : null;
  const posts = await listPosts(ws, 50, account);
  const tz = await workspaceTz(ws);
  const fmt = (d: Date | null) => fmtIn(d, tz);
  const active = posts.some((p: any) => ["scheduled", "publishing"].includes(p.status));

  return (
    <>
      <AutoRefresh active={active} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Очередь и история</h1>
        <Link href="/posts/new"><Button>+ Новый пост</Button></Link>
      </div>
      <AccountFilter workspaceId={ws} base="/" active={account} />
      {posts.length === 0 ? (
        <div className="card muted">Постов пока нет. Создайте первый в интерфейсе или через API.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Медиа</th>
                <th>Время ({tzLabel(tz)})</th>
                <th className="hide-sm">Подпись</th>
                <th>Платформы</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p: any) => (
                <tr key={p.id}>
                  <td>
                    {p.media[0]?.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="thumb" src={p.media[0].public_url} alt="" />
                    ) : (
                      <div className="thumb">🎬</div>
                    )}
                  </td>
                  <td className="small">
                    {fmt(p.scheduled_at)}
                    <div className="muted">{p.source}</div>
                  </td>
                  <td className="hide-sm small" style={{ maxWidth: 260 }}>
                    {p.base_caption ? p.base_caption.slice(0, 120) : <span className="muted">без подписи</span>}
                  </td>
                  <td>
                    {p.targets.map((t: any) => (
                      <div key={t.id} style={{ marginBottom: 6 }}>
                        <span className={`chip s-${t.status}`}>
                          {t.platform === "instagram" ? "IG" : t.platform} @{t.username} · {STATUS[t.status] ?? t.status}
                        </span>
                        {t.status === "published" && (t.m_likes != null || t.m_reach != null) && (
                          <div className="muted small" title="Последний снимок статистики">
                            ♥ {t.m_likes ?? "—"} · 💬 {t.m_comments ?? "—"}
                            {t.m_saves != null && ` · 🔖 ${t.m_saves}`}
                            {t.m_reach != null && ` · охват ${t.m_reach}`}
                            {t.m_views != null && ` · просмотры ${t.m_views}`}
                          </div>
                        )}
                        {t.permalink && (
                          <a href={t.permalink} target="_blank" className="small"> открыть ↗</a>
                        )}
                        {t.last_error && <div className="err">{t.last_error}</div>}
                        {t.status === "failed" && (
                          <form action={retryTargetAction} style={{ display: "inline" }}>
                            <input type="hidden" name="target_id" value={t.id} />
                            <Button className="ghost small" style={{ padding: "2px 8px", marginTop: 4 }}>Повторить</Button>
                          </form>
                        )}
                      </div>
                    ))}
                  </td>
                  <td><span className={`chip s-${p.status}`}>{STATUS[p.status] ?? p.status}</span></td>
                  <td>
                    {p.status === "scheduled" && (
                      <form action={cancelPostAction}>
                        <input type="hidden" name="post_id" value={p.id} />
                        <Button className="danger small" style={{ padding: "2px 8px" }}>Отменить</Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
