"use client";

import { useActionState } from "react";
import { Area, Button, Check, Dropdown, Input } from "@/components/ui";
import {
  createWebhookAction,
  saveTelegramAction,
  saveTemplateAction,
  saveWorkspaceAction,
  type FormState,
} from "../actions";

const EVENTS = [
  { name: "post.published", label: "Пост опубликован" },
  { name: "post.failed", label: "Ошибка публикации" },
  { name: "account.needs_reauth", label: "Аккаунт нужно переподключить" },
];

function Result({ state }: { state: FormState }) {
  if (!state) return null;
  return (
    <div className={`alert ${state.error ? "bad" : "ok"}`}>
      {state.error ?? state.ok}
      {state.secret && <code className="secret">{state.secret}</code>}
      {state.issues?.length ? <ul>{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
    </div>
  );
}

export function WorkspaceForm({ timezone }: { timezone: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveWorkspaceAction, null);
  return (
    <form action={action} className="card">
      <label htmlFor="tz" style={{ marginTop: 0 }}>Часовой пояс</label>
      <div className="row">
        <Input id="tz" name="timezone" type="text" defaultValue={timezone} style={{ flex: 1, minWidth: 200 }} />
        <Button disabled={pending}>Сохранить</Button>
      </div>
      <div className="muted small">Например Asia/Seoul, Europe/Moscow, Europe/Berlin. Влияет на слоты, календарь и время в очереди.</div>
      <Result state={state} />
    </form>
  );
}

export function TemplateForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTemplateAction, null);
  return (
    <form action={action} className="card">
      <div className="row">
        <Dropdown name="kind" defaultValue="caption" width={160} options={[{ value: "caption", label: "Подпись" }, { value: "hashtags", label: "Хэштеги" }]} />
        <Input name="name" type="text" placeholder="Название" style={{ flex: 1, minWidth: 160 }} />
      </div>
      <Area name="body" placeholder="Текст шаблона" style={{ marginTop: 8, minHeight: 80 }} />
      <div style={{ marginTop: 8 }}>
        <Button disabled={pending}>Добавить шаблон</Button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function TelegramForm({ chatId, hasToken, events }: { chatId: string; hasToken: boolean; events: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveTelegramAction, null);
  return (
    <form action={action} className="card">
      <div className="muted small">
        Создайте бота у @BotFather, добавьте его в чат и укажите chat_id (для личных сообщений — ваш id, для группы — с
        минусом). Токен бота хранится зашифрованным.
      </div>
      <label htmlFor="bot_token">Токен бота</label>
      <Input id="bot_token" name="bot_token" type="password" autoComplete="off" placeholder={hasToken ? "сохранён — оставьте пустым" : "123456:ABC…"} />
      <label htmlFor="chat_id">chat_id</label>
      <Input id="chat_id" name="chat_id" type="text" defaultValue={chatId} />
      <label>События</label>
      {EVENTS.map((e) => (
        <Check key={e.name} name="events" value={e.name} defaultChecked={events.includes(e.name)}>{e.label}</Check>
      ))}
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <Button disabled={pending}>Сохранить</Button>
        <Button name="test" value="1" className="ghost" disabled={pending}>Сохранить и отправить тест</Button>
        {hasToken && <Button name="disable" value="1" className="danger" disabled={pending}>Отключить</Button>}
      </div>
      <Result state={state} />
    </form>
  );
}

export function WebhookForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createWebhookAction, null);
  return (
    <form action={action} className="card">
      <label htmlFor="wh" style={{ marginTop: 0 }}>URL</label>
      <Input id="wh" name="url" type="url" placeholder="https://generator.example.com/hooks/autopost" />
      <div className="row" style={{ marginTop: 8 }}>
        {EVENTS.map((e) => (
          <Check key={e.name} inline name="events" value={e.name} defaultChecked>{e.name}</Check>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <Button disabled={pending}>Добавить вебхук</Button>
      </div>
      <Result state={state} />
    </form>
  );
}
