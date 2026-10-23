# BlogOS API — контракт на 59 методов

Версия 2.0. Источник: ТЗ v1.1, раздел 8 «Методы и внешние сервисы».
Этот файл — единственный источник истины для сервера, клиента и тестов.
Машинночитаемая версия: `docs/openapi.yaml`.

## Общие правила

| Правило | Значение |
|---|---|
| Формат | JSON, UTF-8. Ответы и тела запросов — объекты, кроме `204 No Content` |
| Аутентификация | `Authorization: Bearer <jwt>` |
| Префикс | Методы доступны в корне (`/auth/telegram`) и по алиасу `/api/v1/...` для развёртывания за статическим хостом |
| Списки | `?limit=` (по умолчанию 50, максимум 200), `?cursor=<opaque>`, сортировка `created_at DESC`, фильтры по статусу, типу и диапазону дат |
| Формат списка | `{ "items": [...], "next_cursor": "…" \| null }` |
| Идентификаторы | `bigint` в JSON передаётся **числом**, если значение ≤ 2^53, иначе строкой. Клиент обязан принимать оба варианта |
| Время | ISO 8601 с зоной, UTC (`2026-10-23T21:34:31.000Z`) |
| Идемпотентность | `POST …/posts/import` и `POST …/comments/scan` — повторный вызов не создаёт дублей (дедупликация по `external_id`) |
| Валюта | `numeric(12,2)` в рублях, `cost` — `numeric(12,6)` |

### Ошибки

Единый конверт: `{ "error": { "code": "…", "message": "…", "details": { … } } }`.

| Код HTTP | `code` | Когда |
|---|---|---|
| 400 | `validation_error` | Тело или параметры не проходят схему; `details.fields` — список полей |
| 401 | `unauthorized` | Нет токена, токен просрочен или подпись неверна |
| 403 | `forbidden` | Запись принадлежит другому пользователю; не хватает роли `admin` |
| 404 | `not_found` | Запись не существует **или** чужая (не различаем: не раскрываем существование) |
| 409 | `conflict` | Нарушение уникальности: `tov_profiles.author_id`, `(author_id, external_id)`, `(source_id, external_id)`, `(generation_run_id, golden_id)` |
| 422 | `unprocessable` | Данные валидны по форме, но неприменимы: профиль стиля без 180 символов, статус `approved` без `approved_at`, публикация черновика с пропусками `[дополните: …]` |
| 402 | `ai_budget_exceeded` | Достигнут `monthly_cost_limit` канала: AI-вызов не выполняется, `details.fallback` = `"rules"` |
| 429 | `rate_limited` | Слишком частые сканирования: `POST …/comments/scan` |
| 500 | `internal` | Непредвиденная ошибка. Текст исключения наружу не отдаётся, попадает в лог |

### Права

Ровно по разделу 2 ТЗ.

- `user` — CRUD только над записями, где `user_id`/`author_id` принадлежит ему. Чужие записи → `404`.
- `admin` — всё, что доступно `user` (над своими каналами), плюс `golden-dataset` и `evals`.
- `GET /generation-runs` — автор видит **только свои** вызовы (по своим каналам), администратор — все.
- Роли через API не выдаются: метода назначения роли нет намеренно.

### Поведение AI

- Правиловый движок работает всегда и бесплатно. LLM — второй слой.
- Один вызов LLM: `LLM_PROVIDER` ∈ `mock` | `deepseek` | `openai`.
- Таймаут → **одна повторная попытка**, затем откат на правила.
- Откат виден в ответе: `verified_without_ai: true` и `engine: "rules"`.
- Каждый вызов (успешный и неудачный) пишется в `generation_runs`.
- Превышение лимита: на 80% канала — `warning` в ответе `GET …/usage`; на 100% AI-вызовы не выполняются (`402 ai_budget_exceeded`), движок работает на правилах.

---

## 1. Вход и пользователь — 4 метода

### `POST /auth/telegram`
Создаёт учётную запись при первом входе, иначе возвращает существующую. Отдельной регистрации нет.

```json
{ "initData": "query_id=AAH…&hash=…" }
```

В режиме `DEV_AUTH=1` вместо подписи принимается пара (для локальной проверки и демо):

```json
{ "telegram_id": 100500, "name": "Демо-автор" }
```

