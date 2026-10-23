/** База знаний автора: факты для RAG, чтобы AI не придумывала. */
import { query, queryOne, type QueryParam } from '../db.ts'
import { cursorCondition, paginate, type ListOptions, type ListResult } from '../lib/query.ts'
import type { Row } from './access.ts'

export interface CreateKnowledgeInput {
  title: string
  content: string
}

export async function list(
  userId: number,
  profileId: number,
  options: ListOptions,
): Promise<ListResult<Row>> {
  const params: QueryParam[] = [userId, profileId]
  let index = 3
  let where = 'WHERE ap.user_id = $1 AND kb.author_id = $2'
  const cursor = cursorCondition(options.cursor, 'kb', params, index)
  where += cursor.sql
  index = cursor.nextIndex
  params.push(options.limit + 1)
  const rows = await query<Row>(
    `SELECT kb.* FROM knowledge_base kb
       JOIN author_profiles ap ON ap.id = kb.author_id
      ${where}
      ORDER BY kb.created_at DESC, kb.id DESC
      LIMIT $${index}`,
    params,
  )
  return paginate(rows, options.limit)
}

export async function create(authorId: number, input: CreateKnowledgeInput): Promise<Row> {
  const row = await queryOne<Row>(
    `INSERT INTO knowledge_base (author_id, title, content) VALUES ($1, $2, $3) RETURNING *`,
    [authorId, input.title, input.content],
  )
  if (!row) throw new Error('Факт не создан')
  return row
}

export async function update(
  knowledgeId: number,
  patch: { title?: string; content?: string },
): Promise<Row> {
  const sets: string[] = []
  const params: QueryParam[] = [knowledgeId]
  let index = 2
  if (patch.title !== undefined) {
    sets.push(`title = $${index}`)
    params.push(patch.title)
    index++
  }
  if (patch.content !== undefined) {
    sets.push(`content = $${index}`)
    params.push(patch.content)
    index++
  }
  if (sets.length === 0) {
    const row = await queryOne<Row>(`SELECT * FROM knowledge_base WHERE id = $1`, [knowledgeId])
    if (!row) throw new Error('Факт не найден')
    return row
  }
  const row = await queryOne<Row>(
    `UPDATE knowledge_base SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  )
  if (!row) throw new Error('Факт не обновлён')
  return row
}

export async function remove(knowledgeId: number): Promise<void> {
  await query(`DELETE FROM knowledge_base WHERE id = $1`, [knowledgeId])
}

export async function getById(knowledgeId: number): Promise<Row | null> {
  return queryOne<Row>(`SELECT * FROM knowledge_base WHERE id = $1`, [knowledgeId])
}

/** Последние факты автора — контекст для генерации ответа (RAG-подсказка). */
export async function listRecent(authorId: number, limit: number): Promise<Row[]> {
  return query<Row>(
    `SELECT * FROM knowledge_base WHERE author_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [authorId, limit],
  )
}
