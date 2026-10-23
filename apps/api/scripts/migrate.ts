/**
 * Тонкий CLI миграций: применение SQL из db/sql.
 *
 *   npm run db:migrate
 *
 * Вся логика — в src/migrations.ts: эта же функция используется reset.ts
 * и тестами (spawn в песочнице недоступен).
 */
import { applyMigrations } from '../src/migrations.ts'
import { closeDb, dbKind } from '../src/db.ts'
import { env } from '../src/env.ts'

try {
  const shown = env.DATABASE_URL.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@')
  console.log(`Драйвер: ${dbKind} · база: ${shown}`)
  const result = await applyMigrations({ log: (line) => console.log(line) })
  console.log(
    result.applied.length === 0
      ? `Схема актуальна. Таблиц в базе: ${result.tables}`
      : `Применено файлов: ${result.applied.length}. Таблиц в базе: ${result.tables}`,
  )
} catch (error) {
  console.error('\nМиграция не применена:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await closeDb()
}
