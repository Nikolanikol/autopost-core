"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Обновляет страницу, пока есть посты в работе. */
export function AutoRefresh({ active, seconds = 10 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return null;
}
