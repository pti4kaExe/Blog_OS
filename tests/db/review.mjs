/**
 * Ревизия схемы BlogOS на живой базе.
 *
 *   node tests/db/review.mjs
 *
 * Поднимает PGlite (настоящий PostgreSQL 16 + pgvector в WASM) в памяти,
 * применяет db/sql/001_schema.sql через apps/api/src/db.ts и проверяет
 * схему по системным каталогам и реальными INSERT/UPDATE/DELETE-сценариями.
 *
 * Каждая проверка печатает «ожидание → факт → вердикт». Скрипт завершается
 * с кодом 1, если хоть одна проверка не сошлась: приёмка не должна быть
 * зелёной на непроверенных утверждениях.
 *
 * Запуск только по-русски и только на чтение кода приложения: файлы apps/**
 * не изменяются, используется их публичный слой доступа к БД.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// ─── Окружение должно быть выставлено ДО импорта приложения ──────────────────
// env.ts читает .env, но уже заданные переменные не перетирает.
process.env.DATABASE_URL = 'pglite://memory'
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.DEV_AUTH = '1'
process.env.LLM_PROVIDER = 'mock'
process.env.EMBEDDINGS_PROVIDER = 'mock'
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'review-secret-0123456789abcdef'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const schemaPath = resolve(repoRoot, 'db/sql/001_schema.sql')

const db = await import('../../apps/api/src/db.ts')

// ─── Мини-фреймворк отчёта ────────────────────────────────────────────────────
const results = []
let currentGroup = ''

function group(title) {
  currentGroup = title
  console.log(`\n${'═'.repeat(78)}\n${title}\n${'═'.repeat(78)}`)
}

function record(name, expected, actual, ok, extra) {
  results.push({ group: currentGroup, name, expected, actual, ok })
  const mark = ok ? 'ПРОЙДЕНО' : 'ПРОВАЛ'
  console.log(`\n• ${name}`)
  console.log(`  ожидание: ${expected}`)
  console.log(`  факт:     ${actual}`)
  if (extra) console.log(`  детали:   ${extra}`)
  console.log(`  вердикт:  ${mark}`)
}

const q = (sql, params) => db.query(sql, params ?? [])
const one = (sql, params) => db.queryOne(sql, params ?? [])

/** Выполнить операцию, ожидая ошибку БД. Возвращает {failed, code, message}. */
async function expectDbError(fn) {
  try {
    await fn()
    return { failed: false, code: null, message: null }
  } catch (error) {
    return { failed: true, code: error?.code ?? null, message: String(error?.message ?? error) }
  }
}

const RECORD = {
  embedding: (id) => `[${Array.from({ length: 1536 }, (_, i) => (i === id ? 1 : 0)).join(',')}]`,
  /** Вектор с единственным ненулевым компонентом `id` — косинусное сходство легко посчитать. */
}

// ─── Применение схемы ─────────────────────────────────────────────────────────
const ddl = readFileSync(schemaPath, 'utf8')
await db.exec(ddl)
console.log(`Схема применена: db/sql/001_schema.sql (${ddl.length} байт)`)

// ═══════════════════════════════════════════════════════════════════════════════
group('1. Таблицы и внешние ключи (системные каталоги)')
// ═══════════════════════════════════════════════════════════════════════════════

const EXPECTED_TABLES = [
  'author_profiles',
  'comments',
  'drafts',
  'embeddings',
  'eval_results',
  'generated_responses',
  'generation_runs',
  'golden_dataset',
  'knowledge_base',
  'lint_reports',
  'posts',
  'sources',
  'tov_profiles',
  'users',
]

const tables = (await q(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
)).map((r) => r.tablename)

record(
  'Ровно 14 таблиц',
  '14 таблиц: ' + EXPECTED_TABLES.join(', '),
  `${tables.length} таблиц: ${tables.join(', ')}`,
  tables.length === 14 && EXPECTED_TABLES.every((t) => tables.includes(t)),
  tables.filter((t) => !EXPECTED_TABLES.includes(t)).length
    ? `Лишние: ${tables.filter((t) => !EXPECTED_TABLES.includes(t)).join(', ')}`
    : 'Состав совпадает',
)

// Полный перечень FK с ON DELETE. Определение берём из pg_get_constraintdef.
const fkRows = await q(
  `SELECT c.conname AS name,
          c.conrelid::regclass::text AS table_name,
          pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
    ORDER BY 2, 1`,
)

const parsedFks = fkRows.map((row) => {
  const m = /^FOREIGN KEY \((\w+)\) REFERENCES (\w+)\((\w+)\)(?: ON DELETE (CASCADE|SET NULL|NO ACTION|RESTRICT))?/.exec(
    row.definition,
  )
  if (!m) throw new Error(`Не разобрано определение FK: ${row.definition}`)
  return {
    table: row.table_name,
    column: m[1],
    refTable: m[2],
    refColumn: m[3],
    onDelete: m[4] ?? 'NO ACTION',
    constraint: row.name,
    definition: row.definition,
  }
})

console.log('\nВсе внешние ключи (фактически):')
for (const fk of parsedFks) {
  console.log(`  ${fk.table}.${fk.column} → ${fk.refTable}.${fk.refColumn} [ON DELETE ${fk.onDelete}]  (${fk.constraint})`)
}

