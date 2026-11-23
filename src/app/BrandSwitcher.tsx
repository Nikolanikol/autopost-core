"use client";

/** Выпадающий список брендов в шапке: смена бренда отправляет форму сразу, без кнопки. */
export function BrandSwitcher({
  brands,
  current,
  action,
}: {
  brands: { id: string; name: string }[];
  current: string;
  action: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={action}>
      <select
        key={`${current}:${brands.map((b) => b.id + b.name).join("|")}`}
        name="brand"
        defaultValue={current}
        aria-label="Бренд"
        className="brand-select"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {brands.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
    </form>
  );
}
