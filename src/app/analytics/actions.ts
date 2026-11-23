"use server";

import { revalidatePath } from "next/cache";
import { syncAccountAnalytics } from "@/lib/analytics";
import { defaultWorkspaceId, one } from "@/lib/db";

/** Кнопка «Обновить»: забирает свежую статистику аккаунта прямо сейчас. */
export async function refreshAnalyticsAction(formData: FormData) {
  const id = String(formData.get("account_id") ?? "");
  const ws = await defaultWorkspaceId();
  const acc = await one("select id from social_accounts where id=$1 and workspace_id=$2", [id, ws]);
  if (!acc) return;
  try {
    await syncAccountAnalytics(id, console.log);
  } catch (e) {
    console.error("[analytics] refresh failed:", (e as Error).message);
  }
  revalidatePath("/analytics");
}
