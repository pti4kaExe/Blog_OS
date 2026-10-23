/**
 * Проверка контракта сервера без сети и без фоновых процессов:
 *   - применяет миграции на чистой in-memory базе;
 *   - собирает приложение;
 *   - считает зарегистрированные доменные методы (по ТЗ — 59 в корне
 *     и столько же под алиасом /api/v1);
 *   - дёргает /health и несколько ключевых методов через app.inject().
 *
 *   node scripts/check-api.mjs
 */
process.env.DATABASE_URL ??= 'pglite://memory'
process.env.LOG_LEVEL ??= 'silent'
process.env.NODE_ENV ??= 'test'

const { applyMigrations } = await import('../apps/api/src/migrations.ts')
const { buildApp } = await import('../apps/api/src/app.ts')
const { closeDb } = await import('../apps/api/src/db.ts')

const migration = await applyMigrations()
console.log(`миграции: применено файлов — ${migration.applied?.length ?? 0}`)

const app = await buildApp()

/**
 * Fastify печатает дерево маршрутов. Чтобы посчитать «доменные методы»
 * (путь + метод, без HEAD, без /health и корня /), восстанавливаем полный путь
 * по отступу каждой строки: узел — сегмент пути, вложенность — глубина.
 */
const tree = app.printRoutes({ commonPrefix: false })
const lines = tree.split('\n')

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function parseTree(text) {
  const routes = []
  const stack = []
  for (const raw of text.split('\n')) {
    const match = raw.match(/^((?:│   |    )*)(?:├── |└── )(.+)$/)
    if (!match) continue
    const depth = match[1].length / 4 + 1
    const node = match[2].trim()
    const pathPart = node.replace(/\s*\([^)]*\)\s*$/, '').trim()
    const methodsMatch = node.match(/\(([^)]+)\)\s*$/)
    stack[depth] = pathPart
    stack.length = depth + 1

    const segments = []
    for (let level = 1; level <= depth; level++) {
      const segment = (stack[level] ?? '').replace(/^\//, '')
      if (segment) segments.push(segment)
    }
    const path = '/' + segments.join('/')

    if (!methodsMatch) continue
    const methods = methodsMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter((m) => HTTP_METHODS.includes(m))
    for (const method of methods) routes.push({ method, path })
  }
  return routes
}

const routes = parseTree(tree)
const domainRoutes = routes.filter(
  (r) => !r.path.startsWith('/api/v1') && r.path !== '/health' && r.path !== '/',
)
const aliasRoutes = routes.filter((r) => r.path.startsWith('/api/v1'))

console.log(`маршрутов всего: ${routes.length}`)
console.log(`доменных в корне: ${domainRoutes.length} (по контракту 59)`)
console.log(`алиас /api/v1: ${aliasRoutes.length}`)

const groups = new Map()
for (const route of domainRoutes) {
  const first = route.path.split('/')[1] ?? '(корень)'
  const key = first.startsWith(':') ? 'users/auth' : first
  groups.set(key, (groups.get(key) ?? 0) + 1)
}
console.log('по группам путей:')
for (const [key, value] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${String(value).padStart(2)}  /${key}`)
}

const rootMethods = domainRoutes.length

const health = await app.inject({ method: 'GET', url: '/health' })
console.log('GET /health →', health.statusCode, health.body)

const unauthorized = await app.inject({ method: 'GET', url: '/users/me' })
console.log('GET /users/me без токена →', unauthorized.statusCode)

const login = await app.inject({
  method: 'POST',
  url: '/auth/telegram',
  payload: { telegram_id: 100500, name: 'Проверка' },
})
console.log('POST /auth/telegram (dev-вход) →', login.statusCode)

const aliasHealth = await app.inject({ method: 'GET', url: '/api/v1/users/me' })
console.log('GET /api/v1/users/me (алиас, без токена) →', aliasHealth.statusCode)

await app.close()
await closeDb()

if (rootMethods !== 59) {
  console.error(`\nРАСХОЖДЕНИЕ: методов ${rootMethods}, по контракту 59`)
  process.exitCode = 1
} else {
  console.log('\nКонтракт выполнен: 59 доменных методов.')
}
