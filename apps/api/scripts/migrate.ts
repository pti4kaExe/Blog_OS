/**
 * Применение SQL-миграций из db/sql по порядку имён файлов.
 *
 *   npm run db:migrate
 *
 * Единственный путь создания схемы: DDL не дублируется ни в ORM, ни в initdb
 * Docker-контейнера. Уже применённые файлы записываются в _migrations
 * и повторно не выполняются; сами файлы тоже идемпотентны.
 *
 * Работает и на PostgreSQL (Neon/Docker), и на PGlite — драйвер выбирается
 * по DATABASE_URL, см. src/db.ts.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { query, transaction, closeDb, dbKind } from '../src/db.ts'
import { env } from '../src/env.ts'

const here = dirname(fileURLToPath(import.meta.url))
const sqlDir = resolve(here, '../../../db/sql')

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

async function main(): Promise<void> {
  const shown = env.DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')
  console.log(`Драйвер: ${dbKind} · база: ${shown}`)
  await ensureMigrationsTable()

  const files = readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('В db/sql нет .sql-файлов — нечего применять')
    return
  }

  const applied = await query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM _migrations',
  )
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]))

  let count = 0
  for (const file of files) {
    const sql = readFileSync(join(sqlDir, file), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    const previous = appliedByName.get(file)

    if (previous === checksum) {
      console.log(`  = ${file} — уже применён`)
      continue
    }
    if (previous !== undefined && previous !== checksum) {
      console.warn(
        `  ! ${file} — файл изменился после применения. Скрипт идемпотентен, ` +
          'но новые ограничения могли не создаться; для чистой базы используйте npm run db:reset',
      )
    }

    process.stdout.write(`  + ${file} … `)
    try {
      await transaction(async (tx) => {
        await tx.exec(sql)
        await tx.query(
          `INSERT INTO _migrations (name, checksum) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
          [file, checksum],
        )
      })
      console.log('готово')
      count++
    } catch (error) {
      console.log('ошибка')
      throw error
    }
  }

  const tables = await query<{ count: string | number }>(
    `SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name <> '_migrations'`,
  )
  console.log(
    count === 0
      ? `Схема актуальна. Таблиц в базе: ${tables[0]?.count ?? 0}`
      : `Применено файлов: ${count}. Таблиц в базе: ${tables[0]?.count ?? 0}`,
  )
}

main()
  .catch((error) => {
    console.error('\nМиграция не применена:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