record(
  'Количество внешних ключей',
  'по ТЗ и шапке DDL — 17',
  `${parsedFks.length} фактических FK`,
  parsedFks.length === 17,
  parsedFks.length === 17
    ? 'Совпадает с документацией'
    : `Расхождение документации и схемы: ТЗ (раздел 7) и комментарий в db/sql/001_schema.sql говорят «17 внешних ключей», фактически их ${parsedFks.length}`,
)

const EXPECTED_FKS = [
  ['author_profiles', 'user_id', 'users', 'CASCADE'],
  ['generation_runs', 'author_id', 'author_profiles', 'SET NULL'],
  ['tov_profiles', 'author_id', 'author_profiles', 'CASCADE'],
  ['tov_profiles', 'generation_run_id', 'generation_runs', 'SET NULL'],
  ['posts', 'author_id', 'author_profiles', 'CASCADE'],
  ['drafts', 'author_id', 'author_profiles', 'CASCADE'],
  ['drafts', 'published_post_id', 'posts', 'SET NULL'],
  ['lint_reports', 'draft_id', 'drafts', 'CASCADE'],
  ['lint_reports', 'generation_run_id', 'generation_runs', 'SET NULL'],
  ['sources', 'author_id', 'author_profiles', 'CASCADE'],
  ['comments', 'source_id', 'sources', 'CASCADE'],
  ['generated_responses', 'comment_id', 'comments', 'CASCADE'],
  ['generated_responses', 'generation_run_id', 'generation_runs', 'SET NULL'],
  ['knowledge_base', 'author_id', 'author_profiles', 'CASCADE'],
  ['embeddings', 'post_id', 'posts', 'CASCADE'],
  ['embeddings', 'knowledge_id', 'knowledge_base', 'CASCADE'],
  ['eval_results', 'generation_run_id', 'generation_runs', 'CASCADE'],
  ['eval_results', 'golden_id', 'golden_dataset', 'CASCADE'],
]

const actualFkSet = new Set(parsedFks.map((f) => `${f.table}.${f.column}→${f.refTable}.${f.onDelete}`))
const missingFks = EXPECTED_FKS.map((e) => `${e[0]}.${e[1]}→${e[2]}.${e[3]}`).filter((x) => !actualFkSet.has(x))
const extraFks = [...actualFkSet].filter(
  (x) => !EXPECTED_FKS.some((e) => `${e[0]}.${e[1]}→${e[2]}.${e[3]}` === x),
)

record(
  'Состав и правила ON DELETE каждого FK',
  '13 CASCADE + 5 SET NULL, состав по ТЗ (разделы 4, 7)',
  `${parsedFks.filter((f) => f.onDelete === 'CASCADE').length} CASCADE + ${
    parsedFks.filter((f) => f.onDelete === 'SET NULL').length
  } SET NULL`,
  missingFks.length === 0 && extraFks.length === 0,
  missingFks.length || extraFks.length
    ? `Отсутствуют: ${missingFks.join(', ') || '—'}; лишние: ${extraFks.join(', ') || '—'}`
    : 'Каждый FK соответствует ожиданию: SET NULL только у журнала расходов (generation_runs.*) и drafts.published_post_id',
)

// ═══════════════════════════════════════════════════════════════════════════════
group('2. Уникальные индексы и ограничения (каталог + реальные вставки)')
// ═══════════════════════════════════════════════════════════════════════════════

const indexes = await q(
  `SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' ORDER BY tablename, indexname`,
)
console.log('\nИндексы и ограничения (фактически):')
for (const ix of indexes) console.log(`  ${ix.indexdef}`)

const indexByName = new Map(indexes.map((ix) => [ix.indexname, ix.indexdef]))

function checkIndex(name, mustInclude) {
  const def = indexByName.get(name)
  const ok = Boolean(def) && mustInclude.every((frag) => def.includes(frag))
  return { ok, def: def ?? 'индекс не найден' }
}

