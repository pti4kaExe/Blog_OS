# Матрица соответствия ТЗ

Каждое требование ТЗ v1.1 сопоставлено с артефактом в репозитории и способом
проверки. «Прототип» — рабочая часть из раздела 1 ТЗ (Шаги 1—4 и CommentRadar
в браузере), «Целевая» — серверная версия из разделов 7—8.

## 1. Назначение и результат

| Требование | Артефакт | Чем проверено |
|---|---|---|
| Профиль Tone of Voice по 2—3 постам | `packages/engine/src/styleProfile.js` (браузер), `apps/api/src/services/style.ts` (сервер) | 7 тестов движка; `apps/api/test/tov.test.ts` |
| Narrative Engine — пост из заметок с аркой | `packages/engine/src/narrative.js`, `apps/api/src/services/narrative.ts` | 13 тестов движка; `apps/api/test/drafts.test.ts` |
| Режим «Черновик» без сборки | `apps/web/src/components/cloud/CloudNotesStep.jsx`, `mode: "draft"` в API | `apps/api/test/drafts.test.ts` («mode=draft пропускает сборку») |
| AntiCringe: оценка 0—100, 4 группы, замечания с цитатами | `packages/engine/src/anticringe.js`, `apps/api/src/services/lint.ts` | 13 тестов движка; контрольные тексты ≈86 / ≈16 / ≈29 |
| Автоправки без порчи грамматики | `packages/engine/src/anticringe.js` (`applyFixes`) | тесты «именительный „вы“ не правится автоматически», «автоправки не ломают текст» |
| CommentRadar: лента и черновик комментария | `packages/engine/src/radar.js`, `apps/api/src/services/responses.ts` | 7 тестов движка; `apps/api/test/responses.test.ts` |
| Сохранение состояния в браузере | `apps/web/src/components/LocalApp.jsx` (`blogos.state.v1`) | локальный режим в сборке клиента |
| 49 автотестов движков | `packages/engine/test/test-engine.mjs` | `npm run test:engine` → 49/49 |

## 2. Пользователи и права

| Требование | Артефакт | Чем проверено |
|---|---|---|
| Вход через Telegram, регистрации нет | `apps/api/src/auth.ts` (HMAC initData), `POST /auth/telegram` | `apps/api/test/auth.test.ts`: валидная подпись, неверная, просроченный `auth_date`, отсутствие токена бота → 503 |
| Роль `user` / `admin`, выдаётся только вручную | `users.role`, guard `requireAdmin` | тест «администратор имеет роль admin»; `db/sql` без метода назначения роли |
| `user` — только свои записи | `apps/api/src/repositories/*` (фильтр по владельцу) | `cross.test.ts`: 404 на чужой канал, пост, черновик, источник; e2e negative |
| `admin` — golden-dataset и evals | `apps/api/src/routes/service.ts` | `cross.test.ts`: 403 для роли user |
| `GET /generation-runs` — только свои вызовы | `generationRuns` репозиторий | `service.test.ts`: админ видит все, автор — только свои |
| Прототип доступен без входа | `LocalApp.jsx`, движки в браузере | локальный режим в сборке |

## 3. Функции и границы

| Функция | Состояние | Где |
|---|---|---|
| Профиль стиля, Narrative Engine, «Черновик», AntiCringe, автоправки, CommentRadar | работает (прототип) | `packages/engine`, `LocalApp.jsx` |
| Вход через Telegram, учётные записи, роли | реализовано (целевая) | `apps/api/src/auth.ts` |
| Несколько каналов на автора, площадки | реализовано | `author_profiles.platform`, переключатель каналов в клиенте |
| Архив постов и импорт | реализовано для Telegram, Instagram, YouTube | `apps/api/src/services/adapters/*` |
| Реальный источник обсуждений | реализовано (сканирование площадок) | `POST /sources/{id}/comments/scan` |
| База знаний и RAG (pgvector) | реализовано | `embeddings`, `services/rag`, `GET …/knowledge/search` |
| Нейросеть во всех модулях | реализовано за интерфейсом, mock по умолчанию | `apps/api/src/services/llm/*` |
| Журнал вызовов и расходов | реализовано | `generation_runs`, `GET /generation-runs`, `GET …/usage` |
| golden_dataset и прогоны Evals | реализовано | `POST /evals/run`, `GET /evals/runs` |
| Публикация статической сборки | сборка готова, развёртывание — в RUNBOOK | `npm run build -w @blogos/web`, `vercel.json` |
| Настраиваемые правила AntiCringe | частично: стоп-слова в `tov_profiles`; отключение групп — открыто | DECISIONS, № 14 |
| Публикация постов на площадку, планировщик, аналитика, монетизация | вне границ проекта (ТЗ, раздел 3) | `POST /drafts/{id}/publish` только фиксирует факт |

