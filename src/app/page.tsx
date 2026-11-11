import Link from "next/link";
import { defaultWorkspaceId } from "@/lib/db";
import { listPosts } from "@/lib/posts";
import { cancelPostAction, retryTargetAction } from "./actions";
import { AutoRefresh } from "./AutoRefresh";

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

const fmt = (d: Date | null) =>
  d ? new Date(d).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }) : "—";

export default async function QueuePage() {
  const posts = await listPosts(await defaultWorkspaceId());
  const active = posts.some((p: any) => ["scheduled", "publishing"].includes(p.status));

  return (
    <>
      <AutoRefresh active={active} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Очередь и история</h1>
        <Link href="/posts/new"><button>+ Новый пост</button></Link>
      </div>
      {posts.length === 0 ? (
        <div className="card muted">Постов пока нет. Создайте первый в интерфейсе или через API.</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Медиа</th>
                <th>Время (МСК)</th>
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
                        {t.permalink && (
                          <a href={t.permalink} target="_blank" className="small"> открыть ↗</a>
                        )}
                        {t.last_error && <div className="err">{t.last_error}</div>}
                        {t.status === "failed" && (
                          <form action={retryTargetAction} style={{ display: "inline" }}>
                            <input type="hidden" name="target_id" value={t.id} />
                            <button className="ghost small" style={{ padding: "2px 8px", marginTop: 4 }}>Повторить</button>
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
                        <button className="danger small" style={{ padding: "2px 8px" }}>Отменить</button>
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