Ответ `200`: `{ "token": "…", "expires_at": "…", "user": { "id", "telegram_id", "name", "role", "created_at" } }`
Ошибки: `400` — подпись неверна или `DEV_AUTH=0`; `503` — Telegram недоступен (после одной повторной попытки; открытая сессия продолжает работать).

### `GET /users/me`
Профиль текущего пользователя и число каналов.
Ответ `200`: `{ "id", "telegram_id", "name", "role", "created_at", "updated_at", "author_profiles_count" }`

### `PATCH /users/me`
```json
{ "name": "Новое имя" }
```
Ответ `200` — обновлённый пользователь. `400` — пустое имя. Смена роли невозможна: поле игнорируется.

### `DELETE /users/me`
Удаляет учётную запись. Каскадом уходят каналы, стили, посты, черновики, отчёты, источники, комментарии, ответы, база знаний, векторы. Записи `generation_runs` **остаются** с `author_id = null`.
Ответ `204`. Повторный вызов → `401`.

---

## 2. Каналы — 6 методов

`author_profiles`: канал одной площадки. Всё остальное в API привязано к каналу.

### `GET /author-profiles`
`?platform=telegram&limit=50&cursor=…` → `{ items, next_cursor }`

### `POST /author-profiles`
```json
{
  "name": "Заметки разработчика",
  "platform": "telegram",
  "description": "О чём канал",
  "content_settings": { "topics": ["код", "учёба"], "language": "ru", "target_length": { "min": 800, "max": 2500 } },
  "monthly_cost_limit": 500
}
```
Ответ `201` — канал. `409` — не бывает: имена не уникальны.
Валидация: `platform` из enum; `content_settings.topics` — массив строк; `target_length.min ≤ max`; `monthly_cost_limit ≥ 0`.
Лимит каналов: 20 на пользователя → `422`.

### `GET /author-profiles/{id}` → `200` канал с `tov_profiles_count`, `posts_count`, `drafts_count`

### `PATCH /author-profiles/{id}` — частичное обновление тех же полей, `200`

### `DELETE /author-profiles/{id}` — `204`; каскад. `generation_runs.author_id → null`

### `GET /author-profiles/{id}/usage`
Расходы AI по каналу за текущий месяц.
```json
{
  "author_profile_id": 7,
  "period": "2026-10",
  "monthly_cost_limit": 500,
  "spent": 123.45,
  "limit_ratio": 0.2469,
  "warning": false,
  "blocked": false,
  "runs": { "total": 42, "success": 40, "failed": 2 },
  "by_task": [ { "task_type": "lint", "runs": 30, "tokens": 120000, "cost": 90.1 } ]
}
```
`warning = limit_ratio ≥ COST_WARN_RATIO (0.8)`, `blocked = limit_ratio ≥ 1`.

---

## 3. Стиль — 3 метода

`tov_profiles`: 1:1 с каналом (уникальный `author_id`).

### `GET /author-profiles/{id}/tov` → `200` профиль стиля или `404`, если не построен

### `PUT /author-profiles/{id}/tov`
Полная замена профиля (идемпотентно, `upsert`).
```json
{
  "tone": "ты",
  "slang": ["кринж", "залипать"],
  "stop_words": ["синергия"],
  "favorite_phrases": ["по делу"],
  "metrics": { "avg_sentence_length": 11.4, "…": "…" }
}
```
Ответ `200`. `409` — нарушение 1:1 не возникает: `PUT` перезаписывает.

### `POST /author-profiles/{id}/tov/analyze`
Собирает профиль стиля из текстов канала: `texts` (2—3 поста) **или** последние посты из `posts`.
```json
{ "texts": ["первый пост…", "второй пост…"], "use_archive": false }
```
Правила: суммарно ≥ **180 символов**, иначе `422` с `details.reason = "too_short"` и `details.length`.
Правиловый движок строит карточку всегда; LLM (при доступности) дополняет `tone`, `slang`, `favorite_phrases`.
Ответ `200`:
```json
{
  "tov_profile": { "…": "…" },
  "analysis": { "source": "rules+|llm", "chars": 1840, "posts_used": 2 },
  "verified_without_ai": false,
  "generation_run_id": 1001
}
```

---

## 4. Посты — 6 методов

### `GET /author-profiles/{id}/posts` — `?content_type=post&from=…&to=…&limit=&cursor=`

