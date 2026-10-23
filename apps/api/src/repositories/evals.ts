/** Результаты Evals: по одному на пару (generation_run_id, golden_id). */
import { query, queryOne, transaction, type QueryParam } from '../db.ts'
import { cursorCondition, paginate, type ListOptions, type ListResult } from '../lib/query.ts'
import type { Row } from './access.ts'

export interface EvalResultRow {
  goldenId: number
  precision: number
  recall: number
  matched: unknown[]
  missed: unknown[]
  falsePositive: unknown[]
}

export async function insertResults(
  generationRunId: number,
  results: EvalResultRow[],
): Promise<void> {
  await transaction(async (tx) => {
    for (const result of results) {
      await tx.query(
        `INSERT INTO eval_results
           (generation_run_id, golden_id, precision, recall, matched, missed, false_positive)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
        [
          generationRunId,
          result.goldenId,
          result.precision,
          result.recall,
          JSON.stringify(result.matched),
          JSON.stringify(result.missed),
          JSON.stringify(result.falsePositive),
        ],
      )
    }
  })
}

export async function listByRun(
  generationRunId: number,
  options: ListOptions,
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [generationRunId]
  let index = 2
  let where = 'WHERE er.generation_run_id = $1'
  const cursor = cursorCondition(options.cursor, 'er', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT er.* FROM eval_results er
      ${where}
      ORDER BY er.created_at DESC, er.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

/** Сводка по прогонам Evals (без фильтра generation_run_id). */
export async function runsSummary(options: ListOptions): Promise<ListResult<Row>> {
  const params: QueryParam[] = []
  let index = 1
  let where = 'WHERE gr.task_type = \'lint\''
  const cursor = cursorCondition(options.cursor, 'gr', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT gr.id AS generation_run_id,
            gr.id AS id,
            gr.created_at,
            count(er.id)::int AS goldens,
            coalesce(avg(er.precision), 0)::float8 AS precision,
            coalesce(avg(er.recall), 0)::float8 AS recall,
            coalesce(sum(jsonb_array_length(er.matched)), 0)::int AS matched,
            coalesce(sum(jsonb_array_length(er.missed)), 0)::int AS missed,
            coalesce(sum(jsonb_array_length(er.false_positive)), 0)::int AS false_positive
       FROM generation_runs gr
       JOIN eval_results er ON er.generation_run_id = gr.id
      ${where}
      GROUP BY gr.id, gr.created_at
      ORDER BY gr.created_at DESC, gr.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function getResult(
  generationRunId: number,
  goldenId: number,
): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT * FROM eval_results WHERE generation_run_id = $1 AND golden_id = $2`,
    [generationRunId, goldenId],
  )
}
