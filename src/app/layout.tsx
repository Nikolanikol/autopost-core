import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { defaultWorkspaceId, q } from "@/lib/db";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";
import { BrandSwitcher } from "./BrandSwitcher";
import { switchBrandAction } from "./brands/actions";
import { logoutAction } from "./login/actions";
import "./globals.css";

export const metadata: Metadata = { title: "Autopost Core" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Список брендов показываем только вошедшему пользователю (на странице входа его быть не должно).
  const sess = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const authed = Boolean(sess) && safeEqual(sess, await sessionToken());
  const brands = authed ? await q<{ id: string; name: string }>("select id, name from workspaces order by created_at") : [];
  const current = authed ? await defaultWorkspaceId() : "";
  return (
    <html lang="ru">
      <body>
        <header className="top">
          <div className="wrap row">
            <Link href="/" className="brand">Autopost</Link>
            {authed && brands.length > 0 && <BrandSwitcher brands={brands} current={current} action={switchBrandAction} />}
            <nav>
              <Link href="/">Очередь</Link>
              <Link href="/calendar">Календарь</Link>
              <Link href="/posts/new">Новый пост</Link>
              <Link href="/media">Медиатека</Link>
              <Link href="/analytics">Аналитика</Link>
              <Link href="/comments">Комментарии</Link>
              <Link href="/accounts">Аккаунты</Link>
              <Link href="/brands">Бренды</Link>
              <Link href="/settings">Настройки</Link>
            </nav>
            <form action={logoutAction} style={{ marginLeft: "auto" }}>
              <button className="ghost small" style={{ padding: "4px 10px" }}>Выйти</button>
            </form>
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
