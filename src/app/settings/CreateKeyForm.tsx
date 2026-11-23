"use client";

import { useActionState } from "react";
import { createApiKeyAction, type FormState } from "../actions";
import { Button, Dropdown, Input } from "@/components/ui";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createApiKeyAction, null);
  return (
    <form action={action} className="card">
      <div className="row">
        <Input name="name" type="text" placeholder="Название, например: video-generator" style={{ flex: 1, minWidth: 200 }} />
        <Dropdown name="scope" defaultValue="brand" width="auto" ariaLabel="Область ключа" options={[
          { value: "brand", label: "Только этот бренд (генераторы)" },
          { value: "all", label: "Все бренды (для Claude)" },
        ]} />
        <Button disabled={pending}>Создать ключ</Button>
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