// ── Фикстура для проверок ограничений ────────────────────────────────────────
const fxUser = await one(
  `INSERT INTO users (telegram_id, name) VALUES (920001, 'Ревизор') RETURNING id, created_at, updated_at`,
)
const fxChannel = await one(
  `INSERT INTO author_profiles (user_id, name, platform, monthly_cost_limit)
   VALUES ($1, 'Канал ревизии', 'telegram', 500) RETURNING id`,
  [fxUser.id],
)
const fxRun = await one(
  `INSERT INTO generation_runs (author_id, task_type, model, tokens_input, tokens_output, tokens, cost, status)
   VALUES ($1, 'lint', 'mock', 100, 50, 150, 0.01, 'success') RETURNING id`,
  [fxChannel.id],
)
const fxTov = await one(
  `INSERT INTO tov_profiles (author_id, tone, slang, stop_words, favorite_phrases, generation_run_id)
   VALUES ($1, 'ты', '["кринж"]'::jsonb, '["синергия"]'::jsonb, '["по делу"]'::jsonb, $2) RETURNING id`,
  [fxChannel.id, fxRun.id],
)
const fxPost = await one(
  `INSERT INTO posts (author_id, content_type, text, external_id, external_url, published_at)
   VALUES ($1, 'post', 'Первый пост для ревизии', 'ext-1', 'https://t.me/s/review/1', '2026-10-01T10:00:00Z')
   RETURNING id`,
  [fxChannel.id],
)
const fxDraft = await one(
  `INSERT INTO drafts (author_id, title, source_notes, text, status, published_post_id)
   VALUES ($1, 'Черновик', 'заметка', 'Текст черновика', 'published', $2) RETURNING id`,
  [fxChannel.id, fxPost.id],
)
const fxLint = await one(
  `INSERT INTO lint_reports (draft_id, generation_run_id, score, issues, engine)
   VALUES ($1, $2, 86, '[{"type":"cliche","quote":"в современном мире"}]'::jsonb, 'rules') RETURNING id`,
  [fxDraft.id, fxRun.id],
)
const fxSource = await one(
  `INSERT INTO sources (author_id, name, source_type, source_url)
   VALUES ($1, 'Источник', 'telegram_channel', 'https://t.me/s/review') RETURNING id`,
  [fxChannel.id],
)
const fxComment = await one(
  `INSERT INTO comments (source_id, external_id, commenter_name, text)
   VALUES ($1, 'scan-1', 'Читатель', 'А как это настроить?') RETURNING id`,
  [fxSource.id],
)
const fxResponse = await one(
  `INSERT INTO generated_responses (comment_id, response_text, status, generation_run_id)
   VALUES ($1, 'Спасибо за вопрос!', 'generated', $2) RETURNING id`,
  [fxComment.id, fxRun.id],
)
const fxKnowledge = await one(
  `INSERT INTO knowledge_base (author_id, title, content)
   VALUES ($1, 'Обо мне', 'Работаю в продуктовой аналитике с 2019 года') RETURNING id`,
  [fxChannel.id],
)
const fxEmbedding = await one(
  `INSERT INTO embeddings (post_id, chunk_index, chunk_text, embedding, model)
   VALUES ($1, 0, 'Первый пост для ревизии', $2::vector, 'text-embedding-3-small') RETURNING id`,
  [fxPost.id, RECORD.embedding(0)],
)
const fxGolden = await one(
  `INSERT INTO golden_dataset (text, labels, platform)
   VALUES ('Эталонный текст с клише в современном мире', '[{"type":"cliche","quote":"в современном мире","start":21,"end":38}]'::jsonb, 'telegram')
   RETURNING id`,
)
const fxEval = await one(
  `INSERT INTO eval_results (generation_run_id, golden_id, precision, recall)
   VALUES ($1, $2, 1.0000, 0.5000) RETURNING id`,
  [fxRun.id, fxGolden.id],
)
void fxEval
console.log(
  `\nФикстура создана: users=${fxUser.id}, author_profiles=${fxChannel.id}, tov=${fxTov.id}, posts=${fxPost.id}, ` +
    `drafts=${fxDraft.id}, lint=${fxLint.id}, sources=${fxSource.id}, comments=${fxComment.id}, ` +
    `responses=${fxResponse.id}, knowledge=${fxKnowledge.id}, embeddings=${fxEmbedding.id}, golden=${fxGolden.id}`,
)

// ── Уникальный индекс tov_profiles.author_id ─────────────────────────────────
{
  const ix = checkIndex('tov_profiles_author_id_key', ['UNIQUE', 'author_id'])
  const dup = await expectDbError(() =>
    one(
      `INSERT INTO tov_profiles (author_id, tone) VALUES ($1, 'вы') RETURNING id`,
      [fxChannel.id],
    ),
  )
  record(
    'Уникальность tov_profiles.author_id (1:1)',
    'уникальный индекс есть; второй профиль на тот же канал → ошибка 23505',
    `индекс: ${ix.def}; повторная вставка: ${dup.failed ? `ошибка ${dup.code}` : 'УСПЕШНО (плохо)'}`,
    ix.ok && dup.failed && dup.code === '23505',
    dup.message,
  )
}

// ── posts(author_id, external_id) partial unique ──────────────────────────────
{
  const ix = checkIndex('posts_author_external_id_key', [
    'UNIQUE',
    '(author_id, external_id)',
    'external_id IS NOT NULL',
  ])
  const dup = await expectDbError(() =>
    one(
      `INSERT INTO posts (author_id, content_type, text, external_id)
       VALUES ($1, 'post', 'Дубль', 'ext-1') RETURNING id`,
      [fxChannel.id],
    ),
  )
  const nullA = await one(
    `INSERT INTO posts (author_id, content_type, text) VALUES ($1, 'post', 'Без external_id #2') RETURNING id`,
    [fxChannel.id],
  )
  const nullB = await one(
    `INSERT INTO posts (author_id, content_type, text) VALUES ($1, 'post', 'Без external_id #3') RETURNING id`,
    [fxChannel.id],
  )
  record(
    'Уникальность posts (author_id, external_id) — частичный индекс',
    'дубль (author_id, external_id) → 23505; две строки с NULL external_id разрешены',
    `индекс: ${ix.def}; дубль: ${dup.failed ? `ошибка ${dup.code}` : 'УСПЕШНО (плохо)'}; ` +
      `NULL-строки вставлены: ${nullA.id}, ${nullB.id}`,
    ix.ok && dup.failed && dup.code === '23505' && Boolean(nullA.id && nullB.id),
    dup.message,
  )
}

