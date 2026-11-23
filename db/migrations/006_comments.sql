-- Комментарии: входящие комментарии аккаунтов, правила автоответа, журнал действий.

create table ig_comments (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references social_accounts(id) on delete cascade,
  external_id      text not null,            -- id комментария в Instagram
  media_id         text,
  media_permalink  text,
  parent_id        text,                     -- если это ответ на другой комментарий
  username         text,
  from_id          text,
  text             text not null default '',
  commented_at     timestamptz,
  status           text not null default 'new'
                   check (status in ('new', 'replied', 'hidden', 'ignored', 'failed')),
  hidden           boolean not null default false,
  matched_rule_id  uuid,
  suggested_reply  text,                     -- заготовка ответа по правилу
  suggested_dm     text,
  reply_text       text,
  reply_external_id text,
  replied_at       timestamptz,
  dm_sent_at       timestamptz,
  auto_acted       boolean not null default false,
  last_error       text,
  source           text not null default 'webhook' check (source in ('webhook', 'poll', 'test')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, external_id)
);
create index ig_comments_acc_status on ig_comments (account_id, status, commented_at desc);

-- Правила: ключевые слова → действие. auto=false — только заготовка ответа, отправляет человек.
create table comment_rules (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  account_id   uuid references social_accounts(id) on delete cascade,  -- null = для всех аккаунтов
  name         text not null,
  keywords     text[] not null default '{}',
  action       text not null check (action in ('reply', 'reply_dm', 'dm', 'hide')),
  reply_text   text,
  dm_text      text,
  auto         boolean not null default false,
  active       boolean not null default true,
  priority     int not null default 100,
  created_at   timestamptz not null default now()
);

create table comment_log (
  id         bigserial primary key,
  comment_id uuid not null references ig_comments(id) on delete cascade,
  action     text not null,
  ok         boolean not null,
  detail     jsonb not null default '{}',
  auto       boolean not null default false,
  at         timestamptz not null default now()
);
create index comment_log_comment on comment_log (comment_id, at);
