/** Группа 4. Посты — 6 методов, дедупликация импорта по (author_id, external_id). */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.ts'
import { AppError, conflict, unprocessable, upstreamUnavailable } from '../errors.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import { defaultContentType, exceededLimit } from '../lib/text.ts'
import { ownPost, ownProfile } from '../repositories/access.ts'
import * as posts from '../repositories/posts.ts'
import {
  importFromPlatform,
  PlatformError,
  type PlatformName,
} from '../services/adapters/index.ts'
import { recalcPostEmbeddings } from '../services/embeddings/store.ts'
import { contentTypeSchema, platformSchema } from './schemas.ts'

const dateTime = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Ожидается дата ISO 8601')

const listSchema = listQuerySchema.extend({
  content_type: contentTypeSchema.optional(),
})

const createSchema = z.object({
  content_type: contentTypeSchema,
  text: z.string().min(1, 'Текст не может быть пустым'),
  external_id: z.string().min(1).nullable().optional(),
  external_url: z.string().min(1).nullable().optional(),
  published_at: dateTime.nullable().optional(),
})

const updateSchema = z.object({
  text: z.string().min(1, 'Текст не может быть пустым').optional(),
  content_type: contentTypeSchema.optional(),
  external_url: z.string().min(1).nullable().optional(),
  published_at: dateTime.nullable().optional(),
})

const importSchema = z.object({
  platform: platformSchema.default('telegram'),
  source_url: z.string().min(1, 'Нужен source_url площадки'),
  limit: z.number().int().min(1).max(200).default(50),
})

function assertLength(contentType: string, text: string): void {
  const limit = exceededLimit(contentType, text)
  if (limit !== null) {
    throw unprocessable(`Текст длиннее лимита площадки: ${limit} символов`, {
      limit,
      content_type: contentType,
      length: text.length,
    })
  }
}

export async function postRoutes(app: FastifyInstance): Promise<void> {
  // GET /author-profiles/{id}/posts
  app.get(
    '/author-profiles/:id/posts',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const query = parseQuery(listSchema, request.query)
      const result = await posts.list(request.user!.id, profileId, toListOptions(query), {
        content_type: query.content_type,
      })
      return reply.status(200).send(result)
    },
  )

  // POST /author-profiles/{id}/posts
  app.post(
    '/author-profiles/:id/posts',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const body = parseBody(createSchema, request.body)
      assertLength(body.content_type, body.text)
      const created = await posts.create(profileId, {
        content_type: body.content_type,
        text: body.text,
        external_id: body.external_id ?? null,
        external_url: body.external_url ?? null,
        published_at: body.published_at ?? null,
      })
      await recalcPostEmbeddings(Number(created.id), String(created.text))
      return reply.status(201).send(created)
    },
  )

  // POST /author-profiles/{id}/posts/import
  app.post(
    '/author-profiles/:id/posts/import',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const body = parseBody(importSchema, request.body)

      let items
      try {
        items = await importFromPlatform(body.platform as PlatformName, body.source_url, body.limit)
      } catch (error) {
        if (error instanceof AppError) throw error
        const platform =
          error instanceof PlatformError ? error.platform : (body.platform as PlatformName)
        throw upstreamUnavailable('Не удалось импортировать посты с площадки', {
          platform,
          reason: 'platform_error',
        })
      }

      let imported = 0
      let skippedDuplicates = 0
      let skippedInvalid = 0
      const errors: string[] = []

      for (const item of items) {
        const text = String(item.text ?? '').trim()
        if (!text) {
          skippedInvalid++
          errors.push(`${item.external_id}: пустой текст`)
          continue
        }
        try {
          assertLength(item.content_type, text)
        } catch {
          skippedInvalid++
          errors.push(`${item.external_id}: превышен лимит длины`)
          continue
        }
        const existing = await posts.findByExternal(profileId, item.external_id)
        if (existing) {
          skippedDuplicates++
          continue
        }
        try {
          const created = await posts.create(profileId, {
            content_type: item.content_type,
            text,
            external_id: item.external_id,
            external_url: item.external_url,
            published_at: item.published_at,
          })
          imported++
          await recalcPostEmbeddings(Number(created.id), String(created.text))
        } catch (error) {
          if (error instanceof AppError && error.code === 'conflict') {
            skippedDuplicates++
          } else {
            errors.push(`${item.external_id}: ошибка записи`)
          }
        }
      }

      return reply.status(200).send({
        imported,
        skipped_duplicates: skippedDuplicates,
        skipped_invalid: skippedInvalid,
        errors,
        checked: items.length,
      })
    },
  )

  // GET /author-profiles/{id}/posts/{postId}
  app.get(
    '/author-profiles/:id/posts/:postId',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      const postId = paramsId(request.params, 'postId')
      await ownProfile(request.user!.id, profileId)
      const post = await ownPost(request.user!.id, postId, profileId)
      return reply.status(200).send(post)
    },
  )

  // PATCH /author-profiles/{id}/posts/{postId} — правка текста пересчитывает векторы.
  app.patch(
    '/author-profiles/:id/posts/:postId',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      const postId = paramsId(request.params, 'postId')
      await ownProfile(request.user!.id, profileId)
      const post = await ownPost(request.user!.id, postId, profileId)
      const body = parseBody(updateSchema, request.body)

      const contentType = body.content_type ?? String(post.content_type)
      const text = body.text ?? String(post.text)
      if (body.text !== undefined) assertLength(contentType, body.text)

      const updated = await posts.update(postId, {
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.content_type !== undefined ? { content_type: body.content_type } : {}),
        ...(body.external_url !== undefined ? { external_url: body.external_url } : {}),
        ...(body.published_at !== undefined ? { published_at: body.published_at } : {}),
      })
      if (body.text !== undefined) {
        await recalcPostEmbeddings(postId, text)
      }
      return reply.status(200).send(updated)
    },
  )

  // DELETE /author-profiles/{id}/posts/{postId}
  app.delete(
    '/author-profiles/:id/posts/:postId',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      const postId = paramsId(request.params, 'postId')
      await ownProfile(request.user!.id, profileId)
      await ownPost(request.user!.id, postId, profileId)
      await posts.remove(postId)
      return reply.status(204).send()
    },
  )
}

/** Экспорт для сида/тестов: тип контента по умолчанию для площадки. */
export { defaultContentType, conflict }
