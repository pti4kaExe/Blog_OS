/**
 * Мост между профилем стиля в БД (tov_profiles.metrics = результат
 * buildStyleProfile) и чистым движком packages/engine.
 */
import { buildStyleProfile } from '@blogos/engine'
import type { Row } from '../repositories/access.ts'
import type { TovInput } from '../repositories/tov.ts'

export interface EngineProfile {
  address: string
  avgSentenceLen: number
  firstPersonPer100Words: number
  emojiPer100Words: number
  exclamationShare: number
  questionShare: number
  openingStyle?: string
  topTerms?: Array<{ stem: string; label: string; weight: number }>
  samples?: string[]
  [key: string]: unknown
}

export type Tone = 'ты' | 'вы' | 'смешанное'

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Профиль для lint/buildPost/draftComment: metrics из БД + tone как address. */
export function toEngineProfile(row: Row | null): EngineProfile | null {
  if (!row) return null
  const metrics = (row.metrics ?? {}) as Record<string, unknown>
  const tone = String(row.tone ?? 'смешанное')
  return {
    ...metrics,
    address: tone === 'ты' || tone === 'вы' ? tone : 'смешанное',
    avgSentenceLen: num(metrics.avgSentenceLen),
    firstPersonPer100Words: num(metrics.firstPersonPer100Words),
    emojiPer100Words: num(metrics.emojiPer100Words),
    exclamationShare: num(metrics.exclamationShare),
    questionShare: num(metrics.questionShare),
    openingStyle: typeof metrics.openingStyle === 'string' ? metrics.openingStyle : undefined,
    topTerms: Array.isArray(metrics.topTerms)
      ? (metrics.topTerms as EngineProfile['topTerms'])
      : [],
    samples: Array.isArray(metrics.samples) ? (metrics.samples as string[]) : [],
  }
}

export function toneFromAddress(address: string | undefined): Tone {
  if (address === 'ты') return 'ты'
  if (address === 'вы') return 'вы'
  return 'смешанное'
}

const SLANG_WORDS = [
  'кайф',
  'жесть',
  'норм',
  'фигня',
  'треш',
  'трэш',
  'чувак',
  'прикол',
  'круто',
  'класс',
  'зашло',
  'качает',
  'пушка',
  'бомба',
  'вайб',
  'кринж',
  'хайп',
  'окей',
]

export function extractSlang(texts: string[]): string[] {
  const joined = texts.join('\n').toLowerCase()
  const found: string[] = []
  for (const word of SLANG_WORDS) {
    const re = new RegExp(`(?<![а-яёa-z])${word}(?![а-яёa-z])`, 'iu')
    if (re.test(joined) && !found.includes(word)) found.push(word)
  }
  return found.slice(0, 12)
}

/** Суммарная длина текстов — входное условие «≥ 180 символов». */
export function totalChars(texts: string[]): number {
  return texts.map((text) => String(text).trim()).filter(Boolean).join('\n\n').length
}

export interface TovAnalysis {
  engineProfile: EngineProfile
  input: TovInput
}

/** Правиловый анализ стиля: карточка строится всегда, если хватает текста. */
export function analyzeTov(texts: string[]): TovAnalysis | null {
  const engineProfile = buildStyleProfile(texts)
  if (!engineProfile) return null
  const phrases = Array.isArray(engineProfile.signaturePhrases)
    ? (engineProfile.signaturePhrases as string[])
    : []
  return {
    engineProfile: engineProfile as EngineProfile,
    input: {
      tone: toneFromAddress(String(engineProfile.address ?? '')),
      slang: extractSlang(texts),
      stop_words: [],
      favorite_phrases: phrases.slice(0, 8),
      metrics: engineProfile,
      analyzed_at: true,
    },
  }
}

/** Короткая подсказка стиля для LLM-промптов ответа на комментарий. */
export function styleHint(row: Row | null): string {
  if (!row) return ''
  const metrics = (row.metrics ?? {}) as Record<string, unknown>
  const parts: string[] = [`обращение: ${String(row.tone ?? 'смешанное')}`]
  if (metrics.avgSentenceLen) parts.push(`средняя длина предложения: ${metrics.avgSentenceLen}`)
  if (Array.isArray(row.favorite_phrases) && row.favorite_phrases.length) {
    parts.push(`частые фразы: ${(row.favorite_phrases as string[]).slice(0, 4).join(', ')}`)
  }
  if (metrics.openingStyle) parts.push(`начало: ${String(metrics.openingStyle)}`)
  return parts.join('; ')
}
