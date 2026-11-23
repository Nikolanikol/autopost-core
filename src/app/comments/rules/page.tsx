import Link from "next/link";
import { defaultWorkspaceId, q } from "@/lib/db";
import { createRuleAction, deleteRuleAction, toggleRuleAction } from "../actions";
import { Area, Button, Check, Dropdown, Input } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACTIONS: Record<string, string> = {
  reply: "Ответить в комментариях",
  reply_dm: "Ответить + личное сообщение",
  dm: "Только личное сообщение",
  hide: "Скрыть комментарий",
};

export default async function RulesPage() {
  const ws = await defaultWorkspaceId();
  const accounts = await q<{ id: string; username: string | null }>(
    "select id, username from social_accounts where workspace_id=$1 and platform='instagram' order by username",
    [ws]
  );
  const rules = await q<any>(
    `select r.*, a.username from comment_rules r left join social_accounts a on a.id = r.account_id
      where r.workspace_id=$1 order by r.priority, r.created_at`,
    [ws]
  );

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Правила автоответа</h1>
        <Link href="/comments" className="pill">← К комментариям</Link>
      </div>
      <p className="muted small">
        Правило срабатывает на комментарий, если в нём есть любое из ключевых слов (регистр не важен, «*» — любой комментарий).
        Пока «Авто» выключено, ядро только готовит ответ, а отправляете вы одним нажатием в разделе «Комментарии».
        Автоответ срабатывает один раз, только на свежие комментарии (до 2 часов), не чаще 15 в час на аккаунт и не отвечает
        одному автору дважды под одним постом за сутки. В тексте можно использовать <code>{"{username}"}</code> — подставится @автор.
      </p>

      {rules.length === 0 && <div className="card muted">Правил пока нет.</div>}
      {rules.map((r: any) => (
        <div key={r.id} className="card">
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <div>
              <b>{r.name}</b>
              <span className="muted small"> · {r.username ? `@${r.username}` : "все аккаунты"} · {ACTIONS[r.action]}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <form action={toggleRuleAction}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="field" value="auto" />
                <Button className={r.auto ? "" : "ghost"} style={{ padding: "2px 10px" }} title="Отправлять без подтверждения">
                  {r.auto ? "Авто: вкл" : "Авто: выкл"}
                </Button>
              </form>
              <form action={toggleRuleAction}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="field" value="active" />
                <Button className="ghost" style={{ padding: "2px 10px" }}>{r.active ? "Выключить" : "Включить"}</Button>
              </form>
              <form action={deleteRuleAction}>
                <input type="hidden" name="id" value={r.id} />
                <Button className="danger" style={{ padding: "2px 10px" }}>Удалить</Button>
              </form>
            </div>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            <span className="muted">Слова:</span> {r.keywords.join(", ")}
          </div>
          {r.reply_text && <div className="small"><span className="muted">Ответ:</span> {r.reply_text}</div>}
          {r.dm_text && <div className="small"><span className="muted">Личное сообщение:</span> {r.dm_text}</div>}
          {!r.active && <div className="muted small">Выключено</div>}
        </div>
      ))}

      <h2>Новое правило</h2>
      <form action={createRuleAction} className="card">
        <label>Название</label>
        <Input type="text" name="name" placeholder="Вопрос про цену" required />
        <label>Для аккаунта</label>
        <Dropdown name="account_id" defaultValue="" options={[{ value: "", label: "Все аккаунты" }, ...accounts.map((a) => ({ value: a.id, label: "@" + a.username }))]} />
        <label>Ключевые слова (через запятую)</label>
        <Input type="text" name="keywords" placeholder="цена, сколько стоит, price" required />
        <label>Действие</label>
        <Dropdown name="action" defaultValue="reply" options={Object.entries(ACTIONS).map(([k, v]) => ({ value: k, label: v }))} />
        <label>Ответ в комментариях</label>
        <Area name="reply_text" placeholder="{username}, отправили расчёт в личные сообщения 👇" />
        <label>Личное сообщение</label>
        <Area name="dm_text" placeholder="Здравствуйте! Вот расчёт стоимости…" />
        <label>Приоритет (меньше — раньше)</label>
        <Input type="text" name="priority" defaultValue="100" />
        <Check name="auto">Авто — отправлять без подтверждения (включайте, когда убедитесь, что правило работает верно)</Check>
        <Button style={{ marginTop: 12 }}>Создать правило</Button>
      </form>
    </>
  );
}