## 4. Сценарии и правила

| Правило ТЗ | Где обеспечено | Проверка |
|---|---|---|
| Без профиля стиля следующие шаги недоступны | `apps/web` (блокировка шагов), `422` на сервере | шаги в клиенте + e2e |
| Профиль не строится при материале < 180 символов | `POST …/tov/analyze` → `422 too_short` | `tov.test.ts` |
| Автоправка не имеет права оставить текст неграмотным | `applyFixes` в движке, правки с конца текста | тесты движка |
| Движок не выдумывает факты → `[дополните: …]` | `draftComment`, `services/responses.ts` | тест «черновик оставляет пропуск для автора» |
| Нельзя одобрить/опубликовать с пропусками | `422 unfilled_gaps` в publish и approve | `drafts.test.ts`, `responses.test.ts` |
| Каждая правка пересчитывает оценку | сервер создаёт новый отчёт, клиент перепроверяет | «повторная проверка создаёт новый отчёт» |
| Удаление канала не удаляет журнал расходов | `generation_runs.author_id ON DELETE SET NULL` | `scripts/check-schema.mjs`, DB-REVIEW |
| Удаление поста не удаляет черновик | `drafts.published_post_id ON DELETE SET NULL` | `scripts/check-schema.mjs` |

## 5. Экраны

| Экран ТЗ | Артефакт |
|---|---|
| Панель вкладок | `apps/web/src/App.jsx` + переключатель «Локально / В облаке» |
| Шаг 1 — Стиль | `StyleStep.jsx` (локально), `cloud/CloudStyleStep.jsx` |
| Шаг 2 — Заметки / Черновик | `NotesStep.jsx`, `cloud/CloudNotesStep.jsx` |
| Шаг 3 — Пост | `PostStep.jsx`, `cloud/CloudDraftStep.jsx` |
| Шаг 4 — Проверка | `CheckStep.jsx`, `cloud/CloudCheckStep.jsx` |
| CommentRadar | `RadarView.jsx`, `cloud/CloudRadarView.jsx` |
| Общие элементы (кольцо, теги, копирование) | `components/ui.jsx` |
| Дополнительно в целевой версии | `LoginScreen`, `DraftsList`, `KnowledgeView`, `UsageView`, `ChannelFormModal` |

## 6. Вход и результат действий

| Функция | Метод API | Артефакт |
|---|---|---|
| Построение профиля стиля | `POST /author-profiles/{id}/tov/analyze` | `routes/tov.ts` |
| Сборка поста | `POST /author-profiles/{id}/drafts/generate` | `routes/drafts.ts` |
| Проверка AntiCringe | `POST /drafts/{id}/lint` | `routes/lint.ts` |
| Применение автоправки | `PATCH /drafts/{id}` + повторный `lint` | `routes/drafts.ts` |
| Ранжирование обсуждений | `GET /sources/{id}/comments` + профиль канала | `routes/comments.ts` |
| Черновик комментария | `POST /comments/{id}/responses/generate` | `routes/responses.ts` |
| Импорт постов | `POST /author-profiles/{id}/posts/import` | `routes/posts.ts` |
| Запуск Evals | `POST /evals/run` | `routes/service.ts` |

## 7. База и модель данных

