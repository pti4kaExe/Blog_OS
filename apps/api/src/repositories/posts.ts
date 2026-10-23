/** Посты: архив публикаций, дедупликация импорта по (author_id, external_id). */
import { query, queryOne, type QueryParam } from '../db.ts'
import {
  cursorCondition,
  dateRangeCondition,
  paginate,
  type ListOptions,
  type ListResult,
} from '../lib/query.ts'
import type { Row } from './access.ts'

export interface CreatePostInput {
  content_type: string
  text: string
  external_id?: string | null
  external_url?: string | null
  published_at?: string | null
}

export interface PostFilters {
  content_type?: string
}

export async function list(
  userId: number,
  profileId: number,
  options: ListOptions,
  filters: PostFilters = {},
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [userId, profileId]
  let index = 3
  let where = 'WHERE ap.user_id = $1 AND p.author_id = $2'
  if (filters.content_type) {
    where += ` AND p.content_type = $${index}`
    params.push(filters.content_type)
    index++
  }
  const dates = dateRangeCondition(options.from, options.to, 'p', params, index)
  where += dates.sql
  index = dates.nextIndex
  const cursor = cursorCondition(options.cursor, 'p', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT p.* FROM posts p
       JOIN author_profiles ap ON ap.id = p.author_id
      ${where}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function create(authorId: number, input: CreatePostInput): Promise<Row> {
  const row = await queryOne<Row>(
    `INSERT INTO posts (author_id, content_type, text, external_id, external_url, published_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      authorId,
      input.content_type,
      input.text,
      input.external_id ?? null,
      input.external_url ?? null,
      input.published_at ?? null,
    ],
  )
  if (!row) throw new Error('Пост не создан')
  return row
}

export async function update(
  postId: number,
  patch: { text?: string; content_type?: string; published_at?: string | null; external_url?: string | null },
): Promise<Row> {
  const sets: string[] = []
  const params: QueryParam[] = [postId]
  let index = 2
  const set = (column: string, value: QueryParam) => {
    sets.push(`${column} = $${index}`)
    params.push(value)
    index++
  }
  if (patch.text !== undefined) set('text', patch.text)
  if (patch.content_type !== undefined) set('content_type', patch.content_type)
  if (patch.published_at !== undefined) set('published_at', patch.published_at)
  if (patch.external_url !== undefined) set('external_url', patch.external_url)

  if (sets.length === 0) {
    const row = await queryOne<Row>(`SELECT * FROM posts WHERE id = $1`, [postId])
    if (!row) throw new Error('Пост не найден')
    return row
  }
  const row = await queryOne<Row>(
    `UPDATE posts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  if (!row) throw new Error('Пост не обновлён')
  return row
}

export async function remove(postId: number): Promise<void> {
  await query(`DELETE FROM posts WHERE id = $1`, [postId])
}

export async function findByExternal(authorId: number, externalId: string): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT * FROM posts WHERE author_id = $1 AND external_id = $2`,
    [authorId, externalId],
  )
}

export async function listRecent(authorId: number, limit: number): Promise<Row[]> {
  return query<Row>(
    `SELECT * FROM posts WHERE author_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [authorId, limit],
  )
}
