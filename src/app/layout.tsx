import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "./login/actions";
import "./globals.css";

export const metadata: Metadata = { title: "Autopost Core" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="top">
          <div className="wrap row">
            <Link href="/" className="brand">Autopost</Link>
            <nav>
              <Link href="/">Очередь</Link>
              <Link href="/calendar">Календарь</Link>
              <Link href="/posts/new">Новый пост</Link>
              <Link href="/media">Медиатека</Link>
              <Link href="/accounts">Аккаунты</Link>
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
