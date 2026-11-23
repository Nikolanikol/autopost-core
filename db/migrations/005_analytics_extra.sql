-- Аналитика, часть 2: подписки/отписки, клики по кнопкам профиля, «подписчики онлайн», отметки, события вебхуков.

alter table account_daily
  add column follows          int,   -- подписались за день
  add column unfollows        int,   -- отписались за день
  add column link_taps_total  int,   -- клики по ссылке и кнопкам профиля (всего)
  add column link_taps        jsonb; -- по типам кнопок: { CALL: n, TEXT: n, EMAIL: n, DIRECTIONS: n, ... }

-- Когда подписчики онлайн: по дням, часы 0–23 → число подписчиков в сети.
create table account_online (
  account_id uuid not null references social_accounts(id) on delete cascade,
  day        date not null,
  hours      jsonb not null default '{}',
  fetched_at timestamptz not null default now(),
  primary key (account_id, day)
);

-- Публикации других аккаунтов, где отмечен наш аккаунт.
create table account_tags (
  account_id    uuid not null references social_accounts(id) on delete cascade,
  external_id   text not null,
  username      text,
  caption       text,
  permalink     text,
  media_url     text,
  posted_at     timestamptz,
  like_count    int,
  comments_count int,
  fetched_at    timestamptz not null default now(),
  primary key (account_id, external_id)
);

-- Сырые события вебхуков Instagram (комментарии, упоминания, сообщения).
create table ig_events (
  id          bigserial primary key,
  account_id  uuid references social_accounts(id) on delete set null,
  ig_user_id  text,
  field       text not null,
  payload     jsonb not null default '{}',
  received_at timestamptz not null default now()
);
create index ig_events_acc_time on ig_events (account_id, received_at desc);
create index ig_events_field_time on ig_events (field, received_at desc);
