# BlogOS — RUNBOOK развёртывания

Пошаговое развёртывание целевой версии на бесплатном хостинге:
**Neon** (PostgreSQL 16 + pgvector) → **Render** (API) → **Vercel** (клиент).

Документ описывает порядок действий, проверки после каждого шага, прогрев перед
демонстрацией, типичные ошибки и откат. Все команды — из корня репозитория,
если не указано иное.

> Статус: конфигурации (`render.yaml`, `vercel.json`, `Dockerfile`,
> `.github/workflows/ci.yml`) написаны и проверены статически и локальными
> командами. Само развёртывание в среде подготовки не выполнялось: внешняя сеть
> и Docker-демон там недоступны. Ниже — проверяемая процедура, а не отчёт о
> выполненном деплое.

## 0. Что понадобится

| Что | Зачем | Проверка |
|---|---|---|
| Аккаунт GitHub с этим репозиторием | Render и Vercel разворачивают из репозитория | код запушен в `main` или `master` |
| Аккаунт Neon (neon.tech) | PostgreSQL 16 + pgvector | проект создан |
| Аккаунт Render (render.com) | API | Blueprint подключён |
| Аккаунт Vercel (vercel.com) | статический клиент | проект импортирован |
| Node.js ≥ 22.18 и npm на машине для миграций | миграции и сиды запускаются локально | `node -v`, `npm -v` |
| (по желанию) бот Telegram | вход через `initData` на проде | `TELEGRAM_BOT_TOKEN` |

Обозначения: `<api-url>` — адрес сервиса Render (например
`https://blogos-api.onrender.com`), `<client-url>` — адрес клиента Vercel
(например `https://blogos.vercel.app`).

## 1. Neon: база данных

1. Войдите в консоль Neon → **New Project**.
2. Регион выбирайте рядом с регионом API: в `render.yaml` регион не задан,
   поэтому Render разместит сервис в **Oregon** (по умолчанию) — тогда берите у
   Neon **US West (Oregon)**. Если нужна Европа, добавьте в `render.yaml`
   `region: frankfurt` и создайте проект Neon **EU Central (Frankfurt)**.
   Пере-выбор региона после создания проекта недоступен.
3. Версия PostgreSQL — **16** (схема и `vector(1536)` рассчитаны на неё).
4. Скопируйте строку подключения. Нужны две:
   - **direct** (без `-pooler` в хосте) — для миграций;
   - **pooled** (хост содержит `-pooler`) — для `DATABASE_URL` на Render.
5. Убедитесь, что в строке есть `?sslmode=require`. Пример:

   ```text
   postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/blogos?sslmode=require
   ```

6. Проверьте pgvector (в SQL-редакторе Neon):

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   SELECT extversion FROM pg_extension WHERE extname = 'vector';
   ```

   Расширение ставится миграцией (`db/sql/001_schema.sql`), но на Neon его можно
   включить и заранее. Если `vector` нет в `pg_available_extensions`, проект
   создан на версии PostgreSQL без pgvector — создайте проект заново.

Пароль из строки подключения — секрет: не коммитьте его, не вставляйте в README
и issue.

## 2. Миграции и (опционально) сиды

Выполняются с локальной машины против **direct**-строки Neon (DDL и транзакции
надёжнее без пулера).

PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://user:password@ep-xxx.neon.tech/blogos?sslmode=require"
npm run db:migrate
```

bash/macOS/Linux:

```bash
DATABASE_URL="postgresql://user:password@ep-xxx.neon.tech/blogos?sslmode=require" npm run db:migrate
```

Ожидаемый вывод: `Применено файлов: N. Таблиц в базе: 14`, где N — число
файлов в `db/sql` (сейчас два: `001_schema.sql` и `002_align_17_relations.sql`).
Повторный запуск — `Схема актуальна. Таблиц в базе: 14`. Проверка в SQL-редакторе Neon:

```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'public' AND table_name <> '_migrations';   -- 14
SELECT count(*) FROM pg_constraint WHERE contype = 'f'
  AND connamespace = 'public'::regnamespace;                     -- 17 внешних ключей
```

Демо-данные (администратор, каналы, стиль, посты, черновики, источники,
комментарии, база знаний, эталоны) — только если нужна готовая демонстрация:

```powershell
$env:DATABASE_URL = "..."
npm run db:seed
```

**Не запускайте `npm run db:reset` против Neon**: команда пересоздаёт схему
локальной базы, а на облаке это означает потерю данных.

