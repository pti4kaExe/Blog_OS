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
import { assertRateAllowed } from './services/authRateLimit.ts'
import { botUsername, telegramLoginConfigured } from './services/telegramBot.ts'

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
    // JSON-API не принимает файлов: половины мегабайта хватает даже длинному посту.
    bodyLimit: 512 * 1024,
    // Доверяем только ближайшему прокси (Render). Если доверять всем,
    // клиент подделает X-Forwarded-For и обойдёт лимиты, которые считаются по IP.
    trustProxy: (_address: string, hop: number) => hop === 0,
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
    // env.CORS_ORIGIN — уже список origin'ов (схема разбирает запятую).
    origin: env.CORS_ORIGIN.includes('*') ? true : env.CORS_ORIGIN,
    credentials: false,
  })



  /**
   * Общий предохранитель от флуда: сколько запросов в минуту принимаем с одного IP.
   *
   * Точечные лимиты (вход через бота, сканирование) строже и живут в роутерах.
   * Здесь — грубая защита от потока запросов, который может съесть CPU и трафик.
   * /health исключён: его дёргает прогрев и мониторинг.
   *
   * Значение по умолчанию разное: в проде — 240, локально и в тестах — 5000,
   * чтобы тесты не упирались в лимит. Переопределяется RATE_LIMIT_PER_MINUTE.
   */
  app.addHook('onRequest', async (request) => {
    const url = request.url ?? ''
    if (url.startsWith('/health')) return
    const configured = Number(process.env.RATE_LIMIT_PER_MINUTE)
    const limit = Number.isFinite(configured) && configured > 0
      ? configured
      : (isProd ? 240 : 5000)
    assertRateAllowed(`global:${request.ip}`, limit, 60_000, 'Слишком много запросов с одного адреса')
  })

  // Базовые заголовки безопасности для API. CORS настроен отдельно ниже;
  // здесь — то, что защищает от подмены типа контента, встраивания в iframe,
  // утечки referer и избыточных разрешений браузера.
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('x-frame-options', 'DENY')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()')
    reply.header('cross-origin-opener-policy', 'same-origin')
    if (isProd) {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains')
    }
    return payload
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

    // Остальные ошибки разбора запроса от Fastify (например, «тело пустое при
    // content-type: application/json») — это ошибка клиента, а не сбой сервера:
    // отдаём её 4xx с тем же конвертом, а не 500.
    const fastifyStatus = (error as { statusCode?: unknown }).statusCode
    if (
      typeof fastifyStatus === 'number' &&
      fastifyStatus >= 400 &&
      fastifyStatus < 500 &&
      !(error as { validation?: unknown }).validation
    ) {
      return reply.status(fastifyStatus).send({
        error: {
          code: 'validation_error',
          message: 'Запрос сформирован неверно',
          details: { reason: String((error as { code?: unknown }).code ?? 'bad_request') },
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

  /**
   * Проверка живости.
   *
   * `?light=1` — без обращения к базе. Нужен для прогрева: бесплатный хостинг
   * засыпает без трафика, и внешний пингер раз в 10 минут держит процесс живым.
   * Лёгкий режим не будит базу (у Neon свой лимит вычислений), поэтому прогрев
   * не тратит его впустую. Флаги входа отдаются и здесь: они не требуют базы.
   */
  app.get('/health', async (request) => {
    const query = (request.query ?? {}) as { light?: unknown }
    const light = query.light === '1' || query.light === 'true' || query.light === true
    const db = light ? 'skipped' : (await pingDb()) ? 'ok' : 'down'
    const healthy = db === 'ok' || db === 'skipped'
    return {
      status: healthy ? 'ok' : 'degraded',
      db,
      version: '2.0.0',
      dev_auth: env.DEV_AUTH,
      telegram_auth: telegramLoginConfigured(),
      telegram_bot_username: telegramLoginConfigured() ? botUsername() : null,
      time: new Date().toISOString(),
    }
  })

  await registerRoutes(app)

  return app
}
