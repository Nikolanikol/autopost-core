-- Этап 2: слоты расписания, шаблоны, вебхуки, загрузка файлов

-- Слоты: день недели ISO (1 = пн … 7 = вс) + время в часовом поясе workspace.
create table posting_slots (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references social_accounts(id) on delete cascade,
  weekday    smallint not null check (weekday between 1 and 7),
  at_time    time not null,
  unique (account_id, weekday, at_time)
);

create table templates (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind         text not null check (kind in ('caption', 'hashtags')),
  name         text not null,
  body         text not null,
  created_at   timestamptz not null default now()
);

create table webhooks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url          text not null,
  secret       text not null,
  events       text[] not null default '{post.published,post.failed,account.needs_reauth}',
  active       boolean not null default true,
  last_status  int,
  last_at      timestamptz,
  created_at   timestamptz not null default now()
);

alter table media
  add column source   text not null default 'url' check (source in ('url', 'upload')),
  add column filename text;
