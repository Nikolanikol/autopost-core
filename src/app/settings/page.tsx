import { defaultWorkspaceId, q } from "@/lib/db";
import { getTelegram } from "@/lib/notify";
import { workspaceTz } from "@/lib/slots";
import { fmtIn } from "@/lib/tz";
import { deleteTemplateAction, deleteWebhookAction, revokeApiKeyAction, testWebhooksAction } from "../actions";
import { CreateKeyForm } from "./CreateKeyForm";
import { TelegramForm, TemplateForm, WebhookForm, WorkspaceForm } from "./SettingsForms";

export const dynamic = "force-dynamic";


export default async function SettingsPage() {
  const ws = await defaultWorkspaceId();
  const [keys, templates, hooks, tg, tz] = await Promise.all([
    q("select id, name, prefix, created_at, last_used_at, revoked_at from api_keys where workspace_id=$1 order by created_at desc", [ws]),
    q("select id, kind, name, body from templates where workspace_id=$1 order by kind, name", [ws]),
    q("select id, url, events, last_status, last_at from webhooks where workspace_id=$1 order by created_at", [ws]),
    getTelegram(ws),
    workspaceTz(ws),
  ]);
  const fmt = (d: Date | null) => fmtIn(d, tz);

  return (
    <>
      <h1>Настройки</h1>

      <h2>Workspace</h2>
      <WorkspaceForm timezone={tz} />

      <h2>Шаблоны подписей и хэштегов</h2>
      <p className="muted small">Вставляются в подпись одним кликом в редакторе поста.</p>
      {templates.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <tbody>
              {templates.map((t: any) => (
                <tr key={t.id}>
                  <td style={{ width: 90 }}><span className="chip">{t.kind === "hashtags" ? "хэштеги" : "подпись"}</span></td>
                  <td><b>{t.name}</b><div className="muted small" style={{ whiteSpace: "pre-wrap" }}>{t.body.slice(0, 200)}</div></td>
                  <td style={{ width: 90 }}>
                    <form action={deleteTemplateAction}>
                      <input type="hidden" name="template_id" value={t.id} />
                      <button className="danger small" style={{ padding: "2px 8px" }}>Удалить</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <TemplateForm />

      <h2>Уведомления в Telegram</h2>
      <TelegramForm
        chatId={tg.chat_id ?? ""}
        hasToken={Boolean(tg.bot_token_enc)}
        events={tg.events ?? ["post.failed", "account.needs_reauth"]}
      />

      <h2>Вебхуки</h2>
      <p className="muted small">
        POST с JSON <code>{`{ event, at, data }`}</code> и подписью <code>X-Autopost-Signature: sha256=…</code> (HMAC тела секретом).
      </p>
      {hooks.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table>
            <thead><tr><th>URL</th><th>События</th><th>Последний ответ</th><th></th></tr></thead>
            <tbody>
              {hooks.map((h: any) => (
                <tr key={h.id}>
                  <td className="small" style={{ wordBreak: "break-all" }}>{h.url}</td>
                  <td className="small">{h.events.join(", ")}</td>
                  <td className="small">
                    {h.last_status == null ? "—" : (
                      <span className={`chip ${h.last_status >= 200 && h.last_status < 300 ? "s-published" : "s-failed"}`}>
                        {h.last_status || "нет ответа"}
                      </span>
                    )}{" "}
                    <span className="muted">{h.last_at ? fmt(h.last_at) : ""}</span>
                  </td>
                  <td>
                    <form action={deleteWebhookAction}>
                      <input type="hidden" name="webhook_id" value={h.id} />
                      <button className="danger small" style={{ padding: "2px 8px" }}>Удалить</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={testWebhooksAction} style={{ padding: 12 }}>
            <button className="ghost small">Отправить тестовое событие post.published</button>
          </form>
        </div>
      )}
      <WebhookForm />

      <h2>API-ключи для генераторов</h2>
      <CreateKeyForm />
      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table>
          <thead><tr><th>Название</th><th>Ключ</th><th>Создан</th><th>Использован</th><th></th></tr></thead>
          <tbody>
            {keys.length === 0 && <tr><td colSpan={5} className="muted">Ключей нет</td></tr>}
            {keys.map((k: any) => (
              <tr key={k.id} className={k.revoked_at ? "muted" : ""}>
                <td>{k.name}</td>
                <td><code>{k.prefix}…</code></td>
                <td className="small">{fmt(k.created_at)}</td>
                <td className="small">{fmt(k.last_used_at)}</td>
                <td>
                  {k.revoked_at ? (
                    <span className="chip s-canceled">отозван</span>
                  ) : (
                    <form action={revokeApiKeyAction}>
                      <input type="hidden" name="key_id" value={k.id} />
                      <button className="danger small" style={{ padding: "2px 8px" }}>Отозвать</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Как отправить пост из генератора</h2>
      <div className="card small">
        <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{`# 1. Загрузить файл (или передать media_urls сразу в посте)
curl -X POST $HOST/api/v1/media -H "Authorization: Bearer ak_…" -F file=@reel.mp4

# 2. Поставить в ближайший свободный слот
curl -X POST $HOST/api/v1/posts \\
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" -H "X-Source: generator" \\
  -d '{
    "caption": "Новое поступление",
    "media_ids": ["<id из шага 1>"],
    "targets": [{ "account_id": "<id из GET /api/v1/accounts>", "options": { "type": "reel" } }],
    "schedule": "next_slot",
    "idempotency_key": "gen-2026-11-12-001"
  }'`}</pre>
      </div>
    </>
  );
}
