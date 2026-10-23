/**
 * Аутентификация BlogOS.
 *
 * Вход — Telegram WebApp initData (HMAC-SHA256) или dev-пара при DEV_AUTH=1.
 * Сессия — JWT HS256 на 30 дней (docs/DECISIONS.md, решение № 23): claims
 * sub = id пользователя, role. Хелперы requireUser/requireAdmin — preHandler
 * для доменных маршрутов.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from './env.ts'
import { liveString } from './lib/liveEnv.ts'
import { forbidden, notConfigured, unauthorized, validationError } from './errors.ts'
import { queryOne } from './db.ts'

export type UserRole = 'user' | 'admin'

export interface SessionUser {
  id: number
  telegram_id: number
  name: string
  role: UserRole
  created_at: string | Date
  updated_at: string | Date
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser
  }
}

const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

const secretKey = (): Uint8Array => new TextEncoder().encode(env.JWT_SECRET)

export interface IssuedToken {
  token: string
  expires_at: string
}

/** JWT HS256: sub = user.id, role — в claim. */
export async function signToken(user: Pick<SessionUser, 'id' | 'role'>): Promise<IssuedToken> {
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + TOKEN_TTL_SECONDS
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(user.id))
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secretKey())
  return { token, expires_at: new Date(expiresAt * 1000).toISOString() }
}

/** Проверка Bearer-токена и загрузка актуального пользователя. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (request.user) return
  const header = request.headers.authorization
  if (!header || !header.toLowerCase().startsWith('bearer ')) throw unauthorized()
  const token = header.slice(7).trim()
  if (!token) throw unauthorized()

  let subject: string | undefined
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] })
    subject = payload.sub
  } catch {
    throw unauthorized('Токен недействителен или просрочен')
  }
  if (!subject) throw unauthorized('Токен недействителен или просрочен')

  const user = await queryOne<SessionUser>(
    `SELECT id, telegram_id, name, role, created_at, updated_at FROM users WHERE id = $1`,
    [subject],
  )
  if (!user) throw unauthorized('Пользователь удалён или не найден')
  request.user = user
}

export const requireUser = authenticate

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply)
  if (request.user?.role !== 'admin') throw forbidden('Требуется роль admin')
}

/** Проверка подписи Telegram WebApp initData. */
export interface TelegramIdentity {
  telegramId: number
  name: string
}

export function verifyTelegramInitData(initData: string): TelegramIdentity {
  const botToken = liveString('TELEGRAM_BOT_TOKEN', env.TELEGRAM_BOT_TOKEN)
  if (!botToken) throw notConfigured('Telegram Bot API')

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) throw validationError('В initData нет подписи hash', { reason: 'hash_missing' })

  // hash исключается; остальные поля сортируются по ключу и склеиваются через \n.
  params.delete('hash')
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computed = createHmac('sha256', secret).update(dataCheckString).digest('hex')
  const provided = hash.toLowerCase()
  const computedBuffer = Buffer.from(computed, 'utf8')
  const providedBuffer = Buffer.from(provided, 'utf8')
  if (
    computedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(computedBuffer, providedBuffer)
  ) {
    throw validationError('Подпись Telegram неверна', { reason: 'invalid_signature' })
  }

  const authDate = Number(params.get('auth_date') ?? 0)
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw validationError('В initData нет auth_date', { reason: 'auth_date_missing' })
  }
  if (Date.now() / 1000 - authDate > 24 * 60 * 60) {
    throw validationError('Подпись Telegram устарела', { reason: 'auth_date_expired' })
  }

  const rawUser = params.get('user')
  if (!rawUser) throw validationError('В initData нет пользователя', { reason: 'user_missing' })
  let parsed: { id?: number; first_name?: string; last_name?: string; username?: string }
  try {
    parsed = JSON.parse(rawUser) as typeof parsed
  } catch {
    throw validationError('Поле user в initData не является JSON', { reason: 'user_invalid' })
  }
  if (!parsed.id || !Number.isSafeInteger(parsed.id)) {
    throw validationError('В initData нет telegram_id', { reason: 'user_invalid' })
  }
  const name =
    [parsed.first_name, parsed.last_name].filter(Boolean).join(' ').trim() ||
    parsed.username ||
    'Пользователь'
  return { telegramId: parsed.id, name }
}