Если миграция упала, исправляйте и повторяйте: файлы идемпотентны, применённое
фиксируется в `_migrations` по имени и контрольной сумме.

## 3. Render: API

1. Render → **New** → **Blueprint** → подключите GitHub-репозиторий.
2. Render прочитает `render.yaml` и предложит сервис `blogos-api` (runtime
   `node`, plan `free`, rootDir — корень монорепо, `buildCommand: npm ci`,
   `startCommand: node apps/api/src/server.ts`, `healthCheckPath: /health`).
3. Заполните переменные, помеченные `sync: false`:
   - `DATABASE_URL` — **pooled**-строка Neon с `?sslmode=require`;
   - `CORS_ORIGIN` — пока можно поставить `*` для первой проверки (или сразу
     `<client-url>`, если домен Vercel уже известен);
   - `JWT_SECRET` Render сгенерирует сам (`generateValue: true`) — не задавайте
     его вручную пустым;
   - `LLM_PROVIDER` / `EMBEDDINGS_PROVIDER` — `mock`, если не нужен платный AI.
     Для DeepSeek: `LLM_PROVIDER=deepseek`, ключ `DEEPSEEK_API_KEY` — в Render
     как secret, не в репозитории.
4. **Apply** / **Create Web Service** и дождитесь деплоя (обычно 2–5 минут).
5. Скопируйте адрес сервиса — это `<api-url>`.

Проверка:

```bash
curl -s <api-url>/health
# {"status":"ok","db":"ok","version":"2.0.0","llm":"mock","embeddings":"mock",
#  "dev_auth":false,"time":"..."}
curl -s <api-url>/
# {"name":"BlogOS API","version":"2.0.0","methods":59,...}
```

`"db":"ok"` означает, что API достучался до Neon (`/health` делает `SELECT 1`) и
заодно разбудил вычисления базы. `"dev_auth":false` — правильно для прода
(`DEV_AUTH=0` в blueprint).

Проверка, что dev-вход закрыт (ожидаемо ошибка):

```bash
curl -s -X POST <api-url>/auth/telegram \
  -H "Content-Type: application/json" \
  -d '{"telegram_id":100500,"name":"probe"}'
# HTTP 400 — dev-вход выключен (DEV_AUTH=0), нужна подпись Telegram initData
```

## 4. Миграции при деплое

- **Free-план Render**: `preDeployCommand` недоступен. Миграции применяются
  вручную с локальной машины до деплоя (шаг 2). При изменении схемы — всегда
  сначала миграция, потом деплой, чтобы новый код не увидел старую схему.
- **Платный план**: раскомментируйте в `render.yaml` строку
  `preDeployCommand: npm run db:migrate` — Render выполнит её перед запуском
  новой версии.
- Render **Shell** можно использовать как альтернативу локальному запуску, если
  он доступен на вашем плане: команды те же (`npm run db:migrate`), но
  `DATABASE_URL` уже задан в окружении сервиса. На free-плане Shell и one-off
  jobs недоступны — только запуск с локальной машины.

## 5. Vercel: клиент

1. Vercel → **Add New** → **Project** → импортируйте тот же репозиторий.
2. Настройки проекта:
   - **Root Directory** — корень репозитория (`.`) — не `apps/web`: команда
     сборки в `vercel.json` обращается к воркспейсу из корня;
   - **Framework Preset** — Vite (можно оставить автоопределение);
   - **Build Command** и **Output Directory** — из `vercel.json`, в панели не
     переопределяйте: `npm run build -w @blogos/web` → `apps/web/dist`.
3. **Environment Variables** → `VITE_API_URL = <api-url>` (без слэша на конце,
   `https`). Переменная встраивается в бандл при сборке — после изменения нужен
   redeploy, а не только рестарт.
4. **Deploy**. Скопируйте домен — это `<client-url>`.
5. Вернитесь в Render → Environment → `CORS_ORIGIN = <client-url>` (несколько
   источников — через запятую, без слэша на конце). Сохраните: сервис
   перезапустится. Если до этого стоял `*`, замените его на конкретный домен —
   `*` допустим только на время проверки.

Проверка связки:

```bash
curl -s -o /dev/null -w "%{http_code}\n" <client-url>/          # 200
curl -s -I -H "Origin: <client-url>" <api-url>/health | findstr /i access-control
```

