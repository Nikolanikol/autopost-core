import { decrypt } from "@/lib/crypto";
import { defaultWorkspaceId, one } from "@/lib/db";
import { listAccounts } from "@/lib/accounts";
import { publisherFor } from "@/publishers";
import { listSlots, WEEKDAYS, workspaceTz } from "@/lib/slots";
import { addSlotsAction, deleteSlotAction, toggleAccountAction } from "../actions";
import { AddAccountForm } from "./AddAccountForm";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { active: "активен", needs_reauth: "нужно переподключить", disabled: "выключен" };

async function quotaFor(a: any) {
  try {
    const row = await one<{ token_enc: string }>("select token_enc from social_accounts where id=$1", [a.id]);
    const q = await publisherFor(a.platform).quota?.(a.external_id, decrypt(row!.token_enc));
    return q ? `${q.used} / ${q.total} за 24ч` : "—";
  } catch {
    return "не удалось получить";
  }
}

export default async function AccountsPage() {
  const ws = await defaultWorkspaceId();
  const accounts = await listAccounts(ws);
  const tz = await workspaceTz(ws);
  const slots = await Promise.all(accounts.map((a: any) => listSlots(a.id)));
  const quotas = await Promise.all(accounts.map((a: any) => (a.status === "active" ? quotaFor(a) : "—")));

  return (
    <>
      <h1>Аккаунты</h1>
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead>
            <tr><th>Аккаунт</th><th>Платформа</th><th>Статус</th><th>Лимит публикаций</th><th></th></tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr><td colSpan={5} className="muted">Пока ни одного аккаунта</td></tr>
            )}
            {accounts.map((a: any, i: number) => (
              <tr key={a.id}>
                <td>@{a.username}<div className="muted small">id {a.external_id}</div></td>
                <td>{a.platform === "instagram" ? "Instagram" : a.platform}</td>
                <td><span className={`chip s-${a.status}`}>{STATUS[a.status] ?? a.status}</span></td>
                <td className="small">{quotas[i]}</td>
                <td>
                  <form action={toggleAccountAction}>
                    <input type="hidden" name="account_id" value={a.id} />
                    <button className="ghost small" style={{ padding: "2px 8px" }}>
                      {a.status === "disabled" ? "Включить" : "Выключить"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Слоты расписания</h2>
      <p className="muted small">
        Время в поясе workspace ({tz}). Посты с расписанием «в ближайший слот» (из интерфейса или API{" "}
        <code>&quot;schedule&quot;: &quot;next_slot&quot;</code>) встают в первый свободный слот.
      </p>
      {accounts.map((a: any, i: number) => (
        <div key={a.id} className="card">
          <b>@{a.username}</b>
          <div className="slots">
            {slots[i].length === 0 && <span className="muted small">Слотов нет</span>}
            {slots[i].map((s) => (
              <form key={s.id} action={deleteSlotAction} className="chip">
                {WEEKDAYS[s.weekday]} {s.at_time}
                <input type="hidden" name="slot_id" value={s.id} />
                <button className="ghost" style={{ padding: 0, border: 0, lineHeight: 1 }} title="Удалить">×</button>
              </form>
            ))}
          </div>
          <form action={addSlotsAction} className="row" style={{ gap: 10 }}>
            <input type="hidden" name="account_id" value={a.id} />
            {WEEKDAYS.slice(1).map((d, wd) => (
              <label key={d} className="check" style={{ margin: 0 }}>
                <input type="checkbox" name="weekday" value={wd + 1} defaultChecked={wd < 5} /> {d}
              </label>
            ))}
            <input type="time" name="at_time" required defaultValue="18:00" style={{ width: 140 }} />
            <button className="ghost">Добавить</button>
          </form>
        </div>
      ))}

      <h2>Подключить аккаунт</h2>
      <AddAccountForm />
    </>
  );
}
