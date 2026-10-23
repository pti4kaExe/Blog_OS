# Ревизия схемы базы данных BlogOS

Версия 2.0 · дата ревизии: 24.10.2026 · ревизор: QA (независимая проверка)

Источник истины — `db/sql/001_schema.sql`; согласование уже существующих баз —
`db/sql/002_align_17_relations.sql`. Ревизия выполнена **на живой базе**, а не
по чтению DDL: скрипт [`tests/db/review.mjs`](../tests/db/review.mjs) поднимает
PGlite (настоящий PostgreSQL 16 + pgvector, собранный в WASM), применяет обе
миграции через `apps/api/src/db.ts` и проверяет схему по системным каталогам
(`pg_tables`, `pg_constraint`, `pg_indexes`, `pg_trigger`) и реальными
INSERT/UPDATE/DELETE-сценариями.

```bash
DATABASE_URL=pglite://memory node tests/db/review.mjs
```

Скрипт печатает «ожидание → факт → вердикт» по каждой проверке и завершается
с кодом 1, если хоть одна проверка не сошлась.

**Итог: проверок 23, пройдено 23, провалено 0.** Ревизия проведена повторно
после правок Lead: `001_schema.sql` (22 027 байт) + `002_align_17_relations.sql`
(2 023 байта); PGlite-каталог не использовался — база каждый раз создаётся
чистой в памяти, временных файлов не остаётся.

Два дефекта, найденные первой ревизией (DB-1 и DB-2), **исправлены и повторно
проверены** — раздел «Дефекты» в конце документа.

---

## 1. Таблицы и внешние ключи (системные каталоги)

| Проверка | Ожидание | Факт | Вердикт |
|---|---|---|---|
| Ровно 14 таблиц | 14 и только 14 таблиц из ТЗ, раздел 7 | 14: `author_profiles, comments, drafts, embeddings, eval_results, generated_responses, generation_runs, golden_dataset, knowledge_base, lint_reports, posts, sources, tov_profiles, users` | **ПРОЙДЕНО** |
| Количество внешних ключей | По ТЗ (раздел 7) и шапке DDL — ровно 17 | **17** фактических FK (полный перечень ниже) | **ПРОЙДЕНО** |
| Состав и правила `ON DELETE` каждого FK | 13 `CASCADE` + 4 `SET NULL`; `SET NULL` только у ссылок на журнал расходов и `drafts.published_post_id` (ТЗ, разделы 4 и 7) | 13 `CASCADE` + 4 `SET NULL`; каждая пара совпала с ожиданием | **ПРОЙДЕНО** |
| Повторное применение DDL (идемпотентность) | Повторный запуск 001 + 002 не падает, 14 таблиц и 17 FK сохраняются | Повторный запуск прошёл: `{"tables":14,"fks":17}` | **ПРОЙДЕНО** |

Фактический перечень всех 17 FK (`pg_get_constraintdef`, после 001 + 002):

| Таблица.колонка | Ссылается на | `ON DELETE` |
|---|---|---|
| `author_profiles.user_id` | `users.id` | CASCADE |
| `generation_runs.author_id` | `author_profiles.id` | SET NULL |
| `tov_profiles.author_id` | `author_profiles.id` | CASCADE |
| `posts.author_id` | `author_profiles.id` | CASCADE |
| `drafts.author_id` | `author_profiles.id` | CASCADE |
| `drafts.published_post_id` | `posts.id` | SET NULL |
| `lint_reports.draft_id` | `drafts.id` | CASCADE |
| `lint_reports.generation_run_id` | `generation_runs.id` | SET NULL |
| `sources.author_id` | `author_profiles.id` | CASCADE |
| `comments.source_id` | `sources.id` | CASCADE |
| `generated_responses.comment_id` | `comments.id` | CASCADE |
| `generated_responses.generation_run_id` | `generation_runs.id` | SET NULL |
| `knowledge_base.author_id` | `author_profiles.id` | CASCADE |
| `embeddings.post_id` | `posts.id` | CASCADE |
| `embeddings.knowledge_id` | `knowledge_base.id` | CASCADE |
| `eval_results.generation_run_id` | `generation_runs.id` | CASCADE |
| `eval_results.golden_id` | `golden_dataset.id` | CASCADE |

Правила ТЗ «удаление канала/пользователя не стирает журнал расходов, а удаление
опубликованного поста не удаляет черновик» выполнены: `generation_runs.author_id`
и `drafts.published_post_id` — `SET NULL`, остальные ссылки каскадные. Связь
`tov_profiles.generation_run_id`, из-за которой было 18 FK вместо 17, удалена
миграцией 002; профиль стиля по-прежнему виден в журнале через
`generation_runs(author_id, task_type = 'tov_analyze')`.

## 2. Уникальные индексы и CHECK-ограничения

Проверялись и наличие индекса в каталоге, и фактическое поведение при вставке.

