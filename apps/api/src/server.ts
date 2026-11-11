import { buildApp } from './app.ts'
import { env, isProd } from './env.ts'
import { closeDb } from './db.ts'
import { applyMigrations } from './migrations.ts'
import { cleanupOldCodes } from './services/loginCodes.ts'
import { registerWebhook, telegramLoginConfigured } from './services/telegramBot.ts'
import { sweepAuthRateLimits } from './services/authRateLimit.ts'

const app = await buildApp()

const shutdown = async (signal: string) => {
  app.log.info(`получен ${signal}: закрываю сервер`)
  await app.close()
  await closeDb()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  if (env.RUN_MIGRATIONS_ON_START) {
    const result = await applyMigrations()
    app.log.info(`миграции при старте: применено файлов ${result.applied?.length ?? 0}`)
  }
  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(
    `BlogOS API: http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT} · LLM=${env.LLM_PROVIDER} · embeddings=${env.EMBEDDINGS_PROVIDER} · dev-вход=${env.DEV_AUTH ? 'да' : 'нет'} · вход через бота=${telegramLoginConfigured() ? 'да' : 'нет'}`,
  )

  // Webhook Telegram регистрируется на старте: адрес известен из PUBLIC_API_URL.
  // Ошибка регистрации не мешает серверу работать — вход через бота просто
  // останется недоступным, а причина попадёт в лог.
  if (telegramLoginConfigured() && env.PUBLIC_API_URL) {
    try {
      const result = await registerWebhook()
      app.log.info(`Telegram webhook: ${result.url ?? 'не зарегистрирован'}`)
    } catch (error) {
      app.log.error(
        { err: error },
        'не удалось зарегистрировать Telegram webhook — вход через бота не сработает',
      )
    }
  }

  // Уборка старых кодов входа и окон ограничителя: раз в час, без отдельного планировщика.
  const cleanupTimer = setInterval(async () => {
    try {
      const removed = await cleanupOldCodes()
      sweepAuthRateLimits()
      if (removed > 0) app.log.info(`удалено устаревших кодов входа: ${removed}`)
    } catch (error) {
      app.log.warn({ err: error }, 'уборка кодов входа не удалась')
    }
  }, 60 * 60 * 1000)
  cleanupTimer.unref()
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
