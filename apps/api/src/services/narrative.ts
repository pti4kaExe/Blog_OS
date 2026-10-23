/**
 * Narrative Engine на сервере: из заметок — связный пост.
 *
 * mode=notes  — сборка правиловым buildPost (arc/suggestArc/splitFragments);
 * mode=draft  — текст как есть, шаг сборки пропускается;
 * use_llm     — при доступной модели блоки собирает LLM (иначе откат на правила
 *               с verified_without_ai: true и generation_run_id: null).
 * Пустые заметки проверяет маршрут: 422 details.reason = "empty_notes".
 */
import { ARCS, buildPost, splitFragments, suggestArc } from '@blogos/engine'
import { callLlm, llmConfigured, parseJson } from './llm/index.ts'
import { NARRATIVE_SYSTEM, narrativeUser } from './llm/prompts.ts'
import type { EngineProfile } from './style.ts'

/** Внешние имена арок (контракт API) ↔ ключи движка. */
const ARC_TO_ENGINE: Record<string, string> = {
  story_case: 'story',
  problem_solution: 'problem',
  opinion_breakdown: 'opinion',
  story: 'story',
  problem: 'problem',
  opinion: 'opinion',
}

const ENGINE_TO_ARC: Record<string, string> = {
  story: 'story_case',
  problem: 'problem_solution',
  opinion: 'opinion_breakdown',
}

export function externalArc(engineKey: string | null | undefined): string | null {
  if (!engineKey) return null
  return ENGINE_TO_ARC[engineKey] ?? null
}

export function engineArc(arc: string | null | undefined): string | null {
  if (!arc) return null
  return ARC_TO_ENGINE[arc] ?? null
}

export interface NarrativeBlock {
  role: string
  text: string
  fragment: string | null
}

export interface NarrativeResult {
  text: string
  title: string | null
  arc: string | null
  arcAuto: boolean
  blocks: NarrativeBlock[]
  addedByEngine: string[]
  notesUsed: number
  notesDropped: number
  verifiedWithoutAi: boolean
  generationRunId: number | null
  aiSkippedReason?: string
}

export interface NarrativeOptions {
  notes: string
  arc: string | null
  mode: 'notes' | 'draft'
  profile: EngineProfile | null
  authorId: number
  useLlm: boolean
  budgetBlocked: boolean
}

function rulesNarrative(options: NarrativeOptions): NarrativeResult {
  const fragments = splitFragments(options.notes)
  const arcAuto = !options.arc

  if (options.mode === 'draft') {
    return {
      text: options.notes.trim(),
      title: null,
      arc: options.arc ? (externalArc(engineArc(options.arc)) ?? options.arc) : null,
      arcAuto,
      blocks: fragments.map((fragment) => ({
        role: 'draft',
        text: fragment.text,
        fragment: fragment.text,
      })),
      addedByEngine: [],
      notesUsed: fragments.length,
      notesDropped: 0,
      verifiedWithoutAi: true,
      generationRunId: null,
    }
  }

  const requested = engineArc(options.arc)
  const built = buildPost(options.notes, options.profile, requested ?? undefined)
  if (!built.ok) {
    // Одна заметка: собирать нечего, но и терять текст нельзя.
    return {
      text: options.notes.trim(),
      title: null,
      arc: options.arc ? (externalArc(requested) ?? options.arc) : (suggestArc(fragments) as string),
      arcAuto,
      blocks: fragments.map((fragment) => ({
        role: 'fragment',
        text: fragment.text,
        fragment: fragment.text,
      })),
      addedByEngine: [],
      notesUsed: fragments.length,
      notesDropped: 0,
      verifiedWithoutAi: true,
      generationRunId: null,
    }
  }

  const fragmentsList = built.fragments
  const blocks: NarrativeBlock[] = (built.blocks ?? []).map((block) => ({
    role: block.role,
    text: block.text,
    fragment:
      block.sources.length > 0
        ? (fragmentsList[block.sources[0] ?? -1]?.text ?? null)
        : null,
  }))
  return {
    text: built.text ?? options.notes.trim(),
    title: built.title ?? null,
    arc: externalArc(built.arc?.key),
    arcAuto: arcAuto || requested === null,
    blocks,
    addedByEngine: (built.additions ?? []).map((addition) => addition.text),
    notesUsed: built.coverage?.used ?? fragments.length,
    notesDropped: Math.max((built.coverage?.total ?? fragments.length) - (built.coverage?.used ?? 0), 0),
    verifiedWithoutAi: true,
    generationRunId: null,
  }
}

function parseLlmBlocks(raw: unknown): NarrativeBlock[] {
  if (!Array.isArray(raw)) return []
  const blocks: NarrativeBlock[] = []
  for (const item of raw as Array<{ role?: unknown; text?: unknown }>) {
    if (!item || typeof item !== 'object') continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (!text) continue
    const role = typeof item.role === 'string' ? item.role : 'insight'
    blocks.push({ role, text, fragment: null })
  }
  return blocks
}

export async function buildNarrative(options: NarrativeOptions): Promise<NarrativeResult> {
  const fallback = rulesNarrative(options)

  if (!options.useLlm) return fallback
  if (options.budgetBlocked) {
    return { ...fallback, aiSkippedReason: 'budget_exceeded' }
  }
  if (!llmConfigured()) {
    return { ...fallback, aiSkippedReason: 'llm_not_configured' }
  }

  const outcome = await callLlm({
    authorId: options.authorId,
    taskType: 'narrative_generate',
    system: NARRATIVE_SYSTEM,
    user: narrativeUser(options.notes, options.arc),
    json: true,
    maxTokens: 1600,
  })
  if (!outcome.ok) return { ...fallback, aiSkippedReason: 'llm_unavailable' }

  const parsed = parseJson<{
    title?: unknown
    blocks?: unknown
    added_by_engine?: unknown
  }>(outcome.result.text)
  const llmBlocks = parseLlmBlocks(parsed?.blocks)
  if (llmBlocks.length === 0) {
    return { ...fallback, aiSkippedReason: 'llm_empty_response' }
  }

  const fragments = splitFragments(options.notes)
  const addedByEngine = Array.isArray(parsed?.added_by_engine)
    ? (parsed?.added_by_engine as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  return {
    text: llmBlocks.map((block) => block.text).join('\n\n'),
    title: typeof parsed?.title === 'string' ? parsed.title : fallback.title,
    arc: fallback.arc ?? externalArc(requestedArcKey(options.arc)),
    arcAuto: !options.arc,
    blocks: llmBlocks,
    addedByEngine,
    notesUsed: fragments.length,
    notesDropped: 0,
    verifiedWithoutAi: false,
    generationRunId: outcome.generationRunId,
  }
}

function requestedArcKey(arc: string | null): string | null {
  const engineKey = engineArc(arc)
  return engineKey && ARCS[engineKey] ? engineKey : null
}