// ── comments(source_id, external_id) ─────────────────────────────────────────
{
  const ix = checkIndex('comments_source_external_key', ['UNIQUE', '(source_id, external_id)'])
  const dup = await expectDbError(() =>
    one(
      `INSERT INTO comments (source_id, external_id, text) VALUES ($1, 'scan-1', 'Дубль') RETURNING id`,
      [fxSource.id],
    ),
  )
  record(
    'Уникальность comments (source_id, external_id) — дедупликация сканирования',
    'уникальный индекс есть; дубль → 23505',
    `индекс: ${ix.def}; повтор: ${dup.failed ? `ошибка ${dup.code}` : 'УСПЕШНО (плохо)'}`,
    ix.ok && dup.failed && dup.code === '23505',
    dup.message,
  )
}

// ── eval_results(generation_run_id, golden_id) ──────────────────────────────
{
  const ix = checkIndex('eval_results_run_golden_key', [
    'UNIQUE',
    '(generation_run_id, golden_id)',
  ])
  const dup = await expectDbError(() =>
    one(
      `INSERT INTO eval_results (generation_run_id, golden_id) VALUES ($1, $2) RETURNING id`,
      [fxRun.id, fxGolden.id],
    ),
  )
  record(
    'Уникальность eval_results (generation_run_id, golden_id)',
    'уникальное ограничение есть; повтор эталона в прогоне → 23505',
    `индекс: ${ix.def}; повтор: ${dup.failed ? `ошибка ${dup.code}` : 'УСПЕШНО (плохо)'}`,
    ix.ok && dup.failed && dup.code === '23505',
    dup.message,
  )
}

// ── drafts.published_post_id unique ─────────────────────────────────────────
{
  const ix = checkIndex('drafts_published_post_id_key', ['UNIQUE', 'published_post_id'])
  const dup = await expectDbError(() =>
    one(
      `INSERT INTO drafts (author_id, text, published_post_id) VALUES ($1, 'Второй', $2) RETURNING id`,
      [fxChannel.id, fxPost.id],
    ),
  )
  record(
    'Уникальность drafts.published_post_id',
    'один пост не может быть опубликован из двух черновиков → 23505',
    `индекс: ${ix.def}; повтор: ${dup.failed ? `ошибка ${dup.code}` : 'УСПЕШНО (плохо)'}`,
    ix.ok && dup.failed && dup.code === '23505',
    dup.message,
  )
}

