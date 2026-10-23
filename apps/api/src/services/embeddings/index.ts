/**
 * Эмбеддинги для RAG.
 *
 *   mock   — детерминированный нормализованный вектор 1536 из sha256 текста
 *            (одинаковый текст → одинаковый вектор, без сети и денег);
 *   openai — text-embedding-3-small через /embeddings;
 *   none   — модель недоступна: поиск отвечает 503.
 *
 * Размерность зафиксирована схемой vector(1536) (docs/DECISIONS.md, решение № 5).
 */
import { createHash } from 'node:crypto'
import { env } from '../../env.ts'
import { liveString } from '../../lib/liveEnv.ts'

export type EmbeddingsProviderName = 'mock' | 'openai' | 'none'

export const EMBEDDING_DIMENSIONS = 1536

export function embeddingsProviderName(): EmbeddingsProviderName {
  const raw = liveString('EMBEDDINGS_PROVIDER', env.EMBEDDINGS_PROVIDER)
  if (raw === 'openai' || raw === 'none') return raw
  return 'mock'
}

function openaiKey(): string {
  return liveString('OPENAI_API_KEY', env.OPENAI_API_KEY)
}

/** Настроена ли модель: none и openai без ключа — недоступны. */
export function isEmbeddingsEnabled(): boolean {
  const provider = embeddingsProviderName()
  if (provider === 'none') return false
  if (provider === 'openai') return openaiKey().length > 0
  return true
}

/** Имя модели для ответов API (по контракту — text-embedding-3-small). */
export function queryEmbeddingModel(): string {
  return liveString('EMBEDDING_MODEL', env.EMBEDDING_MODEL)
}

/** Имя модели для колонки embeddings.model: видно, чем посчитан вектор. */
export function storedEmbeddingModel(): string {
  const provider = embeddingsProviderName()
  const model = queryEmbeddingModel()
  return provider === 'mock' ? `mock:${model}` : model
}

function mockVector(text: string, dimensions: number): number[] {
  const digest = createHash('sha256').update(text, 'utf8').digest()
  let state = digest.readUInt32LE(0) || 1
  const next = (): number => {
    // mulberry32: детерминированный ГПСЧ без зависимости от платформы.
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const raw = Array.from({ length: dimensions }, () => next() * 2 - 1)
  const norm = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1
  return raw.map((value) => value / norm)
}

async function openaiVectors(texts: string[]): Promise<number[][]> {
  const key = openaiKey()
  if (!key) throw new Error('OPENAI_API_KEY не задан')
  const base = liveString('OPENAI_BASE_URL', env.OPENAI_BASE_URL).replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), env.LLM_TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: queryEmbeddingModel(), input: texts }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`openai embeddings: HTTP ${response.status}`)
    }
    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>
    }
    const items = data.data ?? []
    if (items.length !== texts.length) throw new Error('openai embeddings: неверное число векторов')
    const vectors = items
      .slice()
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
      .map((item) => item.embedding ?? [])
    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `openai embeddings: размерность ${vector.length} вместо ${EMBEDDING_DIMENSIONS}`,
        )
      }
    }
    return vectors
  } finally {
    clearTimeout(timer)
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const provider = embeddingsProviderName()
  if (provider === 'mock') {
    return texts.map((text) => mockVector(text, EMBEDDING_DIMENSIONS))
  }
  if (provider === 'openai') return openaiVectors(texts)
  throw new Error('EMBEDDINGS_PROVIDER=none: модель эмбеддингов недоступна')
}

/** Вектор pgvector в виде строки '[1,2,…]' для параметра $n::vector. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`
}

export { mockVector }
