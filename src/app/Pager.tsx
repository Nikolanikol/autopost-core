import Link from "next/link";

export const PAGE_SIZE = 20;

/** Текущая страница из параметра ?p= (с ограничением по числу страниц). */
export function pageFrom(raw: string | undefined, total: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Number.parseInt(raw ?? "1", 10) || 1), pages);
  return { page: p, pages, offset: (p - 1) * size };
}

/** Постраничная навигация: «‹ 1 … 4 [5] 6 … 20 ›» и подпись «Показаны 21–40 из 57». */
export function Pager({ page, pages, total, size = PAGE_SIZE, href }: { page: number; pages: number; total: number; size?: number; href: (p: number) => string }) {
  if (total === 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 1 && n <= pages));
  const list = [...nums].sort((a, b) => a - b);
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: 8, margin: "12px 0" }}>
      <span className="muted small">Показаны {from}–{to} из {total}</span>
      {pages > 1 && (
        <div className="row" style={{ gap: 6 }}>
          {page > 1 && <Link href={href(page - 1)} className="pill">‹ Назад</Link>}
          {list.map((n, i) => (
            <span key={n} className="row" style={{ gap: 6 }}>
              {i > 0 && n - list[i - 1] > 1 && <span className="muted">…</span>}
              <Link href={href(n)} className={`pill ${n === page ? "on" : ""}`} aria-current={n === page ? "page" : undefined}>{n}</Link>
            </span>
          ))}
          {page < pages && <Link href={href(page + 1)} className="pill">Вперёд ›</Link>}
        </div>
      )}
    </div>
  );
}
