#!/usr/bin/env bash
# Локальный Postgres для разработки: данные в ./.pgdata, порт 54329.
# На сервере вместо этого используется Postgres из Supabase/Coolify (DATABASE_URL).
set -euo pipefail
cd "$(dirname "$0")/.."
PGDATA="$PWD/.pgdata"
PORT=54329

case "${1:-}" in
  start)
    if [ ! -d "$PGDATA" ]; then
      initdb -D "$PGDATA" -U autopost --auth=trust -E UTF8 >/dev/null
      echo "Создан кластер в .pgdata"
    fi
    pg_ctl -D "$PGDATA" -o "-p $PORT -k /tmp" -l "$PGDATA/server.log" -w start
    createdb -h localhost -p $PORT -U autopost autopost 2>/dev/null || true
    echo "DATABASE_URL=postgres://autopost@localhost:$PORT/autopost"
    ;;
  stop)
    pg_ctl -D "$PGDATA" -w stop
    ;;
  *)
    echo "usage: db.sh start|stop"; exit 1;;
esac
