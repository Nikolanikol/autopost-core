-- Личные сообщения Instagram: диалоги и сообщения.
-- Диалог = переписка аккаунта с одним человеком (participant_id — IGSID человека).

create table ig_conversations (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references social_accounts(id) on delete cascade,
  participant_id        text not null,           -- IGSID собеседника
  participant_username  text,
  external_id           text,                    -- id диалога в Graph API (появляется после опроса)
  -- new: последнее слово за человеком, ждёт ответа; replied: последним ответили мы; ignored: отложен, вернётся в new при новом сообщении
  status                text not null default 'new' check (status in ('new', 'replied', 'ignored')),
  last_message_at       timestamptz,
  last_incoming_at      timestamptz,             -- от него считаем окно ответа в 24 часа
  last_text             text,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (account_id, participant_id)
);
create index ig_conversations_acc_status on ig_conversations (account_id, status, last_message_at desc);

create table ig_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ig_conversations(id) on delete cascade,
  account_id      uuid not null references social_accounts(id) on delete cascade,
  external_id     text not null,                 -- id сообщения в Instagram
  direction       text not null check (direction in ('in', 'out')),
  text            text not null default '',
  attachments     jsonb not null default '[]',   -- кратко: [{type, url}]
  sent_at         timestamptz not null default now(),
  source          text not null default 'webhook' check (source in ('webhook', 'poll', 'api')),
  created_at      timestamptz not null default now(),
  unique (account_id, external_id)
);
create index ig_messages_conv_time on ig_messages (conversation_id, sent_at);
