export type Platform = "instagram" | "tiktok";

export interface MediaItem {
  id: string;
  kind: "image" | "video";
  public_url: string;
  width?: number | null;
  height?: number | null;
  duration_sec?: number | null;
}

export interface PublishContext {
  account: { id: string; external_id: string; username: string | null; token: string };
  caption: string;
  media: MediaItem[];
  options: Record<string, unknown>;
  containerId: string | null;
}

export type PollResult =
  | { state: "pending" }
  | { state: "ready" }
  | { state: "published" } // уже опубликовано ранее (идемпотентность)
  | { state: "error"; message: string };

export type ErrorClass = "retry" | "reauth" | "fatal" | "rate_limit";

export interface Issue {
  level: "error" | "warning";
  message: string;
}

/** Контракт провайдера платформы (идея из Postiz/TryPost). */
export interface Publisher {
  platform: Platform;
  validate(media: MediaItem[], options: Record<string, unknown>): Issue[];
  /** Фаза 1: загрузить медиа / создать контейнер. */
  start(ctx: PublishContext): Promise<{ containerId: string | null }>;
  /** Опрос готовности контейнера. Если нет асинхронной обработки — не реализуется. */
  poll?(ctx: PublishContext): Promise<PollResult>;
  /** Фаза 2: публикация. */
  finish(ctx: PublishContext): Promise<{ externalId: string; permalink: string | null }>;
  classifyError(e: unknown): ErrorClass;
  verifyAccount(externalId: string, token: string): Promise<{ username: string }>;
  quota?(externalId: string, token: string): Promise<{ used: number; total: number } | null>;
}

export class PlatformError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
    public subcode?: number,
    public isTransient?: boolean
  ) {
    super(message);
  }
}
