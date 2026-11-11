import { defaultWorkspaceId } from "@/lib/db";
import { listMedia } from "@/lib/media";
import { publicBaseUrl } from "@/lib/storage";
import { deleteMediaAction } from "../actions";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

const mb = (n: number | null) =>
  !n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`;

export default async function MediaPage() {
  const media = await listMedia(await defaultWorkspaceId());
  const httpsOk = publicBaseUrl().startsWith("https://");
  return (
    <>
      <h1>Медиатека</h1>
      {!httpsOk && (
        <div className="alert bad small">
          Загруженные файлы сейчас доступны по {publicBaseUrl()} — Instagram не сможет их скачать. Для публикации задайте
          PUBLIC_BASE_URL с https (сервер или туннель ngrok). Файлы по внешним https-ссылкам работают и так.
        </div>
      )}
      <UploadForm />
      {media.length === 0 ? (
        <div className="card muted">Пока пусто</div>
      ) : (
        <div className="grid">
          {media.map((m: any) => (
            <div key={m.id} className="tile">
              <div className="pic">
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.public_url} alt="" loading="lazy" />
                ) : (
                  <video src={m.public_url} muted preload="metadata" />
                )}
              </div>
              <div className="meta">
                <span>
                  {m.kind === "video" ? "🎬" : "🖼"} {m.width && m.height ? `${m.width}×${m.height}` : ""}
                  {m.duration_sec ? ` · ${Number(m.duration_sec).toFixed(1)} c` : ""}
                </span>
                <span className="muted">
                  {m.source === "upload" ? "загружен" : "по ссылке"} {mb(m.size_bytes)} · в постах: {m.used}
                </span>
                {(m.validation?.warnings ?? []).map((w: string) => (
                  <span key={w} className="err">{w}</span>
                ))}
                {m.used === 0 && (
                  <form action={deleteMediaAction}>
                    <input type="hidden" name="media_id" value={m.id} />
                    <button className="danger small" style={{ padding: "2px 8px" }}>Удалить</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
