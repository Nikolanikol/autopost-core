import { instagram } from "./instagram";
import type { Platform, Publisher } from "./types";

const registry: Partial<Record<Platform, Publisher>> = { instagram };

export function publisherFor(platform: string): Publisher {
  const p = registry[platform as Platform];
  if (!p) throw new Error(`Платформа ${platform} пока не поддерживается`);
  return p;
}

export * from "./types";
