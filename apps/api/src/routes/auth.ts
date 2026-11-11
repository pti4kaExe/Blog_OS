/**
 * Группа 1. Вход и пользователь.
 *
 * Методы контракта (4): POST /auth/telegram, GET/PATCH/DELETE /users/me.
 * Методы входа через бота (3, служебные): POST /auth/telegram/start,
 * GET /auth/telegram/status, POST /telegram/webhook.
 *
 * Два способа входа:
 *   1. initData — когда клиент открыт как Telegram Mini App (подпись проверяется HMAC);
 *   2. код + бот — когда клиент открыт в обычном браузере: сайт выдаёт код,
 *      человек подтверждает его в боте, сайт получает JWT.
 * Dev-вход (telegram_id + имя) работает только при DEV_AUTH=1 и нужен
 * для локальной проверки; на проде выключен.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { env } from '../env.ts'
import { requireUser, signToken, verifyTelegramInitData } from '../auth.ts'
import { unauthorized, validationError, notConfigured } from '../errors.ts'
import { parseBody } from '../lib/query.ts'
import * as users from '../repositories/users.ts'
import { assertRateAllowed } from '../services/authRateLimit.ts'
import { claimCode, cleanupOldCodes, confirmCode, createCode, expireCode, getCode } from '../services/loginCodes.ts'
import { ingestChatMessage } from '../services/telegramChatIngest.ts'
import {
  botUsername,
  displayName,
  sendMessage,
  telegramLoginConfigured,
  webhookSecret,
  type TelegramUpdate,
} from '../services/telegramBot.ts'

const loginSchema = z
  .object({
    initData: z.string().min(1).optional(),
    telegram_id: z
      .union([z.number().int().positive(), z.string().regex(/^\d+$/, 'telegram_id — число')])
      .optional(),
    name: z.string().min(1).optional(),
  })
  .refine((value) => value.initData !== undefined || value.telegram_id !== undefined, {
    message: 'Нужен initData или telegram_id',
  })

const patchMeSchema = z.object({
  name: z.string().trim().min(1, 'Имя не может быть пустым'),
})

const statusQuerySchema = z.object({
  code: z.string().regex(/^[0-9a-f]{16}$/, 'Код входа — 16 hex-символов'),
})

async function upsertUser(telegramId: number | string, name: string) {
  const existing = await users.findByTelegramId(telegramId)
  if (existing) return existing
  return users.create(telegramId, name)
}

/** IP для ограничителя частоты: за прокси берём первый адрес из X-Forwarded-For. */
function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0]!.trim()
  return request.ip
}

/** Постоянное время сравнения — чтобы секрет webhook нельзя было подобрать по таймингу. */
function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

