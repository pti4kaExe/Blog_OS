/**
 * Serverless-вход для Vercel.
 *
 * Vercel не держит постоянный процесс: каждый вызов — это (req, res) Node-стиля.
 * Fastify создаёт экземпляр один раз на «тёплый» инстанс и дальше обслуживает
 * запросы через app.server.emit('request', req, res) — это официальный приём
 * Fastify для serverless-платформ.
 *
 * Плюс к Render здесь нет сна: функции стартуют за доли секунды, поэтому
 * «долгая загрузка» исчезает как класс.
 */
import { timingSafeEqual } from 'node:crypto'
import { buildApp } from '../apps/api/dist/app.js'
import { applyMigrations } from '../apps/api/dist/migrations.js'
import { registerWebhook } from '../apps/api/dist/services/telegramBot.js'

let appPromise = null

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const app = await buildApp()
      await app.ready()
      // Миграции — только если включены явно: на serverless это делается один раз
      // при первом холодном старте. Удобнее вызвать POST /internal/migrate.
      if (process.env.RUN_MIGRATIONS_ON_START === '1') {
        const result = await applyMigrations()
        if (result.applied?.length) {
          app.log.info(`миграции на старте: ${result.applied.length}`)
        }
      }
      return app
    })()
  }
  return appPromise
}

/** Сравнение секрета без утечки по времени. */
function sameSecret(provided, expected) {
  if (!provided || !expected) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(String(expected))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Внутренние операции, которых нет в публичном контракте:
 *   POST /internal/migrate — применить db/sql (нужно один раз после переезда);
 *   POST /internal/register-webhook — зарегистрировать webhook бота на этот домен.
 * Обе доступны только с заголовком x-internal-token = MIGRATE_TOKEN.
 */
async function internalRoute(req) {
  const token = process.env.MIGRATE_TOKEN
  const provided = req.headers['x-internal-token']
  if (!sameSecret(provided, token)) return null
  if (req.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } }

  const url = String(req.url || '')
  if (url.startsWith('/internal/migrate')) {
    const result = await applyMigrations({ log: (line) => console.log(line) })
    return {
      status: 200,
      body: { applied: result.applied, skipped: result.skipped.length, tables: result.tables },
    }
  }
  if (url.startsWith('/internal/register-webhook')) {
    await registerWebhook()
    return { status: 200, body: { ok: true } }
  }
  return null
}

export default async function handler(req, res) {
  const internal = await internalRoute(req)
  if (internal) {
    res.statusCode = internal.status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(internal.body))
    return
  }
  const app = await getApp()
  app.server.emit('request', req, res)
}
