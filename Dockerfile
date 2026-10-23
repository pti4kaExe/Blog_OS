# syntax=docker/dockerfile:1
#
# BlogOS API — образ для контейнерного хостинга.
#
# Сборки кода нет: Node 22.18+ исполняет TypeScript напрямую (type stripping),
# поэтому в рантайме запускается apps/api/src/server.ts. Стадия deps только
# ставит production-зависимости монорепо (npm workspaces), стадия runtime
# копирует их и исходники API.
#
# Миграции и сиды — отдельными командами, а не при старте контейнера:
#   docker run --rm --env-file .env blogos-api node apps/api/scripts/migrate.ts
#   docker run --rm --env-file .env blogos-api node apps/api/scripts/seed.ts
# Подробнее — docs/RUNBOOK.md.

FROM node:22-alpine AS deps
WORKDIR /app

# .npmrc проекта задаёт ignore-scripts=true; флаг дублируем явно, чтобы образ
# не зависел от того, скопирован ли .npmrc.
COPY .npmrc package.json package-lock.json ./
# Манифесты всех воркспейсов обязательны: npm ci сверяет их с package-lock.json.
COPY packages/engine/package.json packages/engine/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --ignore-scripts --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# node_modules из стадии deps: внутри — симлинки воркспейсов @blogos/engine
# и @blogos/api, поэтому исходники копируются по тем же относительным путям.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/engine packages/engine
COPY apps/api apps/api
# Манифест клиента нужен только чтобы симлинк node_modules/@blogos/web не вёл
# в пустоту; сам клиент раздаёт Vercel, в образе он не используется.
COPY apps/web/package.json apps/web/package.json
# DDL — единственный источник схемы; путь db/sql нужен скрипту миграций.
COPY db/sql db/sql

# Процессу не нужна запись на диск: в проде база — внешний PostgreSQL.
USER node

EXPOSE 3000

# Проверка живости сервиса. Заодно прогревает Neon: /health делает SELECT 1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/src/server.ts"]
