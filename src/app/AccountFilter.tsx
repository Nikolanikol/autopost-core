import Link from "next/link";
import { q } from "@/lib/db";

/** Переключатель «Все аккаунты / @аккаунт» для очереди и календаря. Не показывается, если аккаунт один. */
export async function AccountFilter({
  workspaceId,
  base,
  active,
  params = {},
}: {
  workspaceId: string;
  base: string;
  active?: string | null;
  params?: Record<string, string>;
}) {
  const accounts = await q<{ id: string; username: string | null }>(
    "select id, username from social_accounts where workspace_id=$1 order by username",
    [workspaceId]
  );
  if (accounts.length < 2) return null;
  const href = (id?: string) => {
    const p = new URLSearchParams({ ...params, ...(id ? { account: id } : {}) });
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };
  return (
    <div className="row" style={{ gap: 8, margin: "4px 0 12px" }}>
      <Link href={href()} className={`pill ${!active ? "on" : ""}`}>Все аккаунты</Link>
      {accounts.map((a) => (
        <Link key={a.id} href={href(a.id)} className={`pill ${active === a.id ? "on" : ""}`}>@{a.username}</Link>
      ))}
    </div>
  );
}
