"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { safeEqual, SESSION_COOKIE, SESSION_MAX_AGE, sessionToken } from "@/lib/session";

export async function loginAction(_: { error?: string } | null, fd: FormData) {
  const user = String(fd.get("user") ?? "");
  const pass = String(fd.get("password") ?? "");
  const okUser = safeEqual(user, process.env.ADMIN_USER ?? "");
  const okPass = safeEqual(pass, process.env.ADMIN_PASSWORD ?? "");
  if (!okUser || !okPass) {
    await new Promise((r) => setTimeout(r, 700)); // замедляем перебор
    return { error: "Неверный логин или пароль" };
  }
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  const next = String(fd.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