Последняя команда (в bash — `grep -i`) должна показать
`access-control-allow-origin: <client-url>`. Если заголовка нет — `CORS_ORIGIN`
не совпадает с доменом (схема, порт, `www`, слэш на конце, домен preview-деплоя).

## 6. Вход на проде

`DEV_AUTH=0`, поэтому вход — только через Telegram `initData`.

1. Создайте бота у [@BotFather](https://t.me/BotFather) (если ещё нет).
2. `/newapp` → выберите бота → укажите URL `<client-url>` (HTTPS).
3. `TELEGRAM_BOT_TOKEN` положите в Render → Environment как secret. После
   изменения переменных сервис перезапустится.
4. Откройте мини-приложение из Telegram: клиент передаёт `initData` автоматически
   (`window.Telegram.WebApp.initData`), сервер проверяет HMAC-SHA256 и выдаёт JWT
   на 30 дней.

Для скриншотов без Telegram допустим временный dev-вход: поставьте на Render
`DEV_AUTH=1`, войдите через форму (`telegram_id` + имя), затем **обязательно**
верните `DEV_AUTH=0`. В логах и на скриншотах отмечайте, что это dev-режим.

## 7. Прогрев перед демонстрацией

Render free засыпает после ~15 минут без запросов (пробуждение около минуты,
иногда до 2 минут), Neon free останавливает вычисления после ~5 минут простоя
(первый запрос медленнее на 1–3 секунды).

```bash
curl -s <api-url>/health
```

Повторяйте раз в 10–15 минут во время подготовки и один раз непосредственно перед
показом. Первый ответ может быть таймаутом или 502 — это холодный старт, повторите
через минуту. `/health` одновременно проверяет API и базу, поэтому прогревает
оба сервиса.

## 8. Проверка сценария после деплоя

Минимальный чек-лист (режим «В облаке», вход выполнен):

| Шаг | Действие | Ожидаемо |
|---|---|---|
| 1 | Открыть `<client-url>` | интерфейс загружается, в консоли нет ошибок CORS |
| 2 | Переключиться в облачный режим | запросы уходят на `<api-url>`, не на `localhost` |
| 3 | Вход | JWT получен, профиль отображается |
| 4 | Создать канал | `201`, канал виден в списке |
| 5 | Стиль: анализ 2–3 текстов | профиль Tone of Voice сохранён; `verified_without_ai` при mock |
| 6 | Черновик: сборка из заметок | статус `draft`, блоки и арка видны |
| 7 | Проверка AntiCringe | оценка 0–100, замечания с цитатами, история отчётов |
| 8 | Публикация черновика | статус `published`, пост в архиве |
| 9 | Источник: сканирование | `status: "ok"`, комментарии в радаре (при настроенных ключах площадки) |
| 10 | Ответ на комментарий: генерация | четыре части, пропуск `[дополните: …]` не выдуман |
| 11 | База знаний: RAG-поиск | результаты по косинусному расстоянию (mock-векторы) |
| 12 | Расходы канала (`usage`) | `spent`, `limit_ratio`, `warning`/`blocked` |
| 13 | `GET <api-url>/health` ещё раз | `status: "ok"`, `db: "ok"` |

Быстрая проверка API без клиента:

```bash
# вход (только при DEV_AUTH=1; на проде замените на initData)
curl -s -X POST <api-url>/auth/telegram -H "Content-Type: application/json" \
  -d '{"telegram_id":100500,"name":"Проверка"}'
# далее с Authorization: Bearer <token>
curl -s <api-url>/users/me -H "Authorization: Bearer <token>"
curl -s "<api-url>/generation-runs?limit=5" -H "Authorization: Bearer <token>"
```

## 9. Типичные ошибки и лечение

| Симптом | Причина | Что делать |
|---|---|---|
| Сервис Render падает, в логах `Unknown file extension ".ts"` или `ERR_UNKNOWN_FILE_EXTENSION` | Node ниже 22.18 — не умеет исполнять TypeScript | В Render задайте `NODE_VERSION=22.18.0` (уже в `render.yaml`) и перезапустите деплой |
| Сервис не стартует, в логах `DATABASE_URL обязателен` / `JWT_SECRET короче 16 символов` | Не заполнены переменные окружения | Render → Environment: задайте `DATABASE_URL`, оставьте `JWT_SECRET` сгенерированным |
| `type "vector" does not exist` | Расширение pgvector не установлено/недоступно | Проверьте версию проекта PostgreSQL 16 и `pg_available_extensions`; выполните `CREATE EXTENSION IF NOT EXISTS vector;`. Если расширения нет вообще — пересоздайте проект Neon |
| `relation "users" does not exist` | Миграции не применялись к этой базе (другой проект/ветка Neon, неверная строка) | Сверьте `DATABASE_URL` и примените миграции (шаг 2); проверьте `SELECT * FROM _migrations` |
| `password authentication failed`, `ENOTFOUND`, `getaddrinfo` | Опечатка или неполная строка подключения; спецсимволы в пароле | Скопируйте строку заново, спецсимволы пароля закодируйте URL-кодировкой |
| `no pg_hba.conf entry ... no encryption` / `self signed certificate` | В строке нет SSL | Добавьте `?sslmode=require`; для приложения используйте pooled-строку |
| `/health` отвечает `degraded`, `"db":"down"` | Neon спит/приостановлен, сеть, неверная строка | Откройте консоль Neon: проект активен, лимиты не исчерпаны; повторите запрос; проверьте `DATABASE_URL` |
| Render отвечает 502 | Холодный старт или цикл падений | Повторите через минуту; если повторяется — Logs: ошибка старта (чаще всего env или Node) |
| Render build падает на `npm ci` | Нет `package-lock.json` или он рассинхронизирован | Не удаляйте lock; выполните `npm install` локально и закоммитьте обновлённый lock |
| Браузер: `No 'Access-Control-Allow-Origin'` | `CORS_ORIGIN` не совпадает с доменом клиента | Укажите точный origin (`https://…`, без слэша, без `www`/с `www` как в адресной строке); preview-домены Vercel уникальны — добавьте нужный; сохраните и дождитесь перезапуска |
| Клиент стучится на `localhost`, в консоли сетевые ошибки | `VITE_API_URL` не задан или задан после сборки | Vercel → Environment → `VITE_API_URL=<api-url>`, затем **Redeploy** (переменная встраивается при сборке) |
| Vercel: 404 при обновлении вложенного маршрута | Потерян SPA-rewrite или неверный Output Directory | Проверьте, что `vercel.json` в корне репозитория, Root Directory — корень, Output Directory — `apps/web/dist` |
| Vercel build: `Cannot find package '@blogos/engine'` / `vite: not found` | Root Directory указывает на `apps/web`, установка не из корня | Root Directory = корень репозитория; Install Command — `npm ci` |
| Vercel: `No Output Directory named "dist"` | Ручное переопределение Output Directory | Очистите поле, оставьте значение из `vercel.json` (`apps/web/dist`) |
| `402 ai_budget_exceeded` от API | Достигнут `monthly_cost_limit` канала | Увеличьте лимит канала или верните `LLM_PROVIDER=mock`; правиловая проверка продолжает работать |
| 401/402 от провайдера LLM, генерация откатилась на правила | Неверный/просроченный ключ, кончилась квота | Проверьте ключ и баланс; ошибка видна в `generation_runs.error_message`, ответ содержит `verified_without_ai: true` |
| `429 rate_limited` при сканировании | Повторный скан источника чаще, чем раз в 60 секунд | Подождите минуту; для нескольких инстансов нужен `REDIS_URL` |
| После редеплоя пропали данные | В проде остался `DATABASE_URL=pglite://…` (файл в контейнере) | В Render должен быть только `postgresql://…` Neon; PGlite — для локального запуска |
| `_migrations`: «файл изменился после применения» | Правка уже применённого SQL-файла | Локально — `npm run db:reset`; на проде — новая миграция вперёд, без правки старых |
| `ECONNREFUSED 127.0.0.1:5432` | На хостинге осталась локальная строка из `.env.example` | Задайте `DATABASE_URL` Neon в Render |
| `self-signed certificate` только в миграциях | Окружение требует `sslmode=require` в строке | Добавьте параметр SSL, повторите |

## 10. Повторный деплой и изменения

1. `git push` в ветку, на которую смотрят Render (Auto-Deploy) и Vercel — оба
   сервиса пересоберутся автоматически. Проект Render можно пересобрать вручную:
   **Manual Deploy** → **Deploy latest commit**.
2. Порядок при изменении схемы: сначала миграция против Neon (шаг 2), затем
   деплой кода. Миграция должна быть совместима со старой версией кода
   (добавление колонок/таблиц), иначе будет окно ошибок.
3. Изменение переменной окружения Render/Vercel — это новый деплой. После
   правки `VITE_API_URL` обязателен Redeploy клиента.
4. CI (`.github/workflows/ci.yml`) на каждый push прогоняет миграции на PGlite,
   тесты движков и API, typecheck и сборку клиента. Красный CI — не деплойте.

## 11. Откат

**Приложение.** Схема мигрирует только вперёд, код откатывается независимо.

| Сервис | Как откатить |
|---|---|
| Render | Dashboard → сервис `blogos-api` → **Deploys** → у успешного деплоя **⋮** → **Rollback to this deploy**. На free-плане откат доступен только к двум последним предыдущим деплоям. Дождитесь статуса Live и проверьте `/health` |
| Vercel | Проект → **Deployments** → у предыдущего деплоя **⋮** → **Promote to Production** (или **Instant Rollback**). Переключение мгновенное |
| Локально | `git revert <commit>` и обычный push |

**База.** Обратных миграций нет; откат данных — через Neon:

1. Перед рискованной миграцией создайте ветку Neon (**Branches** → **New Branch**
   от текущей) — это копия базы без влияния на прод.
2. Если миграция испортила данные: переключите `DATABASE_URL` на строку ветки
   (или на восстановленную копию), перезапустите Render, проверьте `/health` и
   сценарий. Затем при необходимости перенесите исправления в основную ветку.
3. Восстановление на момент времени (PITR) доступно в пределах окна истории
   тарифа Neon — смотрите консоль проекта.
4. После отката сверьте `_migrations`: таблица должна соответствовать реально
   применённой схеме.

**Полный передеплой с нуля**: удалите сервис Render (данные в Neon сохраняются),
создайте Blueprint заново; на Vercel — **Redeploy** любого деплоя. Миграции
повторно не нужны, если база та же.

## 12. Чек-лист перед показом

- [ ] `<api-url>/health` → `status: "ok"`, `db: "ok"`;
- [ ] прогревы сделаны за 10–15 минут и непосредственно перед показом;
- [ ] `DEV_AUTH=0` на Render, вход через Telegram проверен (или честно помечен
      временный dev-режим);
- [ ] `CORS_ORIGIN` содержит точный `<client-url>`;
- [ ] `VITE_API_URL` на Vercel указывает на `<api-url>`, клиент пересобран;
- [ ] демо-данные есть (если нужны) или сценарий начинается с создания канала;
- [ ] `LLM_PROVIDER=mock`, если не оплачен AI: ответы детерминированы и бесплатны;
- [ ] при включённом AI проверены ключ и лимит расходов канала;
- [ ] ссылки на API и клиент открываются в том браузере, где будет показ;
- [ ] известные ограничения проговорены (см. README, раздел «Известные
      ограничения»).

## 13. Что проверено, а что нет

Проверено локально в среде подготовки:

- `npm run db:migrate` на PGlite — 14 таблиц, повторный запуск идемпотентен;
- `npm run test:engine` — 49 из 49;
- `npm run build -w @blogos/web` — `apps/web/dist`;
- запуск `node apps/api/src/server.ts`, `GET /health` → 200 (`db: ok`), `GET /` → `methods: 59`;
- синтаксис и ключи `render.yaml`, `vercel.json`, `ci.yml`, `Dockerfile` — статическая проверка.

Не проверено (нет внешней сети/Docker-демона в среде подготовки): реальный деплой
Render/Vercel, сборка `Dockerfile`, работа с живыми ключами Neon/Telegram/LLM и
площадок. Эти шаги выполняются по инструкции выше; результаты проверок
фиксируйте в issue/отчёте, а не в README.

## 14. Справочные ограничения бесплатных тарифов

Точные лимиты меняются — сверяйте на сайтах провайдеров.

| Сервис | Что важно для BlogOS |
|---|---|
| Neon free | 1 ГБ хранилища на проект, 100 CU-часов в месяц; вычисления останавливаются через ~5 минут простоя; история восстановления — 6 часов; 10 ветвей на проект. Есть пулер соединений |
| Render free | web service засыпает после ~15 минут простоя и просыпается около минуты; 750 free instance hours в месяц; откат — только к двум последним предыдущим деплоям; нет `preDeployCommand`, Shell, one-off jobs и дисков |
| Vercel Hobby | статика в пределах лимитов тарифа: одна параллельная сборка, до 45 минут на сборку, 100 деплоев в сутки; домены `*.vercel.app` и preview-домены на каждый деплой (их нужно учитывать в `CORS_ORIGIN`) |
