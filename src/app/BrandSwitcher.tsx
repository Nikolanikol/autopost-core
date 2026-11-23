"use client";

import { Select } from "@radix-ui/themes";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/** Выбор бренда: смена применяется сразу; последний пункт ведёт к управлению брендами. */
export function BrandSwitcher({
  brands,
  current,
  action,
}: {
  brands: { id: string; name: string }[];
  current: string;
  action: (fd: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <Select.Root
      value={mounted ? current : ""}
      disabled={pending}
      onValueChange={(v) => {
        if (v === "__manage") return router.push("/brands");
        const fd = new FormData();
        fd.set("brand", v);
        start(() => action(fd));
      }}
    >
      <Select.Trigger
        aria-label="Бренд"
        placeholder={mounted ? undefined : brands.find((b) => b.id === current)?.name}
        className={mounted ? undefined : "ssr-value"}
        style={{ width: "100%", fontWeight: 600 }}
      />
      <Select.Content position="popper" sideOffset={4}>
        <Select.Group>
          <Select.Label>Бренд</Select.Label>
          {brands.map((b) => (
            <Select.Item key={b.id} value={b.id}>{b.name}</Select.Item>
          ))}
        </Select.Group>
        <Select.Separator />
        <Select.Item value="__manage">⚙ Управление брендами…</Select.Item>
      </Select.Content>
    </Select.Root>
  );
}
