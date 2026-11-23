"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { Button, Input } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="card">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="user" style={{ marginTop: 0 }}>Логин</label>
      <Input id="user" name="user" type="text" autoComplete="username" defaultValue="admin" required />
      <label htmlFor="password">Пароль</label>
      <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      {state?.error && <div className="alert bad">{state.error}</div>}
      <div style={{ marginTop: 16 }}>
        <Button disabled={pending}>{pending ? "Вхожу…" : "Войти"}</Button>
      </div>
    </form>
  );
}