### `POST /author-profiles/{id}/posts`
```json
{
  "content_type": "post",
  "text": "текст поста",
  "external_id": "123",
  "external_url": "https://t.me/…",
  "published_at": "2026-10-01T10:00:00Z"
}
```
`201`. Валидация длины по площадке (ТЗ, раздел 7): telegram `post` ≤ 4096; instagram `caption` ≤ 2200, `reels_script`; youtube `video_script`, `video_description` ≤ 5000. Превышение → `422 details.limit`.
Побочно: пересчитываются `embeddings` (если `EMBEDDINGS_PROVIDER ≠ mock`).

### `GET /author-profiles/{id}/posts/{postId}` → `200`
### `PATCH /author-profiles/{id}/posts/{postId}` → `200` (правка текста пересчитывает векторы)
### `DELETE /author-profiles/{id}/posts/{postId}` → `204`; `drafts.published_post_id → null`

### `POST /author-profiles/{id}/posts/import`
Импорт с площадки. Сначала Telegram; Instagram и YouTube — через адаптеры того же метода.
```json
{ "platform": "telegram", "source_url": "https://t.me/s/channel", "limit": 50 }
```
Ответ `200`:
```json
{ "imported": 12, "skipped_duplicates": 3, "skipped_invalid": 0, "errors": [], "checked": 15 }
```
Дедупликация по `(author_id, external_id)`. Ошибка площадки → **одна повторная попытка**, затем `502` с `details.platform`; уже импортированное не откатывается.

---

## 5. Черновики — 7 методов

### `GET /author-profiles/{id}/drafts` — `?status=draft&origin=author&limit=&cursor=`
### `POST /author-profiles/{id}/drafts`
```json
{ "title": "Черновик", "source_notes": "заметка 1\nзаметка 2", "text": "", "origin": "author" }
```
`201`.

### `GET /drafts/{id}` → `200`, включает `latest_lint_report` (последний отчёт или `null`)

### `PATCH /drafts/{id}`
```json
{ "text": "…", "title": "…", "status": "on_check", "source_notes": "…", "arc": "story_case" }
```
`200`. Смена `status` проверяется по переходам: `draft → on_check → ready → published`. Обратные переходы разрешены, кроме ухода из `published` (нужен `DELETE …/publish`, метода нет → `422`).

### `DELETE /drafts/{id}` → `204`; `lint_reports` уходят каскадом

### `POST /author-profiles/{id}/drafts/generate`
Narrative Engine на сервере: из заметок — связный пост.
```json
{ "source_notes": "заметка 1\nзаметка 2", "arc": null, "mode": "notes" }
```
`mode`: `notes` (сборка) | `draft` (текст как есть, шаг сборки пропускается).
Ответ `201`:
```json
{
  "draft": { "id", "text", "origin": "narrative_engine", "status": "draft", "arc": "story_case" },
  "build": {
    "arc": "story_case",
    "arc_auto": true,
    "blocks": [ { "role": "hook", "text": "…", "fragment": "…" } ],
    "added_by_engine": [ "…" ],
    "notes_used": 4,
    "notes_dropped": 0
  },
  "verified_without_ai": true,
  "generation_run_id": null
}
```
Пустые заметки → `422 details.reason = "empty_notes"`.
Если LLM доступна, `blocks` собирает модель, `added_by_engine` не пуст; при отказе — `verified_without_ai: true`.

### `POST /drafts/{id}/publish`
Публикует черновик: создаёт запись в `posts`, ставит `status = published`, связи `published_post_id`.
```json
{ "published_at": "2026-10-23T12:00:00Z" }
```
Ответ `200`: `{ "draft": {…}, "post": { "id", "text", "published_at" } }`.
Блокировки: `422 details.reason` ∈ `not_ready` (статус не `ready`), `unfilled_gaps` (в тексте остались `[дополните: …]`), `empty_text`.
Публикация **не отправляет** ничего на площадку (границы проекта, раздел 3 ТЗ) — только фиксирует факт в архиве.

---

## 6. Проверка — 3 метода

