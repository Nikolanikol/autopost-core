"use client";

import { useActionState } from "react";
import { addAccountAction, type FormState } from "../actions";
import { Button, Dropdown, Input } from "@/components/ui";

export function AddAccountForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addAccountAction, null);
  return (
    <form action={action} className="card">
      <div className="muted small">
        MVP: токен вставляется вручную (Meta → приложение → Instagram API → «Сгенерировать маркер»). Вход через
        OAuth — этап 3. Токен проверяется у платформы и хранится зашифрованным.
      </div>
      <label htmlFor="platform">Платформа</label>
      <Dropdown name="platform" defaultValue="instagram" ariaLabel="Платформа" options={[{ value: "instagram", label: "Instagram" }]} />
      <label htmlFor="external_id">ID аккаунта Instagram</label>
      <Input id="external_id" name="external_id" type="text" required placeholder="1784…" inputMode="numeric" autoComplete="off" />
      <label htmlFor="token">Токен доступа</label>
      {/* new-password: не даём браузеру подставлять сохранённый пароль от интерфейса */}
      <Input id="token" name="token" type="password" required autoComplete="new-password" />
      {state?.error && (
        <div className="alert bad">
          {state.error}
          {state.issues?.length ? <ul>{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
        </div>
      )}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      <div style={{ marginTop: 16 }}>
        <Button disabled={pending}>{pending ? "Проверяю…" : "Подключить"}</Button>
      </div>
    </form>
  );
}
