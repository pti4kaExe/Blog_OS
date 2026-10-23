/**
 * Генерация вариантов ответа на комментарий.
 *
 * Правиловый движок draftComment (packages/engine) никогда не выдумывает факты:
 * часть gap остаётся пропуском [дополните: …], пока автор его не заполнит.
 * LLM — второй слой: при отказе откат на правила, verified_without_ai: true.
 */
import { draftComment } from '@blogos/engine'
import { callLlm, llmConfigured, parseJson } from './llm/index.ts'
import { RESPONSE_SYSTEM, responseUser } from './llm/prompts.ts'
import type { Row } from '../repositories/access.ts'
import { styleHint, toEngineProfile } from './style.ts'

export interface ResponseParts {
  reference: string
  experience: string
  gap: string
  question: string
}

export interface GeneratedResponse {
  text: string
  parts: ResponseParts
}

export interface ResponseGenerationResult {
  responses: GeneratedResponse[]
  verifiedWithoutAi: boolean
  generationRunId: number | null
  aiSkippedReason?: string
}

export interface GenerateOptions {
  commentText: string
  count: number
  authorId: number
  tovRow: Row | null
  knowledge: string[]
  useLlm: boolean
  budgetBlocked: boolean
  commentKind: 'question' | 'claim'
}

const GAP_PART = '[дополните: что именно сработало у меня и в каких условиях]'

function emptyParts(): ResponseParts {
  return { reference: '', experience: '', gap: GAP_PART, question: '' }
}

function partsFromEngine(parts: Array<{ kind: string; text: string }>): ResponseParts {
  const mapped = emptyParts()
  for (const part of parts) {
    if (part.kind === 'opener' || part.kind === 'reference') mapped.reference = part.text
    else if (part.kind === 'evidence' || part.kind === 'experience') mapped.experience = part.text
    else if (part.kind === 'gap') mapped.gap = part.text
    else if (part.kind === 'question') mapped.question = part.text
  }
  return mapped
}

function rulesResponse(options: GenerateOptions): { text: string; parts: ResponseParts } {
  const profile = toEngineProfile(options.tovRow)
  const discussion = {
    id: 'comment',
    kind: options.commentKind,
    text: options.commentText,
    replies: 0,
    hoursAgo: 0,
  }
  const drafted = draftComment(discussion, profile)
  if (drafted.text.trim()) {
    return { text: drafted.text, parts: partsFromEngine(drafted.parts) }
  }
  const informal = String(options.tovRow?.tone ?? '') !== 'вы'
  const question = informal ? 'А у тебя как это устроено?' : 'А у вас как это устроено?'
  const text = `Отвечу из своего опыта. ${GAP_PART} ${question}`
  return { text, parts: { reference: 'Отвечу из своего опыта.', experience: '', gap: GAP_PART, question } }
}

function parseLlmResponses(raw: unknown): GeneratedResponse[] {
  if (!Array.isArray(raw)) return []
  const result: GeneratedResponse[] = []
  for (const item of raw as Array<{ text?: unknown; parts?: unknown }>) {
    if (!item || typeof item !== 'object') continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (!text) continue
    const partsRaw = (item.parts ?? {}) as Record<string, unknown>
    result.push({
      text,
      parts: {
        reference: String(partsRaw.reference ?? ''),
        experience: String(partsRaw.experience ?? ''),
        gap: String(partsRaw.gap ?? GAP_PART),
        question: String(partsRaw.question ?? ''),
      },
    })
  }
  return result
}

export async function generateResponses(
  options: GenerateOptions,
): Promise<ResponseGenerationResult> {
  const base = rulesResponse(options)
  const rules: GeneratedResponse[] = Array.from({ length: options.count }, () => ({
    text: base.text,
    parts: base.parts,
  }))

  if (!options.useLlm) return { responses: rules, verifiedWithoutAi: true, generationRunId: null }
  if (options.budgetBlocked) {
    return {
      responses: rules,
      verifiedWithoutAi: true,
      generationRunId: null,
      aiSkippedReason: 'budget_exceeded',
    }
  }
  if (!llmConfigured()) {
    return {
      responses: rules,
      verifiedWithoutAi: true,
      generationRunId: null,
      aiSkippedReason: 'llm_not_configured',
    }
  }

  const outcome = await callLlm({
    authorId: options.authorId,
    taskType: 'response_generate',
    system: RESPONSE_SYSTEM,
    user: responseUser({
      commentText: options.commentText,
      count: options.count,
      styleHint: styleHint(options.tovRow),
      knowledge: options.knowledge,
    }),
    json: true,
    maxTokens: 1400,
  })
  if (!outcome.ok) {
    return {
      responses: rules,
      verifiedWithoutAi: true,
      generationRunId: null,
      aiSkippedReason: 'llm_unavailable',
    }
  }

  const parsed = parseJson<{ responses?: unknown }>(outcome.result.text)
  const llmResponses = parseLlmResponses(parsed?.responses).slice(0, options.count)
  if (llmResponses.length === 0) {
    return {
      responses: rules,
      verifiedWithoutAi: true,
      generationRunId: null,
      aiSkippedReason: 'llm_empty_response',
    }
  }
  while (llmResponses.length < options.count) {
    llmResponses.push(llmResponses[llmResponses.length - 1] as GeneratedResponse)
  }
  return {
    responses: llmResponses,
    verifiedWithoutAi: false,
    generationRunId: outcome.generationRunId,
  }
}
