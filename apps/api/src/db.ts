/**
 * Слой доступа к PostgreSQL. Два драйвера под одним интерфейсом:
 *
 *   DATABASE_URL=postgresql://…  → node-postgres (Neon, Render, Docker, любой managed-PG)
 *   DATABASE_URL=pglite://…      → PGlite: PostgreSQL 16 + pgvector, собранный в WASM
 *
 * Зачем второй драйвер: проверяющему и демонстрации нужен запуск одной командой,
 * без Docker, без сети и без внешней базы. PGlite — это тот же сервер PostgreSQL,
 * а не эмуляция: те же типы, ограничения, триггеры, `vector(1536)` и HNSW-индексы.
 * Продакшен-путь остаётся обычным PostgreSQL — код репозиториев одинаков.
 *
 * ORM не используется (docs/DECISIONS.md, решение № 16): схема — это DDL в db/sql,
 * а векторный поиск живёт только в сыром SQL.
 */
import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { vector as pgliteVector } from '@electric-sql/pglite/vector'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { env } from './env.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

export type QueryParam = string | number | boolean | null | undefined | bigint | object
export type DbKind = 'pg' | 'pglite'

export interface Tx {
  query<U = Record<string, unknown>>(sql: string, params?: QueryParam[]): Promise<U[]>
  queryOne<U = Record<string, unknown>>(sql: string, params?: QueryParam[]): Promise<U | null>
  /** Несколько операторов без параметров (DDL, миграции) — простой протокол. */
  exec(sql: string): Promise<void>
}

const { Pool, types } = pg

// ─── Приведение типов: одинаковое для обоих драйверов ──────────────────────────
const OID = { INT8: 20, NUMERIC: 1700, INT4: 23, INT2: 21 } as const

// pg: числовые парсеры — как в PGlite-адаптере ниже.
types.setTypeParser(OID.NUMERIC, (value: string) => Number(value))
types.setTypeParser(OID.INT8, (value: string) => {
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : value
})

/** Значения из PGlite приводим по OID так же, как парсеры pg. */
function normalizePgliteRow(
  row: Record<string, unknown>,
  fields: Array<{ name: string; dataTypeID: number }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const value = row[field.name]
    if (value === null || value === undefined) {
      out[field.name] = value
      continue
    }
    if (field.dataTypeID === OID.INT8) {
      const n = typeof value === 'bigint' ? Number(value) : Number(value as number)
      out[field.name] = Number.isSafeInteger(n) ? n : String(value)
    } else if (field.dataTypeID === OID.NUMERIC) {
      out[field.name] = typeof value === 'string' ? Number(value) : Number(value)
    } else {
      out[field.name] = value
    }
  }
  return out
}

/** bigint-параметры отправляем строкой: драйверы понимают это одинаково. */
function normalizeParams(params: QueryParam[]): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null
    if (typeof p === 'bigint') return String(p)
    return p
  })
}

// ─── Состояние драйвера ────────────────────────────────────────────────────────
function pgliteDataDir(): string | null {
  const raw = env.DATABASE_URL
  if (!raw.startsWith('pglite://')) return null
  const rest = raw.slice('pglite://'.length).replace(/^\/+/, '')
  if (rest === '' || rest === 'memory' || rest === ':memory:') return null
  // Путь относительный — считаем от корня монорепо, чтобы запуск из любой папки работал.
  return resolve(repoRoot, rest)
}

export const dbKind: DbKind = env.DATABASE_URL.startsWith('pglite://') ? 'pglite' : 'pg'

let pool: pg.Pool | null = null
let pglite: PGlite | null = null
let initPromise: Promise<void> | null = null

async function init(): Promise<void> {
  if (dbKind === 'pg') {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.NODE_ENV === 'test' ? 4 : 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: /localhost|127\.0\.0\.1/.test(env.DATABASE_URL) ? undefined : { rejectUnauthorized: false },
    })
    pool.on('error', (err) => console.error('[db] ошибка простаивающего соединения:', err.message))
    return
  }
  const dataDir = pgliteDataDir()
  pglite = new PGlite(dataDir ? { dataDir, extensions: { vector: pgliteVector } } : { extensions: { vector: pgliteVector } })
  await pglite.waitReady
  // Локальная база создаётся пустой: расширение включается сразу, схема — миграциями.
  await pglite.exec('CREATE EXTENSION IF NOT EXISTS vector;')
}

