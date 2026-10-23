# Чек-лист приёмки BlogOS 2.0

Дата приёмки: 24.10.2026 · ревизия: QA · окружение: Windows, Node.js 24.13.1,
npm workspaces, база PGlite (`DATABASE_URL=pglite://memory` — настоящий
PostgreSQL 16 + pgvector в WASM).

Документ фиксирует **фактический результат** каждой проверки: команду, ожидание,
факт и вердикт. Непроверенное честно помечено — «подтверждено» без браузера,
сети и Docker не ставится.

---

## Как воспроизвести

Все команды — из корня монорепо.

| Что | Команда | Факт |
|---|---|---|
| Автотесты движков | `npm run test:engine` | **49 пройдено, 0 провалено** |
| E2E-приёмка API | `npm run test:e2e` (та же команда: `node --test --test-isolation=none --test-reporter=spec "tests/e2e/*.test.mjs"`) | **57 пройдено, 0 провалено** (4 файла, 53 подтеста) |
| Ревизия БД | `npm run test:db` (`node tests/db/review.mjs` + `node scripts/check-schema.mjs`) | **23 проверки, 23 пройдено, 0 провалено** |
| Контракт (API + OpenAPI) | `npm run test:contract` (`node scripts/check-api.mjs` + `node tests/db/openapi-structure.mjs`) | **59 методов в API и OpenAPI; 11 проверок OpenAPI, 11 пройдено** |
| Сборка клиента | `npm run build -w @blogos/web` | **успешно**, `apps/web/dist` собран |
| Сборка сервера | `npm run build -w @blogos/api` | **успешно**, `apps/api/dist` собран |
| Типы сервера | `npm run typecheck -w @blogos/api` | **без ошибок** |

Почему `--test-isolation=none`: в песочнице QA запрещён `child_process.spawn`
(EPERM), а штатный раннер Node запускает файлы в дочерних процессах. Режим
`none` выполняет все файлы в одном процессе — сервер и in-memory база одни на
прогон, миграции применяются один раз, тесты изолированы уникальными
`telegram_id`. Тесты работают по HTTP через `app.inject()` (без реального порта),
сервер поднимается из `apps/api/src/app.ts` — ровно тот код, что пойдёт в
продакшен.

---

## 1. Раздел 12 ТЗ: проверки и приёмка

В разделе 12 ТЗ 17 строк: 13 проверок работающей функциональности и 4 «плана»
(они раньше были закрыты как «не проверено»; сейчас подтверждены там, где это
позволяет серверное API). Ниже — все 17 строк.

