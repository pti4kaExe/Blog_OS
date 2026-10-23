/**
 * Журнал вызовов AI и расходов. Переживает удаление канала:
 * author_id становится NULL (ON DELETE SET NULL), запись остаётся.
 */
import { query, queryOne, type QueryParam } from '../db.ts'
import {
  cursorCondition,
  dateRangeCondition,
  paginate,
  type ListOptions,
  type ListResult,
} from '../lib/query.ts'
import type { Row } from './access.ts'

export interface InsertRunInput {
  authorId: number | null
  taskType: string
  model: string
  tokensInput: number
  tokensOutput: number
  tokens: number
  cost: number
  status: 'success' | 'failed'
  errorMessage?: string | null
  durationMs?: number | null
}

export interface RunFilters {
  author_profile_id?: number
  task_type?: string
  status?: string
}

export async function insert(input: InsertRunInput): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO generation_runs
       (author_id, task_type, model, tokens_input, tokens_output, tokens, cost, status, error_message, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      input.authorId,
      input.taskType,
      input.model,
      input.tokensInput,
      input.tokensOutput,
      input.tokens,
      input.cost,
      input.status,
      input.errorMessage ?? null,
      input.durationMs ?? null,
    ],
  )
  if (!row) throw new Error('Запись журнала не создана')
  return Number(row.id)
}

/** user видит только свои каналы, admin — все (docs/API.md, группа 11). */
export async function list(
  userId: number,
  isAdmin: boolean,
  options: ListOptions,
  filters: RunFilters = {},
): Promise<ListResult<Row>> {
  const params: QueryParam[] = []
  let index = 1
  const where: string[] = []

  if (isAdmin) {
    where.push('1 = 1')
  } else {
    params.push(userId)
    where.push('gr.author_id IN (SELECT id FROM author_profiles WHERE user_id = $1)')
    index = 2
  }
  if (filters.author_profile_id !== undefined) {
    params.push(filters.author_profile_id)
    where.push(`gr.author_id = $${index}`)
    index++
  }
  if (filters.task_type) {
    params.push(filters.task_type)
    where.push(`gr.task_type = $${index}`)
    index++
  }
  if (filters.status) {
    params.push(filters.status)
    where.push(`gr.status = $${index}`)
    index++
  }
  const dates = dateRangeCondition(options.from, options.to, 'gr', params, index)
  if (dates.sql) where.push(dates.sql.replace(/^ AND /, ''))
  index = dates.nextIndex
  const cursor = cursorCondition(options.cursor, 'gr', params, index)
  if (cursor.sql) where.push(cursor.sql.replace(/^ AND /, ''))
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT gr.* FROM generation_runs gr
      WHERE ${where.join(' AND ')}
      ORDER BY gr.created_at DESC, gr.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}
