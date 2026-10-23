/** Группа 8. Комментарии — 6 методов, сканирование площадки с дедупликацией. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.ts'
import { AppError, unprocessable, upstreamUnavailable } from '../errors.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import { ownComment, ownSource } from '../repositories/access.ts'
import * as comments from '../repositories/comments.ts'
import * as sources from '../repositories/sources.ts'
import {
  PlatformError,
  scanPlatform,
  type PlatformName,
} from '../services/adapters/index.ts'
import { assertScanRateAllowed } from '../services/rateLimit.ts'

const dateTime = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Ожидается дата ISO 8601')

const manualSchema = z.object({
  commenter_name: z.string().nullable().optional(),
  text: z.string().trim().min(1, 'Текст комментария не может быть пустым'),
  posted_at: dateTime.nullable().optional(),
})

const patchSchema = z.object({
  commenter_name: z.string().nullable().optional(),
  text: z.string().trim().min(1, 'Текст комментария не может быть пустым').optional(),
})

const scanSchema = z.object({
  limit: z.number().int().min(1).max(200).default(100),
})

/** Тип источника → площадка адаптера. manual сканировать нечем. */
function platformOf(sourceType: string): PlatformName | null {
  if (sourceType.startsWith('telegram')) return 'telegram'
  if (sourceType === 'instagram') return 'instagram'
  if (sourceType === 'youtube') return 'youtube'
  return null
}

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  // GET /sources/{id}/comments
  app.get('/sources/:id/comments', { preHandler: requireUser }, async (request, reply) => {
    const sourceId = paramsId(request.params)
    await ownSource(request.user!.id, sourceId)
    const query = parseQuery(listQuerySchema, request.query)
    const result = await comments.list(request.user!.id, sourceId, toListOptions(query))
    return reply.status(200).send(result)
  })

  // POST /sources/{id}/comments — ручное добавление, external_id = manual:<id>.
  app.post('/sources/:id/comments', { preHandler: requireUser }, async (request, reply) => {
    const sourceId = paramsId(request.params)
    await ownSource(request.user!.id, sourceId)
    const body = parseBody(manualSchema, request.body)
    const created = await comments.createManual(sourceId, {
      commenter_name: body.commenter_name ?? null,
      text: body.text,
      posted_at: body.posted_at ?? null,
    })
    return reply.status(201).send(created)
  })

  // POST /sources/{id}/comments/scan — один повторный вызов адаптера, затем 502.
  app.post('/sources/:id/comments/scan', { preHandler: requireUser }, async (request, reply) => {
    const sourceId = paramsId(request.params)
    const source = await ownSource(request.user!.id, sourceId)
    const body = parseBody(scanSchema, request.body)

    if (!source.is_active) {
      throw unprocessable('Источник выключен: сканирование недоступно', {
        reason: 'source_inactive',
      })
    }
    const platform = platformOf(String(source.source_type))
    if (!platform) {
      throw unprocessable('Ручной источник не сканируется', { reason: 'source_not_scannable' })
    }

    await assertScanRateAllowed(sourceId)

    let scanned
    try {
      scanned = await scanPlatform(platform, String(source.source_url), body.limit)
    } catch (error) {
      if (error instanceof AppError) throw error
      const platformName = error instanceof PlatformError ? error.platform : platform
      await sources.markScanFailed(
        sourceId,
        error instanceof Error ? error.message : String(error),
      )
      throw upstreamUnavailable('Не удалось просканировать источник', {
        platform: platformName,
        reason: 'platform_error',
      })
    }

    const inserted = await comments.insertScanned(sourceId, scanned)
    const marked = await sources.markScanOk(sourceId)
    return reply.status(200).send({
      source_id: sourceId,
      found: scanned.length,
      created: inserted.created,
      duplicates: inserted.duplicates,
      last_scanned_at: marked.last_scanned_at,
      status: 'ok',
    })
  })

  // GET /comments/{id}
  app.get('/comments/:id', { preHandler: requireUser }, async (request, reply) => {
    const commentId = paramsId(request.params)
    await ownComment(request.user!.id, commentId)
    const comment = await comments.getWithCounts(request.user!.id, commentId)
    return reply.status(200).send(comment)
  })

  // PATCH /comments/{id}
  app.patch('/comments/:id', { preHandler: requireUser }, async (request, reply) => {
    const commentId = paramsId(request.params)
    await ownComment(request.user!.id, commentId)
    const body = parseBody(patchSchema, request.body)
    const updated = await comments.update(commentId, {
      ...(body.commenter_name !== undefined ? { commenter_name: body.commenter_name } : {}),
      ...(body.text !== undefined ? { text: body.text } : {}),
    })
    return reply.status(200).send(updated)
  })

  // DELETE /comments/{id}
  app.delete('/comments/:id', { preHandler: requireUser }, async (request, reply) => {
    const commentId = paramsId(request.params)
    await ownComment(request.user!.id, commentId)
    await comments.remove(commentId)
    return reply.status(204).send()
  })
}
