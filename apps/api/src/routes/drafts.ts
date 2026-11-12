/** Группа 5. Черновики — 7 методов, включая Narrative Engine и публикацию. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.ts'
import { unprocessable } from '../errors.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import { defaultContentType, exceededLimit, hasUnfilledGaps } from '../lib/text.ts'
import { ownDraft, ownProfile } from '../repositories/access.ts'
import * as drafts from '../repositories/drafts.ts'
import * as knowledgeRepo from '../repositories/knowledge.ts'
import * as posts from '../repositories/posts.ts'
import * as tovRepo from '../repositories/tov.ts'
import { splitFragments } from '@blogos/engine'
import { assertAiBudget } from '../services/cost.ts'
import { recalcPostEmbeddings } from '../services/embeddings/store.ts'
import { buildNarrative, isAnnouncementNotes } from '../services/narrative.ts'
import { toEngineProfile } from '../services/style.ts'
import {
  draftOriginSchema,
  draftStatusSchema,
  strictAiOf,
  strictAiSchema,
} from './schemas.ts'

const rank: Record<string, number> = { draft: 0, on_check: 1, ready: 2, published: 3 }

/** Факты старше этого срока не подмешиваем: в них могли остаться прошедшие события. */
const FACTS_MAX_AGE_DAYS = 180

/**
 * Свежий ли факт. Если даты создания нет — считаем свежим (обратная совместимость):
 * в базе created_at есть всегда, но репозиторий может отдать строку без поля.
 */
function isFreshFact(row: { created_at?: unknown }): boolean {
  const raw = row.created_at
  if (raw === undefined || raw === null || raw === '') return true
  const createdAt = raw instanceof Date ? raw.getTime() : new Date(String(raw)).getTime()
  if (!Number.isFinite(createdAt)) return true
  return Date.now() - createdAt <= FACTS_MAX_AGE_DAYS * 86_400_000
}

const listSchema = listQuerySchema.extend({
  status: draftStatusSchema.optional(),
  origin: draftOriginSchema.optional(),
})

const dateTime = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Ожидается дата ISO 8601')

const createSchema = z.object({
  title: z.string().nullable().optional(),
  source_notes: z.string().nullable().optional(),
  text: z.string().optional(),
  origin: draftOriginSchema.optional(),
  arc: z.string().nullable().optional(),
})

const updateSchema = z.object({
  text: z.string().optional(),
  title: z.string().nullable().optional(),
  status: draftStatusSchema.optional(),
  source_notes: z.string().nullable().optional(),
  arc: z.string().nullable().optional(),
})

const generateSchema = z.object({
  source_notes: z.string().min(1, 'Нужны заметки'),
  arc: z.string().nullable().optional(),
  mode: z.enum(['notes', 'draft']).default('notes'),
  use_llm: z.boolean().optional(),
  strict_ai: strictAiSchema,
})

const publishSchema = z.object({
  published_at: dateTime.nullable().optional(),
})

/** draft → on_check → ready → published; назад можно, из published — нельзя. */
function assertTransition(from: string, to: string): void {
  if (from === to) return
  if (from === 'published') {
    throw unprocessable('Из статуса published выйти нельзя', { reason: 'published_immutable' })
  }
  if (to === 'published') {
    throw unprocessable('Публикация — через POST /drafts/{id}/publish', {
      reason: 'use_publish_endpoint',
    })
  }
  if (rank[to] !== undefined && rank[from] !== undefined && rank[to] > rank[from] + 1) {
    throw unprocessable('Недопустимый переход статуса', {
      reason: 'invalid_transition',
      from,
      to,
    })
  }
}

