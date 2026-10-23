# Ревизия схемы базы данных BlogOS

Версия 2.0 · дата ревизии: 23.10.2026 · ревизор: QA (независимая проверка)

Источник истины — `db/sql/001_schema.sql`. Ревизия выполнена **на живой базе**, а не
по чтению DDL: скрипт [`tests/db/review.mjs`](../tests/db/review.mjs) поднимает
PGlite (настоящий PostgreSQL 16 + pgvector, собранный в WASM), применяет
`db/sql/001_schema.sql` через `apps/api/src/db.ts` и проверяет схему по системным
каталогам (`pg_tables`, `pg_constraint`, `pg_indexes`, `pg_trigger`) и реальными
INSERT/UPDATE/DELETE-сценариями.

```bash
DATABASE_URL=pglite://memory node tests/db/review.mjs
```

Скрипт печатает «ожидание → факт → вердикт» по каждой проверке и завершается
с кодом 1, если хоть одна проверка не сошлась.

**Итог: проверок 22, пройдено 20, провалено 2.** Оба провала — расхождения
с документацией/ограничением ТЗ, а не сбой инфраструктуры; вынесены в раздел
«Дефекты» в конце документа.

---

## 1. Таблицы и внешние ключи (системные каталоги)

| Проверка | Ожидание | Факт | Вердикт |
|---|---|---|---|
| Ровно 14 таблиц | 14 и только 14 таблиц из ТЗ, раздел 7 | 14: `author_profiles, comments, drafts, embeddings, eval_results, generated_responses, generation_runs, golden_dataset, knowledge_base, lint_reports, posts, sources, tov_profiles, users` | **ПРОЙДЕНО** |
| Количество внешних ключей | По ТЗ (раздел 7) и шапке DDL — 17 | **18** фактических FK (полный перечень ниже) | **ПРОВАЛ** — расхождение документации и схемы (см. дефект DB-1) |
| Состав и правила `ON DELETE` каждого FK | 13 `CASCADE` + 5 `SET NULL`; `SET NULL` только у журнала расходов и `drafts.published_post_id` (ТЗ, разделы 4 и 7) | 13 `CASCADE` + 5 `SET NULL`; каждая пара совпала с ожиданием | **ПРОЙДЕНО** |
| Повторное применение DDL (идемпотентность) | Повторный запуск файла не падает, 14 таблиц и FK сохраняются | Повторный запуск прошёл: `{"tables":14,"fks":18}` | **ПРОЙДЕНО** |

Фактический перечень всех 18 FK (`pg_get_constraintdef`):

| Таблица.колонка | Ссылается на | `ON DELETE` |
|---|---|---|
| `author_profiles.user_id` | `users.id` | CASCADE |
| `generation_runs.author_id` | `author_profiles.id` | SET NULL |
| `tov_profiles.author_id` | `author_profiles.id` | CASCADE |
| `tov_profiles.generation_run_id` | `generation_runs.id` | SET NULL |
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

Правило ТЗ «удаление канала/пользователя не стирает журнал расходов, а удаление
опубликованного поста не удаляет черновик» на уровне DDL выполнено:
`generation_runs.author_id` и `drafts.published_post_id` — `SET NULL`, остальные
ссылки каскадные. Расхождение только в **счётчике** документации: 18 FK вместо
заявленных 17 (дефект DB-1).

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
| `UPDATE lint_reports` запрещён | Ошибка с текстом «неизменяема», `score` не меняется | `UPDATE` → `Таблица lint_reports неизменяема после создания`; `score` после попытки = 86 | **ПРОЙДЕНО** |

## 5. Каскады и обнуление на реальных строках

Каждая строка — реальные INSERT → DELETE на живых данных, а не рассуждение по DDL.

