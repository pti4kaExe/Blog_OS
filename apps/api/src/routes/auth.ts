/** Группа 1. Вход и пользователь — 4 метода. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../env.ts'
import { requireUser, signToken, verifyTelegramInitData } from '../auth.ts'
import { validationError } from '../errors.ts'
import { parseBody } from '../lib/query.ts'
import * as users from '../repositories/users.ts'

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

async function upsertUser(telegramId: number | string, name: string) {
  const existing = await users.findByTelegramId(telegramId)
  if (existing) return existing
  return users.create(telegramId, name)
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