export async function draftRoutes(app: FastifyInstance): Promise<void> {
  // GET /author-profiles/{id}/drafts
  app.get(
    '/author-profiles/:id/drafts',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const query = parseQuery(listSchema, request.query)
      const result = await drafts.list(request.user!.id, profileId, toListOptions(query), {
        status: query.status,
        origin: query.origin,
      })
      return reply.status(200).send(result)
    },
  )

  // POST /author-profiles/{id}/drafts
  app.post(
    '/author-profiles/:id/drafts',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      await ownProfile(request.user!.id, profileId)
      const body = parseBody(createSchema, request.body)
      const created = await drafts.create(profileId, {
        title: body.title ?? null,
        source_notes: body.source_notes ?? null,
        text: body.text ?? '',
        origin: body.origin ?? 'author',
        arc: body.arc ?? null,
      })
      return reply.status(201).send(created)
    },
  )

  // POST /author-profiles/{id}/drafts/generate — Narrative Engine.
  app.post(
    '/author-profiles/:id/drafts/generate',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      const profile = await ownProfile(request.user!.id, profileId)
      const body = parseBody(generateSchema, request.body)
      const notes = String(body.source_notes ?? '').trim()
      if (!notes) {
        throw unprocessable('Заметки пусты — собирать нечего', { reason: 'empty_notes' })
      }

      const tovRow = await tovRepo.getByAuthor(request.user!.id, profileId)

      // Тонкие заметки: движок не сможет построить арку и вернёт сырые строки —
      // это выглядит как «бред, который не зависит от арки». Лучше сказать честно
      // и подсказать темы канала, чем показывать такой «черновик».
      if (splitFragments(notes).length < 2 && !isAnnouncementNotes(notes)) {
        const metrics = (tovRow?.metrics ?? {}) as Record<string, unknown>
        const topTerms = Array.isArray(metrics.topTerms) ? metrics.topTerms : []
        const topics = topTerms
          .map((term) => (term && typeof term === 'object' ? (term as { label?: unknown }).label : term))
          .filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
          .slice(0, 6)
        throw unprocessable(
          'Нужно хотя бы две мысли в заметках: по одной строке на мысль. Из одной строки структура не собирается',
          {
            reason: 'notes_too_thin',
            hint: 'Напишите 4–6 коротких строк — что случилось, что вы поняли, что посоветуете. Либо возьмите готовый черновик на вкладке «Готовый черновик».',
            ...(topics.length ? { topics } : {}),
          },
        )
      }

      const budget = await assertAiBudget(profileId, { strict: strictAiOf(body) })
      const useLlm = body.use_llm === true
      // Только свежие факты автора (до 180 дней): в старых записях часто остаются
      // прошедшие события, которые модель выдавала за анонсы («приходите 6 ноября»).
      // Прошлые посты в промт как «факты» не подмешиваем: они уже служат примерами
      // голоса в профиле, а как факты модель переносила из них фразы и даты.
      const knowledge = useLlm ? await knowledgeRepo.listRecent(profileId, 5) : []
      const facts = knowledge
        .filter((row) => isFreshFact(row))
        .map((row) => String(row.content ?? '').trim())
        .filter((fact) => fact.length > 0)
      const narrative = await buildNarrative({
        notes,
        arc: body.arc ?? null,
        mode: body.mode,
        profile: toEngineProfile(tovRow),
        facts,
        authorId: profileId,
        useLlm,
        budgetBlocked: budget.blocked,
      })

      const created = await drafts.create(profileId, {
        title: narrative.title,
        source_notes: notes,
        text: narrative.text,
        origin: 'narrative_engine',
        arc: narrative.arc,
      })

      return reply.status(201).send({
        draft: created,
        build: {
          arc: narrative.arc,
          arc_auto: narrative.arcAuto,
          blocks: narrative.blocks,
          added_by_engine: narrative.addedByEngine,
          notes_used: narrative.notesUsed,
          notes_dropped: narrative.notesDropped,
        },
        verified_without_ai: narrative.verifiedWithoutAi,
        generation_run_id: narrative.generationRunId,
        ...(narrative.aiSkippedReason
          ? { ai_skipped_reason: narrative.aiSkippedReason }
          : {}),
      })
    },
  )

  // GET /drafts/{id}
  app.get('/drafts/:id', { preHandler: requireUser }, async (request, reply) => {
    const draftId = paramsId(request.params)
    const draft = await ownDraft(request.user!.id, draftId)
    const latest = await drafts.latestLintReport(draftId)
    return reply.status(200).send({ ...draft, latest_lint_report: latest })
  })

  // PATCH /drafts/{id}
  app.patch('/drafts/:id', { preHandler: requireUser }, async (request, reply) => {
    const draftId = paramsId(request.params)
    const draft = await ownDraft(request.user!.id, draftId)
    const body = parseBody(updateSchema, request.body)
    if (body.status !== undefined) assertTransition(String(draft.status), body.status)

    const updated = await drafts.update(draftId, {
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.source_notes !== undefined ? { source_notes: body.source_notes } : {}),
      ...(body.arc !== undefined ? { arc: body.arc } : {}),
    })
    return reply.status(200).send(updated)
  })

  // DELETE /drafts/{id}
  app.delete('/drafts/:id', { preHandler: requireUser }, async (request, reply) => {
    const draftId = paramsId(request.params)
    await ownDraft(request.user!.id, draftId)
    await drafts.remove(draftId)
    return reply.status(204).send()
  })

  // POST /drafts/{id}/publish — только фиксация в архиве, на площадку ничего не уходит.
  app.post('/drafts/:id/publish', { preHandler: requireUser }, async (request, reply) => {
    const draftId = paramsId(request.params)
    const draft = await ownDraft(request.user!.id, draftId)
    const body = parseBody(publishSchema, request.body)
    const text = String(draft.text ?? '').trim()

    if (!text) {
      throw unprocessable('Черновик пуст: публиковать нечего', { reason: 'empty_text' })
    }
    if (String(draft.status) !== 'ready') {
      throw unprocessable('Публиковать можно только черновик в статусе ready', {
        reason: 'not_ready',
        status: draft.status,
      })
    }
    if (hasUnfilledGaps(text)) {
      throw unprocessable('В тексте остались незаполненные пропуски [дополните: …]', {
        reason: 'unfilled_gaps',
      })
    }

    const platform = String(draft.platform ?? 'telegram')
    const contentType = defaultContentType(platform)
    const limit = exceededLimit(contentType, text)
    if (limit !== null) {
      throw unprocessable(`Текст длиннее лимита площадки: ${limit} символов`, {
        limit,
        content_type: contentType,
      })
    }

    const publishedAt = body.published_at ?? new Date().toISOString()
    const post = await posts.create(Number(draft.author_id), {
      content_type: contentType,
      text,
      published_at: publishedAt,
    })
    const updatedDraft = await drafts.markPublished(draftId, Number(post.id))
    await recalcPostEmbeddings(Number(post.id), text)

    return reply.status(200).send({
      draft: updatedDraft,
      post: { id: post.id, text: post.text, published_at: post.published_at },
    })
  })
}
