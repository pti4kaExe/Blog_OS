/**
 * Хранение векторов и RAG-поиск через pgvector.
 *
 * Вектор пишется строкой '[1,2,…]' с приведением ::vector, поиск — по
 * косинусному расстоянию `1 - (embedding <=> $1::vector)` с ORDER BY и LIMIT
 * (HNSW-индекс объявлен в db/sql/001_schema.sql).
 */
import { query, queryOne, transaction } from '../../db.ts'
import { AppError } from '../../errors.ts'
import { chunkText } from './chunk.ts'
import {
  embedTexts,
  isEmbeddingsEnabled,
  queryEmbeddingModel,
  storedEmbeddingModel,
  toVectorLiteral,
} from './index.ts'

interface ReplaceOptions {
  postId?: number
  knowledgeId?: number
  text: string
}

async function replaceEmbeddings(options: ReplaceOptions): Promise<void> {
  const chunks = chunkText(options.text)
  if (chunks.length === 0) return
  const vectors = await embedTexts(chunks)
  const model = storedEmbeddingModel()
  const ownerColumn = options.postId !== undefined ? 'post_id' : 'knowledge_id'
  const ownerId = options.postId ?? options.knowledgeId
  if (ownerId === undefined) return

  await transaction(async (tx) => {
    await tx.query(`DELETE FROM embeddings WHERE ${ownerColumn} = $1`, [ownerId])
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index] ?? ''
      const vector = vectors[index]
      if (!vector) continue
      await tx.query(
        `INSERT INTO embeddings (${ownerColumn}, chunk_index, chunk_text, embedding, model)
         VALUES ($1, $2, $3, $4::vector, $5)`,
        [ownerId, index, chunk, toVectorLiteral(vector), model],
      )
    }
  })
}

/** Пересчёт векторов поста. Побочный эффект: не роняет создание/правку поста. */
export async function recalcPostEmbeddings(postId: number, text: string): Promise<void> {
  if (!isEmbeddingsEnabled()) return
  try {
    await replaceEmbeddings({ postId, text })
  } catch (error) {
    console.warn(`[embeddings] не удалось пересчитать пост ${postId}:`, (error as Error).message)
  }
}

export async function recalcKnowledgeEmbeddings(
  knowledgeId: number,
  text: string,
): Promise<void> {
  if (!isEmbeddingsEnabled()) return
  try {
    await replaceEmbeddings({ knowledgeId, text })
  } catch (error) {
    console.warn(
      `[embeddings] не удалось пересчитать факт ${knowledgeId}:`,
      (error as Error).message,
    )
  }
}

export interface KnowledgeSearchItem {
  knowledge_id: number
  title: string
  chunk_text: string
  score: number
  chunk_index: number
}

export interface KnowledgeSearchResult {
  items: KnowledgeSearchItem[]
  query_embedding_model: string
  searched_chunks: number
}

export async function searchKnowledge(
  authorId: number,
  searchQuery: string,
  topK: number,
): Promise<KnowledgeSearchResult> {
  if (!isEmbeddingsEnabled()) {
    throw new AppError('not_configured', 'Модель эмбеддингов недоступна', {
      reason: 'not_configured',
    })
  }
  let vector: number[]
  try {
    const vectors = await embedTexts([searchQuery])
    vector = vectors[0] ?? []
    if (vector.length === 0) throw new Error('пустой вектор')
  } catch (error) {
    throw new AppError('not_configured', 'Модель эмбеддингов недоступна', {
      reason: 'not_configured',
      message: (error as Error).message,
    })
  }

  const literal = toVectorLiteral(vector)
  const rows = await query<KnowledgeSearchItem>(
    `SELECT e.knowledge_id,
            kb.title,
            e.chunk_text,
            e.chunk_index,
            1 - (e.embedding <=> $1::vector) AS score
       FROM embeddings e
       JOIN knowledge_base kb ON kb.id = e.knowledge_id
      WHERE kb.author_id = $2
      ORDER BY e.embedding <=> $1::vector
      LIMIT $3`,
    [literal, authorId, topK],
  )
  const counted = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM embeddings e
       JOIN knowledge_base kb ON kb.id = e.knowledge_id
      WHERE kb.author_id = $1`,
    [authorId],
  )
  return {
    items: rows.map((row) => ({
      knowledge_id: Number(row.knowledge_id),
      title: String(row.title),
      chunk_text: String(row.chunk_text),
      score: Math.round(Number(row.score) * 10_000) / 10_000,
      chunk_index: Number(row.chunk_index),
    })),
    query_embedding_model: queryEmbeddingModel(),
    searched_chunks: Number(counted?.count ?? 0),
  }
}
