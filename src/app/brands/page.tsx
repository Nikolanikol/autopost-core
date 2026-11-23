import { defaultWorkspaceId, q } from "@/lib/db";
import { createBrandAction, deleteBrandAction, moveAccountAction, renameBrandAction, switchBrandAction } from "./actions";
import { Button, Check, Dropdown, Input } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BrandsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const current = await defaultWorkspaceId();
  const brands = await q<any>(
    `select w.id, w.name, w.timezone,
            (select count(*) from posts p where p.workspace_id = w.id) as posts,
            (select count(*) from media m where m.workspace_id = w.id) as media,
            (select count(*) from api_keys k where k.workspace_id = w.id and k.revoked_at is null) as keys
       from workspaces w order by w.created_at`
  );
  const accounts = await q<any>(
    `select a.id, a.workspace_id, a.platform, a.username, a.status,
            (select count(distinct t.post_id) from post_targets t where t.account_id = a.id)::int as posts
       from social_accounts a order by a.platform, a.username`
  );

  return (
    <>
      <h1>Бренды</h1>
      <p className="muted small">
        Бренд — это отдельное пространство: свои аккаунты, очередь и календарь, медиатека, шаблоны, правила комментариев,
        аналитика и API-ключи. Переключайтесь в шапке; всё, что вы видите на других страницах, относится к выбранному бренду.
        При переносе аккаунта вместе с ним переезжают его посты и использованные в них файлы; отметка «медиатека и ключи» переносит ещё и всю
        медиатеку и API-ключи старого бренда (нужна, когда старый бренд остаётся пустым).
      </p>
      {sp.ok && <div className="alert ok">{sp.ok}</div>}
      {sp.err && <div className="alert bad">{sp.err}</div>}

      {brands.map((b: any) => {
        const mine = accounts.filter((a: any) => a.workspace_id === b.id);
        const empty = mine.length === 0 && Number(b.posts) === 0 && Number(b.media) === 0;
        return (
          <div key={b.id} className="card" style={b.id === current ? { borderColor: "var(--accent)" } : undefined}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <form action={renameBrandAction} className="row" style={{ gap: 8, flex: 1, minWidth: 220 }}>
                <input type="hidden" name="id" value={b.id} />
                <Input type="text" name="name" defaultValue={b.name} aria-label="Название бренда" style={{ maxWidth: 260, fontWeight: 600 }} />
                <Button className="ghost small" style={{ padding: "4px 10px" }}>Переименовать</Button>
              </form>
              <div className="row" style={{ gap: 8 }}>
                {b.id === current ? (
                  <span className="chip">выбран сейчас</span>
                ) : (
                  <form action={switchBrandAction}>
                    <input type="hidden" name="brand" value={b.id} />
                    <Button style={{ padding: "4px 12px" }}>Открыть</Button>
                  </form>
                )}
                {empty && brands.length > 1 && (
                  <form action={deleteBrandAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <Button className="danger" style={{ padding: "4px 12px" }}>Удалить</Button>
                  </form>
                )}
              </div>
            </div>
            <div className="muted small" style={{ margin: "6px 0 10px" }}>
              Часовой пояс: {b.timezone} · постов: {b.posts} · файлов: {b.media} · API-ключей: {b.keys}
            </div>

            {mine.length === 0 && <div className="muted small">Аккаунтов нет. Подключите на странице «Аккаунты» при выбранном бренде.</div>}
            {mine.map((a: any) => (
              <div key={a.id} className="row" style={{ justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                <div>
                  {a.platform === "instagram" ? "Instagram" : a.platform} · <b>@{a.username}</b>
                  <span className={`chip s-${a.status}`} style={{ marginLeft: 8 }}>{a.status === "active" ? "активен" : a.status}</span>
                  <span className="muted small" style={{ marginLeft: 8 }}>постов: {a.posts}</span>
                </div>
                {brands.length > 1 && (
                  <form action={moveAccountAction} className="row" style={{ gap: 8 }}>
                    <input type="hidden" name="account_id" value={a.id} />
                    <Dropdown name="brand" defaultValue={b.id} width="auto" size="1" ariaLabel="Перенести в бренд"
                      options={brands.map((x: any) => ({ value: x.id, label: x.name }))} />
                    <Check inline name="with_library">+ медиатека и ключи бренда</Check>
                    <Button className="ghost small">Перенести</Button>
                  </form>
                )}
              </div>
            ))}
          </div>
        );
      })}

      <h2>Новый бренд</h2>
      <form action={createBrandAction} className="card row" style={{ gap: 10 }}>
        <Input type="text" name="name" placeholder="Название, например Axis" required style={{ maxWidth: 320 }} />
        <Button>Создать и открыть</Button>
        <span className="muted small">Часовой пояс возьмётся от текущего бренда, его можно поменять в «Настройках».</span>
      </form>
    </>
  );
}
