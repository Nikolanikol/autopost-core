import Link from "next/link";
import { listAccounts } from "@/lib/accounts";
import { defaultWorkspaceId, q } from "@/lib/db";
import { listMedia } from "@/lib/media";
import { NewPostForm } from "./NewPostForm";

export const dynamic = "force-dynamic";

export default async function NewPostPage() {
  const ws = await defaultWorkspaceId();
  const accounts = (await listAccounts(ws)).filter((a: any) => a.status === "active");
  const media = await listMedia(ws, 30);
  const templates = await q("select id, kind, name, body from templates where workspace_id=$1 order by kind, name", [ws]);
  return (
    <>
      <h1>Новый пост</h1>
      {accounts.length === 0 ? (
        <div className="card">
          Нет активных аккаунтов. <Link href="/accounts">Подключите аккаунт</Link>.
        </div>
      ) : (
        <NewPostForm
          accounts={accounts.map((a: any) => ({ id: a.id, platform: a.platform, username: a.username }))}
          media={media.map((m: any) => ({
            id: m.id,
            kind: m.kind,
            url: m.public_url,
            width: m.width,
            height: m.height,
            warnings: m.validation?.warnings ?? [],
          }))}
          templates={templates.map((t: any) => ({ id: t.id, kind: t.kind, name: t.name, body: t.body }))}
        />
      )}
    </>
  );
}
