import { buildApp } from './app.ts'
import { env } from './env.ts'
import { closeDb } from './db.ts'

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
  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(
    `BlogOS API: http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT} · LLM=${env.LLM_PROVIDER} · embeddings=${env.EMBEDDINGS_PROVIDER} · dev-вход=${env.DEV_AUTH ? 'да' : 'нет'}`,
  )
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
