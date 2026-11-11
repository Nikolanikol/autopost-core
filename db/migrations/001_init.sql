-- Ядро автопостинга: базовая схема (этап 1)
create extension if not exists pgcrypto;

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  timezone    text not null default 'Europe/Moscow',
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create table social_accounts (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  platform         text not null check (platform in ('instagram', 'tiktok')),
  external_id      text not null,
  username         text,
  token_enc        text not null,
  token_expires_at timestamptz,
  status           text not null default 'active'
                   check (status in ('active', 'needs_reauth', 'disabled')),
  settings         jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);

create table media (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind         text not null check (kind in ('image', 'video')),
  public_url   text not null,
  storage_key  text,
  mime         text,
  size_bytes   bigint,
  width        int,
  height       int,
  duration_sec numeric,
  validation   jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create table posts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  base_caption    text not null default '',
  status          text not null default 'scheduled'
                  check (status in ('draft', 'scheduled', 'publishing', 'published',
                                    'partial', 'failed', 'canceled')),
  scheduled_at    timestamptz,
  source          text not null default 'ui' check (source in ('ui', 'api', 'generator')),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index posts_ws_sched on posts (workspace_id, scheduled_at desc);

create table post_targets (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references posts(id) on delete cascade,
  account_id       uuid not null references social_accounts(id) on delete restrict,
  caption_override text,
  media_ids        uuid[] not null default '{}',
  options          jsonb not null default '{}',
  status           text not null default 'queued'
                   check (status in ('queued', 'processing', 'published', 'failed', 'canceled')),
  container_id     text,
  external_id      text,
  permalink        text,
  attempts         int not null default 0,
  last_error       text,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index post_targets_post on post_targets (post_id);

create table publish_logs (
  id        bigserial primary key,
  target_id uuid not null references post_targets(id) on delete cascade,
  step      text not null,
  ok        boolean not null,
  detail    jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index publish_logs_target on publish_logs (target_id, at);

create table api_keys (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  prefix       text not null,
  key_hash     text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

insert into workspaces (name) values ('default');