| Проверка | Ожидание | Факт | Вердикт |
|---|---|---|---|
| `tov_profiles.author_id` (1:1 с каналом) | Уникальный индекс; второй профиль на тот же канал → `23505` | `CREATE UNIQUE INDEX tov_profiles_author_id_key ... (author_id)`; повторная вставка → `23505: duplicate key value violates unique constraint "tov_profiles_author_id_key"` | **ПРОЙДЕНО** |
| `posts (author_id, external_id)` — частичный | Дубль пары → `23505`; две строки с `NULL external_id` разрешены | `... UNIQUE ... (author_id, external_id) WHERE (external_id IS NOT NULL)`; дубль → `23505`; NULL-строки вставлены (id 3 и 4) | **ПРОЙДЕНО** |
| `comments (source_id, external_id)` — дедупликация сканирования | Уникальный индекс; дубль → `23505` | `comments_source_external_key UNIQUE (source_id, external_id)`; повтор → `23505` | **ПРОЙДЕНО** |
| `eval_results (generation_run_id, golden_id)` | Один эталон оценивается в прогоне один раз | `eval_results_run_golden_key UNIQUE (...)`; повтор → `23505` | **ПРОЙДЕНО** |
| `drafts.published_post_id` | Один пост не может быть опубликован из двух черновиков | `drafts_published_post_id_key UNIQUE (published_post_id)`; повтор → `23505` | **ПРОЙДЕНО** |
| `CHECK embeddings_exactly_one_owner` (post_id XOR knowledge_id) | Оба значения → `23514`; оба `NULL` → `23514`; ровно один владелец → успех | `CHECK ((((post_id IS NOT NULL))::integer + ((knowledge_id IS NOT NULL))::integer) = 1)`; оба заданы → `23514`; оба NULL → `23514`; ровно один владелец — вставка прошла | **ПРОЙДЕНО** |

Дополнительно каталог подтверждает частичный уникальный индекс
`posts_author_external_url_key (author_id, external_url) WHERE external_url IS NOT
NULL` и уникальность `sources (author_id, source_url)` — они используются в
поведении API (`409 conflict` на дубли, docs/API.md, группы 4 и 7).

## 3. HNSW-индекс и векторный поиск

| Проверка | Ожидание | Факт | Вердикт |
|---|---|---|---|
| HNSW-индекс на `embeddings.embedding` | Индекс `hnsw (embedding vector_cosine_ops)` (ТЗ, раздел 7) | `CREATE INDEX embeddings_hnsw_cosine_idx ON public.embeddings USING hnsw (embedding vector_cosine_ops)` | **ПРОЙДЕНО** |
| Вставка `vector(1536)` и поиск по `<=>` | Ближайший вектор — точное совпадение со score ≈ 1, ортогональный — ≈ 0 | Запрос = вектор A: `knowledge_id=2 score=1.000000`, `knowledge_id=3 score=0.000000` | **ПРОЙДЕНО** |

Вектор размерности 1536 принят колонкой `vector(1536)`, косинусное расстояние
`<=>` считается осмысленно — RAG-поиск из группы 10 API обеспечен на уровне БД.

## 4. Триггеры: `updated_at` и неизменяемость `lint_reports`

| Проверка | Ожидание | Факт | Вердикт |
|---|---|---|---|
| `blogos_touch_updated_at` на изменяемых таблицах | 10 таблиц: `users, author_profiles, tov_profiles, posts, drafts, sources, comments, generated_responses, knowledge_base, golden_dataset` | 10 таблиц ровно этого состава; у `generation_runs`, `lint_reports`, `embeddings`, `eval_results` нет колонки `updated_at` — триггера нет, это верно | **ПРОЙДЕНО** |
| Триггер неизменяемости `lint_reports` | `BEFORE UPDATE → EXCEPTION`, единственный `_immutable`-триггер | `lint_reports_immutable` → `blogos_forbid_update`; других `_immutable` нет | **ПРОЙДЕНО** |
| `updated_at` реально перезаписывается | `UPDATE ... SET updated_at='2000-01-01'` → значение = `now()` на всех 10 таблицах | На всех 10 таблицах год стал 2026 (`users=2026, author_profiles=2026, tov_profiles=2026, posts=2026, drafts=2026, sources=2026, comments=2026, generated_responses=2026, knowledge_base=2026, golden_dataset=2026`) | **ПРОЙДЕНО** |
| (а) `UPDATE lint_reports SET score = …` запрещён | Ошибка с текстом «неизменяема», `score` не меняется | `UPDATE` → `Таблица lint_reports неизменяема после создания`; `score` после попытки = 86 | **ПРОЙДЕНО** |
| (в) Нецелевое изменение `generation_run_id` запрещено | `UPDATE lint_reports SET generation_run_id = <другой id>` → `P0001`, значение остаётся `null` | `ошибка P0001: Таблица lint_reports неизменяема после создания`; `generation_run_id=null` | **ПРОЙДЕНО** |

Разрешено ровно одно изменение отчёта — обнуление ссылки на журнал расходов при
удалении прогона AI (`ON DELETE SET NULL`). Триггер сравнивает
`to_jsonb(NEW) - 'generation_run_id'` с `to_jsonb(OLD) - 'generation_run_id'`,
поэтому содержание отчёта (оценка, замечания, движок, дата) измениться не может.

