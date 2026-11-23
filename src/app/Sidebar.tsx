"use client";

import {
  BarChartIcon,
  CalendarIcon,
  ChatBubbleIcon,
  Cross1Icon,
  ExitIcon,
  GearIcon,
  HamburgerMenuIcon,
  ImageIcon,
  LayersIcon,
  PersonIcon,
  PlusCircledIcon,
  RowsIcon,
} from "@radix-ui/react-icons";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

type Item = { href: string; label: string; icon: ReactNode };
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Публикации",
    items: [
      { href: "/", label: "Очередь", icon: <RowsIcon /> },
      { href: "/calendar", label: "Календарь", icon: <CalendarIcon /> },
      { href: "/posts/new", label: "Новый пост", icon: <PlusCircledIcon /> },
      { href: "/media", label: "Медиатека", icon: <ImageIcon /> },
    ],
  },
  {
    title: "Аудитория",
    items: [
      { href: "/analytics", label: "Аналитика", icon: <BarChartIcon /> },
      { href: "/comments", label: "Комментарии", icon: <ChatBubbleIcon /> },
    ],
  },
  {
    title: "Настройка",
    items: [
      { href: "/accounts", label: "Аккаунты", icon: <PersonIcon /> },
      { href: "/brands", label: "Бренды", icon: <LayersIcon /> },
      { href: "/settings", label: "Настройки", icon: <GearIcon /> },
    ],
  },
];

/**
 * Боковая панель: бренд, разделы по группам, выход. На узких экранах — выезжающее меню с кнопкой в верхней полосе.
 * Полоса загрузки включается сразу по клику на внутреннюю ссылку и гаснет, когда адрес сменился.
 */
export function Sidebar({ brandSwitcher, brandName, logout }: { brandSwitcher: ReactNode; brandName: string; logout: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    setPending(null);
    setOpen(false);
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      const href = a?.getAttribute("href");
      if (!a || !href || !href.startsWith("/") || a.target === "_blank" || a.hasAttribute("download")) return;
      if (href === location.pathname + location.search) return;
      setPending(href.split("?")[0]);
    };
    // capture: сработать раньше, чем Link у Next отменит стандартное действие клика
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 20_000);
    return () => clearTimeout(t);
  }, [pending]);

  const current = pending ?? pathname;
  const active = (href: string) => (href === "/" ? current === "/" : current === href || current.startsWith(href + "/"));

  return (
    <>
      {pending && <div className="topbar" role="progressbar" aria-label="Загрузка страницы" />}

      <div className="mobbar">
        <button className="iconbtn" onClick={() => setOpen(true)} aria-label="Открыть меню"><HamburgerMenuIcon width={20} height={20} /></button>
        <b>Autopost</b>
        <span className="muted small" style={{ marginLeft: "auto" }}>{brandName}</span>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <aside className={`side ${open ? "open" : ""}`}>
        <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "nowrap" }}>
          <Link href="/" className="logo">Autopost</Link>
          <button className="iconbtn only-mobile" onClick={() => setOpen(false)} aria-label="Закрыть меню"><Cross1Icon /></button>
        </div>
        {brandSwitcher}
        <nav className="side-nav">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="nav-title">{g.title}</div>
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className={`nav-link ${active(it.href) ? "on" : ""}`} aria-current={active(it.href) ? "page" : undefined}>
                  {it.icon}
                  <span>{it.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">{logout}</div>
      </aside>
    </>
  );
}

export { ExitIcon };
