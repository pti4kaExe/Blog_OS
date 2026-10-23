/** Группа 3. Стиль — 3 метода. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.ts'
import { notFound, unprocessable } from '../errors.ts'
import { parseBody, paramsId } from '../lib/query.ts'
import { ownProfile } from '../repositories/access.ts'
import * as posts from '../repositories/posts.ts'
import * as tovRepo from '../repositories/tov.ts'
import { assertAiBudget } from '../services/cost.ts'
import { callLlm, llmConfigured, parseJson } from '../services/llm/index.ts'
import { TOV_SYSTEM, tovUser } from '../services/llm/prompts.ts'
import { analyzeTov, toneFromAddress, totalChars } from '../services/style.ts'
import { strictAiOf, strictAiSchema, toneSchema } from './schemas.ts'

const putSchema = z.object({
  tone: toneSchema,
  slang: z.array(z.string()).default([]),
  stop_words: z.array(z.string()).default([]),
  favorite_phrases: z.array(z.string()).default([]),
  metrics: z.record(z.unknown()).nullable().optional(),
})

const analyzeSchema = z.object({
  texts: z.array(z.string()).optional(),
  use_archive: z.boolean().optional(),
  use_llm: z.boolean().optional(),
  strict_ai: strictAiSchema,
})

export async function tovRoutes(app: FastifyInstance): Promise<void> {
  // GET /author-profiles/{id}/tov
  app.get('/author-profiles/:id/tov', { preHandler: requireUser }, async (request, reply) => {
    const profileId = paramsId(request.params)
    await ownProfile(request.user!.id, profileId)
    const profile = await tovRepo.getByAuthor(request.user!.id, profileId)
    if (!profile) throw notFound('Профиль стиля ещё не построен')
    return reply.status(200).send(profile)
  })

  // PUT /author-profiles/{id}/tov — полная замена, идемпотентно.
  app.put('/author-profiles/:id/tov', { preHandler: requireUser }, async (request, reply) => {
    const profileId = paramsId(request.params)
    await ownProfile(request.user!.id, profileId)
    const body = parseBody(putSchema, request.body)
    const saved = await tovRepo.upsert(profileId, {
      tone: body.tone,
      slang: body.slang,
      stop_words: body.stop_words,
      favorite_phrases: body.favorite_phrases,
      metrics: body.metrics ?? null,
      analyzed_at: false,
    })
    return reply.status(200).send(saved)
  })

  // POST /author-profiles/{id}/tov/analyze
  app.post(
    '/author-profiles/:id/tov/analyze',
    { preHandler: requireUser },
    async (request, reply) => {
      const profileId = paramsId(request.params)
      const profile = await ownProfile(request.user!.id, profileId)
      const body = parseBody(analyzeSchema, request.body)

      const budget = await assertAiBudget(profile.id, { strict: strictAiOf(body) })

      let texts = (body.texts ?? []).map((text) => String(text).trim()).filter(Boolean)
      if (texts.length === 0 && body.use_archive !== false) {
        const archive = await posts.listRecent(profile.id, 3)
        texts = archive.map((post) => String(post.text ?? '')).filter(Boolean)
      }
      const chars = totalChars(texts)
      if (texts.length === 0 || chars < 180) {
        throw unprocessable('Для профиля стиля нужно суммарно не меньше 180 символов', {
          reason: 'too_short',
          length: chars,
        })
      }

      const analysis = analyzeTov(texts)
      if (!analysis) {
        throw unprocessable('Для профиля стиля нужно суммарно не меньше 180 символов', {
          reason: 'too_short',
          length: chars,
        })
      }

      let verifiedWithoutAi = true
      let source: 'rules' | 'rules+llm' = 'rules'
      let generationRunId: number | null = null
      let aiSkippedReason: string | undefined

      const useLlm = body.use_llm !== false
      if (!useLlm) {
        aiSkippedReason = undefined
      } else if (budget.blocked) {
        aiSkippedReason = 'budget_exceeded'
      } else if (!llmConfigured()) {
        aiSkippedReason = 'llm_not_configured'
      } else {
        const outcome = await callLlm({
          authorId: profileId,
          taskType: 'tov_analyze',
          system: TOV_SYSTEM,
          user: tovUser(texts),
          json: true,
          maxTokens: 800,
        })
        if (!outcome.ok) {
          aiSkippedReason = 'llm_unavailable'
        } else {
          const parsed = parseJson<{
            tone?: unknown
            slang?: unknown
            favorite_phrases?: unknown
          }>(outcome.result.text)
          if (parsed) {
            const slang = Array.isArray(parsed.slang)
              ? (parsed.slang as unknown[]).filter((x): x is string => typeof x === 'string')
              : analysis.input.slang
            const phrases = Array.isArray(parsed.favorite_phrases)
              ? (parsed.favorite_phrases as unknown[]).filter(
                  (x): x is string => typeof x === 'string',
                )
              : analysis.input.favorite_phrases
            analysis.input.tone =
              typeof parsed.tone === 'string'
                ? toneFromAddress(parsed.tone)
                : analysis.input.tone
            analysis.input.slang = slang
            analysis.input.favorite_phrases = phrases
            verifiedWithoutAi = false
            source = 'rules+llm'
            generationRunId = outcome.generationRunId
          } else {
            aiSkippedReason = 'llm_empty_response'
          }
        }
      }

      const saved = await tovRepo.upsert(profileId, analysis.input)
      return reply.status(200).send({
        tov_profile: saved,
        analysis: { source, chars, posts_used: texts.length },
        verified_without_ai: verifiedWithoutAi,
        generation_run_id: generationRunId,
        ...(aiSkippedReason ? { ai_skipped_reason: aiSkippedReason } : {}),
      })
    },
  )
}
