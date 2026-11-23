import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { ExitIcon } from "@radix-ui/react-icons";
import { BRAND_COOKIE, q } from "@/lib/db";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/session";
import { Button } from "@/components/ui";
import { BrandSwitcher } from "./BrandSwitcher";
import { Providers } from "./Providers";
import { Sidebar } from "./Sidebar";
import { switchBrandAction } from "./brands/actions";
import { logoutAction } from "./login/actions";
import "@radix-ui/themes/styles.css";
import "./globals.css";

export const metadata: Metadata = { title: "Autopost Core" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Список брендов и меню показываем только вошедшему пользователю (на странице входа их быть не должно).
  const jar = await cookies();
  const sess = jar.get(SESSION_COOKIE)?.value ?? "";
  const authed = Boolean(sess) && safeEqual(sess, await sessionToken());
  const brands = authed ? await q<{ id: string; name: string }>("select id, name from workspaces order by created_at") : [];
  const wanted = jar.get(BRAND_COOKIE)?.value;
  const current = brands.find((b) => b.id === wanted) ?? brands[0];
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Providers>
          {authed ? (
            <div className="shell">
              <Suspense fallback={null}>
                <Sidebar
                  brandName={current?.name ?? ""}
                  brandSwitcher={current ? <BrandSwitcher brands={brands} current={current.id} action={switchBrandAction} /> : null}
                  logout={
                    <form action={logoutAction}>
                      <Button className="ghost small" style={{ width: "100%" }}>
                        <ExitIcon /> Выйти
                      </Button>
                    </form>
                  }
                />
              </Suspense>
              <main className="content">
                <div className="content-inner">{children}</div>
              </main>
            </div>
          ) : (
            <main className="wrap">{children}</main>
          )}
        </Providers>
      </body>
    </html>
  );
}
