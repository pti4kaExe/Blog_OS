/** Варианты ответа на комментарий: generated → pending_approval → approved|rejected → sent. */
import { query, queryOne, type QueryParam } from '../db.ts'
import { cursorCondition, paginate, type ListOptions, type ListResult } from '../lib/query.ts'
import type { Row } from './access.ts'

export interface CreateResponseInput {
  commentId: number
  responseText: string
  status?: string
  generationRunId?: number | null
}

export interface UpdateResponseInput {
  edited_text?: string | null
  status?: string
  approved_at?: string | null
  sent_at?: string | null
}

export async function list(
  userId: number,
  commentId: number,
  options: ListOptions,
  status?: string,
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [userId, commentId]
  let index = 3
  let where = 'WHERE ap.user_id = $1 AND gr.comment_id = $2'
  if (status) {
    where += ` AND gr.status = $${index}`
    params.push(status)
    index++
  }
  const cursor = cursorCondition(options.cursor, 'gr', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT gr.* FROM generated_responses gr
       JOIN comments c ON c.id = gr.comment_id
       JOIN sources s ON s.id = c.source_id
       JOIN author_profiles ap ON ap.id = s.author_id
      ${where}
      ORDER BY gr.created_at DESC, gr.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function create(input: CreateResponseInput): Promise<Row> {
  const status = input.status ?? 'generated'
  const needsApproval = status === 'approved' || status === 'sent'
  const row = await queryOne<Row>(
    `INSERT INTO generated_responses
       (comment_id, response_text, status, approved_at, sent_at, generation_run_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.commentId,
      input.responseText,
      status,
      needsApproval ? new Date().toISOString() : null,
      status === 'sent' ? new Date().toISOString() : null,
      input.generationRunId ?? null,
    ],
  )
  if (!row) throw new Error('Вариант ответа не создан')
  return row
}

export async function update(responseId: number, patch: UpdateResponseInput): Promise<Row> {
  const sets: string[] = []
  const params: QueryParam[] = [responseId]
  let index = 2
  const set = (column: string, value: QueryParam) => {
    sets.push(`${column} = $${index}`)
    params.push(value)
    index++
  }
  if (patch.edited_text !== undefined) set('edited_text', patch.edited_text)
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.approved_at !== undefined) set('approved_at', patch.approved_at)
  if (patch.sent_at !== undefined) set('sent_at', patch.sent_at)

  if (sets.length === 0) {
    const row = await queryOne<Row>(
      `SELECT * FROM generated_responses WHERE id = $1`,
      [responseId],
    )
    if (!row) throw new Error('Вариант ответа не найден')
    return row
  }
  const row = await queryOne<Row>(
    `UPDATE generated_responses SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  if (!row) throw new Error('Вариант ответа не обновлён')
  return row
}

export async function remove(responseId: number): Promise<void> {
  await query(`DELETE FROM generated_responses WHERE id = $1`, [responseId])
}

export async function countForComment(commentId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM generated_responses WHERE comment_id = $1`,
    [commentId],
  )
  return Number(row?.count ?? 0)
}
