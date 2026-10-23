/**
 * Сброс базы: DROP SCHEMA public CASCADE → CREATE SCHEMA public → миграции.
 *
 *   npm run db:reset
 *
 * ВАЖНО: применение миграций вынесено в src/migrations.ts и вызывается
 * напрямую — child_process.spawn в песочнице запрещён (EPERM).
 * vector-расширение пересоздаётся вместе со схемой.
 */
import { exec, closeDb } from '../src/db.ts'
import { applyMigrations } from '../src/migrations.ts'
import { env } from '../src/env.ts'

async function main(): Promise<void> {
  const shown = env.DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')
  console.log(`Сброс базы: ${shown}`)

  // Сначала снимаем зависимые от vector таблицы/индексы, затем схему.
  await exec('DROP EXTENSION IF EXISTS vector CASCADE')
  await exec('DROP SCHEMA public CASCADE')
  await exec('CREATE SCHEMA public')
  await exec('CREATE EXTENSION IF NOT EXISTS vector')

  const result = await applyMigrations({ log: (line) => console.log(line) })
  console.log(`Готово: схема пересоздана, таблиц в базе: ${result.tables}`)
}

main()
  .catch((error) => {
    console.error('\nСброс не выполнен:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
