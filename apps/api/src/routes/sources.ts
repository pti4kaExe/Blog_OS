/** Группа 7. Источники — 5 методов. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.ts'
import { conflict, notFound } from '../errors.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import { ownProfile, ownSource } from '../repositories/access.ts'
import * as sources from '../repositories/sources.ts'
import { sourceTypeSchema } from './schemas.ts'

const listSchema = listQuerySchema.extend({
  is_active: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  source_type: sourceTypeSchema.optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1, 'Имя источника не может быть пустым'),
  source_type: sourceTypeSchema,
  source_url: z.string().trim().min(1, 'Нужен source_url'),
})

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  source_url: z.string().trim().min(1).optional(),
  is_active: z.boolean().optional(),
})

export async function sourceRoutes(app: FastifyInstance): Promise<void> {
  // GET /author-profiles/{id}/sources
  app.get(
    '/author-profiles/:id/sources',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const query = parseQuery(listSchema, request.query)
      const result = await sources.list(request.user!.id, profileId, toListOptions(query), {
        is_active: query.is_active,
        source_type: query.source_type,
      })
      return reply.status(200).send(result)
    },
  )

  // POST /author-profiles/{id}/sources
  app.post(
    '/author-profiles/:id/sources',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const body = parseBody(createSchema, request.body)
      const created = await sources.create(profileId, {
        name: body.name,
        source_type: body.source_type,
        source_url: body.source_url,
      })
      return reply.status(201).send(created)
    },
  )

  // GET /sources/{id}
  app.get('/sources/:id', { preHandler: requireUser }, async (request, reply) => {
    const sourceId = paramsId(request.params)
    const source = await ownSource(request.user!.id, sourceId)
    const withCounts = await sources.getWithCounts(request.user!.id, sourceId)
    return reply.status(200).send(withCounts ?? source)
  })

  // PATCH /sources/{id} — is_active=false выключает отслеживание.
  app.patch('/sources/:id', { preHandler: requireUser }, async (request, reply) => {
    const sourceId = paramsId(request.params)
    await ownSource(request.user!.id, sourceId)
    const body = parseBody(updateSchema, request.body)
    const updated = await sources.update(sourceId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.source_url !== undefined ? { source_url: body.source_url } : {}),
      ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
    })
    return reply.status(200).send(updated)
  })

  // DELETE /sources/{id}
  app.delete('/sources/:id', { preHandler: requireUser }, async (request, reply) => {
    const sourceId = paramsId(request.params)
    await ownSource(request.user!.id, sourceId)
    await sources.remove(sourceId)
    return reply.status(204).send()
  })
}

export { conflict, notFound }
