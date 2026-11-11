"use client";

import { useActionState } from "react";
import { addAccountAction, type FormState } from "../actions";

export function AddAccountForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addAccountAction, null);
  return (
    <form action={action} className="card">
      <div className="muted small">
        MVP: токен вставляется вручную (Meta → приложение → Instagram API → «Сгенерировать маркер»). Вход через
        OAuth — этап 3. Токен проверяется у платформы и хранится зашифрованным.
      </div>
      <label htmlFor="platform">Платформа</label>
      <select id="platform" name="platform" defaultValue="instagram">
        <option value="instagram">Instagram</option>
      </select>
      <label htmlFor="external_id">ID аккаунта Instagram</label>
      <input id="external_id" name="external_id" type="text" required placeholder="1784…" inputMode="numeric" />
      <label htmlFor="token">Токен доступа</label>
      <input id="token" name="token" type="password" required autoComplete="off" />
      {state?.error && (
        <div className="alert bad">
          {state.error}
          {state.issues?.length ? <ul>{state.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
        </div>
      )}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      <div style={{ marginTop: 16 }}>
        <button disabled={pending}>{pending ? "Проверяю…" : "Подключить"}</button>
      </div>
    </form>
  );
}