// ── CHECK «ровно один владелец» у embeddings ────────────────────────────────
{
  const constraint = await one(
    `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'c' AND t.relname = 'embeddings'
        AND n.nspname = 'public' AND c.conname = 'embeddings_exactly_one_owner'`,
  )
  const both = await expectDbError(() =>
    one(
      `INSERT INTO embeddings (post_id, knowledge_id, chunk_text, embedding, model)
       VALUES ($1, $2, 'оба', $3::vector, 'm') RETURNING id`,
      [fxPost.id, fxKnowledge.id, RECORD.embedding(1)],
    ),
  )
  const neither = await expectDbError(() =>
    one(
      `INSERT INTO embeddings (chunk_text, embedding, model)
       VALUES ('ни одного', $1::vector, 'm') RETURNING id`,
      [RECORD.embedding(2)],
    ),
  )
  record(
    'CHECK embeddings_exactly_one_owner (post_id XOR knowledge_id)',
    'оба NULL и оба значения → ошибка 23514; ровно один владелец → успех',
    `определение: ${constraint?.definition ?? 'не найдено'}; оба заданы: ${
      both.failed ? `ошибка ${both.code}` : 'УСПЕШНО (плохо)'
    }; оба NULL: ${neither.failed ? `ошибка ${neither.code}` : 'УСПЕШНО (плохо)'}; ` +
      `ровно один владелец: вставка ${fxEmbedding.id} прошла`,
    Boolean(constraint) &&
      both.failed &&
      both.code === '23514' &&
      neither.failed &&
      neither.code === '23514',
    constraint?.definition,
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
group('3. HNSW-индекс и поиск по косинусному расстоянию')
// ═══════════════════════════════════════════════════════════════════════════════

{
  const hnsw = indexByName.get('embeddings_hnsw_cosine_idx')
  const hnswOk = Boolean(hnsw) && hnsw.includes('hnsw') && hnsw.includes('vector_cosine_ops')

  const knowledge2 = await one(
    `INSERT INTO knowledge_base (author_id, title, content) VALUES ($1, 'Факт A', 'Вектор A') RETURNING id`,
    [fxChannel.id],
  )
  const knowledge3 = await one(
    `INSERT INTO knowledge_base (author_id, title, content) VALUES ($1, 'Факт B', 'Вектор B') RETURNING id`,
    [fxChannel.id],
  )
  await q(
    `INSERT INTO embeddings (knowledge_id, chunk_index, chunk_text, embedding, model)
     VALUES ($1, 0, 'Вектор A', $2::vector, 'mock-embedding')`,
    [knowledge2.id, RECORD.embedding(0)],
  )
  await q(
    `INSERT INTO embeddings (knowledge_id, chunk_index, chunk_text, embedding, model)
     VALUES ($1, 0, 'Вектор B', $2::vector, 'mock-embedding')`,
    [knowledge3.id, RECORD.embedding(1)],
  )

  const search = await q(
    `SELECT knowledge_id,
            1 - (embedding <=> $1::vector) AS score
       FROM embeddings
      WHERE knowledge_id IS NOT NULL AND model = 'mock-embedding'
      ORDER BY embedding <=> $1::vector
      LIMIT 3`,
    [RECORD.embedding(0)],
  )
  const top = search[0]
  const meaningful =
    top &&
    Number(top.knowledge_id) === Number(knowledge2.id) &&
    Number(top.score) > 0.999 &&
    search.length === 2 &&
    Number(search[1].score) < 0.001

  console.log('\nРезультат векторного поиска (запрос = вектор A):')
  for (const row of search) {
    console.log(`  knowledge_id=${row.knowledge_id}  score=${Number(row.score).toFixed(6)}`)
  }

  record(
    'HNSW-индекс и осмысленный поиск `<=>`',
    'индекс embeddings_hnsw_cosine_idx (vector_cosine_ops); ближайший вектор A со score ≈ 1',
    `${hnsw ?? 'HNSW-индекс НЕ НАЙДЕН'}; ближайший: knowledge_id=${top?.knowledge_id ?? '—'} ` +
      `score=${top ? Number(top.score).toFixed(6) : '—'}`,
    hnswOk && Boolean(meaningful),
    hnswOk
      ? 'Косинусное расстояние посчитано: 1 — полное совпадение, 0 — ортогональные векторы'
      : 'Раздел 7 ТЗ требует HNSW-индекс на embeddings.embedding',
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
group('4. Триггеры: updated_at и неизменяемость lint_reports')
// ═══════════════════════════════════════════════════════════════════════════════

{
  const triggers = await q(
    `SELECT t.tgname AS name, c.relname AS table_name, t.tgenabled AS enabled
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public'
      ORDER BY c.relname, t.tgname`,
  )
  const touchTables = triggers
    .filter((t) => t.name.endsWith('_touch_updated_at'))
    .map((t) => t.table_name)
  const forbidTables = triggers
    .filter((t) => t.name.endsWith('_immutable'))
    .map((t) => t.table_name)

  const EXPECTED_TOUCH = [
    'author_profiles',
    'comments',
    'drafts',
    'generated_responses',
    'golden_dataset',
    'knowledge_base',
    'posts',
    'sources',
    'tov_profiles',
    'users',
  ]

  console.log('\nТриггеры (фактически):')
  for (const t of triggers) console.log(`  ${t.table_name}: ${t.name}`)

  record(
    'Триггеры blogos_touch_updated_at на изменяемых таблицах',
    `10 таблиц: ${EXPECTED_TOUCH.join(', ')}`,
    `${touchTables.length} таблиц: ${[...touchTables].sort().join(', ')}`,
    touchTables.length === 10 &&
      EXPECTED_TOUCH.every((t) => touchTables.includes(t)) &&
      triggers.every((t) => t.enabled !== 'D'),
    'Таблицы без updated_at (generation_runs, lint_reports, embeddings, eval_results) триггера не имеют — это верно',
  )

  record(
    'Триггер неизменяемости lint_reports',
    'BEFORE UPDATE → EXCEPTION; таблица только с триггером _immutable',
    forbidTables.length === 1 && forbidTables[0] === 'lint_reports'
      ? `blogos_forbid_update на lint_reports`
      : `триггеры _immutable: ${forbidTables.join(', ') || 'нет'}`,
    forbidTables.length === 1 && forbidTables[0] === 'lint_reports',
    triggers.map((t) => `${t.table_name}.${t.name}`).join(', '),
  )

  // Поведенческая проверка: UPDATE затирает updated_at на 2000-01-01, триггер
  // обязан вернуть now(). Если триггер не сработал — останется 2000 год.
  const fixturesForTouch = [
    ['users', fxUser.id],
    ['author_profiles', fxChannel.id],
    ['tov_profiles', fxTov.id],
    ['posts', fxPost.id],
    ['drafts', fxDraft.id],
    ['sources', fxSource.id],
    ['comments', fxComment.id],
    ['generated_responses', fxResponse.id],
    ['knowledge_base', fxKnowledge.id],
    ['golden_dataset', fxGolden.id],
  ]
  const touchFacts = []
  for (const [table, id] of fixturesForTouch) {
    const row = await one(
      `UPDATE ${table} SET updated_at = '2000-01-01T00:00:00Z' WHERE id = $1 RETURNING updated_at`,
      [id],
    )
    const when = row?.updated_at ? new Date(row.updated_at) : null
    touchFacts.push({ table, ok: Boolean(when && when.getUTCFullYear() >= 2026), value: row?.updated_at })
    if (!when || when.getUTCFullYear() < 2026) {
      console.log(`  ! ${table}: updated_at не перезаписан триггером (${String(row?.updated_at)})`)
    }
  }
  const badTouch = touchFacts.filter((f) => !f.ok)
  record(
    'Триггер реально обновляет updated_at при UPDATE',
    'после UPDATE ... SET updated_at=\'2000-01-01\' значение = now() на всех 10 таблицах',
    badTouch.length === 0
      ? `на всех 10 таблицах updated_at = ${new Date(touchFacts[0].value).getUTCFullYear()} год`
      : `не обновлено: ${badTouch.map((f) => f.table).join(', ')}`,
    badTouch.length === 0,
    touchFacts.map((f) => `${f.table}=${new Date(f.value).getUTCFullYear()}`).join(', '),
  )

  // Неизменяемость отчёта: UPDATE должен упасть с текстом про неизменяемость.
  const updateLint = await expectDbError(() =>
    q(`UPDATE lint_reports SET score = 10 WHERE id = $1`, [fxLint.id]),
  )
  const still = await one(`SELECT score FROM lint_reports WHERE id = $1`, [fxLint.id])
  record(
    'UPDATE lint_reports запрещён (история проверок — цепочка записей)',
    'UPDATE → ошибка с текстом «неизменяема»; score остался 86',
    `UPDATE: ${updateLint.failed ? updateLint.message : 'не упал (плохо)'}; score после попытки: ${still?.score}`,
    updateLint.failed &&
      /неизменяем/i.test(updateLint.message) &&
      Number(still?.score) === 86,
    updateLint.message,
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
group('5. Каскады и обнуление на реальных строках')
// ═══════════════════════════════════════════════════════════════════════════════

async function makeUserWithChannel(telegramId, label) {
  const user = await one(
    `INSERT INTO users (telegram_id, name) VALUES ($1, $2) RETURNING id`,
    [telegramId, label],
  )
  const channel = await one(
    `INSERT INTO author_profiles (user_id, name, platform) VALUES ($1, $2, 'telegram') RETURNING id`,
    [user.id, label],
  )
  return { user, channel }
}

// ── 5.1 Удаление канала обнуляет generation_runs.author_id ───────────────────
{
  const { channel } = await makeUserWithChannel(930001, 'Каскад: канал')
  const run = await one(
    `INSERT INTO generation_runs (author_id, task_type, model, status)
     VALUES ($1, 'tov_analyze', 'mock', 'success') RETURNING id`,
    [channel.id],
  )
  await q(`DELETE FROM author_profiles WHERE id = $1`, [channel.id])
  const after = await one(
    `SELECT id, author_id FROM generation_runs WHERE id = $1`,
    [run.id],
  )
  record(
    'Удаление канала: generation_runs.author_id → NULL, строка сохранена',
    'запись журнала расходов существует, author_id = null (ТЗ, раздел 4)',
    after
      ? `запись id=${after.id} существует, author_id=${after.author_id === null ? 'null' : after.author_id}`
      : 'запись УДАЛЕНА (плохо)',
    Boolean(after) && after.author_id === null,
  )
}

// ── 5.2 Удаление поста обнуляет drafts.published_post_id ────────────────────
{
  const { channel } = await makeUserWithChannel(930002, 'Каскад: пост')
  const post = await one(
    `INSERT INTO posts (author_id, content_type, text) VALUES ($1, 'post', 'Опубликованный пост') RETURNING id`,
    [channel.id],
  )
  const draft = await one(
    `INSERT INTO drafts (author_id, text, status, published_post_id)
     VALUES ($1, 'Текст', 'published', $2) RETURNING id`,
    [channel.id, post.id],
  )
  await q(`DELETE FROM posts WHERE id = $1`, [post.id])
  const after = await one(
    `SELECT id, published_post_id, status FROM drafts WHERE id = $1`,
    [draft.id],
  )
  record(
    'Удаление поста: drafts.published_post_id → NULL, черновик сохранён',
    'черновик существует, published_post_id = null (ТЗ, раздел 4)',
    after
      ? `черновик id=${after.id} существует, status=${after.status}, published_post_id=${
          after.published_post_id === null ? 'null' : after.published_post_id
        }`
      : 'черновик УДАЛЁН (плохо)',
    Boolean(after) && after.published_post_id === null,
  )
}

// ── 5.3 Удаление users каскадит каналы и всё под ними ───────────────────────
{
  const { user, channel } = await makeUserWithChannel(930003, 'Каскад: пользователь')
  await one(
    `INSERT INTO tov_profiles (author_id, tone) VALUES ($1, 'ты') RETURNING id`,
    [channel.id],
  )
  await one(
    `INSERT INTO posts (author_id, content_type, text) VALUES ($1, 'post', 'Пост') RETURNING id`,
    [channel.id],
  )
  const draft = await one(
    `INSERT INTO drafts (author_id, text) VALUES ($1, 'Черновик') RETURNING id`,
    [channel.id],
  )
  await one(
    `INSERT INTO lint_reports (draft_id, score) VALUES ($1, 70) RETURNING id`,
    [draft.id],
  )
  const source = await one(
    `INSERT INTO sources (author_id, name, source_type, source_url)
     VALUES ($1, 'Источник', 'telegram_channel', 'https://t.me/s/cascade') RETURNING id`,
    [channel.id],
  )
  const comment = await one(
    `INSERT INTO comments (source_id, external_id, text) VALUES ($1, 'c1', 'Комментарий') RETURNING id`,
    [source.id],
  )
  await one(
    `INSERT INTO generated_responses (comment_id, response_text) VALUES ($1, 'Ответ') RETURNING id`,
    [comment.id],
  )
  const knowledge = await one(
    `INSERT INTO knowledge_base (author_id, title, content) VALUES ($1, 'Факт', 'Содержание') RETURNING id`,
    [channel.id],
  )
  await one(
    `INSERT INTO embeddings (knowledge_id, chunk_text, embedding, model)
     VALUES ($1, 'Факт', $2::vector, 'mock') RETURNING id`,
    [knowledge.id, RECORD.embedding(0)],
  )
  const run = await one(
    `INSERT INTO generation_runs (author_id, task_type, model, status)
     VALUES ($1, 'lint', 'mock', 'success') RETURNING id`,
    [channel.id],
  )

  await q(`DELETE FROM users WHERE id = $1`, [user.id])

  const counts = await one(
    `SELECT
       (SELECT count(*)::int FROM author_profiles WHERE user_id = $1) AS channels,
       (SELECT count(*)::int FROM tov_profiles WHERE author_id = $2) AS tov,
       (SELECT count(*)::int FROM posts WHERE author_id = $2) AS posts,
       (SELECT count(*)::int FROM drafts WHERE author_id = $2) AS drafts,
       (SELECT count(*)::int FROM lint_reports WHERE draft_id = $3) AS lints,
       (SELECT count(*)::int FROM sources WHERE author_id = $2) AS sources,
       (SELECT count(*)::int FROM comments WHERE source_id = $4) AS comments,
       (SELECT count(*)::int FROM generated_responses WHERE comment_id = $5) AS responses,
       (SELECT count(*)::int FROM knowledge_base WHERE author_id = $2) AS knowledge,
       (SELECT count(*)::int FROM embeddings WHERE knowledge_id = $6) AS embeddings,
       (SELECT count(*)::int FROM generation_runs WHERE id = $7) AS runs`,
    [user.id, channel.id, draft.id, source.id, comment.id, knowledge.id, run.id],
  )
  const expectedZero = ['channels', 'tov', 'posts', 'drafts', 'lints', 'sources', 'comments', 'responses', 'knowledge', 'embeddings']
  const allZero = expectedZero.every((k) => Number(counts[k]) === 0)
  record(
    'Удаление users каскадит каналы и всё содержимое канала',
    'channels/tov/posts/drafts/lints/sources/comments/responses/knowledge/embeddings = 0; generation_runs остаются (author_id=null)',
    JSON.stringify(counts),
    allZero && Number(counts.runs) === 1,
    'Журнал расходов отделён от личных записей — как требует ТЗ, раздел 4',
  )
}

// ── 5.4 Удаление черновика каскадит lint_reports ────────────────────────────
{
  const { channel } = await makeUserWithChannel(930004, 'Каскад: черновик')
  const draft = await one(
    `INSERT INTO drafts (author_id, text) VALUES ($1, 'Черновик') RETURNING id`,
    [channel.id],
  )
  await one(`INSERT INTO lint_reports (draft_id, score) VALUES ($1, 80) RETURNING id`, [draft.id])
  await one(`INSERT INTO lint_reports (draft_id, score) VALUES ($1, 90) RETURNING id`, [draft.id])
  await q(`DELETE FROM drafts WHERE id = $1`, [draft.id])
  const left = await one(
    `SELECT count(*)::int AS n FROM lint_reports WHERE draft_id = $1`,
    [draft.id],
  )
  record(
    'Удаление черновика каскадит lint_reports',
    'после DELETE drafts отчётов по черновику — 0',
    `осталось отчётов: ${left.n}`,
    Number(left.n) === 0,
  )
}

// ── 5.5 Дополнительно: source → comments/responses, knowledge → embeddings ──
{
  const { channel } = await makeUserWithChannel(930005, 'Каскад: источник/знания')
  const source = await one(
    `INSERT INTO sources (author_id, name, source_type, source_url)
     VALUES ($1, 'S', 'telegram_channel', 'https://t.me/s/s') RETURNING id`,
    [channel.id],
  )
  const comment = await one(
    `INSERT INTO comments (source_id, external_id, text) VALUES ($1, 'x1', 'К') RETURNING id`,
    [source.id],
  )
  await one(
    `INSERT INTO generated_responses (comment_id, response_text) VALUES ($1, 'О') RETURNING id`,
    [comment.id],
  )
  const knowledge = await one(
    `INSERT INTO knowledge_base (author_id, title, content) VALUES ($1, 'T', 'C') RETURNING id`,
    [channel.id],
  )
  await one(
    `INSERT INTO embeddings (knowledge_id, chunk_text, embedding, model)
     VALUES ($1, 'C', $2::vector, 'mock') RETURNING id`,
    [knowledge.id, RECORD.embedding(3)],
  )

  await q(`DELETE FROM sources WHERE id = $1`, [source.id])
  const afterSource = await one(
    `SELECT
       (SELECT count(*)::int FROM comments WHERE source_id = $1) AS comments,
       (SELECT count(*)::int FROM generated_responses WHERE comment_id = $2) AS responses`,
    [source.id, comment.id],
  )
  await q(`DELETE FROM knowledge_base WHERE id = $1`, [knowledge.id])
  const afterKnowledge = await one(
    `SELECT count(*)::int AS embeddings FROM embeddings WHERE knowledge_id = $1`,
    [knowledge.id],
  )
  record(
    'Удаление source и knowledge_base каскадит зависимые записи',
    'source → comments=0, responses=0; knowledge_base → embeddings=0',
    `source: ${JSON.stringify(afterSource)}; knowledge: ${JSON.stringify(afterKnowledge)}`,
    Number(afterSource.comments) === 0 &&
      Number(afterSource.responses) === 0 &&
      Number(afterKnowledge.embeddings) === 0,
  )
}

// ── 5.6 Дополнительно: generation_runs → SET NULL, eval_results → CASCADE ───
{
  const { channel } = await makeUserWithChannel(930006, 'Каскад: прогон')
  const draft = await one(
    `INSERT INTO drafts (author_id, text) VALUES ($1, 'Черновик') RETURNING id`,
    [channel.id],
  )
  const run = await one(
    `INSERT INTO generation_runs (author_id, task_type, model, status)
     VALUES ($1, 'lint', 'mock', 'success') RETURNING id`,
    [channel.id],
  )
  await one(
    `INSERT INTO lint_reports (draft_id, generation_run_id, score) VALUES ($1, $2, 50) RETURNING id`,
    [draft.id, run.id],
  )
  const golden = await one(
    `INSERT INTO golden_dataset (text) VALUES ('Эталон') RETURNING id`,
  )
  await one(
    `INSERT INTO eval_results (generation_run_id, golden_id) VALUES ($1, $2) RETURNING id`,
    [run.id, golden.id],
  )
  const del = await expectDbError(() => q(`DELETE FROM generation_runs WHERE id = $1`, [run.id]))
  const lint = await one(
    `SELECT generation_run_id FROM lint_reports WHERE draft_id = $1`,
    [draft.id],
  )
  const evals = await one(
    `SELECT count(*)::int AS n FROM eval_results WHERE generation_run_id = $1`,
    [run.id],
  )
  record(
    'Удаление generation_runs: ссылки обнуляются, eval_results каскадятся',
    'DELETE прогона проходит; lint_reports.generation_run_id = null; eval_results прогона = 0',
    del.failed
      ? `DELETE прогона УПАЛ: ${del.code} — ${del.message}; ссылка в lint_reports осталась ${
          lint?.generation_run_id === null ? 'null' : lint?.generation_run_id
        }, eval_results=${evals.n}`
      : `DELETE прошёл; lint_reports.generation_run_id=${
          lint?.generation_run_id === null ? 'null' : lint?.generation_run_id
        }; eval_results=${evals.n}`,
    !del.failed && lint?.generation_run_id === null && Number(evals.n) === 0,
    del.failed
      ? 'ДЕФЕКТ СХЕМЫ: lint_reports.generation_run_id объявлен ON DELETE SET NULL, но BEFORE UPDATE-триггер неизменяемости запрещает этот UPDATE — удаление прогона, на который ссылается отчёт, невозможно (P0001)'
      : undefined,
  )

  // Тот же SET NULL, но без ссылки из lint_reports: удаление прогона обязано пройти.
  const run2 = await one(
    `INSERT INTO generation_runs (author_id, task_type, model, status)
     VALUES ($1, 'tov_analyze', 'mock', 'success') RETURNING id`,
    [channel.id],
  )
  await one(
    `INSERT INTO tov_profiles (author_id, tone, generation_run_id) VALUES ($1, 'вы', $2)
     ON CONFLICT (author_id) DO UPDATE SET generation_run_id = EXCLUDED.generation_run_id
     RETURNING id`,
    [channel.id, run2.id],
  )
  const del2 = await expectDbError(() => q(`DELETE FROM generation_runs WHERE id = $1`, [run2.id]))
  const tov = await one(
    `SELECT generation_run_id FROM tov_profiles WHERE author_id = $1`,
    [channel.id],
  )
  record(
    'SET NULL работает там, где нет неперезаписываемой таблицы',
    'удаление прогона, на который ссылается только tov_profiles, проходит; ссылка → null',
    del2.failed
      ? `DELETE УПАЛ: ${del2.message}`
      : `DELETE прошёл; tov_profiles.generation_run_id=${
          tov?.generation_run_id === null ? 'null' : tov?.generation_run_id
        }`,
    !del2.failed && tov?.generation_run_id === null,
    del2.message,
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
group('6. Идемпотентность DDL и служебные каталоги')
// ═══════════════════════════════════════════════════════════════════════════════

{
  let reapplyError = null
  try {
    await db.exec(ddl) // повторное применение того же файла
  } catch (error) {
    reapplyError = String(error?.message ?? error)
  }
  const after = await one(
    `SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables,
            (SELECT count(*)::int FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
              JOIN pg_namespace n ON n.oid=t.relnamespace
              WHERE c.contype='f' AND n.nspname='public') AS fks`,
  )
  record(
    'Повторное применение db/sql/001_schema.sql (идемпотентность)',
    'повторный запуск не падает; 14 таблиц и 18 FK остаются',
    reapplyError ? `ошибка: ${reapplyError}` : `повторный запуск прошёл: ${JSON.stringify(after)}`,
    !reapplyError && Number(after.tables) === 14 && Number(after.fks) === 18,
    reapplyError ?? undefined,
  )
}

// ─── Итог ─────────────────────────────────────────────────────────────────────
await db.closeDb()

const failed = results.filter((r) => !r.ok)
console.log(`\n${'═'.repeat(78)}\nИТОГ: проверок ${results.length}, пройдено ${results.length - failed.length}, провалено ${failed.length}`)
for (const f of failed) console.log(`  ✗ ${f.group} · ${f.name}: ожидание ${f.expected}; факт ${f.actual}`)
console.log('═'.repeat(78))

if (failed.length > 0) process.exitCode = 1
