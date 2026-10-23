/** Черновики: ручные и собранные Narrative Engine, переходы статусов. */
import { query, queryOne, type QueryParam } from '../db.ts'
import {
  cursorCondition,
  paginate,
  type ListOptions,
  type ListResult,
} from '../lib/query.ts'
import type { Row } from './access.ts'

export interface CreateDraftInput {
  title?: string | null
  source_notes?: string | null
  text?: string
  origin?: string
  arc?: string | null
}

export interface UpdateDraftInput {
  title?: string | null
  source_notes?: string | null
  text?: string
  status?: string
  arc?: string | null
}

export interface DraftFilters {
  status?: string
  origin?: string
}

export async function list(
  userId: number,
  profileId: number,
  options: ListOptions,
  filters: DraftFilters = {},
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [userId, profileId]
  let index = 3
  let where = 'WHERE ap.user_id = $1 AND d.author_id = $2'
  if (filters.status) {
    where += ` AND d.status = $${index}`
    params.push(filters.status)
    index++
  }
  if (filters.origin) {
    where += ` AND d.origin = $${index}`
    params.push(filters.origin)
    index++
  }
  const cursor = cursorCondition(options.cursor, 'd', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT d.* FROM drafts d
       JOIN author_profiles ap ON ap.id = d.author_id
      ${where}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function create(authorId: number, input: CreateDraftInput): Promise<Row> {
  // Схема объявляет text NOT NULL CHECK (length(text) > 0), а контракт
  // допускает создание черновика с text: "". Храним один пробел: «пустой текст»
  // проверяется через trim (422 empty_text при публикации/проверке).
  const text = input.text && input.text.length > 0 ? input.text : ' '
  const row = await queryOne<Row>(
    `INSERT INTO drafts (author_id, title, source_notes, text, origin, arc)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      authorId,
      input.title ?? null,
      input.source_notes ?? null,
      text,
      input.origin ?? 'author',
      input.arc ?? null,
    ],
  )
  if (!row) throw new Error('Черновик не создан')
  return row
}

export async function update(draftId: number, patch: UpdateDraftInput): Promise<Row> {
  const sets: string[] = []
  const params: QueryParam[] = [draftId]
  let index = 2
  const set = (column: string, value: QueryParam) => {
    sets.push(`${column} = $${index}`)
    params.push(value)
    index++
  }
  if (patch.title !== undefined) set('title', patch.title)
  if (patch.source_notes !== undefined) set('source_notes', patch.source_notes)
  if (patch.text !== undefined) set('text', patch.text)
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.arc !== undefined) set('arc', patch.arc)

  if (sets.length === 0) {
    const row = await queryOne<Row>(`SELECT * FROM drafts WHERE id = $1`, [draftId])
    if (!row) throw new Error('Черновик не найден')
    return row
  }
  const row = await queryOne<Row>(
    `UPDATE drafts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  if (!row) throw new Error('Черновик не обновлён')
  return row
}

export async function remove(draftId: number): Promise<void> {
  await query(`DELETE FROM drafts WHERE id = $1`, [draftId])
}

export async function latestLintReport(draftId: number): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT * FROM lint_reports WHERE draft_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [draftId],
  )
}

export async function markPublished(draftId: number, postId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `UPDATE drafts SET status = 'published', published_post_id = $2 WHERE id = $1 RETURNING *`,
    [draftId, postId],
  )
  if (!row) throw new Error('Черновик не опубликован')
  return row
}