| № | Проверка (ТЗ, раздел 12) | Команда / тест | Ожидание | Факт | Вердикт |
|---|---|---|---|---|---|
| 1 | Профиль на достаточном тексте | `npm run test:engine` (блок «профиль стиля», 7 тестов) + e2e, шаг 7 | Профиль строится, видны все метрики | Движок: профиль построен, «ты» распознано, личный голос > 3, темы ≥ 5. API: `POST /author-profiles/{id}/tov/analyze` → `200`, `analysis.posts_used=2`, `analysis.chars=376` (≥ 180), `tone` из enum | **ПОДТВЕРЖДЕНО** |
| 2 | Профиль на коротком тексте | `npm run test:engine` + e2e, «422 — профиль стиля на коротком тексте» | Профиль не строится, следующие шаги заблокированы | Движок: `buildStyleProfile(['коротко']) === null`. API: `422`, `details.reason="too_short"`, `details.length` — число; серверный профиль не создаётся | **ПОДТВЕРЖДЕНО** (сервер + движок; UI-блокировка — по коду) |
| 3 | Сборка поста из заметок | `npm run test:engine` (Narrative Engine, 13 тестов) + e2e, шаг 10 | Связный пост, все заметки распределены без потерь | Движок: для всех трёх арок `coverage.used === coverage.total`. API: `POST …/drafts/generate` → `201`, `blocks` > 0, `notes_used + notes_dropped = 4` (все 4 заметки), `notes_dropped = 0` | **ПОДТВЕРЖДЕНО** |
| 4 | Переключение сюжетной арки | `npm run test:engine` (автовыбор трёх арок) + e2e, шаг 10b | Пост пересобирается под новую структуру | Автовыбор: `suggestArc` верно выбирает `story`, `problem`, `opinion`. API: `arc="problem_solution"` → `201`, `build.arc="problem_solution"`, `arc_auto=false` | **ПОДТВЕРЖДЕНО** |
| 5 | Проверка чистого текста | `npm run test:engine` + контрольный расчёт по демо-посту | Оценка около 86, вердикт «Можно публиковать» | `lint(demoPost, demoProfile).score = 85` (≈ 86 по ТЗ), 2 замечания → `85 ≥ 75` → «Можно публиковать». Движковый тест: чистый текст ≥ 80 | **ПОДТВЕРЖДЕНО** (85 вместо 86 — расхождение на 1 балл в пределах «около») |
| 6 | Проверка намеренно плохого текста | `npm run test:engine` + контрольный расчёт | Оценка около 16 → вердикт «Переписать»; после всех автоправок рост примерно до 29 | Контрольный кринжовый текст: `score = 17` (ТЗ ≈ 16) → `< 40` → «Переписать», 28 замечаний. После `applyFixes`: `score = 29`, замечаний 12 — ровно «примерно до 29» | **ПОДТВЕРЖДЕНО** |
| 7 | Автоправка не портит грамотность | `npm run test:engine` | Замена «вы» → «ты» только в косвенных падежах, текст грамотен | Тесты: «именительный «вы» не правится автоматически», «автоправки не ломают текст» (нет `, .`, двойных точек), «каждое предложение начинается с заглавной» — пройдены | **ПОДТВЕРЖДЕНО** |
| 8 | CommentRadar не выдумывает факты | `npm run test:engine` + e2e, шаги 22—24 | Кнопка «Одобрить» заблокирована, пока не заполнен пропуск | Движок: «черновик оставляет пропуск для автора» — пройден. API: `POST …/responses/generate` → части ответа, `parts.gap` содержит `[дополните: …]`; `PATCH status=approved` → `422 details.reason="unfilled_gaps"`; после заполнения текста → `200`, `approved_at` проставлен | **ПОДТВЕРЖДЕНО** (сервер + движок; кнопка UI — статически) |
| 9 | Сохранение состояния | Осмотр кода (браузера в окружении QA нет) | После перезагрузки все данные, кроме вкладки и шага, восстанавливаются | `apps/web/src/components/LocalApp.jsx`: `STORAGE_KEY = 'blogos.state.v1'`, состояние пишется в `localStorage` при изменении; `apps/web/src/api/client.js` хранит токен (`blogos.token.v1`) | **НЕ ПОДТВЕРЖДЕНО** в браузере — только по коду |
| 10 | Пустые и некорректные данные (11 сценариев чек-листа) | `tests/e2e/negative.test.mjs` (14 подтестов) + осмотр кода | Приложение не падает и явно показывает нехватку данных | Сервер: без токена → `401`; битый токен → `401`; пустое имя → `400`; неизвестная площадка → `400`; короткий стиль → `422 too_short`; пустые заметки → `422 empty_notes`; пустой текст lint → `422 empty_text`; публикация не `ready` → `422 not_ready`; публикация с `[дополните:]` → `422 unfilled_gaps`; дубли → `409`; чужая запись → `404`; 21-й канал → `422`; лимит расхода → `402`/откат. Клиент: кнопки блокируются (`disabled={chars < 30}` и др.), ошибки сервера показываются, приложение не падает (CloudApp ловит недоступность сервера) | **ПОДТВЕРЖДЕНО на сервере**; клиентская часть — по коду (браузера нет) |
| 11 | Адаптивность (390, 768, 1024, 1440 px) | Осмотр `apps/web/src/styles.css` | Макет читаем на всех размерах | В CSS два брейкпоинта: `@media (max-width: 940px)` и `@media (max-width: 660px)`; отдельных проверок на 390/768/1024/1440 нет: браузера и скриншотов в окружении QA нет | **НЕ ПОДТВЕРЖДЕНО** — только статически (брейкпоинты есть) |
| 12 | Автотесты движков | `npm run test:engine` | Все 49 тестов проходят: граничные 9, профиль 7, Narrative 13, AntiCringe 13, CommentRadar 7 | `Итог: 49 пройдено, 0 провалено` | **ПОДТВЕРЖДЕНО** |
| 13 | Сборка без ошибок | `npm run build -w @blogos/web`; `npm run build -w @blogos/api`; `npm run typecheck -w @blogos/api` | Сборка завершается без ошибок | Клиент: vite 8.3.5, 50 модулей, `dist/index.html` 0.75 kB, CSS 21.49 kB, JS 341.40 kB (gzip 101.57). Сервер: `tsc -p tsconfig.build.json` — ok, `dist/` собран. Typecheck — без ошибок | **ПОДТВЕРЖДЕНО** |
| 14 | Отказ нейросети (план) | e2e `budget-fallback.test.mjs`: `LLM_MOCK_FAIL=1` | Одна повторная попытка, затем результат правил с пометкой «проверено без AI»; неудачный вызов в `generation_runs` | `POST /drafts/{id}/lint` → `201`, `verified_without_ai=true`, `engine="rules"`, оценка сохранена; `GET /generation-runs?task_type=lint&status=failed` → запись с `error_message` | **ПОДТВЕРЖДЕНО** |
| 15 | Предупреждение о передаче текста наружу (план) | e2e `budget-fallback.test.mjs` + осмотр `apps/web/src/lib/aiConsent.jsx` | Автор видит предупреждение и может отказаться — тогда AI-вызов не выполняется | Клиент: компонент согласия (`aiConsent.jsx`, `localStorage`), при отказе передаётся `use_llm:false` (DECISIONS №28). Сервер: `lint` с `use_llm:false` → `verified_without_ai=true`, число записей в `generation-runs` не меняется — AI-вызов не выполнялся | **ПОДТВЕРЖДЕНО на сервере**; показ предупреждения — по коду (браузера нет) |
| 16 | Журнал расходов — своё и чужое (план) | e2e, шаг 28 + шаг 29 | `GET /generation-runs` отдаёт только свои вызовы; admin — все | Автор: все `items.author_id` равны его каналу; фильтр `?author_profile_id=` соблюдается. Admin: видит вызовы чужого канала | **ПОДТВЕРЖДЕНО** |
| 17 | Права доступа (план) | e2e `negative.test.mjs` | Отказ в доступе без изменения данных | `403` на `golden-dataset`/`evals` для обычного автора; `404` на чужой канал (GET/PATCH/DELETE) и чужой черновик; после `403/404` владелец по-прежнему видит свой канал (`200`) — данные не изменены | **ПОДТВЕРЖДЕНО** |

