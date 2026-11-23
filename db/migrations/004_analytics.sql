-- Аналитика аккаунта: все публикации аккаунта (в т.ч. сделанные вне ядра), дневные ряды, демография.

-- Публикации аккаунта целиком, последний снимок метрик хранится в строке.
create table account_media (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references social_accounts(id) on delete cascade,
  external_id        text not null,
  product_type       text,           -- FEED / REELS / STORY ...
  media_type         text,           -- IMAGE / VIDEO / CAROUSEL_ALBUM
  caption            text,
  permalink          text,
  thumbnail_url      text,
  posted_at          timestamptz,
  likes              int,
  comments           int,
  saves              int,
  shares             int,
  reach              int,
  views              int,
  total_interactions int,
  avg_watch_ms       int,            -- Reels: среднее время просмотра
  total_watch_ms     bigint,         -- Reels: суммарное время просмотра
  metrics_at         timestamptz,    -- когда последний раз обновлялись insights
  updated_at         timestamptz not null default now(),
  unique (account_id, external_id)
);
create index account_media_acc_posted on account_media (account_id, posted_at desc);

-- Дневные итоги аккаунта (дни по UTC).
create table account_daily (
  account_id         uuid not null references social_accounts(id) on delete cascade,
  day                date not null,
  reach              int,
  views              int,
  likes              int,
  comments           int,
  shares             int,
  saves              int,
  total_interactions int,
  profile_views      int,
  accounts_engaged   int,
  follows_delta      int,
  fetched_at         timestamptz not null default now(),
  primary key (account_id, day)
);

-- Демография подписчиков (страны, города, возраст, пол) — последний снимок.
create table account_demographics (
  account_id uuid not null references social_accounts(id) on delete cascade,
  breakdown  text not null,
  data       jsonb not null default '[]',
  fetched_at timestamptz not null default now(),
  primary key (account_id, breakdown)
);