| Требование | Артефакт | Проверка |
|---|---|---|
| PostgreSQL + pgvector | `db/sql/001_schema.sql`, драйвер `apps/api/src/db.ts` | `scripts/check-schema.mjs` |
| 14 таблиц, 17 связей | `db/sql/001_schema.sql`, `002_align_17_relations.sql` | DB-REVIEW: 14 таблиц, 17 FK |
| Удаление каскадное, кроме ссылок на журнал и `published_post_id` | DDL | `check-schema.mjs`, 5 сценариев |
| `lint_reports` неизменяемы | триггер `blogos_forbid_update` | тест «UPDATE запрещён триггером» |
| Размерность вектора = модель | `vector(1536)` + `model` | DDL, решение № 5 |
| Индексы: FK, «владелец + дата», HNSW | DDL | DB-REVIEW |
| Лимиты длины по площадкам (4096/2200/5000) | валидация в `routes/posts.ts` | `posts.test.ts` |

## 8. Методы и внешние сервисы

| Требование | Артефакт | Проверка |
|---|---|---|
| 59 методов в 11 группах | `apps/api/src/routes/*` | `scripts/check-api.mjs`: 59 в корне и 59 под `/api/v1` |
| Права по разделу 2 | репозитории + guard'ы | `cross.test.ts`, e2e negative |
| Списки: limit 50/200, cursor, сортировка | `apps/api/src/lib/query.ts` | `pagination.test.ts` |
| Telegram: вход, импорт, сканирование | `auth.ts`, `adapters/telegram.ts` | `sources.test.ts` (сканирование, дедупликация, 429) |
| Instagram / YouTube | `adapters/instagram.ts`, `adapters/youtube.ts` | 503 `not_configured` без ключей; живые ключи не проверялись |
| LLM: 1 повторная попытка, откат на правила, журнал | `services/llm/*`, `services/cost.ts` | `lint.test.ts` (`LLM_MOCK_FAIL=1`), 402 при лимите |
| Пометка «проверено без AI» | `verified_without_ai` в ответах | тесты lint/tov/drafts |

## 9—10. Архитектура и технологии

| Требование | Артефакт |
|---|---|
| Целевая архитектура (клиент → API → PostgreSQL + площадки + LLM) | `docs/ARCHITECTURE.md` |
| React 18.3.1, Vite 8.3.x | `apps/web/package.json` |
| Node.js, TypeScript, Fastify 5 | `apps/api/package.json` |
| PostgreSQL 16 + pgvector; локально PGlite (тот же сервер в WASM) | `apps/api/src/db.ts`, `docker-compose.yml`, `.env.example` |
| Хостинг: Neon + Render + Vercel (бесплатные тарифы) | `render.yaml`, `vercel.json`, `docs/RUNBOOK.md` |
| Тесты: свой раннер движков + node:test сервера | `packages/engine/test`, `apps/api/test` |

## 11. Безопасность

| Требование | Артефакт |
|---|---|
| Секреты только в env сервера | `.env.example`, `apps/api/src/env.ts`, `.gitignore` |
| `DEV_AUTH=0` на проде | `render.yaml`, `docs/RUNBOOK.md` |
| Предупреждение перед передачей текста провайдеру, отказ возможен | `apps/web/src/lib/aiConsent.jsx` (`use_llm: false`) |
| Ошибки не раскрывают внутренности | `apps/api/src/app.ts` (конверт ошибок, лог) |
| Данные автора не покидают сервис без AI-вызова | mock-провайдеры по умолчанию |

## 12—14. Проверки, запуск, этапы

| Требование | Артефакт |
|---|---|
| Чек-лист приёмки раздела 12 | `docs/ACCEPTANCE.md` (фактические результаты) |
| Запуск и передача результата | `README.md`, `docs/RUNBOOK.md` |
| Этапы и открытые вопросы | `docs/DECISIONS.md` |

## Открытые вопросы ТЗ → решения

Все пункты «Нужно уточнить» закрыты решением или явно оставлены открытыми
с причиной: `docs/DECISIONS.md`, раздел «Согласовано с заказчиком» (№ 1—15)
и «Что осталось открытым».
