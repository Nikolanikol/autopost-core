import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { publicBaseUrl } from "@/lib/storage";
import { tiktokAuthorizeUrl, tiktokConfigured } from "@/lib/tiktokAuth";

export const runtime = "nodejs";

/** Начало подключения TikTok: ставим защитный state в cookie и отправляем на страницу согласия. */
export async function GET() {
  if (!tiktokConfigured())
    return new NextResponse("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET не заданы в .env", { status: 500 });
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(tiktokAuthorizeUrl(state));
  res.cookies.set("tt_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: publicBaseUrl().startsWith("https://"),
    maxAge: 600,
    path: "/",
  });
  return res;
}
