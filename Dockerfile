# Один образ для веба и worker'а. ffmpeg нужен для ffprobe (проверка медиа).
FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.11.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/storage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json tsconfig.json next.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY db ./db
RUN mkdir -p /data/storage && chown -R node:node /data /app
USER node
EXPOSE 3000
# По умолчанию — веб: миграции, затем сервер. Worker запускается своей командой (см. docker-compose.yml).
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && node_modules/.bin/next start -p 3000"]
