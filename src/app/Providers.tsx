"use client";

import { Theme } from "@radix-ui/themes";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/** Тема следует за настройкой системы (светлая/тёмная); цвета и скругления задаются здесь, в одном месте. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Theme accentColor="indigo" grayColor="slate" radius="medium" panelBackground="solid" scaling="100%">
        {children}
      </Theme>
    </ThemeProvider>
  );
}
