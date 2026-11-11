# autopost-core — проект ядра автопостинга

Стек: Next.js + Supabase (Postgres) + отдельный worker на Node, деплой на Netcup через Coolify.
Проверено 12.11.2026: Instagram API (фото и Reels) работает с бессрочным токеном системного пользователя — см. `ig-test.mjs`.

## Что берём из open-source

| Идея | Откуда | Зачем |
|---|---|---|
| Провайдер на платформу с единым интерфейсом | Postiz, TryPost | Новая платформа = новый файл |
| Пост = основа + версии под платформу | Mixpost, Postiz | Разные подписи/опции для IG и TikTok |
| Статус у каждой цели публикации | Mixpost, Postiz | «Частично опубликован», повтор только упавшего |
| Слоты расписания + «ближайший свободный» | Mixpost, Buffer | Генераторы шлют без времени |
| Двухфазная публикация с сохранением container_id | TryPost | Повтор без дублей |
| Валидация медиа до публикации | Postiz, Mixpost | Ошибки видны сразу |
| API-ключи + исходящие вебхуки | Postiz, TryPost | Интеграция генераторов |
| Ключи платформ в UI настроек | Mixpost | Без передеплоя |
| Workspaces (бренды) | все | KMotors / Axis / тест |

## Архитектура

```
Генераторы ──► REST API ─┐
Интерфейс (Next.js) ─────┤
                         ▼
        Postgres (Supabase): посты, цели, аккаунты, медиа
                         │
        Очередь pg-boss (в том же Postgres)
                         │
        Worker (Node, отдельный контейнер)
          ├─ InstagramPublisher  ✅
          ├─ TikTokPublisher     (черновики / агрегатор)
          └─ …
                         │
        Медиа: публичный HTTPS (VPS → R2)
        Уведомления: вебхуки + Telegram
```

## Модель данных

```
workspaces        id, name, timezone, settings
social_accounts   id, workspace_id, platform, external_id, username,
                  token_enc, token_expires_at, status (active|needs_reauth|disabled), settings jsonb
posting_slots     account_id, weekday, time
media             id, workspace_id, storage_key, public_url, kind, width, height,
                  duration, codecs, checksum, validation jsonb
posts             id, workspace_id, base_caption, status (draft|scheduled|publishing|
                  published|partial|failed), scheduled_at, source, idempotency_key, created_by
post_targets      id, post_id, account_id, caption_override, media_ids, options jsonb,
                  status, container_id, external_id, permalink, attempts, last_error, published_at
publish_logs      target_id, step, request/response (без токенов), at
templates, api_keys, webhooks, app_credentials (зашифрованы)
```

## Контракт провайдера

```ts
interface Publisher {
  platform: string
  validate(target, media): Issue[]
  start(target): Promise<{ containerId?: string }>
  poll?(target): Promise<'pending' | 'ready' | 'error'>
  finish(target): Promise<{ externalId: string; permalink?: string }>
  classifyError(e): 'retry' | 'reauth' | 'fatal' | 'rate_limit'
  quota?(account): Promise<{ used: number; total: number }>
}
```

Worker: одна публикация за раз на аккаунт; повторы с backoff только для `retry`;
`reauth` → аккаунт «нужно переподключить» + уведомление; перед `finish` проверка, не опубликовано ли уже.

## API v1

```
POST /api/v1/media         файл или {url} → валидация → media_id
POST /api/v1/posts         { caption, media_ids, targets:[{account, options}],
                             schedule: ISO | "next_slot" | "now", idempotency_key }
POST /api/v1/posts/batch
GET  /api/v1/posts/:id
Вебхуки: post.published, post.failed, account.needs_reauth
```

## Интерфейс

1. Календарь (неделя/месяц, drag-n-drop)
2. Редактор: общая подпись + вкладки платформ, медиа, превью, валидация, сейчас/время/слот
3. Очередь и история: статусы целей, ошибки, «Повторить»
4. Медиатека
5. Аккаунты: подключение, здоровье токена, квота
6. Настройки: workspace и часовой пояс, слоты, шаблоны/хэштеги, ключи платформ, API-ключи/вебхуки, Telegram, хранилище
7. Логи публикаций

## Этапы

1. **MVP** ✅ — БД, worker + InstagramPublisher, API v1, UI: аккаунты (токен вручную), редактор, очередь.
2. **Удобство** ✅ — календарь с переносом, слоты и next_slot, медиатека с загрузкой, превью, шаблоны, Telegram, вебхуки.
3. **Расширение** — TikTok, OAuth-подключение, workspaces и роли, согласование.

## Настройка Meta (рабочий путь, ноябрь 2026)

1. developers.facebook.com → «Создать приложение» → фильтр «Управление контентом» → «Управление сообщениями и контентом в Instagram».
2. Подключить бизнес-портфолио (нужно для «API setup with Unified login»; вход только через Instagram для новых приложений недоступен).
3. Шаг 1: «Создать новую конфигурацию» → «Создать из шаблона» (токен системного пользователя, бессрочный).
4. «Роли в приложении» → «Добавить людей» → «Тестировщик Instagram» → принять на instagram.com/accounts/manage_access.
5. Шаг 2: «Сгенерировать маркер» → войти под аккаунтом → токен в `.env`.
6. API: `graph.facebook.com/v24.0`, лимит 100 публикаций в сутки.