## 2. E2E-приёмка: что именно покрыто

`tests/e2e/*.test.mjs` — 4 файла, **57 тестов, все пройдены**:
`main-flow.test.mjs` (главный сценарий, 31 подтест), `negative.test.mjs`
(15 подтестов), `pagination.test.mjs` (4), `budget-fallback.test.mjs` (3).

Главный сценарий проходит по HTTP весь конвейер: dev-вход → алиас `/api/v1` →
`GET/PATCH /users/me` → создание канала → анализ стиля → черновик → Narrative
Engine → переключение арки → lint (оценка, замечания, группы, вердикт) → правка
текста → повторный lint (новая запись, история по `created_at DESC`) →
`GET /lint-reports/{id}` → публикация (`status=ready`, связь с постом) →
источник → ручной комментарий → сканирование → генерация ответа →
блокировка `approve` на `[дополните: …]` → заполнение → `approved` → база
знаний → RAG-поиск → `usage` → `generation-runs` (только свои) →
`golden-dataset` и Evals (admin).

Фактическое поведение, зафиксированное в прогоне (не подгонялось):

- **Сканирование источника** (`POST /sources/{id}/comments/scan`) в этом
  окружении вернуло `200`: `{source_id:1, found:0, created:0, duplicates:0,
  status:"ok"}` — Telegram-адаптер читает публичную веб-версию `t.me/s/<channel>`
  (ключ бота не нужен); у тестового канала нет постов, поэтому найдено 0. Это
  допустимое контрактом поведение (docs/API.md: `200` при рабочем адаптере);
  `502`/`503` не понадобились.