/** Внутри Telegram ссылка на клиент: Mini App или обычный браузер. */
function webUrl(): string {
  if (env.PUBLIC_WEB_URL.trim()) return env.PUBLIC_WEB_URL.trim()
  return env.CORS_ORIGIN[0] ?? ''
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/telegram — вход по подписи initData или dev-пара при DEV_AUTH=1.
  app.post('/auth/telegram', async (request, reply) => {
    const body = parseBody(loginSchema, request.body)

    let telegramId: number | string
    let name: string

    if (body.initData) {
      const identity = verifyTelegramInitData(body.initData)
      telegramId = identity.telegramId
      name = identity.name
    } else {
      if (!env.DEV_AUTH) {
        throw validationError('DEV_AUTH выключен: вход только по initData', {
          reason: 'dev_auth_disabled',
        })
      }
      telegramId = body.telegram_id as number | string
      name = (body.name ?? 'Демо-пользователь').trim()
    }

    const user = await upsertUser(telegramId, name)
    const issued = await signToken(user)
    return reply.status(200).send({
      token: issued.token,
      expires_at: issued.expires_at,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        name: user.name,
        role: user.role,
        created_at: user.created_at,
      },
    })
  })

  // ─── Вход через Telegram-бота ───────────────────────────────────────────────
  // POST /auth/telegram/start — выдать одноразовый код и ссылку на бота.
  app.post('/auth/telegram/start', async (request, reply) => {
    if (!telegramLoginConfigured()) {
      // Клиент по /health узнаёт, что вход через бота выключен, и не показывает кнопку.
      throw notConfigured('Вход через Telegram-бота')
    }
    assertRateAllowed(`start:${clientIp(request)}`, 10, 60_000, 'Слишком много попыток входа')

    const row = await createCode()
    const username = botUsername()
    return reply.status(201).send({
      code: row.code,
      bot_url: `https://t.me/${username}?start=login_${row.code}`,
      bot_username: username,
      expires_at: row.expires_at,
      ttl_minutes: env.LOGIN_CODE_TTL_MINUTES,
    })
  })

  // GET /auth/telegram/status?code=… — сайт опрашивает, подтвердил ли человек вход.
  app.get('/auth/telegram/status', async (request, reply) => {
    assertRateAllowed(`status:${clientIp(request)}`, 120, 60_000, 'Слишком частый опрос статуса')
    const query = statusQuerySchema.parse(request.query)
    const row = await getCode(query.code)
    if (!row) throw validationError('Код входа не найден', { reason: 'code_not_found' })

    if (row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now()) {
      await expireCode(row.code)
      return reply.status(200).send({ status: 'expired' })
    }
    // Код уже обменяли на токен: второй раз токен не выдаём (одноразовость).
    if (row.status === 'used') {
      return reply.status(200).send({ status: 'used' })
    }
    if (row.status !== 'confirmed' || !row.user_id) {
      return reply.status(200).send({
        status: row.status,
        expires_at: row.expires_at,
      })
    }

    // Атомарно забираем код: два параллельных опроса не выдадут два токена.
    const claimed = await claimCode(row.code)
    if (!claimed) {
      return reply.status(200).send({ status: 'used' })
    }

    const user = await users.getById(claimed.user_id as number)
    if (!user) throw unauthorized('Пользователь удалён')
    const issued = await signToken(user)
    return reply.status(200).send({
      status: 'confirmed',
      token: issued.token,
      expires_at: issued.expires_at,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        name: user.name,
        role: user.role,
        created_at: user.created_at,
      },
    })
  })

  // POST /telegram/webhook — Telegram присылает сюда сообщения бота.
  app.post('/telegram/webhook', async (request, reply) => {
    const secret = webhookSecret()
    if (!secret) throw notConfigured('Webhook Telegram не настроен')
    const provided = String(request.headers['x-telegram-bot-api-secret-token'] ?? '')
    if (!provided || !safeEqual(provided, secret)) {
      throw unauthorized('Неверный секрет webhook')
    }

    const update = request.body as TelegramUpdate | null
    const message = update?.message
    // Отвечаем 200 всегда, иначе Telegram будет повторять доставку.
    if (!message?.text || !message.chat || !message.from) return reply.status(200).send({ ok: true })

    const chatId = message.chat.id
    const text = message.text.trim()
    const link = webUrl()

    // Сообщение из группы: если на этот чат подписан источник CommentRadar,
    // сохраняем его как комментарий. Ответ в чат не отправляем, чтобы не шуметь.
    if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
      const ingested = await ingestChatMessage(message)
      if (ingested.created > 0) {
        request.log.info(
          { sources: ingested.sources, created: ingested.created },
          'обсуждения из чата сохранены как комментарии',
        )
      }
      return reply.status(200).send({ ok: true })
    }

    if (!text.startsWith('/start')) {
      await sendMessage(
        chatId,
        link ? `BlogOS: откройте сайт ${link} и нажмите «Войти через Telegram».` : 'BlogOS: начните вход на сайте.',
      )
      return reply.status(200).send({ ok: true })
    }

    const payload = text.slice('/start'.length).trim()
    if (!payload.startsWith('login_')) {
      await sendMessage(
        chatId,
        link
          ? `Чтобы войти в BlogOS, откройте сайт и нажмите «Войти через Telegram»\n${link}`
          : 'Чтобы войти в BlogOS, начните вход на сайте и перейдите по ссылке из браузера.',
      )
      return reply.status(200).send({ ok: true })
    }

    const code = payload.slice('login_'.length).trim()
    const row = await getCode(code)
    if (!row || row.status !== 'pending' || new Date(row.expires_at).getTime() <= Date.now()) {
      await sendMessage(chatId, 'Код входа не найден или устарел. Начните вход на сайте заново.')
      return reply.status(200).send({ ok: true })
    }

    const name = displayName(message.from)
    const user = await upsertUser(message.from.id, name)
    const confirmed = await confirmCode(code, {
      telegramId: message.from.id,
      name,
      userId: user.id,
    })
    if (!confirmed) {
      await sendMessage(chatId, 'Код уже использован или устарел. Начните вход на сайте заново.')
      return reply.status(200).send({ ok: true })
    }

    // Периодически подчищаем старые коды: отдельного планировщика в проекте нет.
    void cleanupOldCodes().catch(() => {})

    await sendMessage(
      chatId,
      link
        ? `Готово, ${name}! Вернитесь на сайт — вход выполнен.\n${link}`
        : `Готово, ${name}! Вернитесь на сайт — вход выполнен.`,
    )
    return reply.status(200).send({ ok: true })
  })

  // GET /users/me
  app.get('/users/me', { preHandler: requireUser }, async (request, reply) => {
    const user = request.user!
    const count = await users.profilesCount(user.id)
    return reply.status(200).send({
      id: user.id,
      telegram_id: user.telegram_id,
      name: user.name,
      role: user.role,
      created_at: user.created_at,
      updated_at: user.updated_at,
      author_profiles_count: count,
    })
  })

  // PATCH /users/me — роль не меняется: поле игнорируется схемой.
  app.patch('/users/me', { preHandler: requireUser }, async (request, reply) => {
    const body = parseBody(patchMeSchema, request.body)
    const updated = await users.updateName(request.user!.id, body.name.trim())
    return reply.status(200).send(updated)
  })

  // DELETE /users/me — 204, повторный вызов с тем же токеном даёт 401.
  app.delete('/users/me', { preHandler: requireUser }, async (request, reply) => {
    await users.remove(request.user!.id)
    return reply.status(204).send()
  })
}
