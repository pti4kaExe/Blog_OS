/**
 * Сборка Fastify-приложения.
 *
 * Здесь только сквозные вещи: JSON-ошибки в одном конверте, CORS, health,
 * маршрутизация. Доменные обработчики — в src/routes (11 групп, 59 методов),
 * работа с базой — в src/repositories, вызовы модели — в src/services.
 */
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import { ZodError } from 'zod'
import { env, isProd } from './env.ts'
import { AppError, fromPostgresError, fromZodError } from './errors.ts'
import { registerRoutes } from './routes/index.ts'
import { pingDb } from './db.ts'

export interface RegisteredRoute {
  method: string
  url: string
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Все зарегистрированные маршруты (для проверки контракта 59 методов). */
    routeList: RegisteredRoute[]
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // В проде — JSON, локально — короткие строки. Секреты в лог не пишутся.
      transport: isProd ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  })

  // Учёт маршрутов: контракт фиксирует ровно 59 доменных методов.
  const routeList: RegisteredRoute[] = []
  app.decorate('routeList', routeList)
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      if (method === 'HEAD') continue
      routeList.push({ method, url: route.url })
    }
  })

  await app.register(cors, {
    origin: env.CORS_ORIGIN.includes('*') ? true : env.CORS_ORIGIN,
    credentials: false,
  })

  // Единый конверт ошибок. Внутренний текст — в лог, наружу — безопасное сообщение.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message, details: error.details ?? {} },
      })
    }
    if (error instanceof ZodError) {
      const mapped = fromZodError(error)
      return reply.status(mapped.status).send({
        error: { code: mapped.code, message: mapped.message, details: mapped.details ?? {} },
      })
    }
    const pgMapped = fromPostgresError(error)
    if (pgMapped) {
      return reply.status(pgMapped.status).send({
        error: { code: pgMapped.code, message: pgMapped.message, details: pgMapped.details ?? {} },
      })
    }
    // Ошибки валидации схемы самого Fastify (params, query, body).
    if ((error as { validation?: unknown }).validation) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: 'Данные не проходят проверку',
          details: { fields: (error as { validation?: unknown }).validation },
        },
      })
    }
    request.log.error({ err: error }, 'необработанная ошибка')
    return reply.status(500).send({
      error: { code: 'internal', message: 'Внутренняя ошибка сервера', details: {} },
    })
  })

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'not_found',
        message: `Метод ${request.method} ${request.url} не найден`,
        details: {},
      },
    })
  })

  // Проверка живости: по ней Render и демонстрация прогревают холодный старт.
  app.get('/health', async () => {
    const db = (await pingDb()) ? 'ok' : 'down'
    return {
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      version: '2.0.0',
      llm: env.LLM_PROVIDER,
      embeddings: env.EMBEDDINGS_PROVIDER,
      dev_auth: env.DEV_AUTH,
      time: new Date().toISOString(),
    }
  })

  await registerRoutes(app)

  return app
}
