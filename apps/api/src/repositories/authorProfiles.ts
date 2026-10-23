/** Каналы (author_profiles): всё остальное в API привязано к каналу. */
import { query, queryOne, type QueryParam } from '../db.ts'
import { notFound } from '../errors.ts'
import {
  cursorCondition,
  paginate,
  type ListOptions,
  type ListResult,
} from '../lib/query.ts'
import { ownProfile, type ProfileRow } from './access.ts'

export type Row = Record<string, unknown>

export interface CreateProfileInput {
  name: string
  platform: string
  description?: string | null
  content_settings?: Row | null
  monthly_cost_limit?: number | null
}

export interface UpdateProfileInput {
  name?: string
  platform?: string
  description?: string | null
  content_settings?: Row | null
  monthly_cost_limit?: number | null
}

export async function list(
  userId: number,
  options: ListOptions,
  platform?: string,
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [userId]
  let index = 2
  let where = 'WHERE ap.user_id = $1'
  if (platform) {
    where += ` AND ap.platform = $${index}`
    params.push(platform)
    index++
  }
  const cursor = cursorCondition(options.cursor, 'ap', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT ap.* FROM author_profiles ap
      ${where}
      ORDER BY ap.created_at DESC, ap.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function create(userId: number, input: CreateProfileInput): Promise<Row> {
  const row = await queryOne<Row>(
    `INSERT INTO author_profiles (user_id, name, platform, description, content_settings, monthly_cost_limit)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING *`,
    [
      userId,
      input.name,
      input.platform,
      input.description ?? null,
      input.content_settings ? JSON.stringify(input.content_settings) : null,
      input.monthly_cost_limit ?? null,
    ],
  )
  if (!row) throw new Error('Канал не создан')
  return row
}

export async function getWithCounts(userId: number, profileId: number): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT ap.*,
            (SELECT count(*)::int FROM tov_profiles t WHERE t.author_id = ap.id) AS tov_profiles_count,
            (SELECT count(*)::int FROM posts p WHERE p.author_id = ap.id) AS posts_count,
            (SELECT count(*)::int FROM drafts d WHERE d.author_id = ap.id) AS drafts_count
       FROM author_profiles ap
      WHERE ap.id = $1 AND ap.user_id = $2`,
    [profileId, userId],
  )
  if (!row) throw notFound('Канал не найден')
  return row
}

export async function update(
  userId: number,
  profileId: number,
  patch: UpdateProfileInput,
): Promise<Row> {
  await ownProfile(userId, profileId)
  const sets: string[] = []
  const params: QueryParam[] = [profileId]
  let index = 2

  const set = (sql: string, value: unknown) => {
    sets.push(`${sql} = $${index}`)
    params.push(value)
    index++
  }

  if (patch.name !== undefined) set('name', patch.name)
  if (patch.platform !== undefined) set('platform', patch.platform)
  if (patch.description !== undefined) set('description', patch.description)
  if (patch.content_settings !== undefined) {
    sets.push(`content_settings = $${index}::jsonb`)
    params.push(patch.content_settings ? JSON.stringify(patch.content_settings) : null)
    index++
  }
  if (patch.monthly_cost_limit !== undefined) set('monthly_cost_limit', patch.monthly_cost_limit)

  if (sets.length === 0) {
    const row = await queryOne<Row>(`SELECT * FROM author_profiles WHERE id = $1`, [profileId])
    if (!row) throw notFound('Канал не найден')
    return row
  }

  const row = await queryOne<Row>(
    `UPDATE author_profiles SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  if (!row) throw notFound('Канал не найден')
  return row
}

export async function remove(userId: number, profileId: number): Promise<void> {
  await ownProfile(userId, profileId)
  await query(`DELETE FROM author_profiles WHERE id = $1`, [profileId])
}

/** Количество каналов пользователя: лимит 20 (docs/API.md, группа 2). */
export async function countForUser(userId: number): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM author_profiles WHERE user_id = $1`,
    [userId],
  )
  return Number(row?.count ?? 0)
}

/** Профиль канала без проверки владельца — для внутренних сервисов (usage). */
export async function getById(profileId: number): Promise<ProfileRow | null> {
  return queryOne<ProfileRow>(`SELECT * FROM author_profiles WHERE id = $1`, [profileId])
}
