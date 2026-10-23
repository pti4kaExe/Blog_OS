/**
 * Подсчёт зарегистрированных доменных маршрутов: контракт требует ровно 59.
 *
 *   npm run routes
 *
 * Проверка программная, а не по числу строк в файлах: маршрут считается один
 * раз по паре (метод, путь) после снятия алиаса /api/v1. Служебные `/health`,
 * `/` и wildcard не входят в 59.
 */
import { buildApp } from '../src/app.ts'
import { closeDb } from '../src/db.ts'

const app = await buildApp()

const normalize = (url: string): string => {
  const stripped = url.replace(/^\/api\/v1(?=\/|$)/, '')
  return stripped === '' ? '/' : stripped
}

const service = new Set(['/health', '/', '/*', '*'])

const registered = app.routeList.filter((route) => !service.has(route.url))
const unique = new Set(registered.map((route) => `${route.method} ${normalize(route.url)}`))
const rootCount = registered.filter((route) => !route.url.startsWith('/api/v1')).length
const aliasCount = registered.filter((route) => route.url.startsWith('/api/v1')).length

console.log(`Доменных маршрутов (уникальных): ${unique.size}`)
console.log(`Регистраций в корне: ${rootCount}`)
console.log(`Регистраций с префиксом /api/v1: ${aliasCount}`)
console.log(`Всего маршрутов с алиасами: ${registered.length}`)

if (unique.size !== 59) {
  console.error(`\nОШИБКА: ожидалось 59 доменных методов, зарегистрировано ${unique.size}`)
  console.error(
    [...unique]
      .sort()
      .map((route) => `  ${route}`)
      .join('\n'),
  )
  process.exitCode = 1
}
if (rootCount !== 59 || aliasCount !== 59) {
  console.error(
    `\nОШИБКА: каждый метод должен быть доступен и в корне, и по /api/v1 (${rootCount}/${aliasCount})`,
  )
  process.exitCode = 1
}

await app.close()
await closeDb()
