-- Статистика: снимки метрик постов и аккаунтов (история копится для будущих дашбордов).

create table post_metrics (
  id         bigserial primary key,
  target_id  uuid not null references post_targets(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  -- Нормализованные поля для графиков; null = платформа не отдала.
  likes      int,
  comments   int,
  saves      int,
  shares     int,
  reach      int,
  views      int,
  raw        jsonb not null default '{}'
);
create index post_metrics_target_time on post_metrics (target_id, fetched_at desc);

create table account_metrics (
  id          bigserial primary key,
  account_id  uuid not null references social_accounts(id) on delete cascade,
  fetched_at  timestamptz not null default now(),
  followers   int,
  media_count int,
  reach_day   int,
  views_day   int,
  raw         jsonb not null default '{}'
);
create index account_metrics_account_time on account_metrics (account_id, fetched_at desc);

-- Последний снимок по каждой цели — для очереди и будущих дашбордов.
create view post_metrics_latest as
  select distinct on (target_id) * from post_metrics order by target_id, fetched_at desc;
