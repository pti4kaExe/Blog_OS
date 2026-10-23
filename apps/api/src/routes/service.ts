/** Группа 11. Служебные — 7 методов: журнал AI, golden-dataset, evals. */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAdmin, requireUser } from '../auth.ts'
import { notFound, unprocessable } from '../errors.ts'
import { listQuerySchema, parseBody, parseQuery, paramsId, toListOptions } from '../lib/query.ts'
import { getBudgetState } from '../services/cost.ts'
import * as evalsRepo from '../repositories/evals.ts'
import * as golden from '../repositories/goldenDataset.ts'
import * as runs from '../repositories/generationRuns.ts'
import { runEvals } from '../services/evals.ts'
import {
  goldenLabelSchema,
  platformSchema,
  runStatusSchema,
  taskTypeSchema,
} from './schemas.ts'

const runsQuerySchema = listQuerySchema.extend({
  author_profile_id: z.coerce.number().int().min(1).optional(),
  task_type: taskTypeSchema.optional(),
  status: runStatusSchema.optional(),
})

const goldenListSchema = listQuerySchema.extend({
  platform: platformSchema.optional(),
})

const goldenCreateSchema = z.object({
  text: z.string().trim().min(1, 'Текст эталона не может быть пустым'),
  labels: z.array(goldenLabelSchema).default([]),
  platform: platformSchema.nullable().optional(),
})

const goldenUpdateSchema = z.object({
  text: z.string().trim().min(1, 'Текст эталона не может быть пустым').optional(),
  labels: z.array(goldenLabelSchema).optional(),
  platform: platformSchema.nullable().optional(),
})

const evalRunSchema = z.object({
  use_llm: z.boolean().optional(),
  platform: platformSchema.nullable().optional(),
})

const evalsRunsSchema = listQuerySchema.extend({
  generation_run_id: z.coerce.number().int().min(1).optional(),
})

export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  // GET /generation-runs — user видит только свои каналы, admin — все.
  app.get('/generation-runs', { preHandler: requireUser }, async (request, reply) => {
    const query = parseQuery(runsQuerySchema, request.query)
    const result = await runs.list(
      request.user!.id,
      request.user!.role === 'admin',
      toListOptions(query),
      {
        author_profile_id: query.author_profile_id,
        task_type: query.task_type,
        status: query.status,
      },
    )
    return reply.status(200).send(result)
  })

  // GET /golden-dataset — только admin.
  app.get('/golden-dataset', { preHandler: requireAdmin }, async (request, reply) => {
    const query = parseQuery(goldenListSchema, request.query)
    const result = await golden.list(toListOptions(query), query.platform)
    return reply.status(200).send(result)
  })

  // POST /golden-dataset — только admin.
  app.post('/golden-dataset', { preHandler: requireAdmin }, async (request, reply) => {
    const body = parseBody(goldenCreateSchema, request.body)
    const created = await golden.create({
      text: body.text,
      labels: body.labels,
      platform: body.platform ?? null,
    })
    return reply.status(201).send(created)
  })

  // PATCH /golden-dataset/{id} — только admin.
  app.patch('/golden-dataset/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const goldenId = paramsId(request.params)
    const existing = await golden.getById(goldenId)
    if (!existing) throw notFound('Эталон не найден')
    const body = parseBody(goldenUpdateSchema, request.body)
    const updated = await golden.update(goldenId, {
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.labels !== undefined ? { labels: body.labels } : {}),
      ...(body.platform !== undefined ? { platform: body.platform } : {}),
    })
    return reply.status(200).send(updated)
  })

  // DELETE /golden-dataset/{id} — только admin.
  app.delete('/golden-dataset/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const goldenId = paramsId(request.params)
    const existing = await golden.getById(goldenId)
    if (!existing) throw notFound('Эталон не найден')
    await golden.remove(goldenId)
    return reply.status(204).send()
  })

  // POST /evals/run — только admin, прогон lint по golden_dataset.
  app.post('/evals/run', { preHandler: requireAdmin }, async (request, reply) => {
    const body = parseBody(evalRunSchema, request.body)
    const goldens = await golden.listAll(body.platform ?? undefined)
    if (goldens.length === 0) {
      throw unprocessable('golden_dataset пуст: оценивать нечего', {
        reason: 'empty_golden_dataset',
      })
    }
    const result = await runEvals(goldens)
    return reply.status(201).send(result)
  })

  // GET /evals/runs — только admin; без фильтра — сводка по прогонам.
  app.get('/evals/runs', { preHandler: requireAdmin }, async (request, reply) => {
    const query = parseQuery(evalsRunsSchema, request.query)
    const options = toListOptions(query)
    const result =
      query.generation_run_id !== undefined
        ? await evalsRepo.listByRun(query.generation_run_id, options)
        : await evalsRepo.runsSummary(options)
    return reply.status(200).send(result)
  })

  // Внутренняя проверка лимита канала доступна только через /usage; здесь
  // оставлен импорт, чтобы не дублировать формулу в маршрутах Evals.
  void getBudgetState
}
