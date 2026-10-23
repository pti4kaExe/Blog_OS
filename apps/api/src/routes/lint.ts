/** Группа 6. Проверка — 3 метода. Отчёты неизменяемы, повторная проверка — новая запись. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireUser } from '../auth.ts'
import { unprocessable } from '../errors.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import { ownDraft, ownLintReport } from '../repositories/access.ts'
import * as lintRepo from '../repositories/lint.ts'
import * as tovRepo from '../repositories/tov.ts'
import { assertAiBudget } from '../services/cost.ts'
import { runLint } from '../services/lint.ts'
import { toEngineProfile } from '../services/style.ts'
import { strictAiOf, strictAiSchema } from './schemas.ts'

const lintSchema = z.object({
  use_llm: z.boolean().optional(),
  strict_ai: strictAiSchema,
})

export async function lintRoutes(app: FastifyInstance): Promise<void> {
  // POST /drafts/{id}/lint
  app.post('/drafts/:id/lint', { preHandler: requireUser }, async (request, reply) => {
    const draftId = paramsId(request.params)
    const draft = await ownDraft(request.user!.id, draftId)
    const body = parseBody(lintSchema, request.body)
    const text = String(draft.text ?? '')

    if (!text.trim()) {
      throw unprocessable('Текст пуст — проверять нечего', { reason: 'empty_text' })
    }

    const authorId = Number(draft.author_id)
    const useLlm = body.use_llm !== false
    const budget = await assertAiBudget(authorId, {
      strict: useLlm && strictAiOf(body),
    })
    const tovRow = await tovRepo.getByAuthor(request.user!.id, authorId)

    const outcome = await runLint({
      text,
      profile: toEngineProfile(tovRow),
      authorId,
      useLlm,
      budgetBlocked: budget.blocked,
    })

    const report = await lintRepo.insert({
      draftId,
      score: outcome.score,
      issues: outcome.issues,
      engine: outcome.engine,
      generationRunId: outcome.generationRunId,
    })

    return reply.status(201).send({
      lint_report: report,
      groups: outcome.groups,
      verdict: outcome.verdict,
      verified_without_ai: outcome.verifiedWithoutAi,
      ...(outcome.aiSkippedReason ? { ai_skipped_reason: outcome.aiSkippedReason } : {}),
    })
  })

  // GET /drafts/{id}/lint-reports
  app.get('/drafts/:id/lint-reports', { preHandler: requireUser }, async (request, reply) => {
    const draftId = paramsId(request.params)
    await ownDraft(request.user!.id, draftId)
    const query = parseQuery(listQuerySchema, request.query)
    const result = await lintRepo.listByDraft(request.user!.id, draftId, toListOptions(query))
    return reply.status(200).send(result)
  })

  // GET /lint-reports/{id} — после удаления черновика отчёт удалён каскадом → 404.
  app.get('/lint-reports/:id', { preHandler: requireUser }, async (request, reply) => {
    const reportId = paramsId(request.params)
    const report = await ownLintReport(request.user!.id, reportId)
    return reply.status(200).send(report)
  })
}
