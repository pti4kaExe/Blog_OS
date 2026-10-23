/** Группа 2. Каналы — 6 методов. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.ts'
import { unprocessable } from '../errors.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import * as profiles from '../repositories/authorProfiles.ts'
import { getUsage } from '../services/cost.ts'
import { contentSettingsSchema, platformSchema } from './schemas.ts'

const MAX_PROFILES_PER_USER = 20

const listSchema = listQuerySchema.extend({
  platform: platformSchema.optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1, 'Имя канала не может быть пустым'),
  platform: platformSchema,
  description: z.string().nullable().optional(),
  content_settings: contentSettingsSchema.optional(),
  monthly_cost_limit: z.number().nonnegative().nullable().optional(),
})

const updateSchema = z.object({
  name: z.string().trim().min(1, 'Имя канала не может быть пустым').optional(),
  platform: platformSchema.optional(),
  description: z.string().nullable().optional(),
  content_settings: contentSettingsSchema.optional(),
  monthly_cost_limit: z.number().nonnegative().nullable().optional(),
})

export async function authorProfileRoutes(app: FastifyInstance): Promise<void> {
  // GET /author-profiles
  app.get('/author-profiles', { preHandler: requireUser }, async (request, reply) => {
    const query = parseQuery(listSchema, request.query)
    const options = toListOptions(query)
    const result = await profiles.list(request.user!.id, options, query.platform)
    return reply.status(200).send(result)
  })

  // POST /author-profiles
  app.post('/author-profiles', { preHandler: requireUser }, async (request, reply) => {
    const body = parseBody(createSchema, request.body)
    const count = await profiles.countForUser(request.user!.id)
    if (count >= MAX_PROFILES_PER_USER) {
      throw unprocessable(`Лимит каналов: ${MAX_PROFILES_PER_USER} на пользователя`, {
        reason: 'profile_limit_exceeded',
        limit: MAX_PROFILES_PER_USER,
      })
    }
    const created = await profiles.create(request.user!.id, {
      name: body.name,
      platform: body.platform,
      description: body.description ?? null,
      content_settings: body.content_settings ?? null,
      monthly_cost_limit: body.monthly_cost_limit ?? null,
    })
    return reply.status(201).send(created)
  })

  // GET /author-profiles/{id}
  app.get('/author-profiles/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = paramsId(request.params)
    const profile = await profiles.getWithCounts(request.user!.id, id)
    return reply.status(200).send(profile)
  })

  // PATCH /author-profiles/{id}
  app.patch('/author-profiles/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = paramsId(request.params)
    const body = parseBody(updateSchema, request.body)
    const updated = await profiles.update(request.user!.id, id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.platform !== undefined ? { platform: body.platform } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.content_settings !== undefined
        ? { content_settings: body.content_settings }
        : {}),
      ...(body.monthly_cost_limit !== undefined
        ? { monthly_cost_limit: body.monthly_cost_limit }
        : {}),
    })
    return reply.status(200).send(updated)
  })

  // DELETE /author-profiles/{id}
  app.delete('/author-profiles/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = paramsId(request.params)
    await profiles.remove(request.user!.id, id)
    return reply.status(204).send()
  })

  // GET /author-profiles/{id}/usage
  app.get('/author-profiles/:id/usage', { preHandler: requireUser }, async (request, reply) => {
    const id = paramsId(request.params)
    await profiles.getWithCounts(request.user!.id, id)
    const usage = await getUsage(id)
    return reply.status(200).send(usage)
  })
}
