/** Комментарии и обсуждения: ручные, импортированные сканированием. */
import { randomUUID } from 'node:crypto'
import { query, queryOne, transaction, type QueryParam } from '../db.ts'
import {
  cursorCondition,
  dateRangeCondition,
  paginate,
  type ListOptions,
  type ListResult,
} from '../lib/query.ts'
import type { Row } from './access.ts'

export interface CreateCommentInput {
  commenter_name?: string | null
  text: string
  posted_at?: string | null
}

export interface ScannedComment {
  external_id: string
  commenter_name?: string | null
  text: string
  posted_at?: string | null
}

export async function list(
  userId: number,
  sourceId: number,
  options: ListOptions,
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [userId, sourceId]
  let index = 3
  let where = 'WHERE ap.user_id = $1 AND c.source_id = $2'
  const dates = dateRangeCondition(options.from, options.to, 'c', params, index, 'posted_at')
  where += dates.sql
  index = dates.nextIndex
  const cursor = cursorCondition(options.cursor, 'c', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT c.* FROM comments c
       JOIN sources s ON s.id = c.source_id
       JOIN author_profiles ap ON ap.id = s.author_id
      ${where}
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

/** Ручное добавление: сервер сам ставит external_id = manual:<id>. */
export async function createManual(sourceId: number, input: CreateCommentInput): Promise<Row> {
  return transaction(async (tx) => {
    const inserted = await tx.queryOne<{ id: number }>(
      `INSERT INTO comments (source_id, external_id, commenter_name, text, posted_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [sourceId, `pending:${randomUUID()}`, input.commenter_name ?? null, input.text, input.posted_at ?? null],
    )
    if (!inserted) throw new Error('Комментарий не создан')
    const row = await tx.queryOne<Row>(
      `UPDATE comments SET external_id = $2 WHERE id = $1 RETURNING *`,
      [inserted.id, `manual:${inserted.id}`],
    )
    if (!row) throw new Error('Комментарий не создан')
    return row
  })
}

export async function getWithCounts(userId: number, commentId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT c.*,
            (SELECT count(*)::int FROM generated_responses gr WHERE gr.comment_id = c.id) AS responses_count
       FROM comments c
       JOIN sources s ON s.id = c.source_id
       JOIN author_profiles ap ON ap.id = s.author_id
      WHERE c.id = $1 AND ap.user_id = $2`,
    [commentId, userId],
  )
  if (!row) throw new Error('Комментарий не найден')
  return row
}

export async function update(
  commentId: number,
  patch: { commenter_name?: string | null; text?: string },
): Promise<Row> {
  const sets: string[] = []
  const params: QueryParam[] = [commentId]
  let index = 2
  if (patch.commenter_name !== undefined) {
    sets.push(`commenter_name = $${index}`)
    params.push(patch.commenter_name)
    index++
  }
  if (patch.text !== undefined) {
    sets.push(`text = $${index}`)
    params.push(patch.text)
    index++
  }
  if (sets.length === 0) {
    const row = await queryOne<Row>(`SELECT * FROM comments WHERE id = $1`, [commentId])
    if (!row) throw new Error('Комментарий не найден')
    return row
  }
  const row = await queryOne<Row>(
    `UPDATE comments SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  if (!row) throw new Error('Комментарий не обновлён')
  return row
}

export async function remove(commentId: number): Promise<void> {
  await query(`DELETE FROM comments WHERE id = $1`, [commentId])
}

/** Пакетная вставка сканирования: дубликаты по (source_id, external_id) не создаются. */
export async function insertScanned(
  sourceId: number,
  comments: ScannedComment[],
): Promise<{ created: number; duplicates: number; inserted: Row[] }> {
  let created = 0
  let duplicates = 0
  const inserted: Row[] = []
  for (const comment of comments) {
    if (!comment.text || !comment.external_id) {
      duplicates++
      continue
    }
    const row = await queryOne<Row>(
      `INSERT INTO comments (source_id, external_id, commenter_name, text, posted_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id, external_id) DO NOTHING
       RETURNING *`,
      [sourceId, comment.external_id, comment.commenter_name ?? null, comment.text, comment.posted_at ?? null],
    )
    if (row) {
      created++
      inserted.push(row)
    } else {
      duplicates++
    }
  }
  return { created, duplicates, inserted }
}

export async function countForSource(sourceId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM comments WHERE source_id = $1`,
    [sourceId],
  )
  return Number(row?.count ?? 0)
}
