/** Группа 10. База знаний — 6 методов, RAG-поиск через pgvector. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../env.ts'
import { requireUser } from '../auth.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import { ownKnowledge, ownProfile } from '../repositories/access.ts'
import * as knowledge from '../repositories/knowledge.ts'
import { recalcKnowledgeEmbeddings, searchKnowledge } from '../services/embeddings/store.ts'

const createSchema = z.object({
  title: z.string().trim().min(1, 'Заголовок не может быть пустым'),
  content: z.string().trim().min(1, 'Содержание не может быть пустым'),
})

const updateSchema = z.object({
  title: z.string().trim().min(1, 'Заголовок не может быть пустым').optional(),
  content: z.string().trim().min(1, 'Содержание не может быть пустым').optional(),
})

const searchSchema = z.object({
  q: z.string().min(1, 'Пустой поисковый запрос'),
  limit: z.coerce.number().int().min(1).max(50).default(env.RAG_TOP_K),
})

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  // GET /author-profiles/{id}/knowledge
  app.get(
    '/author-profiles/:id/knowledge',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const query = parseQuery(listQuerySchema, request.query)
      const result = await knowledge.list(request.user!.id, profileId, toListOptions(query))
      return reply.status(200).send(result)
    },
  )

  // GET /author-profiles/{id}/knowledge/search — до параметрического маршрута.
  app.get(
    '/author-profiles/:id/knowledge/search',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const query = parseQuery(searchSchema, request.query)
      const result = await searchKnowledge(profileId, query.q, query.limit)
      return reply.status(200).send(result)
    },
  )

  // POST /author-profiles/{id}/knowledge
  app.post(
    '/author-profiles/:id/knowledge',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const body = parseBody(createSchema, request.body)
      const created = await knowledge.create(profileId, {
        title: body.title,
        content: body.content,
      })
      await recalcKnowledgeEmbeddings(Number(created.id), String(created.content))
      return reply.status(201).send(created)
    },
  )

  // GET /knowledge/{id}
  app.get('/knowledge/:id', { preHandler: requireUser }, async (request, reply) => {
    const knowledgeId = paramsId(request.params)
    const fact = await ownKnowledge(request.user!.id, knowledgeId)
    return reply.status(200).send(fact)
  })

  // PATCH /knowledge/{id} — правка пересчитывает вектор.
  app.patch('/knowledge/:id', { preHandler: requireUser }, async (request, reply) => {
    const knowledgeId = paramsId(request.params)
    await ownKnowledge(request.user!.id, knowledgeId)
    const body = parseBody(updateSchema, request.body)
    const updated = await knowledge.update(knowledgeId, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.content !== undefined ? { content: body.content } : {}),
    })
    if (body.content !== undefined) {
      await recalcKnowledgeEmbeddings(knowledgeId, body.content)
    }
    return reply.status(200).send(updated)
  })

  // DELETE /knowledge/{id}
  app.delete('/knowledge/:id', { preHandler: requireUser }, async (request, reply) => {
    const knowledgeId = paramsId(request.params)
    await ownKnowledge(request.user!.id, knowledgeId)
    await knowledge.remove(knowledgeId)
    return reply.status(204).send()
  })
}