export function ready(): Promise<void> {
  if (!initPromise) initPromise = init()
  return initPromise
}

/**
 * Очередь на PGlite: у WASM-сервера одно соединение, параллельные транзакции
 * иначе перемешались бы. У обычного PostgreSQL соединения берутся из пула.
 */
let pgliteLock: Promise<unknown> = Promise.resolve()

function withPgliteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = pgliteLock.then(fn, fn)
  pgliteLock = run.catch(() => {})
  return run
}

async function rawQuery(sql: string, params: QueryParam[]): Promise<Record<string, unknown>[]> {
  await ready()
  const values = normalizeParams(params)

  if (dbKind === 'pg') {
    const result = await pool!.query(sql, values)
    return result.rows as Record<string, unknown>[]
  }

  return withPgliteLock(async () => {
    const result = await pglite!.query(sql, values as never[])
    return result.rows.map((row, index) =>
      normalizePgliteRow(row as Record<string, unknown>, result.fields),
    )
  })
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: QueryParam[] = [],
): Promise<T[]> {
  return (await rawQuery(sql, params)) as T[]
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: QueryParam[] = [],
): Promise<T | null> {
  const rows = await rawQuery(sql, params)
  return (rows[0] as T) ?? null
}

/** Выполнить несколько операторов без параметров (DDL, миграции). */
export async function exec(sql: string): Promise<void> {
  await ready()
  if (dbKind === 'pg') {
    await pool!.query(sql)
    return
  }
  await withPgliteLock(async () => {
    await pglite!.exec(sql)
  })
}

export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  await ready()

  if (dbKind === 'pg') {
    const client = await pool!.connect()
    try {
      await client.query('BEGIN')
      const tx: Tx = {
        async query<U>(sql: string, params: QueryParam[] = []): Promise<U[]> {
          const r = await client.query(sql, normalizeParams(params))
          return r.rows as U[]
        },
        async queryOne<U>(sql: string, params: QueryParam[] = []): Promise<U | null> {
          const r = await client.query(sql, normalizeParams(params))
          return (r.rows[0] as U) ?? null
        },
        async exec(sql: string): Promise<void> {
          await client.query(sql)
        },
      }
      const result = await fn(tx)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  return withPgliteLock(async () => {
    await pglite!.exec('BEGIN')
    try {
      const tx: Tx = {
        async query<U>(sql: string, params: QueryParam[] = []): Promise<U[]> {
          const r = await pglite!.query(sql, normalizeParams(params) as never[])
          return r.rows.map((row, i) => normalizePgliteRow(row as Record<string, unknown>, r.fields)) as U[]
        },
        async queryOne<U>(sql: string, params: QueryParam[] = []): Promise<U | null> {
          const r = await pglite!.query(sql, normalizeParams(params) as never[])
          const rows = r.rows.map((row) => normalizePgliteRow(row as Record<string, unknown>, r.fields))
          return (rows[0] as U) ?? null
        },
        async exec(sql: string): Promise<void> {
          await pglite!.exec(sql)
        },
      }
      const result = await fn(tx)
      await pglite!.exec('COMMIT')
      return result
    } catch (error) {
      await pglite!.exec('ROLLBACK').catch(() => {})
      throw error
    }
  })
}

/** int8 приходит числом, если влезает в 2^53, иначе строкой — отдаём как есть. */
export function toId(value: unknown): number | string {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : value
  }
  return String(value)
}

/** numeric → number: для денег, precision и recall. */
export function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
  if (pglite) {
    await pglite.close()
    pglite = null
  }
  initPromise = null
}

export async function pingDb(): Promise<boolean> {
  try {
    await query('SELECT 1 AS ok')
    return true
  } catch {
    return false
  }
}