### `POST /drafts/{id}/lint`
AntiCringe: правиловый слой всегда, LLM — второй слой при доступности.
```json
{ "use_llm": true }
```
Ответ `201`:
```json
{
  "lint_report": {
    "id": 88,
    "draft_id": 31,
    "score": 86,
    "engine": "rules",
    "generation_run_id": null,
    "created_at": "…",
    "issues": [
      {
        "id": "cliche-12",
        "type": "cliche",
        "category": "cliche",
        "quote": "в современном мире",
        "start": 10, "end": 27,
        "explanation": "Клише: фраза не несёт смысла",
        "suggestion": "Убрать оборот",
        "severity": "medium",
        "fixable": true
      }
    ]
  },
  "groups": { "cliche": 2, "logic": 1, "tov": 0, "clarity": 1 },
  "verdict": "Можно публиковать",
  "verified_without_ai": true,
  "ai_skipped_reason": "budget_exceeded"
}
```
`verdict`: `Можно публиковать` (оценка ≥ 75) | `Требует правок` (40—74) | `Переписать` (< 40).
`422` — пустой текст. Отчёт неизменяем: повторная проверка создаёт новую запись.

### `GET /drafts/{id}/lint-reports` — история проверок, `created_at DESC` → `{ items, next_cursor }`

### `GET /lint-reports/{id}` → `200` отчёт (в том числе после удаления черновика ссылка недоступна — `404`)

---

## 7. Источники — 5 методов

### `GET /author-profiles/{id}/sources` — `?is_active=true&source_type=telegram_channel`
### `POST /author-profiles/{id}/sources`
```json
{ "name": "Канал про код", "source_type": "telegram_channel", "source_url": "https://t.me/s/code" }
```
`201`. `409` — такая пара `(author_id, source_url)` уже есть.

### `GET /sources/{id}` → `200` с `comments_count`, `last_scanned_at`, `last_scan_status`
### `PATCH /sources/{id}` — `{ "name", "source_url", "is_active" }`; `is_active: false` выключает отслеживание → `200`
### `DELETE /sources/{id}` → `204`; комментарии и ответы уходят каскадом

---

## 8. Комментарии — 6 методов

### `GET /sources/{id}/comments` — `?limit=&cursor=&from=&to=`
### `POST /sources/{id}/comments`
Ручное добавление. `external_id` не передаётся — сервер ставит `manual:<id>`.
```json
{ "commenter_name": "Читатель", "text": "А как вы это настроили?", "posted_at": "…" }
```
`201`.

### `GET /comments/{id}` → `200` с `responses_count`
### `PATCH /comments/{id}` — `{ "commenter_name", "text" }` → `200`
### `DELETE /comments/{id}` → `204`

### `POST /sources/{id}/comments/scan`
Сканирование площадки.
```json
{ "limit": 100 }
```
Ответ `200`: `{ "source_id", "found": 12, "created": 8, "duplicates": 4, "last_scanned_at", "status": "ok" }`
Ошибка площадки → одна повторная попытка → `502`, источник помечается `last_scan_status = "failed"` с `last_scan_error`; ранее найденные комментарии остаются.
Неактивный источник (`is_active = false`) → `422`. Тот же источник чаще, чем раз в 60 секунд → `429`.

---

## 9. Варианты ответа — 6 методов

### `GET /comments/{id}/responses` — `?status=approved`
### `POST /comments/{id}/responses`
```json
{ "response_text": "Спасибо! У меня было так: …" }
```
`201`, `status = "generated"`.

### `GET /responses/{id}` → `200`
### `PATCH /responses/{id}`
```json
{ "edited_text": "…", "status": "approved" }
```
Переходы: `generated → pending_approval → approved | rejected`; `approved → sent`.
`422 details.reason = "unfilled_gaps"` — в тексте остались `[дополните: …]` (правило раздела 4 ТЗ).
`422 details.reason = "approved_at_required"` — статус `approved`/`sent` без даты одобрения: сервер проставляет `approved_at` сам.

### `DELETE /responses/{id}` → `204`
### `POST /comments/{id}/responses/generate`
Черновик ответа из четырёх частей в стиле автора.
```json
{ "count": 2 }
```
Ответ `201`:
```json
{
  "responses": [ { "id", "response_text", "status": "generated", "parts": { "reference": "…", "experience": "…", "gap": "[дополните: …]", "question": "…" }, "generation_run_id": 1002 } ],
  "verified_without_ai": false,
  "based_on_post_id": 44
}
```
Движок никогда не выдумывает факты: в части `gap` остаётся пропуск, пока автор его не заполнит.

---

## 10. База знаний — 6 методов

