/**
 * Отчёты AntiCringe. Неизменяемы после создания: UPDATE запрещён триггером
 * в БД, здесь только INSERT и чтение (история — цепочка отчётов).
 */
import { query, queryOne, type QueryParam } from '../db.ts'
import { cursorCondition, paginate, type ListOptions, type ListResult } from '../lib/query.ts'
import type { Row } from './access.ts'

export interface InsertLintReportInput {
  draftId: number
  score: number
  issues: unknown[]
  engine: 'rules' | 'rules+llm'
  generationRunId: number | null
}

export async function insert(input: InsertLintReportInput): Promise<Row> {
  const row = await queryOne<Row>(
    `INSERT INTO lint_reports (draft_id, score, issues, engine, generation_run_id)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING *`,
    [
      input.draftId,
      input.score,
      JSON.stringify(input.issues),
      input.engine,
      input.generationRunId,
    ],
  )
  if (!row) throw new Error('Отчёт проверки не создан')
  return row
}

export async function listByDraft(
  userId: number,
  draftId: number,
  options: ListOptions,
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [userId, draftId]
  let index = 3
  let where = 'WHERE ap.user_id = $1 AND lr.draft_id = $2'
  const cursor = cursorCondition(options.cursor, 'lr', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT lr.* FROM lint_reports lr
       JOIN drafts d ON d.id = lr.draft_id
       JOIN author_profiles ap ON ap.id = d.author_id
      ${where}
      ORDER BY lr.created_at DESC, lr.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function latest(draftId: number): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT * FROM lint_reports WHERE draft_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [draftId],
  )
}
