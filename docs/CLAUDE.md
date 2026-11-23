# Управление через Claude (MCP)

Сервис на VPS умеет принимать команды от Claude напрямую: ставить посты в очередь, смотреть очередь и
аналитику, отвечать на комментарии, настраивать слоты и правила. Веб-интерфейс остаётся для контроля.

Адрес MCP-сервера: `https://post.dkmatrix.com/api/mcp` (Streamable HTTP, авторизация ключом).

## 1. Ключ

1. Откройте сервис → **Настройки → API-ключи**.
2. Название: имя компьютера (например `claude-macbook`), область: **Все бренды (для Claude)**.
3. Скопируйте ключ `ak_…` — он показывается один раз.

Делайте **отдельный ключ на каждый компьютер**: в списке видно, какой ключ когда использовался, и один из них
можно отозвать, не трогая второй. Ключ «Только этот бренд» подходит генераторам: он видит один бренд.

## 2. Подключение на каждом компьютере

```bash
claude mcp add --transport http --scope user autopost https://post.dkmatrix.com/api/mcp \
  --header "Authorization: Bearer ak_ВАШ_КЛЮЧ"
```

`--scope user` делает сервер доступным во всех проектах этого компьютера. Проверка: `claude mcp list` должен
показать `autopost` со статусом подключения, а в сессии `/mcp` — список из 27 инструментов.

Отзыв доступа: Настройки → API-ключи → «Отозвать» (на компьютере ничего менять не нужно).

## 3. Что умеет Claude

| Область | Инструменты |
|---|---|
| Обзор | `overview` (аккаунты, очередь, ошибки, новые комментарии), `list_brands`, `create_brand` |
| Аккаунты | `list_accounts`, `get_slots`, `set_slots`, `add_media` |
| Очередь и посты | `list_queue`, `get_post`, `create_post` (в т.ч. `dry_run`), `reschedule_post`, `cancel_post`, `retry_post` |
| Аналитика | `analytics_summary`, `analytics_top_posts`, `analytics_audience`, `analytics_online_hours`, `analytics_refresh` |
| Комментарии | `list_comments`, `reply_comment`, `hide_comment`, `ignore_comment`, `sync_comments` |
| Правила автоответа | `list_comment_rules`, `create_comment_rule`, `update_comment_rule`, `delete_comment_rule` |

Почти везде есть параметр `brand` (название или часть названия, например `axis`) и `account` (`@ник`). Если брендов
несколько, а `brand` не указан, Claude получит ошибку со списком — запись в чужой бренд случайно не произойдёт.

## 4. Примеры запросов

- «Что в очереди у Axis на этой неделе?» → `overview`, `list_queue`
- «Поставь это видео в ближайший слот Decay Matrix, подпись такая-то» → `create_post` (сначала `dry_run`, потом после вашего «да» — сам пост)
- «Какие рилсы Axis зашли лучше всего за месяц и когда лучше публиковать?» → `analytics_top_posts`, `analytics_online_hours`
- «Покажи новые комментарии Axis, предложи ответы» → `list_comments`; после одобрения → `reply_comment`
- «Перенеси пост X на завтра 12:00» → `reschedule_post`

## 5. Безопасность

- Публикации и ответы видны всем. Сервер сам подсказывает Claude показывать текст и время до отправки
  (поле `instructions`), но надёжнее оставить подтверждение инструментов-записи включённым в Claude Code.
- Чтобы читающие инструменты не спрашивали разрешение каждый раз, добавьте в `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__autopost__list_brands", "mcp__autopost__overview", "mcp__autopost__list_accounts",
      "mcp__autopost__get_slots", "mcp__autopost__list_queue", "mcp__autopost__get_post",
      "mcp__autopost__analytics_summary", "mcp__autopost__analytics_top_posts",
      "mcp__autopost__analytics_audience", "mcp__autopost__analytics_online_hours",
      "mcp__autopost__list_comments", "mcp__autopost__list_comment_rules"
    ]
  }
}
```

- Токены Instagram через MCP недоступны: они хранятся зашифрованными в базе и наружу не отдаются.
- Автоответы (`auto=true`) Claude включает только по прямой просьбе; у автоответа есть лимиты (15 в час на аккаунт,
  только свежие комментарии, один ответ автору под постом в сутки).

## 6. Если что-то не работает

| Симптом | Причина |
|---|---|
| `claude mcp list` показывает ошибку / 401 | неверный или отозванный ключ; проверьте, что в заголовке `Bearer ak_…` без лишних пробелов |
| «Укажите параметр brand» | брендов несколько — назовите бренд в запросе |
| «Этот ключ работает только с брендом …» | ключ создан с областью «Только этот бренд»; нужен ключ «Все бренды» |
| `create_post`: «нет слотов расписания» | у аккаунта нет слотов — `set_slots` или укажите точное время в `schedule` |
| `create_post`: «Медиа … URL недоступен» | нужен публичный https-URL файла (jpeg / mp4); Instagram скачивает его сам |
| Аналитика пустая у нового аккаунта | сбор идёт раз в 3 часа; `analytics_refresh` обновит сразу |
