import Link from "next/link";
import { defaultWorkspaceId, q } from "@/lib/db";
import { replyWindow } from "@/lib/messages";
import { workspaceTz } from "@/lib/slots";
import { fmtIn } from "@/lib/tz";
import { PAGE_SIZE, Pager, pageFrom } from "../Pager";
import { ignoreConversationAction, replyMessageAction, syncMessagesAction } from "./actions";
import { Area, Button } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: "ждёт ответа", cls: "s-processing" },
  replied: { label: "отвечено", cls: "s-published" },
  ignored: { label: "пропущен", cls: "s-canceled" },
};
const ATTACHMENT: Record<string, string> = {
  image: "🖼 фото",
  video: "🎞 видео",
  file: "📎 файл",
  attachment: "📎 вложение",
  unsupported: "↪ репост / голосовое / стикер",
};
const TABS: Record<string, { label: string; sql: string }> = {
  new: { label: "Ждут ответа", sql: "status = 'new'" },
  done: { label: "Отвеченные", sql: "status = 'replied'" },
  all: { label: "Все", sql: "status <> 'ignored'" },
};

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ account?: string; t?: string; p?: string; sync?: string }> }) {
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
        <h1>Сообщения</h1>
        <div className="card muted">Нет Instagram-аккаунтов.</div>
      </>
    );
  const acc = accounts.find((a) => a.id === sp.account) ?? accounts.find((a) => a.status === "active") ?? accounts[0];
  const tab = sp.t && TABS[sp.t] ? sp.t : "new";
  const href = (o: Record<string, string>) => `/messages?${new URLSearchParams({ account: acc.id, t: tab, ...o })}`;

  const counts = await q<{ status: string; n: string }>("select status, count(*) as n from ig_conversations where account_id=$1 group by status", [acc.id]);
  const cnt = (...st: string[]) => counts.filter((c) => st.includes(c.status)).reduce((s, c) => s + Number(c.n), 0);
  const tabCount: Record<string, number> = { new: cnt("new"), done: cnt("replied"), all: cnt("new", "replied") };

  const totalRows = tabCount[tab];
  const pg = pageFrom(sp.p, totalRows);
  const rows = await q<any>(
    `select * from ig_conversations where account_id=$1 and (${TABS[tab].sql}) order by last_message_at desc nulls last limit ${PAGE_SIZE} offset $2`,
    [acc.id, pg.offset]
  );
  // Последние сообщения каждого диалога одним запросом.
  const ids = rows.map((r: any) => r.id);
  const msgs = ids.length
    ? await q<any>(
        `select conversation_id, direction, text, attachments, sent_at from (
           select *, row_number() over (partition by conversation_id order by sent_at desc) as rn from ig_messages where conversation_id = any($1::uuid[])
         ) m where rn <= 6 order by sent_at`,
        [ids]
      )
    : [];

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Сообщения</h1>
        <form action={syncMessagesAction}>
          <input type="hidden" name="account_id" value={acc.id} />
          <Button className="ghost small" style={{ padding: "4px 12px" }} title="Подтянуть сообщения, которые не дошли вебхуком">Обновить</Button>
        </form>
      </div>

      {sp.sync?.startsWith("ok:") && (
        <div className="card small muted" style={{ marginTop: 12 }}>
          Опрос выполнен: диалогов в Instagram {sp.sync.split(":")[1]}, новых сообщений {sp.sync.split(":")[2]}.
        </div>
      )}
      {sp.sync?.startsWith("err:") && <div className="card err" style={{ marginTop: 12 }}>Ошибка опроса: {sp.sync.slice(4)}</div>}

      <div className="row" style={{ margin: "12px 0", gap: 8 }}>
        {accounts.map((a) => (
          <Link key={a.id} href={`/messages?${new URLSearchParams({ account: a.id, t: tab })}`} className={`pill ${a.id === acc.id ? "on" : ""}`}>
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
          {tab === "new" ? "Сообщений, ждущих ответа, нет. Новые приходят по вебхуку, а «Обновить» подтягивает пропущенные." : "Пока пусто."}
        </div>
      )}

      {rows.map((c: any) => {
        const st = STATUS[c.status] ?? { label: c.status, cls: "" };
        const w = replyWindow(c.last_incoming_at);
        const thread = msgs.filter((m: any) => m.conversation_id === c.id);
        return (
          <div key={c.id} className="card">
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <div>
                <b>@{c.participant_username ?? "?"}</b>
                <span className="muted small"> · {c.last_message_at ? fmtIn(c.last_message_at, tz) : ""}</span>
              </div>
              <span className={`chip ${st.cls}`}>{st.label}</span>
            </div>

            <div style={{ margin: "8px 0", display: "grid", gap: 6 }}>
              {thread.map((m: any, i: number) => (
                <div
                  key={i}
                  className="small"
                  style={{
                    whiteSpace: "pre-wrap",
                    justifySelf: m.direction === "out" ? "end" : "start",
                    maxWidth: "85%",
                    padding: "6px 10px",
                    borderRadius: 10,
                    background: m.direction === "out" ? "var(--accent-a3, rgba(120,120,255,.15))" : "var(--gray-a3, rgba(128,128,128,.15))",
                  }}
                >
                  {m.text || (
                    <span className="muted">
                      {m.attachments?.length
                        ? m.attachments.map((a: any) => ATTACHMENT[a.type] ?? "вложение").join(", ")
                        : "сообщение без текста"}
                    </span>
                  )}
                  <div className="muted" style={{ fontSize: 11 }}>{fmtIn(m.sent_at, tz)}</div>
                </div>
              ))}
            </div>

            {c.last_error && <div className="err">{c.last_error}</div>}

            {c.status === "new" || c.status === "replied" ? (
              w.open ? (
                <form action={replyMessageAction} style={{ marginTop: 8 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <Area name="text" placeholder="Ответ" style={{ minHeight: 64 }} />
                  <div className="row" style={{ gap: 8, marginTop: 8 }}>
                    <Button>Отправить</Button>
                    {c.status === "new" && <Button className="ghost" formAction={ignoreConversationAction}>Пропустить</Button>}
                    <span className="muted small">окно ответа: ещё {w.hoursLeft} ч</span>
                  </div>
                </form>
              ) : (
                <div className="muted small" style={{ marginTop: 8 }}>
                  Ответить уже нельзя: человек писал больше 24 часов назад.
                  {c.status === "new" && (
                    <form action={ignoreConversationAction} style={{ display: "inline", marginLeft: 8 }}>
                      <input type="hidden" name="id" value={c.id} />
                      <Button className="ghost small" style={{ padding: "2px 10px" }}>Убрать из списка</Button>
                    </form>
                  )}
                </div>
              )
            ) : null}
          </div>
        );
      })}
      <Pager page={pg.page} pages={pg.pages} total={totalRows} href={(n) => href({ p: String(n) })} />
    </>
  );
}
