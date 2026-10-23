/** Профиль Tone of Voice: 1:1 с каналом (docs/DECISIONS.md, решение № 9). */
import { queryOne } from '../db.ts'
import type { Row } from './access.ts'

export interface TovInput {
  tone: string
  slang: string[]
  stop_words: string[]
  favorite_phrases: string[]
  metrics?: Row | null
  analyzed_at?: boolean
}

export async function getByAuthor(userId: number, authorId: number): Promise<Row | null> {
  return queryOne<Row>(
    `SELECT t.* FROM tov_profiles t
       JOIN author_profiles ap ON ap.id = t.author_id
      WHERE t.author_id = $1 AND ap.user_id = $2`,
    [authorId, userId],
  )
}

/**
 * Полная замена (PUT) и upsert анализа: нарушить 1:1 невозможно.
 * Связь с журналом AI через tov_profiles не хранится (docs/DB-REVIEW.md, DB-1):
 * вызов виден в generation_runs по author_id и task_type = 'tov_analyze'.
 */
export async function upsert(authorId: number, input: TovInput): Promise<Row> {
  const row = await queryOne<Row>(
    `INSERT INTO tov_profiles
       (author_id, tone, slang, stop_words, favorite_phrases, metrics, analyzed_at)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
     ON CONFLICT (author_id) DO UPDATE SET
       tone = EXCLUDED.tone,
       slang = EXCLUDED.slang,
       stop_words = EXCLUDED.stop_words,
       favorite_phrases = EXCLUDED.favorite_phrases,
       metrics = EXCLUDED.metrics,
       analyzed_at = EXCLUDED.analyzed_at,
       updated_at = now()
     RETURNING *`,
    [
      authorId,
      input.tone,
      JSON.stringify(input.slang),
      JSON.stringify(input.stop_words),
      JSON.stringify(input.favorite_phrases),
      input.metrics ? JSON.stringify(input.metrics) : null,
      input.analyzed_at ? new Date().toISOString() : null,
    ],
  )
  if (!row) throw new Error('Профиль стиля не сохранён')
  return row
}
