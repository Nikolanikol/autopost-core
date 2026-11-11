"use client";

import { useActionState } from "react";
import { createApiKeyAction, type FormState } from "../actions";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createApiKeyAction, null);
  return (
    <form action={action} className="card">
      <div className="row">
        <input name="name" type="text" placeholder="Название, например: video-generator" style={{ flex: 1, minWidth: 200 }} />
        <button disabled={pending}>Создать ключ</button>
      </div>
      {state?.ok && (
        <div className="alert ok">
          {state.ok}
          <code className="secret">{state.secret}</code>
        </div>
      )}
    </form>
  );
}
