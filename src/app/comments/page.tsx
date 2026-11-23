import Link from "next/link";
import { defaultWorkspaceId, q } from "@/lib/db";
import { workspaceTz } from "@/lib/slots";
import { fmtIn } from "@/lib/tz";
import { hideCommentAction, ignoreCommentAction, replyCommentAction, syncCommentsAction, unhideCommentAction } from "./actions";
import { Area, Button, Check } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "новый", cls: "s-processing" },
  replied: { label: "отвечено", cls: "s-published" },
  hidden: { label: "скрыт", cls: "s-canceled" },
  ignored: { label: "пропущен", cls: "s-canceled" },
  failed: { label: "ошибка", cls: "s-failed" },
};
const TABS: Record<string, { label: string; sql: string }> = {
  new: { label: "Новые", sql: "c.status in ('new', 'failed')" },
  done: { label: "Обработанные", sql: "c.status in ('replied', 'hidden')" },
  all: { label: "Все", sql: "c.status <> 'ignored' or c.parent_id is null" },
};
const ACTION_LABEL: Record<string, string> = { reply: "ответ", reply_dm: "ответ + личное сообщение", dm: "личное сообщение", hide: "скрыть" };

export default async function CommentsPage({ searchParams }: { searchParams: Promise<{ account?: string; t?: string }> }) {
  const sp = await searchParams;
  const ws = await defaultWorkspaceId();
  const tz = await workspaceTz(ws);
  const accounts = await q<{ id: string; username: string | null; status: string }>(
    "select id, username, status from social_accounts where workspace_id=$1 and platform='instagram' order by username",
    [ws]
  );
  if (accounts.length === 0)
    return (
      <>
        <h1>Комментарии</h1>
        <div className="card muted">Нет Instagram-аккаунтов.</div>
      </>
    );
  const acc = accounts.find((a) => a.id === sp.account) ?? accounts.find((a) => a.status === "active") ?? accounts[0];
  const tab = sp.t && TABS[sp.t] ? sp.t : "new";
  const href = (o: Record<string, string>) => `/comments?${new URLSearchParams({ account: acc.id, t: tab, ...o })}`;

  const counts = await q<{ status: string; n: string }>(
    "select status, count(*) as n from ig_comments where account_id=$1 and parent_id is null group by status",
    [acc.id]
  );
  const cnt = (...st: string[]) => counts.filter((c) => st.includes(c.status)).reduce((s, c) => s + Number(c.n), 0);
  const tabCount: Record<string, number> = { new: cnt("new", "failed"), done: cnt("replied", "hidden"), all: cnt("new", "failed", "replied", "hidden") };

  const rows = await q<any>(
    `select c.*, r.name as rule_name, r.action as rule_action, r.auto as rule_auto
       from ig_comments c left join comment_rules r on r.id = c.matched_rule_id
      where c.account_id=$1 and c.parent_id is null and c.status <> 'ignored' and (${TABS[tab].sql})
      order by c.commented_at desc nulls last limit 100`,
    [acc.id]
  );

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Комментарии</h1>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/comments/rules" className="pill">Правила автоответа</Link>
          <form action={syncCommentsAction}>
            <input type="hidden" name="account_id" value={acc.id} />
            <Button className="ghost small" style={{ padding: "4px 12px" }} title="Подтянуть комментарии, которые не дошли вебхуком">Обновить</Button>
          </form>
        </div>
      </div>

      <div className="row" style={{ margin: "12px 0", gap: 8 }}>
        {accounts.map((a) => (
          <Link key={a.id} href={`/comments?${new URLSearchParams({ account: a.id, t: tab })}`} className={`pill ${a.id === acc.id ? "on" : ""}`}>
            @{a.username}
          </Link>
        ))}
        <span style={{ flex: 1 }} />
        {Object.entries(TABS).map(([k, v]) => (
          <Link key={k} href={href({ t: k })} className={`pill ${k === tab ? "on" : ""}`}>
            {v.label} {tabCount[k] ? `· ${tabCount[k]}` : ""}
          </Link>
        ))}
      </div>

      {rows.length === 0 && (
        <div className="card muted">
          {tab === "new" ? "Новых комментариев нет. Они появляются сразу по вебхуку, а «Обновить» подтягивает пропущенные." : "Пока пусто."}
        </div>
      )}

      {rows.map((c: any) => {
        const st = STATUS[c.status] ?? { label: c.status, cls: "" };
        const open = c.status === "new" || c.status === "failed";
        return (
          <div key={c.id} className="card">
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <div>
                <b>@{c.username ?? "?"}</b>
                <span className="muted small"> · {c.commented_at ? fmtIn(c.commented_at, tz) : ""}</span>
                {c.media_permalink && (
                  <a href={c.media_permalink} target="_blank" rel="noreferrer" className="small"> · к публикации ↗</a>
                )}
              </div>
              <span className={`chip ${st.cls}`}>{st.label}{c.hidden && c.status !== "hidden" ? " · скрыт" : ""}</span>
            </div>
            <p style={{ margin: "8px 0", whiteSpace: "pre-wrap" }}>{c.text}</p>

            {c.rule_name && (
              <div className="muted small">
                Правило «{c.rule_name}» ({ACTION_LABEL[c.rule_action] ?? c.rule_action}
                {c.rule_auto ? ", авто" : ", ждёт вашего подтверждения"})
              </div>
            )}
            {c.last_error && <div className="err">{c.last_error}</div>}

            {c.reply_text && (
              <div className="small" style={{ marginTop: 8, paddingLeft: 10, borderLeft: "3px solid var(--accent)" }}>
                <span className="muted">Наш ответ{c.auto_acted ? " (авто)" : ""}:</span> {c.reply_text}
                {c.dm_sent_at && <div className="muted">+ личное сообщение отправлено</div>}
              </div>
            )}
            {!c.reply_text && c.dm_sent_at && <div className="small muted" style={{ marginTop: 8 }}>Личное сообщение отправлено</div>}

            {open ? (
              <form action={replyCommentAction} style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={c.id} />
                <Area name="reply" defaultValue={c.suggested_reply ?? ""} placeholder="Ответ в комментариях" style={{ minHeight: 64 }} />
                <Check name="with_dm" defaultChecked={Boolean(c.suggested_dm)}>ещё отправить личное сообщение (одно, в течение 7 дней)</Check>
                <Area name="dm" defaultValue={c.suggested_dm ?? ""} placeholder="Текст личного сообщения" style={{ minHeight: 56 }} />
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <Button>Отправить</Button>
                  <Button className="ghost" formAction={hideCommentAction}>Скрыть</Button>
                  <Button className="ghost" formAction={ignoreCommentAction}>Пропустить</Button>
                </div>
              </form>
            ) : c.hidden ? (
              <form action={unhideCommentAction} style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={c.id} />
                <Button className="ghost small" style={{ padding: "4px 10px" }}>Показать снова</Button>
              </form>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
