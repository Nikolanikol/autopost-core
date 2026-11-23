"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { BRAND_COOKIE, defaultWorkspaceId, one, q } from "@/lib/db";

const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim();

async function setBrandCookie(id: string) {
  (await cookies()).set(BRAND_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

const refresh = () => revalidatePath("/", "layout");

/** Переключатель в шапке: выбранный бренд запоминается в cookie, все разделы показывают его данные. */
export async function switchBrandAction(fd: FormData) {
  const id = clean(fd.get("brand"));
  if (!(await one("select 1 from workspaces where id=$1", [id]))) return;
  await setBrandCookie(id);
  refresh();
}

export async function createBrandAction(fd: FormData) {
  const name = clean(fd.get("name")).slice(0, 60);
  if (!name) return;
  const cur = await one<{ timezone: string }>("select timezone from workspaces where id=$1", [await defaultWorkspaceId()]);
  const row = await one<{ id: string }>("insert into workspaces (name, timezone) values ($1,$2) returning id", [name, cur?.timezone ?? "Europe/Moscow"]);
  if (row) await setBrandCookie(row.id);
  refresh();
}

export async function renameBrandAction(fd: FormData) {
  const name = clean(fd.get("name")).slice(0, 60);
  if (!name) return;
  await q("update workspaces set name=$2 where id=$1", [clean(fd.get("id")), name]);
  refresh();
}

/** Удалить можно только пустой бренд: без аккаунтов, постов и файлов. */
export async function deleteBrandAction(fd: FormData) {
  const id = clean(fd.get("id"));
  const total = await one<{ n: string }>("select count(*) as n from workspaces");
  if (Number(total?.n) <= 1) return;
  const used = await one<{ n: string }>(
    `select (select count(*) from social_accounts where workspace_id=$1) + (select count(*) from posts where workspace_id=$1)
          + (select count(*) from media where workspace_id=$1) as n`,
    [id]
  );
  if (Number(used?.n) > 0) return;
  await q("delete from workspaces where id=$1", [id]);
  refresh();
}

/**
 * Перенос аккаунта в другой бренд. Возможен, пока у аккаунта нет публикаций (у постов бренд свой).
 * Правила автоответа аккаунта переезжают вместе с ним.
 */
export async function moveAccountAction(fd: FormData) {
  const accountId = clean(fd.get("account_id"));
  const to = clean(fd.get("brand"));
  const acc = await one<{ workspace_id: string; platform: string; external_id: string }>(
    "select workspace_id, platform, external_id from social_accounts where id=$1",
    [accountId]
  );
  if (!acc || acc.workspace_id === to || !(await one("select 1 from workspaces where id=$1", [to]))) return;
  if (await one("select 1 from post_targets where account_id=$1 limit 1", [accountId])) return;
  if (await one("select 1 from social_accounts where workspace_id=$1 and platform=$2 and external_id=$3", [to, acc.platform, acc.external_id])) return;
  await q("update social_accounts set workspace_id=$2, updated_at=now() where id=$1", [accountId, to]);
  await q("update comment_rules set workspace_id=$2 where account_id=$1", [accountId, to]);
  refresh();
}
