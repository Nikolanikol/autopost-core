import { NextResponse, type NextRequest } from "next/server";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";

// Интерфейс закрыт страницей входа (ADMIN_USER / ADMIN_PASSWORD → cookie-сессия).
// API v1 — своими ключами; /media/* — публично (платформы скачивают файлы).
export async function middleware(req: NextRequest) {
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD)
    return new NextResponse("ADMIN_USER/ADMIN_PASSWORD не заданы", { status: 500 });
  if (req.nextUrl.pathname === "/login") return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  if (cookie && safeEqual(cookie, await sessionToken())) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!api/v1|media/|_next/static|_next/image|favicon.ico).*)"] };
