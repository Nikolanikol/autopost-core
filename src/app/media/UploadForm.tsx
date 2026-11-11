"use client";

import { useActionState } from "react";
import { uploadMediaAction, type FormState } from "../actions";

export function UploadForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadMediaAction, null);
  return (
    <form action={action} className="card">
      <div className="row">
        <input type="file" name="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" required />
        <button disabled={pending}>{pending ? "Загружаю и проверяю…" : "Загрузить"}</button>
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        Для Instagram: фото JPEG (4:5…1.91:1), видео MP4 H.264 + AAC, лучше 9:16. До 300 МБ.
      </div>
      {state?.error && <div className="alert bad">{state.error}</div>}
      {state?.ok && <div className="alert ok">{state.ok}</div>}
      {state?.issues?.length ? (
        <div className="alert">
          <ul>{state.issues.map((i) => <li key={i}>⚠️ {i}</li>)}</ul>
        </div>
      ) : null}
    </form>
  );
}
