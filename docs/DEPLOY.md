# Деплой в Coolify (Netcup)

Репозиторий: https://github.com/Nikolanikol/autopost-core (публичный — GitHub App не нужен).
Домен: `post.dkmatrix.com` → A-запись на IP сервера.

## 1. Создать ресурс

1. Coolify → **Projects** → New → название `autopost` → окружение `production`.
2. **+ New Resource** → **Public Repository** → URL `https://github.com/Nikolanikol/autopost-core`, ветка `main`.
3. **Build Pack**: `Docker Compose`, путь к файлу: `/docker-compose.yml` → Continue.

## 2. Домен

В ресурсе → сервис **web** → **Domains**: `https://post.dkmatrix.com:3000`
(`:3000` — внутренний порт контейнера; снаружи будет обычный https на 443, сертификат выпустит Traefik).

Сервисам `worker` и `db` домен не нужен.

## 3. Переменные окружения

Resource → **Environment Variables**:

| Переменная | Значение |
|---|---|
| `POSTGRES_PASSWORD` | случайная строка: `openssl rand -hex 24` |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32` (шифрует токены соцсетей; **не терять** — без него токены в базе не расшифровать) |
| `ADMIN_USER` | `admin` |
| `ADMIN_PASSWORD` | ваш пароль для входа в интерфейс |
| `PUBLIC_BASE_URL` | `https://post.dkmatrix.com` |

## 4. Deploy

Кнопка **Deploy**. Первый билд — несколько минут. Веб при старте сам применяет миграции,
worker стартует после того, как веб стал healthy.

Проверка: `https://post.dkmatrix.com/login` открывается, вход по `ADMIN_USER`/`ADMIN_PASSWORD`.

## 5. После деплоя

1. **Аккаунты** → подключить Instagram (ID аккаунта + токен из Meta).
2. **Аккаунты** → слоты расписания.
3. **Настройки** → создать API-ключ для генераторов.
4. Отправить посты генератора:
   ```bash
   python3 generators/tarot/generate.py
   AUTOPOST_URL=https://post.dkmatrix.com AUTOPOST_KEY=ak_… AUTOPOST_ACCOUNT=<id> \
     pnpm tsx generators/tarot/push.ts
   ```

## Бэкапы

Coolify → ресурс → сервис `db` → **Backups** — включить расписание (например, ежедневно).
Медиа лежат в томе `storage` — их потеря не критична, после публикации копия есть в Instagram.

## Обновления

`git push` в `main` → в Coolify **Redeploy** (или включить автодеплой по webhook в настройках ресурса).
