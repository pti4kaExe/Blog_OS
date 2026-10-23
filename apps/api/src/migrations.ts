/**
 * Применение SQL-миграций из db/sql по порядку имён файлов.
 *
 * Единственный путь создания схемы: DDL не дублируется ни в ORM, ни в initdb
 * Docker-контейнера. Уже применённые файлы записываются в _migrations
 * и повторно не выполняются; сами файлы тоже идемпотентны.
 *
 * Вынесено из CLI (scripts/migrate.ts), потому что child_process.spawn в
 * песочнице запрещён: reset и тесты вызывают applyMigrations() напрямую.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { query, ready, transaction } from './db.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const sqlDir = resolve(here, '../../../db/sql')

export interface MigrationResult {
  applied: string[]
  skipped: string[]
  tables: number
}

export interface MigrationOptions {
  log?: (line: string) => void
}

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

export async function applyMigrations(options: MigrationOptions = {}): Promise<MigrationResult> {
  const log = options.log ?? (() => undefined)
  await ready()
  await ensureMigrationsTable()

  const files = readdirSync(sqlDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    log('В db/sql нет .sql-файлов — нечего применять')
    return { applied: [], skipped: [], tables: await tablesCount() }
  }

  const applied = await query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM _migrations',
  )
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]))

  const result: MigrationResult = { applied: [], skipped: [], tables: 0 }

  for (const file of files) {
    const sql = readFileSync(join(sqlDir, file), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const previous = appliedByName.get(file)

    if (previous === checksum) {
      result.skipped.push(file)
      log(`  = ${file} — уже применён`)
      continue
    }
    if (previous !== undefined && previous !== checksum) {
      log(
        `  ! ${file} — файл изменился после применения. Скрипт идемпотентен, ` +
          'но новые ограничения могли не создаться; для чистой базы используйте db:reset',
      )
    }

    log(`  + ${file} …`)
    await transaction(async (tx) => {
      await tx.exec(sql)
      await tx.query(
        `INSERT INTO _migrations (name, checksum) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
        [file, checksum],
      )
    })
    result.applied.push(file)
    log(`  + ${file} — готово`)
  }

  result.tables = await tablesCount()
  return result
}

async function tablesCount(): Promise<number> {
  const rows = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_migrations'`,
  )
  return Number(rows[0]?.count ?? 0)
}