- **Импорт постов Telegram** (`POST …/posts/import`, `platform=telegram`) в этом
  окружении вернул `200`: `{imported:5, skipped_duplicates:0, skipped_invalid:0,
  errors:[], checked:5}` — реально прочитана публичная страница `t.me/s/durov`
  без ключа бота. **Instagram и YouTube без ключей** отвечают `503
  not_configured` и на импорте, и на сканировании — как требует docs/API.md.
- **Лимит `monthly_cost_limit=0`** (закреплено в docs/API.md, группа 6): явный
  AI-запрос `POST /drafts/{id}/lint` с `strict_ai: true` → `402
  ai_budget_exceeded`, `details.fallback="rules"`, проверка **не выполняется**;
  тот же запрос со `strict_ai: false` (по умолчанию) → `201`,
  `verified_without_ai=true`, `ai_skipped_reason="budget_exceeded"`
  (соответствует DECISIONS №7: lint/generate не оставляют автора без проверки).
  Оба варианта проверены e2e (`negative.test.mjs`, `budget-fallback.test.mjs`),
  поле `strict_ai` описано в `docs/API.md` и в `docs/openapi.yaml`.
- **Пороги 80/100 %** проверены через `GET …/usage`: при `limit_ratio ≥ 0.8`
  `warning=true`, `blocked=false`; при `≥ 1` — `warning=true`, `blocked=true`.
  Нулевой cost mock-провайдера не позволяет накопить расход обычными вызовами,
  поэтому две строки расхода созданы фикстурой в `generation_runs` (как и роль
  admin — через базу: API этого намеренно не умеет).
- **Алиас `/api/v1`** зарегистрирован вторым префиксом: `GET /api/v1/users/me`
  отвечает так же, как корень (`200`, тот же пользователь).

## 3. Ревизия схемы БД

`node tests/db/review.mjs` — 23 проверки на живой PGlite после миграций
`001_schema.sql` + `002_align_17_relations.sql`:

- ровно **14 таблиц** и ровно **17 внешних ключей** (13 CASCADE + 4 SET NULL);
- все уникальные ограничения и частичные индексы (`tov_profiles.author_id`,
  `posts(author_id, external_id)`, `comments(source_id, external_id)`,
  `eval_results(run, golden)`, `drafts.published_post_id`);
- `CHECK` «ровно один владелец» у `embeddings` (оба значения и оба `NULL` падают);
- HNSW-индекс `embeddings_hnsw_cosine_idx` и осмысленный поиск по `<=>`
  (score 1.000000 для совпадающего вектора);
- 10 триггеров `updated_at`; неизменяемость `lint_reports` в трёх сценариях:
  обычный UPDATE → P0001; DELETE прогона со ссылкой из отчёта → успешно,
  ссылка `NULL`, остальные поля отчёта не изменились; подмена
  `generation_run_id` → P0001;
- каскады и обнуления на реальных строках (удаление канала/пользователя/поста/
  черновика/источника/факта), идемпотентность миграций.

Подробно: [DB-REVIEW.md](./DB-REVIEW.md). Дефекты DB-1/DB-2 найдены первой
ревизией, исправлены Lead и повторно проверены — приёмка по схеме чистая.

## 4. OpenAPI