### `GET /author-profiles/{id}/knowledge` — `?limit=&cursor=`
### `POST /author-profiles/{id}/knowledge`
```json
{ "title": "Обо мне", "content": "Работаю в продуктовой аналитике с 2019 года" }
```
`201`. Побочно: считается вектор ранга `knowledge_base` → `embeddings`.

### `GET /knowledge/{id}` → `200`
### `PATCH /knowledge/{id}` — `{ "title", "content" }`; правка пересчитывает вектор → `200`
### `DELETE /knowledge/{id}` → `204`; векторы уходят каскадом

### `GET /author-profiles/{id}/knowledge/search`
RAG-поиск по фактам автора.
`?q=сколько лет в аналитике&limit=5` (`RAG_TOP_K` по умолчанию)
Ответ `200`:
```json
{
  "items": [ { "knowledge_id": 3, "title": "Обо мне", "chunk_text": "…", "score": 0.82, "chunk_index": 0 } ],
  "query_embedding_model": "text-embedding-3-small",
  "searched_chunks": 12
}
```
Поиск по косинусному расстоянию (HNSW). `503` — модель эмбеддингов недоступна; пустой `q` → `400`.

---

## 11. Служебные — 7 методов

### `GET /generation-runs`
Журнал вызовов AI и расходов. `user` видит только свои каналы, `admin` — все.
`?author_profile_id=&task_type=&status=&from=&to=&limit=&cursor=`
```json
{ "items": [ { "id": 1001, "author_id": 7, "task_type": "lint", "model": "deepseek-chat", "tokens_input": 900, "tokens_output": 300, "tokens": 1200, "cost": 0.0123, "status": "success", "error_message": null, "duration_ms": 2100, "created_at": "…" } ], "next_cursor": null }
```

### `GET /golden-dataset` — только `admin`. `?platform=telegram`
### `POST /golden-dataset` — только `admin`
```json
{ "text": "эталонный текст", "labels": [ { "type": "cliche", "quote": "в современном мире", "start": 0, "end": 17 } ], "platform": "telegram" }
```
`201`.
### `PATCH /golden-dataset/{id}` — только `admin` → `200`
### `DELETE /golden-dataset/{id}` — только `admin` → `204`
### `POST /evals/run` — только `admin`
Прогон Evals: прогоняет `lint()` по всему `golden_dataset`, считает precision/recall.
```json
{ "use_llm": false, "platform": null }
```
Ответ `201`:
```json
{
  "generation_run_id": 1003,
  "summary": { "goldens": 12, "precision": 0.91, "recall": 0.84, "matched": 34, "missed": 6, "false_positive": 3 },
  "results": [ { "golden_id": 1, "precision": 1, "recall": 0.5, "matched": [], "missed": [], "false_positive": [] } ]
}
```
`422` — `golden_dataset` пуст.
### `GET /evals/runs` — только `admin`
`?generation_run_id=` → `{ items, next_cursor }`; без фильтра — сводка по прогонам, `created_at DESC`.

---

## Сводка

| № | Группа | Методов |
|---|---|---|
| 1 | Вход и пользователь | 4 |
| 2 | Каналы | 6 |
| 3 | Стиль | 3 |
| 4 | Посты | 6 |
| 5 | Черновики | 7 |
| 6 | Проверка | 3 |
| 7 | Источники | 5 |
| 8 | Комментарии | 6 |
| 9 | Варианты ответа | 6 |
| 10 | База знаний | 6 |
| 11 | Служебные | 7 |
| **Итого** | **11 групп** | **59** |

## Внешние сервисы

| Сервис | Назначение | Недоступность |
|---|---|---|
| Telegram Bot API | Вход (`initData`), импорт постов, сканирование комментариев | 1 повторная попытка → `503`/`502`; открытая сессия работает, данные не меняются |
| Instagram Graph API | Импорт постов и комментариев | Требует Business-аккаунт и доступ приложения; при отсутствии ключей адаптер отвечает `503` с `details.reason = "not_configured"` |
| YouTube Data API v3 | Импорт видео и комментариев | Требует API-ключ и квоту; при отсутствии ключа `503 not_configured` |
| LLM (DeepSeek / OpenAI / mock) | Генерация, второй слой проверки, анализ стиля | 1 повторная попытка → откат на правила, `verified_without_ai: true` |
| Модель эмбеддингов | Векторы для RAG | Поиск отвечает `503`; остальные функции работают |
