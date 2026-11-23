import { NextResponse, type NextRequest } from "next/server";
import { defaultWorkspaceId } from "@/lib/db";
import { safeEqual } from "@/lib/session";
import { publicBaseUrl } from "@/lib/storage";
import { connectTikTok } from "@/lib/tiktokAuth";

export const runtime = "nodejs";

/** Возврат из TikTok: проверяем state, меняем код на токены, сохраняем аккаунт в текущий бренд. */
export async function GET(req: NextRequest) {
  const back = (qs: string) => {
    const res = NextResponse.redirect(`${publicBaseUrl()}/accounts?${qs}`);
    res.cookies.delete("tt_oauth_state");
    return res;
  };
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return back(`tiktok_error=${encodeURIComponent(p.get("error_description") || p.get("error")!)}`);

  const state = p.get("state") ?? "";
  const expected = req.cookies.get("tt_oauth_state")?.value ?? "";
  if (!state || !expected || !safeEqual(state, expected)) return back("tiktok_error=" + encodeURIComponent("Сессия подключения устарела, попробуйте ещё раз"));

  const code = p.get("code");
  if (!code) return back("tiktok_error=" + encodeURIComponent("TikTok не вернул код авторизации"));

  try {
    const acc = await connectTikTok(await defaultWorkspaceId(), code);
    return back(`tiktok_ok=${encodeURIComponent(acc?.username ?? "")}`);
  } catch (e) {
    return back(`tiktok_error=${encodeURIComponent((e as Error).message)}`);
  }
}
