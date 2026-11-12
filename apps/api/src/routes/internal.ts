/**
 * Внутренний стенд качества генерации.
 *
 * Доступ: только с заголовком `x-internal-token`, равным env.MIGRATE_TOKEN.
 * Если токен не задан на сервере — маршрута как будто нет (404), чтобы стенд
 * нельзя было открыть случайно на проде.
 *
 * Зачем: сравнивать версии промта на одних и тех же заметках и видеть не только
 * текст, но и оценку правил, клише и запрещённые фразы. Это инструмент для
 * разработки, а не публичный API: в /api/v1 он не дублируется.
 */
import type { FastifyInstance } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { queryOne } from '../db.ts'
import * as tovRepo from '../repositories/tov.ts'
import { runRulesLint } from '../services/lint.ts'
import { BANNED_CLICHES } from '../services/llm/prompts.ts'
import { buildNarrative } from '../services/narrative.ts'
import { toEngineProfile, type EngineProfile } from '../services/style.ts'

const evalSchema = z.object({
  notes: z.string().trim().min(20, 'Нужны заметки: хотя бы 20 символов'),
  variants: z.array(z.enum(['v1', 'v2'])).min(1).max(2).default(['v1', 'v2']),
  runs: z.coerce.number().int().min(1).max(2).default(1),
  author_id: z.coerce.number().int().positive().optional(),
  profile_id: z.coerce.number().int().positive().optional(),
})

/** Синтетический профиль: стенд работает и без реального канала. */
const SYNTHETIC_PROFILE: EngineProfile = {
  address: 'ты',
  avgSentenceLen: 12,
  firstPersonPer100Words: 3,
  stopWords: ['осуществлять', 'является'],
  topTerms: [
    { label: 'личный опыт', weight: 1 },
    { label: 'наблюдения', weight: 0.8 },
    { label: 'ошибки', weight: 0.6 },
  ],
  signaturePhrases: [],
  samples: [],
} as unknown as EngineProfile

function sameSecret(provided: unknown, secret: string): boolean {
  if (!secret) return false
  const value = typeof provided === 'string' ? provided : ''
  const a = Buffer.from(value)
  const b = Buffer.from(secret)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`таймаут ${label}: ${ms} мс`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/internal/eval', async (request, reply) => {
    const secret = process.env.MIGRATE_TOKEN ?? ''
    if (!sameSecret(request.headers['x-internal-token'], secret)) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Маршрут не найден' } })
    }

    const parsed = evalSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'validation_error',
          message: parsed.error.issues[0]?.message ?? 'Неверные параметры',
          details: { issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
        },
      })
    }

    const body = parsed.data
    // Не больше двух вызовов модели на запрос: стенд не должен превращаться
    // в генератор расходов.
    const calls: Array<{ variant: 'v1' | 'v2'; run: number }> = []
    for (let run = 1; run <= body.runs; run++) {
      for (const variant of body.variants) {
        if (calls.length >= 2) break
        calls.push({ variant, run })
      }
    }

    // Профиль: явный из БД или первый попавшийся канал (демо-данные в тестах).
    let profileId: number | null = body.profile_id ?? null
    let userId: number | null = body.author_id ?? null
    if (profileId === null) {
      const row = await queryOne<{ id: number; user_id: number }>(
        'SELECT id, user_id FROM author_profiles ORDER BY id ASC LIMIT 1',
      )
      if (row) {
        profileId = Number(row.id)
        userId = userId ?? Number(row.user_id)
      }
    }
    if (profileId === null || userId === null) {
      return reply.status(422).send({
        error: { code: 'unprocessable', message: 'Нет ни одного канала: создайте канал или передайте profile_id' },
      })
    }

    const tovRow = await tovRepo.getByAuthor(userId, profileId)
    const profile = toEngineProfile(tovRow) ?? SYNTHETIC_PROFILE

    const results = []
    for (const call of calls) {
      const started = Date.now()
      try {
        const narrative = await withTimeout(
          buildNarrative({
            notes: body.notes,
            arc: null,
            mode: 'notes',
            profile,
            authorId: profileId,
            useLlm: true,
            budgetBlocked: false,
            promptVariant: call.variant,
          }),
          45_000,
          'генерации',
        )
        const text = narrative.text ?? ''
        const lint = runRulesLint(text, profile)
        const lower = text.toLowerCase()
        results.push({
          variant: call.variant,
          run: call.run,
          ok: text.trim().length > 0,
          chars: text.length,
          rules_score: lint.score,
          cliches: lint.issues
            .filter((issue) => issue.type === 'cliche' || issue.category === 'cliche')
            .map((issue) => issue.quote)
            .filter(Boolean)
            .slice(0, 10),
          banned_used: BANNED_CLICHES.filter((phrase) => lower.includes(phrase)),
          ai_skipped_reason: narrative.aiSkippedReason ?? null,
          latency_ms: Date.now() - started,
          text,
        })
      } catch (error) {
        results.push({
          variant: call.variant,
          run: call.run,
          ok: false,
          chars: 0,
          rules_score: null,
          cliches: [],
          banned_used: [],
          latency_ms: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return reply.send({ profile_id: profileId, prompt: process.env.NARRATIVE_PROMPT ?? 'v2', results })
  })
}
