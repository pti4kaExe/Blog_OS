/** Группа 9. Варианты ответа — 6 методов. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.ts'
import { unprocessable } from '../errors.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import { hasUnfilledGaps } from '../lib/text.ts'
import { ownComment, ownResponse } from '../repositories/access.ts'
import * as knowledgeRepo from '../repositories/knowledge.ts'
import * as posts from '../repositories/posts.ts'
import * as responses from '../repositories/responses.ts'
import * as tovRepo from '../repositories/tov.ts'
import { assertAiBudget } from '../services/cost.ts'
import { generateResponses } from '../services/responses.ts'
import { responseStatusSchema, strictAiOf, strictAiSchema } from './schemas.ts'

const listSchema = listQuerySchema.extend({
  status: responseStatusSchema.optional(),
})

const createSchema = z.object({
  response_text: z.string().trim().min(1, 'Текст ответа не может быть пустым'),
})

const patchSchema = z.object({
  edited_text: z.string().nullable().optional(),
  status: responseStatusSchema.optional(),
})

const generateSchema = z.object({
  count: z.number().int().min(1).max(5).default(2),
  use_llm: z.boolean().optional(),
  strict_ai: strictAiSchema,
})

/** generated → pending_approval → approved | rejected; approved → sent. */
const TRANSITIONS: Record<string, string[]> = {
  generated: ['pending_approval'],
  pending_approval: ['approved', 'rejected'],
  approved: ['sent'],
  rejected: [],
  sent: [],
}

export async function responseRoutes(app: FastifyInstance): Promise<void> {
  // GET /comments/{id}/responses
  app.get('/comments/:id/responses', { preHandler: requireUser }, async (request, reply) => {
    const commentId = paramsId(request.params)
    await ownComment(request.user!.id, commentId)
    const query = parseQuery(listSchema, request.query)
    const result = await responses.list(
      request.user!.id,
      commentId,
      toListOptions(query),
      query.status,
    )
    return reply.status(200).send(result)
  })

  // POST /comments/{id}/responses — вручную добавленный вариант.
  app.post('/comments/:id/responses', { preHandler: requireUser }, async (request, reply) => {
    const commentId = paramsId(request.params)
    await ownComment(request.user!.id, commentId)
    const body = parseBody(createSchema, request.body)
    const created = await responses.create({
      commentId,
      responseText: body.response_text,
      status: 'generated',
    })
    return reply.status(201).send(created)
  })

  // POST /comments/{id}/responses/generate — четыре части в стиле автора.
  app.post(
    '/comments/:id/responses/generate',
    { preHandler: requireUser },
    async (request, reply) => {
      const commentId = paramsId(request.params)
      const comment = await ownComment(request.user!.id, commentId)
      const body = parseBody(generateSchema, request.body)
      const authorId = Number(comment.author_id)

      const budget = await assertAiBudget(authorId, {
        strict: (body.use_llm !== false) && strictAiOf(body),
      })
      const tovRow = await tovRepo.getByAuthor(request.user!.id, authorId)
      const knowledge = await knowledgeRepo.listRecent(authorId, 5)
      const recentPosts = await posts.listRecent(authorId, 1)

      const result = await generateResponses({
        commentText: String(comment.text ?? ''),
        count: body.count,
        authorId,
        tovRow,
        knowledge: knowledge.map((row) => String(row.content ?? '')),
        useLlm: body.use_llm !== false,
        budgetBlocked: budget.blocked,
        commentKind: String(comment.text ?? '').trim().endsWith('?') ? 'question' : 'claim',
      })

      const created = []
      for (const generated of result.responses) {
        const row = await responses.create({
          commentId,
          responseText: generated.text,
          status: 'generated',
          generationRunId: result.generationRunId,
        })
        created.push({ ...row, parts: generated.parts })
      }

      return reply.status(201).send({
        responses: created,
        verified_without_ai: result.verifiedWithoutAi,
        based_on_post_id: recentPosts[0]?.id ?? null,
        ...(result.aiSkippedReason ? { ai_skipped_reason: result.aiSkippedReason } : {}),
      })
    },
  )

  // GET /responses/{id}
  app.get('/responses/:id', { preHandler: requireUser }, async (request, reply) => {
    const responseId = paramsId(request.params)
    const response = await ownResponse(request.user!.id, responseId)
    return reply.status(200).send(response)
  })

  // PATCH /responses/{id} — переходы статусов и проверка пропусков.
  app.patch('/responses/:id', { preHandler: requireUser }, async (request, reply) => {
    const responseId = paramsId(request.params)
    const response = await ownResponse(request.user!.id, responseId)
    const body = parseBody(patchSchema, request.body)

    const current = String(response.status)
    if (body.status !== undefined && body.status !== current) {
      const allowed = TRANSITIONS[current] ?? []
      if (!allowed.includes(body.status)) {
        throw unprocessable('Недопустимый переход статуса ответа', {
          reason: 'invalid_transition',
          from: current,
          to: body.status,
        })
      }
    }

    const effectiveText =
      body.edited_text ?? response.edited_text ?? response.response_text
    if (
      (body.status === 'approved' || body.status === 'sent' || body.edited_text !== undefined) &&
      hasUnfilledGaps(String(effectiveText ?? ''))
    ) {
      throw unprocessable('В тексте ответа остались незаполненные пропуски [дополните: …]', {
        reason: 'unfilled_gaps',
      })
    }

    const now = new Date().toISOString()
    const patch: {
      edited_text?: string | null
      status?: string
      approved_at?: string
      sent_at?: string
    } = {}
    if (body.edited_text !== undefined) patch.edited_text = body.edited_text
    if (body.status !== undefined) patch.status = body.status
    if (body.status === 'approved' && !response.approved_at) patch.approved_at = now
    if (body.status === 'sent') {
      if (!response.approved_at) patch.approved_at = now
      if (!response.sent_at) patch.sent_at = now
    }

    const updated = await responses.update(responseId, patch)
    return reply.status(200).send(updated)
  })

  // DELETE /responses/{id}
  app.delete('/responses/:id', { preHandler: requireUser }, async (request, reply) => {
    const responseId = paramsId(request.params)
    await ownResponse(request.user!.id, responseId)
    await responses.remove(responseId)
    return reply.status(204).send()
  })
}
