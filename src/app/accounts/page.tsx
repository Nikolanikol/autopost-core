import { Suspense } from "react";
import { decrypt } from "@/lib/crypto";
import { defaultWorkspaceId, one } from "@/lib/db";
import { listAccounts } from "@/lib/accounts";
import { publisherFor } from "@/publishers";
import { listSlots, WEEKDAYS, workspaceTz } from "@/lib/slots";
import { addSlotsAction, deleteSlotAction, toggleAccountAction } from "../actions";
import { AddAccountForm } from "./AddAccountForm";
import { Button, Check, Input } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { active: "активен", needs_reauth: "нужно переподключить", disabled: "выключен" };

// Лимит публикаций спрашиваем у Instagram: это сетевой запрос, поэтому страница не ждёт его —
// ячейка догружается потоком (Suspense), ответ кэшируется на 10 минут, запрос обрывается через 4 секунды.
const quotaCache = new Map<string, { at: number; text: string }>();

async function quotaText(a: any): Promise<string> {
  const hit = quotaCache.get(a.id);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.text;
  try {
    const row = await one<{ token_enc: string }>("select token_enc from social_accounts where id=$1", [a.id]);
    const q = await Promise.race([
      publisherFor(a.platform).quota?.(a.external_id, decrypt(row!.token_enc)),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
    ]);
    const text = q ? `${q.used} / ${q.total} за 24ч` : "—";
    quotaCache.set(a.id, { at: Date.now(), text });
    return text;
  } catch {
    return "не удалось получить";
  }
}

async function QuotaCell({ account }: { account: any }) {
  return <>{await quotaText(account)}</>;
}

export default async function AccountsPage() {
  const ws = await defaultWorkspaceId();
  const accounts = await listAccounts(ws);
  const tz = await workspaceTz(ws);
  const slots = await Promise.all(accounts.map((a: any) => listSlots(a.id)));

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
                <td className="small">{a.status === "active" ? <Suspense fallback={<span className="muted">…</span>}><QuotaCell account={a} /></Suspense> : "—"}</td>
                <td>
                  <form action={toggleAccountAction}>
                    <input type="hidden" name="account_id" value={a.id} />
                    <Button className="ghost small" style={{ padding: "2px 8px" }}>
                      {a.status === "disabled" ? "Включить" : "Выключить"}
                    </Button>
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
                <Button className="ghost" style={{ padding: 0, border: 0, lineHeight: 1 }} title="Удалить">×</Button>
              </form>
            ))}
          </div>
          <form action={addSlotsAction} className="row" style={{ gap: 10 }}>
            <input type="hidden" name="account_id" value={a.id} />
            {WEEKDAYS.slice(1).map((d, wd) => (
              <Check key={d} inline name="weekday" value={String(wd + 1)} defaultChecked={wd < 5}>{d}</Check>
            ))}
            <Input type="time" name="at_time" required defaultValue="18:00" style={{ width: 140 }} />
            <Button className="ghost">Добавить</Button>
          </form>
        </div>
      ))}

      <h2>Подключить аккаунт</h2>
      <AddAccountForm />
    </>
  );
}
