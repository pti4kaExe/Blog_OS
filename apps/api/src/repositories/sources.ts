/** Источники CommentRadar: площадки, которые отслеживает автор. */
import { query, queryOne, type QueryParam } from '../db.ts'
import { cursorCondition, paginate, type ListOptions, type ListResult } from '../lib/query.ts'
import type { Row } from './access.ts'

export interface CreateSourceInput {
  name: string
  source_type: string
  source_url: string
}

export interface UpdateSourceInput {
  name?: string
  source_url?: string
  is_active?: boolean
}

export interface SourceFilters {
  is_active?: boolean
  source_type?: string
}

export async function list(
  userId: number,
  profileId: number,
  options: ListOptions,
  filters: SourceFilters = {},
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [userId, profileId]
  let index = 3
  let where = 'WHERE ap.user_id = $1 AND s.author_id = $2'
  if (filters.is_active !== undefined) {
    where += ` AND s.is_active = $${index}`
    params.push(filters.is_active)
    index++
  }
  if (filters.source_type) {
    where += ` AND s.source_type = $${index}`
    params.push(filters.source_type)
    index++
  }
  const cursor = cursorCondition(options.cursor, 's', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT s.*,
            (SELECT count(*)::int FROM comments c WHERE c.source_id = s.id) AS comments_count
       FROM sources s
       JOIN author_profiles ap ON ap.id = s.author_id
      ${where}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function create(authorId: number, input: CreateSourceInput): Promise<Row> {
  const row = await queryOne<Row>(
    `INSERT INTO sources (author_id, name, source_type, source_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [authorId, input.name, input.source_type, input.source_url],
  )
  if (!row) throw new Error('Источник не создан')
  return row
}

export async function getWithCounts(userId: number, sourceId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT s.*,
            (SELECT count(*)::int FROM comments c WHERE c.source_id = s.id) AS comments_count
       FROM sources s
       JOIN author_profiles ap ON ap.id = s.author_id
      WHERE s.id = $1 AND ap.user_id = $2`,
    [sourceId, userId],
  )
  if (!row) throw new Error('Источник не найден')
  return row
}

export async function update(sourceId: number, patch: UpdateSourceInput): Promise<Row> {
  const sets: string[] = []
  const params: QueryParam[] = [sourceId]
  let index = 2
  const set = (column: string, value: QueryParam) => {
    sets.push(`${column} = $${index}`)
    params.push(value)
    index++
  }
  if (patch.name !== undefined) set('name', patch.name)
  if (patch.source_url !== undefined) set('source_url', patch.source_url)
  if (patch.is_active !== undefined) set('is_active', patch.is_active)
  if (sets.length === 0) {
    const row = await queryOne<Row>(`SELECT * FROM sources WHERE id = $1`, [sourceId])
    if (!row) throw new Error('Источник не найден')
    return row
  }
  const row = await queryOne<Row>(
    `UPDATE sources SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  if (!row) throw new Error('Источник не обновлён')
  return row
}

export async function remove(sourceId: number): Promise<void> {
  await query(`DELETE FROM sources WHERE id = $1`, [sourceId])
}

export async function markScanOk(sourceId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `UPDATE sources
        SET last_scanned_at = now(), last_scan_status = 'ok', last_scan_error = NULL
      WHERE id = $1 RETURNING *`,
    [sourceId],
  )
  if (!row) throw new Error('Источник не найден')
  return row
}

export async function markScanFailed(sourceId: number, errorMessage: string): Promise<void> {
  await query(
    `UPDATE sources
        SET last_scan_status = 'failed', last_scan_error = $2
      WHERE id = $1`,
    [sourceId, errorMessage.slice(0, 500)],
  )
}