## 5. Каскады и обнуление на реальных строках

Каждая строка — реальные INSERT → DELETE на живых данных, а не рассуждение по DDL.

| Проверка | Ожидание | Факт | Вердикт |
|---|---|---|---|
| Удаление канала → `generation_runs.author_id` | Строка журнала расходов **остаётся**, `author_id = null` (ТЗ, раздел 4) | Запись `generation_runs id=2` существует, `author_id=null` | **ПРОЙДЕНО** |
| Удаление поста → `drafts.published_post_id` | Черновик **остаётся**, `published_post_id = null` (ТЗ, раздел 4) | Черновик `id=3` существует, `status=published`, `published_post_id=null` | **ПРОЙДЕНО** |
| Удаление `users` | Каскад: каналы, стили, посты, черновики, отчёты, источники, комментарии, ответы, база знаний, векторы — 0; журнал расходов остаётся | `{"channels":0,"tov":0,"posts":0,"drafts":0,"lints":0,"sources":0,"comments":0,"responses":0,"knowledge":0,"embeddings":0,"runs":1}` | **ПРОЙДЕНО** |
| Удаление черновика → `lint_reports` | Отчёты уходят каскадом | Осталось отчётов по удалённому черновику: 0 | **ПРОЙДЕНО** |
| Удаление `sources` / `knowledge_base` | Комментарии и ответы / векторы уходят каскадом | `source: {"comments":0,"responses":0}; knowledge: {"embeddings":0}` | **ПРОЙДЕНО** |
| (б) Удаление `generation_runs`, на который ссылается отчёт | `DELETE` проходит; `lint_reports.generation_run_id = null`; `draft_id/score/issues/engine/created_at` не изменились; `eval_results` прогона каскадом = 0 | `DELETE прошёл; generation_run_id=null; отчёт: score=50, engine=rules, draft_id=6; eval_results=0` | **ПРОЙДЕНО** |
| `SET NULL` у `generated_responses.generation_run_id` | Удаление прогона проходит; ссылка в ответе → `null` | `DELETE прошёл; generation_run_id=null` | **ПРОЙДЕНО** |

---

## Дефекты первой ревизии: закрыты и повторно проверены

Код приложения не менялся (границы зоны записи QA). Дефекты были переданы Lead,
исправлены им в DDL и повторно проверены этим же скриптом.

### DB-1. Счётчик внешних ключей: было 18 вместо 17 — исправлено

- **Было:** `pg_constraint` возвращал 18 FK; лишней была
  `tov_profiles.generation_run_id`. ТЗ (раздел 7) и шапка DDL заявляли 17.
- **Исправление Lead:** миграция `db/sql/002_align_17_relations.sql` —
  `ALTER TABLE tov_profiles DROP COLUMN IF EXISTS generation_run_id`.
- **Проверка после:** каталог возвращает **ровно 17** FK, состав и `ON DELETE`
  совпадают с ожиданием (13 CASCADE + 4 SET NULL), повторное применение
  миграций не ломает базу. **ЗАКРЫТО.**

### DB-2. Конфликт `ON DELETE SET NULL` и триггера неизменяемости — исправлено

- **Было:** `lint_reports.generation_run_id ON DELETE SET NULL` + запрет любого
  `UPDATE` в `blogos_forbid_update()` → `DELETE generation_runs`, на который
  ссылается отчёт, падал с `P0001`.
- **Исправление Lead:** функция триггера разрешает ровно один вариант —
  `generation_run_id` становится `NULL`, а все остальные поля совпадают с
  прежними (`to_jsonb(NEW) - 'generation_run_id'` = `to_jsonb(OLD) - 'generation_run_id'`).
- **Проверка после:** три сценария пройдены на живой базе —
  (а) обычный `UPDATE score` → `P0001`, оценка не изменилась;
  (б) `DELETE generation_runs` при наличии ссылки из отчёта → успешно,
  `generation_run_id = NULL`, остальные поля отчёта не изменились;
  (в) `UPDATE generation_run_id` на другой прогон → `P0001`.
  **ЗАКРЫТО.**

---

## Что подтверждено и что нет

- **Подтверждено на живой PostgreSQL 16 + pgvector (PGlite):** 14 таблиц,
  ровно 17 FK и правила `ON DELETE` всех связей, пять уникальных ограничений и
  частичный уникальный индекс, `CHECK` «ровно один владелец» у `embeddings`,
  HNSW-индекс и осмысленный косинусный поиск, все 10 триггеров `updated_at`,
  запрет `UPDATE` у `lint_reports` в трёх сценариях, каскады и обнуления на
  реальных строках, идемпотентность миграций 001 + 002.
- **Не проверялось:** поведение на внешнем PostgreSQL (Neon/Docker) — в
  окружении QA нет Docker и сети; отличия ограничены расширением `vector` и
  версией PostgreSQL, которые в PGlite совпадают (PG 16).
- **Воспроизведение:** `node tests/db/review.mjs` (из корня монорепо, Node 24).
  Скрипт автономен: не требует сервера, Docker, сети, не оставляет данных.
