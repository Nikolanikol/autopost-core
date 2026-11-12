# autopost-core

Своё ядро автопостинга: очередь публикаций, интерфейс и API для генераторов контента.
Сейчас: **Instagram (фото, Reels, истории)**, календарь, слоты расписания, медиатека с загрузкой,
шаблоны, уведомления в Telegram и вебхуки. Проект и этапы — [docs/DESIGN.md](docs/DESIGN.md).

## Запуск локально

```bash
pnpm install
cp .env.example .env     # заполнить APP_ENCRYPTION_KEY, ADMIN_PASSWORD, IG_*
pnpm db:start            # локальный Postgres в .pgdata, порт 54329
pnpm db:migrate
pnpm seed:ig             # импорт IG-аккаунта из .env (или через интерфейс → Аккаунты)
pnpm dev                 # интерфейс и API: http://localhost:3100
pnpm worker              # во втором терминале — публикации
```

Интерфейс закрыт паролем `ADMIN_USER` / `ADMIN_PASSWORD`.

## Устройство

```
src/
  app/                интерфейс (Next.js) + API v1 (app/api/v1)
  lib/posts.ts        создание поста, валидация, статусы, повтор/отмена
  lib/queue.ts        pg-boss (очередь в том же Postgres)
  lib/media.ts        проверка URL/файлов и метаданных (ffprobe)
  lib/storage.ts      локальное хранилище, раздача по /media/<key>
  lib/slots.ts        слоты расписания и «ближайший свободный слот»
  lib/notify.ts       Telegram и вебхуки (HMAC-подпись)
  lib/tz.ts           часовые пояса без зависимостей
  lib/crypto.ts       шифрование токенов, API-ключи
  publishers/         провайдеры платформ (instagram.ts; новая платформа = новый файл)
  worker/index.ts     фазы публикации: start → poll → finish, повторы, лимиты, reauth
db/migrations/        SQL-схема
```

## API v1

Ключ создаётся в интерфейсе: **Настройки → API-ключи**. Заголовок: `Authorization: Bearer ak_…`.

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/v1/accounts` | аккаунты (их `id` нужны для `targets`) |
| POST | `/api/v1/media` | `{url}` или multipart `file` → проверка и регистрация медиа |
| POST | `/api/v1/posts` | создать пост (см. ниже) |
| GET | `/api/v1/posts` | последние посты со статусами |
| GET | `/api/v1/posts/:id` | статус поста и каждой цели, ссылки |
| PATCH | `/api/v1/posts/:id` | перенести запланированный пост: `{"scheduled_at": "…+09:00"}` |
| DELETE | `/api/v1/posts/:id` | отменить неопубликованные цели |

```json
{
  "caption": "Текст",
  "media_urls": ["https://…/reel.mp4"],
  "targets": [{ "account_id": "…", "options": { "type": "reel" } }],
  "schedule": "now",
  "idempotency_key": "gen-123"
}
```

- `schedule`: `"now"`, `"next_slot"` (ближайший свободный слот первого аккаунта) или ISO-время с зоной (`2026-11-15T18:00:00+03:00`).
- `options.type`: `feed` | `reel` | `story` (по умолчанию: фото → лента, видео → Reel); для Reels также `share_to_feed`, `cover_url`.
- Повтор с тем же `idempotency_key` вернёт уже созданный пост (200), дубля не будет.
- Ошибки валидации — 422 со списком `details`.
- Заголовок `X-Source: generator` помечает посты от генераторов.

## Статистика

Worker раз в 3 часа (`METRICS_INTERVAL_MIN`) снимает метрики опубликованных постов за 30 дней
и аккаунтов в таблицы `post_metrics` / `account_metrics` — история для будущих дашбордов.
Последние значения видны в очереди. Лайки, комментарии, подписчики доступны сразу;
охват, просмотры и сохранения требуют разрешения `instagram_manage_insights`
в конфигурации входа Meta (и нового токена). Разовый запуск: `pnpm tsx --env-file=.env scripts/collect-metrics.ts`.

## Вебхуки

POST на ваш URL с телом `{ "event", "at", "data" }` и заголовками `X-Autopost-Event`,
`X-Autopost-Signature: sha256=<HMAC-SHA256 тела секретом>`. События: `post.published`, `post.failed`,
`account.needs_reauth`.

## Что проверено (12.11.2026)

- Публикация фото и Reels через Graph API (`ig-test.mjs`).
- Ядро: авторизация API, валидация, планирование, идемпотентность, отмена, обработка ошибок worker'ом.
- Реальная публикация через ядро (API → worker → Instagram): Reel опубликован.
- Этап 2: часовые пояса, next_slot, перенос постов (устаревшая задача пропускается), загрузка и раздача файлов
  (Range, защита от выхода из папки), вебхуки с подписью, все страницы интерфейса.
- Не проверено: отправка в Telegram (нужен ваш бот), публикация загруженного файла (нужен https-адрес),
  перетаскивание в календаре мышью.