| Проверка | Ожидание | Факт | Вердикт |
|---|---|---|---|
| Удаление канала → `generation_runs.author_id` | Строка журнала расходов **остаётся**, `author_id = null` (ТЗ, раздел 4) | Запись `generation_runs id=2` существует, `author_id=null` | **ПРОЙДЕНО** |
| Удаление поста → `drafts.published_post_id` | Черновик **остаётся**, `published_post_id = null` (ТЗ, раздел 4) | Черновик `id=3` существует, `status=published`, `published_post_id=null` | **ПРОЙДЕНО** |
| Удаление `users` | Каскад: каналы, стили, посты, черновики, отчёты, источники, комментарии, ответы, база знаний, векторы — 0; журнал расходов остаётся | `{"channels":0,"tov":0,"posts":0,"drafts":0,"lints":0,"sources":0,"comments":0,"responses":0,"knowledge":0,"embeddings":0,"runs":1}` | **ПРОЙДЕНО** |
| Удаление черновика → `lint_reports` | Отчёты уходят каскадом | Осталось отчётов по удалённому черновику: 0 | **ПРОЙДЕНО** |
| Удаление `sources` / `knowledge_base` | Комментарии и ответы / векторы уходят каскадом | `source: {"comments":0,"responses":0}; knowledge: {"embeddings":0}` | **ПРОЙДЕНО** |
| Удаление `generation_runs`: ссылки обнуляются, `eval_results` каскадятся | `DELETE` прогона проходит; `lint_reports.generation_run_id = null`; `eval_results` прогона = 0 | `DELETE` **упал**: `P0001 — Таблица lint_reports неизменяема после создания`; ссылка осталась `4`, `eval_results=1` | **ПРОВАЛ** — дефект DB-2 |
| `SET NULL` там, где нет неперезаписываемой таблицы | Удаление прогона, на который ссылается только `tov_profiles`, проходит; ссылка → `null` | `DELETE` прошёл; `tov_profiles.generation_run_id=null` | **ПРОЙДЕНО** |

---

## Дефекты, найденные ревизией

Код приложения не менялся (границы зоны записи QA). Запись передана Lead.

### DB-1. Счётчик внешних ключей в документации неверен: 18 вместо 17

- **Где:** `db/sql/001_schema.sql` (шапка и финальный комментарий файла),
  `_docs/BlogOS___ТЗ.txt`, раздел 7 («14 таблиц, 17 связей»).
- **Факт:** на живой базе `pg_constraint` возвращает **18** внешних ключей.
  Полный перечень — в разделе 1; каждая связь осмысленна и нужна.
- **Влияние:** только документация. Поведение БД корректно; но приёмка по
  формальному критерию «ровно 17 FK» не проходит, поэтому дефект нельзя скрыть.
- **Что делать (решение Lead):** либо исправить формулировку в DDL/ТЗ на 18,
  либо удалить одну связь осознанно — QA не выбирает за владельца схемы.

### DB-2. `ON DELETE SET NULL` у `lint_reports.generation_run_id` конфликтует с триггером неизменяемости

- **Где:** `db/sql/001_schema.sql`: `lint_reports.generation_run_id ... ON DELETE
  SET NULL` (строка 237) + `TRIGGER lint_reports_immutable BEFORE UPDATE
  ... blogos_forbid_update()` (строки 250—251).
- **Факт:** `DELETE FROM generation_runs WHERE id = <прогон, на который ссылается
  отчёт>` падает с `SQLSTATE P0001`: PostgreSQL для `SET NULL` выполняет
  `UPDATE lint_reports SET generation_run_id = NULL`, а `BEFORE UPDATE`-триггер
  запрещает любой `UPDATE`. Ошибка воспроизводится на чистой базе скриптом
  `tests/db/review.mjs` (проверка 5.6).
- **Влияние:** противоречие DDL самому себе. Публичного метода удаления
  `generation_runs` в API нет, поэтому сегодня это не ломает сценарии
  пользователя; но любая очистка журнала расходов (миграция, скрипт, будущий
  админ-метод) упрётся в ошибку. Удаление канала и пользователя не затронуто —
  там `generation_runs` только теряет `author_id` (`SET NULL` по `author_id`
  не трогает `lint_reports`).
- **Варианты (решение Lead, не QA):** (а) для `lint_reports.generation_run_id`
  заменить `SET NULL` на `NO ACTION`/`RESTRICT`; (б) разрешить ровно этот
  `UPDATE` в триггере (`WHEN old.generation_run_id IS DISTINCT FROM
  new.generation_run_id`); (в) убрать FK — хуже, теряется целостность.
  Вариант (б) сохраняет и неизменяемость содержания отчёта, и `SET NULL`.

---

## Что подтверждено и что нет

- **Подтверждено на живой PostgreSQL 16 + pgvector (PGlite):** 14 таблиц,
  перечень и `ON DELETE` всех FK, пять уникальных ограничений и частичный
  уникальный индекс, `CHECK` «ровно один владелец» у `embeddings`, HNSW-индекс
  и осмысленный косинусный поиск, все 10 триггеров `updated_at`, запрет
  `UPDATE` у `lint_reports`, каскады и обнуления на реальных строках.
- **Не проверялось:** поведение на внешнем PostgreSQL (Neon/Docker) — в
  окружении QA нет Docker и сети; отличия ограничены расширением `vector` и
  версией PostgreSQL, которые в PGlite совпадают (PG 16).
- **Воспроизведение:** `node tests/db/review.mjs` (из корня монорепо, Node 24).
  Скрипт автономен: не требует сервера, Docker, сети и не оставляет данных.