`docs/openapi.yaml` — OpenAPI 3.1: **59 операций** (11 групп, 33 пути),
86+ схем, `security` bearer глобально, все коды 400/401/402/403/404/409/422/429/
500/502/503, пагинация `limit`/`cursor`/`next_cursor`, примеры запросов и
ответов, конверт `ErrorEnvelope {error:{code,message,details}}`. Схема
`LintInput` содержит `strict_ai` (boolean, default `false`), ответ `402` описан
как достижимый при `strict_ai: true` — синхронно с docs/API.md.

Проверки `node tests/db/openapi-structure.mjs` (11/11): все path+method из
docs/API.md присутствуют и наоборот, дублей нет, 11 тегов = 11 групп, у каждой
операции есть tags/responses/operationId, все `$ref` разрешаются, все коды
ошибок встречаются, `/auth/telegram` без токена. Дополнительно файл разобран
`yaml.safe_load` (PyYAML 6.0.3, системный Python): 33 пути, 59 операций,
11 тегов, 86 схем — синтаксически валиден.

## 5. Что НЕ подтверждено (честно)

| Утверждение | Почему не подтверждено |
|---|---|
| Адаптивность 390/768/1024/1440 px | В окружении QA нет браузера; проверены только CSS-брейкпоинты (940 и 660 px) |
| Клики по интерфейсу (сохранение состояния, блокировки кнопок) | Нет браузера; подтверждено чтением кода компонентов |
| Реальные Telegram/Instagram/YouTube API, DeepSeek/OpenAI, модель эмбеддингов | Ключей нет. Telegram проверен на публичной веб-версии `t.me/s/durov` (импорт 5 постов, `200`); Instagram/YouTube живьём не проверялись — без ключей они обязаны и отвечают `503 not_configured`. DeepSeek/OpenAI не вызывались: работали `LLM_PROVIDER=mock` и путь отказа LLM; модель эмбеддингов — mock |
| PostgreSQL вне PGlite (Neon/Docker) | Нет Docker и внешней сети; PGlite — тот же PostgreSQL 16 + pgvector, но managed-хостинг не проверялся |
| Деплой на Render/Vercel/Netlify, cold start | Вне рамок QA-окружения (platform-engineer) |
| 80% порог на реальных расходах | mock-провайдер бесплатный; порог проверен фикстурой `generation_runs` |

## 6. Дефекты, найденные QA

| ID | Дефект | Статус |
|---|---|---|
| QA-1 | Схема: фактически 18 FK вместо заявленных 17 (`tov_profiles.generation_run_id`) | **ИСПРАВЛЕНО** Lead миграцией 002, повторно проверено — 17 FK |
| QA-2 | Схема: `lint_reports.generation_run_id ON DELETE SET NULL` конфликтовал с триггером неизменяемости → DELETE прогона падал с P0001 | **ИСПРАВЛЕНО** Lead (разрешено только обнуление ссылки), три сценария повторно проверены |
| QA-3 | `apps/api/src/services/llm/openaiCompatible.ts` и `services/adapters/types.ts`: TypeScript parameter properties → Node 24 (`strip-only`) не могла загрузить сервер: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Ломало и e2e, и `npm run dev/start`. | **ИСПРАВЛЕНО** api-engineer; импорт, e2e, typecheck и build проходят |
| QA-4 | `apps/api/src/repositories/authorProfiles.ts:101`: `TS2345 Argument of type 'unknown' is not assignable to parameter of type 'QueryParam'` — падал `npm run typecheck` | **ИСПРАВЛЕНО**; `npm run typecheck -w @blogos/api` чист |
| QA-5 | Документация: `docs/API.md` не описывал поле `strict_ai`, хотя документированный код `402 ai_budget_exceeded` достижим только с ним; без `strict_ai` сервер отдаёт `200` + откат на правила (по DECISIONS №7) | **ЗАКРЫТО**: Lead дополнил `docs/API.md` (тело lint `{use_llm, strict_ai}` и таблица ошибок 402), QA добавил `strict_ai` в `docs/openapi.yaml`; поведение проверено e2e |

Код приложения QA не менял: правки только в `tests/**`, `docs/openapi.yaml`,
`docs/ACCEPTANCE.md`, `docs/DB-REVIEW.md`.
