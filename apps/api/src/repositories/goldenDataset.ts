/** Эталонные тексты для Evals: доступ только администратору. */
import { query, queryOne, type QueryParam } from '../db.ts'
import { cursorCondition, paginate, type ListOptions, type ListResult } from '../lib/query.ts'
import type { Row } from './access.ts'

export interface GoldenLabel {
  type: string
  quote?: string
  start?: number
  end?: number
}

export interface CreateGoldenInput {
  text: string
  labels: GoldenLabel[]
  platform?: string | null
}

export async function list(
  options: ListOptions,
  platform?: string,
): Promise<ListResult<Row>> {
  const params: QueryParam[] = []
  let index = 1
  let where = 'WHERE 1 = 1'
  if (platform) {
    where += ` AND g.platform = $${index}`
    params.push(platform)
    index++
  }
  const cursor = cursorCondition(options.cursor, 'g', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT g.* FROM golden_dataset g
      ${where}
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function create(input: CreateGoldenInput): Promise<Row> {
  const row = await queryOne<Row>(
    `INSERT INTO golden_dataset (text, labels, platform)
     VALUES ($1, $2::jsonb, $3) RETURNING *`,
    [input.text, JSON.stringify(input.labels), input.platform ?? null],
  )
  if (!row) throw new Error('Эталон не создан')
  return row
}

export async function getById(goldenId: number): Promise<Row | null> {
  return queryOne<Row>(`SELECT * FROM golden_dataset WHERE id = $1`, [goldenId])
}

export async function update(
  goldenId: number,
  patch: { text?: string; labels?: GoldenLabel[]; platform?: string | null },
): Promise<Row> {
  const sets: string[] = []
  const params: QueryParam[] = [goldenId]
  let index = 2
  if (patch.text !== undefined) {
    sets.push(`text = $${index}`)
    params.push(patch.text)
    index++
  }
  if (patch.labels !== undefined) {
    sets.push(`labels = $${index}::jsonb`)
    params.push(JSON.stringify(patch.labels))
    index++
  }
  if (patch.platform !== undefined) {
    sets.push(`platform = $${index}`)
    params.push(patch.platform)
    index++
  }
  if (sets.length === 0) {
    const row = await queryOne<Row>(`SELECT * FROM golden_dataset WHERE id = $1`, [goldenId])
    if (!row) throw new Error('Эталон не найден')
    return row
  }
  const row = await queryOne<Row>(
    `UPDATE golden_dataset SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  if (!row) throw new Error('Эталон не обновлён')
  return row
}

export async function remove(goldenId: number): Promise<void> {
  await query(`DELETE FROM golden_dataset WHERE id = $1`, [goldenId])
}

export async function listAll(platform?: string): Promise<Row[]> {
  if (platform) {
    return query<Row>(
      `SELECT * FROM golden_dataset WHERE platform = $1 ORDER BY id`,
      [platform],
    )
  }
  return query<Row>(`SELECT * FROM golden_dataset ORDER BY id`)
}
