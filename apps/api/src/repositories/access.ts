/**
 * Единственная точка проверки «своё/чужое» (docs/DECISIONS.md, решение № 29).
 *
 * Каждая выборка по id фильтруется владельцем через JOIN к author_profiles.
 * Чужая запись неотличима от несуществующей: сервисный слой получает not_found
 * (404), а не forbidden (403). Роль admin здесь не расширяет доступ к чужим
 * каналам: админ работает со своими каналами и с golden-dataset/evals.
 */
import { queryOne } from '../db.ts'
import { notFound } from '../errors.ts'

export type Row = Record<string, unknown>

export type ProfileRow = Row & {
  id: number
  user_id: number
  name: string
  platform: string
  monthly_cost_limit: number | null
}

export type DraftRow = Row & {
  id: number
  author_id: number
  text: string
  status: string
  title: string | null
  source_notes: string | null
  arc: string | null
  published_post_id: number | null
}

export type PostRow = Row & {
  id: number
  author_id: number
  content_type: string
  text: string
  external_id: string | null
}

export type SourceRow = Row & {
  id: number
  author_id: number
  name: string
  source_type: string
  source_url: string
  is_active: boolean
}

export type CommentRow = Row & {
  id: number
  source_id: number
  author_id: number
  text: string
  external_id: string
}

export type ResponseRow = Row & {
  id: number
  comment_id: number
  source_id: number
  author_id: number
  response_text: string
  edited_text: string | null
  status: string
}

export type KnowledgeRow = Row & { id: number; author_id: number }

export async function ownProfile(userId: number, profileId: number): Promise<ProfileRow> {
  const row = await queryOne<ProfileRow>(
    `SELECT * FROM author_profiles WHERE id = $1 AND user_id = $2`,
    [profileId, userId],
  )
  if (!row) throw notFound('Канал не найден')
  return row
}

export async function ownDraft(userId: number, draftId: number): Promise<DraftRow> {
  const row = await queryOne<DraftRow>(
    `SELECT d.*, ap.user_id, ap.platform
       FROM drafts d
       JOIN author_profiles ap ON ap.id = d.author_id
      WHERE d.id = $1 AND ap.user_id = $2`,
    [draftId, userId],
  )
  if (!row) throw notFound('Черновик не найден')
  return row
}

export async function ownPost(
  userId: number,
  postId: number,
  profileId?: number,
): Promise<PostRow> {
  const row = await queryOne<PostRow>(
    `SELECT p.*, ap.user_id, ap.platform
       FROM posts p
       JOIN author_profiles ap ON ap.id = p.author_id
      WHERE p.id = $1 AND ap.user_id = $2 ${profileId !== undefined ? 'AND p.author_id = $3' : ''}`,
    profileId !== undefined ? [postId, userId, profileId] : [postId, userId],
  )
  if (!row) throw notFound('Пост не найден')
  return row
}

export async function ownSource(userId: number, sourceId: number): Promise<SourceRow> {
  const row = await queryOne<SourceRow>(
    `SELECT s.*, ap.user_id
       FROM sources s
       JOIN author_profiles ap ON ap.id = s.author_id
      WHERE s.id = $1 AND ap.user_id = $2`,
    [sourceId, userId],
  )
  if (!row) throw notFound('Источник не найден')
  return row
}

export async function ownComment(userId: number, commentId: number): Promise<CommentRow> {
  const row = await queryOne<CommentRow>(
    `SELECT c.*, s.author_id, s.source_url, ap.user_id, ap.platform
       FROM comments c
       JOIN sources s ON s.id = c.source_id
       JOIN author_profiles ap ON ap.id = s.author_id
      WHERE c.id = $1 AND ap.user_id = $2`,
    [commentId, userId],
  )
  if (!row) throw notFound('Комментарий не найден')
  return row
}

export async function ownResponse(userId: number, responseId: number): Promise<ResponseRow> {
  const row = await queryOne<ResponseRow>(
    `SELECT gr.*, c.source_id, s.author_id, ap.user_id
       FROM generated_responses gr
       JOIN comments c ON c.id = gr.comment_id
       JOIN sources s ON s.id = c.source_id
       JOIN author_profiles ap ON ap.id = s.author_id
      WHERE gr.id = $1 AND ap.user_id = $2`,
    [responseId, userId],
  )
  if (!row) throw notFound('Вариант ответа не найден')
  return row
}

export async function ownKnowledge(userId: number, knowledgeId: number): Promise<KnowledgeRow> {
  const row = await queryOne<KnowledgeRow>(
    `SELECT kb.*, ap.user_id
       FROM knowledge_base kb
       JOIN author_profiles ap ON ap.id = kb.author_id
      WHERE kb.id = $1 AND ap.user_id = $2`,
    [knowledgeId, userId],
  )
  if (!row) throw notFound('Факт базы знаний не найден')
  return row
}

export async function ownLintReport(
  userId: number,
  reportId: number,
): Promise<Row & { id: number; draft_id: number; author_id: number }> {
  const row = await queryOne<Row & { id: number; draft_id: number; author_id: number }>(
    `SELECT lr.*, d.author_id, ap.user_id
       FROM lint_reports lr
       JOIN drafts d ON d.id = lr.draft_id
       JOIN author_profiles ap ON ap.id = d.author_id
      WHERE lr.id = $1 AND ap.user_id = $2`,
    [reportId, userId],
  )
  if (!row) throw notFound('Отчёт проверки не найден')
  return row
}
