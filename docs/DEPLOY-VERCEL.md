# Перенос API на Vercel (бесплатно, без сна)

## Зачем

Render free засыпает после ~15 минут без запросов: первый посетитель ждёт 30–60 секунд.
Планировщик GitHub, который должен был греть сервер, на практике не запускается
(проверено: 0 запусков по расписанию за 4,5 часа, ручной запуск проходит).
Vercel держит API как serverless-функции: холодный старт — доли секунды, сна нет.

Клиент остаётся на GitHub Pages. Меняется только адрес API в переменной
`VITE_API_URL`; Render можно оставить как запасной стенд.

## 1. Создать проект в Vercel

1. https://vercel.com/new → **Import Git Repository** → выберите `PTI4KAEXE/Blog_OS`.
2. Framework Preset: **Other** (конфиг берётся из `vercel.json`).
3. Root Directory: **./** (корень репозитория, не apps/api).
4. Build Command / Install Command / Output — не трогать: они в `vercel.json`.
5. Deploy.

## 2. Переменные окружения (Settings → Environment Variables)

Обязательные:

| Переменная | Значение |
|---|---|
| `DATABASE_URL` | та же строка Neon, что у Render (`postgresql://…?sslmode=require`) |
| `JWT_SECRET` | тот же секрет, что у Render (≥32 символов) |
| `DEV_AUTH` | `0` |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://pti4kaexe.github.io` |
| `LLM_PROVIDER` | `openai` |
| `OPENAI_API_KEY` | ключ OpenRouter |
| `OPENAI_BASE_URL` | `https://openrouter.ai/api/v1` |
| `OPENAI_MODEL` | `dots-studio/dots-3-note-preview:free` |
| `LLM_TIMEOUT_MS` | `45000` (предел функции Hobby — 60 с) |
| `LLM_MAX_TOKENS_FLOOR` | `8192` |
| `EMBEDDINGS_PROVIDER` | `mock` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` |
| `EMBEDDING_DIM` | `1536` |
| `TELEGRAM_BOT_TOKEN` | токен @blogos_login_bot |
| `TELEGRAM_BOT_USERNAME` | `blogos_login_bot` |
| `TELEGRAM_WEBHOOK_SECRET` | тот же секрет, что у Render |
| `PUBLIC_API_URL` | адрес Vercel после первого деплоя, например `https://blogos-api.vercel.app` |
| `PUBLIC_WEB_URL` | `https://pti4kaexe.github.io/Blog_OS/` |
| `MIGRATE_TOKEN` | `06fec7d5413442999fef762b399f570d6c33db80` — временный секрет для миграций и webhook |
| `RUN_MIGRATIONS_ON_START` | `0` (миграции запускаем отдельным запросом) |
| `DEFAULT_MONTHLY_COST_LIMIT` | `100` |
| `AI_CALLS_PER_MINUTE` | `10` |
| `LOG_LEVEL` | `info` |

После добавления переменных нажмите **Redeploy** (Deployments → ⋯ → Redeploy),
чтобы они попали в сборку.

## 3. Один раз применить миграции и перевесить webhook

Нужен URL проекта (например `https://blogos-api.vercel.app`). Выполнить один раз:

```bash
API=https://blogos-api.vercel.app
TOKEN=06fec7d5413442999fef762b399f570d6c33db80

curl -s -X POST "$API/internal/migrate" -H "x-internal-token: $TOKEN"
# ожидание: {"applied":["004_login_codes_used.sql","005_cost_limit_backfill.sql"],...}
# если "applied":[] — миграции уже применены, это нормально

curl -s -X POST "$API/internal/register-webhook" -H "x-internal-token: $TOKEN"
# ожидание: {"ok":true}
```

Проверить, что webhook указывает на Vercel:

```bash
curl -s "https://api.telegram.org/bot<ТОКЕН_БОТА>/getWebhookInfo" | grep -o '"url":"[^"]*"'
```

## 4. Переключить клиент на новый API

1. GitHub → Settings → Secrets and variables → Actions → Variables → `VITE_API_URL`
   = адрес Vercel.
2. Пересобрать клиент: push в `main` или Actions → Deploy web client → Run workflow.
3. Открыть сайт с Ctrl+F5 и проверить: вход через бота, «Разобрать стиль».

Откат за минуту: вернуть `VITE_API_URL` на адрес Render и пересобрать клиент.

## 5. Что учесть на Vercel

- **Лимит функции 60 секунд** (Hobby). Поэтому `LLM_TIMEOUT_MS=45000`: при
  долгом ответе модели сработает откат на правила, а не таймаут платформы.
- **Лимиты в памяти живут на инстанс**: это не отключает их, но при нескольких
  параллельных инстансах счётчик у каждого свой. Для бесплатного проекта приемлемо.
- **Neon** работает как раньше; пул соединений на serverless лучше держать
  маленьким — `pg` создаёт одно соединение на инстанс, этого достаточно.
- **Миграции** применяются один раз через `/internal/migrate`; после этого
  `RUN_MIGRATIONS_ON_START` можно оставить `0`.
- **MIGRATE_TOKEN** после настройки можно удалить из переменных: эндпоинты без
  него отвечают 404.

## 6. Проверка, что сна больше нет

```bash
# Первый запрос после долгой паузы должен отвечать быстро (доли секунды—секунды)
curl -s -o /dev/null -w '%{time_total}\n' "https://blogos-api.vercel.app/health?light=1"
```

Сравнение: Render после простоя отвечал 30–60 секунд, Vercel — обычно < 2 секунд
даже «холодным».
