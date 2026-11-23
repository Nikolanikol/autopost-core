export type Platform = "instagram" | "tiktok";

export interface MediaItem {
  id: string;
  kind: "image" | "video";
  public_url: string;
  width?: number | null;
  height?: number | null;
  duration_sec?: number | null;
  mime?: string | null;
  storage_key?: string | null;
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
  /** Платформа принимает только черновики: окончательно публикует человек в приложении (TikTok). */
  draftOnly?: boolean;
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
  /** Метрики опубликованного поста. Ошибки прав не должны ронять аккаунт — только помечаются в notes. */
  postMetrics?(mediaId: string, token: string): Promise<PostMetrics>;
  accountMetrics?(externalId: string, token: string): Promise<AccountMetrics>;
  /** Аналитика аккаунта целиком (все публикации, дневные итоги, демография). */
  listMedia?(externalId: string, token: string, limit: number): Promise<MediaListItem[]>;
  mediaInsights?(mediaId: string, productType: string | null, token: string): Promise<MediaInsight>;
  dailyInsights?(externalId: string, token: string, dayStartUtc: Date): Promise<DailyInsight>;
  demographics?(externalId: string, token: string): Promise<DemographicsResult>;
  /** Подписчики онлайн по часам, по дням (за последние ~28 дней). */
  onlineFollowers?(externalId: string, token: string): Promise<OnlineDay[]>;
  /** Чужие публикации, где отмечен наш аккаунт. */
  listTags?(externalId: string, token: string): Promise<TaggedMedia[]>;
  /** Комментарии под свежими публикациями (опрос на случай пропущенных вебхуков). */
  listRecentComments?(externalId: string, token: string, opts: { maxMedia: number; sinceDays: number }): Promise<CommentItem[]>;
  replyToComment?(commentId: string, text: string, token: string): Promise<{ id: string }>;
  hideComment?(commentId: string, hide: boolean, token: string): Promise<void>;
  /** Личное сообщение автору комментария (одно, в течение 7 дней после комментария). */
  privateReply?(externalId: string, commentId: string, text: string, token: string): Promise<void>;
  /** Комментарий от имени аккаунта под опубликованной публикацией (первый комментарий). */
  commentOnMedia?(mediaId: string, text: string, token: string): Promise<{ id: string }>;
}

export interface CommentItem {
  external_id: string;
  media_id: string;
  media_permalink: string | null;
  parent_id: string | null;
  username: string | null;
  from_id: string | null;
  text: string;
  timestamp: string | null;
  hidden: boolean;
  /** Ответы под комментарием (нужны, чтобы понять, отвечали ли мы уже). */
  replies: { id: string; username: string | null; text: string }[];
}

export interface OnlineDay {
  day: string; // YYYY-MM-DD
  hours: Record<string, number>; // "0".."23" → подписчиков онлайн
}

export interface TaggedMedia {
  external_id: string;
  username: string | null;
  caption: string | null;
  permalink: string | null;
  media_url: string | null;
  posted_at: string | null;
  like_count: number | null;
  comments_count: number | null;
}

export interface MediaListItem {
  external_id: string;
  product_type: string | null;
  media_type: string | null;
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  likes: number | null;
  comments: number | null;
}

export interface MediaInsight {
  reach?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  total_interactions?: number | null;
  avg_watch_ms?: number | null;
  total_watch_ms?: number | null;
  notes: string[];
}

export interface DailyInsight {
  reach?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  total_interactions?: number | null;
  profile_views?: number | null;
  accounts_engaged?: number | null;
  follows_delta?: number | null;
  follows?: number | null;
  unfollows?: number | null;
  link_taps_total?: number | null;
  link_taps?: Record<string, number> | null;
  notes: string[];
}

export interface DemographicsResult {
  /** breakdown (country/city/age/gender) → отсортированный список { key, value }. */
  data: Record<string, { key: string; value: number }[]>;
  notes: string[];
}

export interface PostMetrics {
  likes?: number | null;
  comments?: number | null;
  saves?: number | null;
  shares?: number | null;
  reach?: number | null;
  views?: number | null;
  raw: Record<string, unknown>;
  notes: string[];
}

export interface AccountMetrics {
  followers?: number | null;
  media_count?: number | null;
  reach_day?: number | null;
  views_day?: number | null;
  raw: Record<string, unknown>;
  notes: string[];
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
