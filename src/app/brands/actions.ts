"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MoveError, moveAccountToBrand } from "@/lib/brands";
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

/** Перенос аккаунта в другой бренд вместе с постами и файлами (см. moveAccountToBrand). */
export async function moveAccountAction(fd: FormData) {
  let notice: string;
  try {
    const r = await moveAccountToBrand(clean(fd.get("account_id")), clean(fd.get("brand")), fd.get("with_library") === "on");
    const parts = [`постов: ${r.posts}`];
    if (r.media_moved + r.media_copied) parts.push(`файлов из постов: ${r.media_moved + r.media_copied}`);
    if (r.library_files) parts.push(`файлов медиатеки: ${r.library_files}`);
    if (r.keys) parts.push(`API-ключей: ${r.keys}`);
    notice = `ok=${encodeURIComponent("Аккаунт перенесён. Переехало: " + parts.join(", "))}`;
  } catch (e) {
    notice = `err=${encodeURIComponent(e instanceof MoveError ? e.message : "Не удалось перенести: " + (e as Error).message)}`;
  }
  refresh();
  redirect(`/brands?${notice}`);
}
