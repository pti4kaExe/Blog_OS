/**
 * Evals: прогон lint() по golden_dataset и метрики precision/recall.
 * Совпадение — по типу замечания и пересечению диапазонов [start, end).
 * Результаты пишутся в eval_results, прогон — в generation_runs (task_type='lint').
 */
import { lint as engineLint } from '@blogos/engine'
import { insert as insertRun } from '../repositories/generationRuns.ts'
import { insertResults, type EvalResultRow } from '../repositories/evals.ts'
import type { Row } from '../repositories/access.ts'

interface NormalizedLabel {
  type: string
  start: number
  end: number
  quote: string
}

interface NormalizedIssue {
  type: string
  start: number
  end: number
  quote: string
}

export interface EvalSummary {
  goldens: number
  precision: number
  recall: number
  matched: number
  missed: number
  false_positive: number
}

export interface EvalResultPayload {
  golden_id: number
  precision: number
  recall: number
  matched: NormalizedLabel[]
  missed: NormalizedLabel[]
  false_positive: NormalizedIssue[]
}

export interface EvalRunResult {
  generation_run_id: number
  summary: EvalSummary
  results: EvalResultPayload[]
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

function normalizeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function typesMatch(labelType: string, issueType: string): boolean {
  const a = normalizeType(labelType)
  const b = normalizeType(issueType)
  if (!a || !b) return false
  if (a === b) return true
  const aBase = a.split(':')[0] ?? a
  const bBase = b.split(':')[0] ?? b
  return aBase === bBase
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
  a.start < b.end && b.start < a.end

export function normalizeLabels(text: string, raw: unknown): NormalizedLabel[] {
  if (!Array.isArray(raw)) return []
  const labels: NormalizedLabel[] = []
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== 'object') continue
    const type = normalizeType(item.type)
    if (!type) continue
    const quote = typeof item.quote === 'string' ? item.quote : ''
    let start = typeof item.start === 'number' ? item.start : Number.NaN
    let end = typeof item.end === 'number' ? item.end : Number.NaN
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      const index = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1
      if (index === -1) {
        // Разметка без позиции и без находимой цитаты не может совпасть.
        labels.push({ type, start: -1, end: -1, quote })
        continue
      }
      start = index
      end = index + quote.length
    }
    labels.push({ type, start, end: Math.min(end, text.length), quote })
  }
  return labels
}

export function normalizeIssues(engineReport: ReturnType<typeof engineLint>): NormalizedIssue[] {
  const issues: NormalizedIssue[] = []
  for (const issue of engineReport.issues) {
    if (typeof issue.start !== 'number' || typeof issue.end !== 'number') continue
    if (issue.end <= issue.start) continue
    issues.push({
      type: normalizeType(issue.category),
      start: issue.start,
      end: issue.end,
      quote: typeof issue.quote === 'string' ? issue.quote : '',
    })
  }
  return issues
}

export function evaluateGolden(golden: Row): EvalResultPayload {
  const text = String(golden.text ?? '')
  const labels = normalizeLabels(text, golden.labels)
  const issues = normalizeIssues(engineLint(text, null))

  const matched: NormalizedLabel[] = []
  const usedIssues = new Set<number>()
  const missed: NormalizedLabel[] = []

  for (const label of labels) {
    const index = issues.findIndex(
      (issue, issueIndex) =>
        !usedIssues.has(issueIndex) &&
        label.start >= 0 &&
        typesMatch(label.type, issue.type) &&
        overlaps(label, issue),
    )
    if (index === -1) {
      missed.push(label)
    } else {
      usedIssues.add(index)
      matched.push(label)
    }
  }
  const falsePositive = issues.filter((_, index) => !usedIssues.has(index))
  const precision =
    matched.length + falsePositive.length === 0
      ? 1
      : matched.length / (matched.length + falsePositive.length)
  const recall = labels.length === 0 ? 1 : matched.length / labels.length

  return {
    golden_id: Number(golden.id),
    precision: round4(precision),
    recall: round4(recall),
    matched,
    missed,
    false_positive: falsePositive,
  }
}

function summarize(results: EvalResultPayload[]): EvalSummary {
  const matched = results.reduce((sum, result) => sum + result.matched.length, 0)
  const missed = results.reduce((sum, result) => sum + result.missed.length, 0)
  const falsePositive = results.reduce((sum, result) => sum + result.false_positive.length, 0)
  return {
    goldens: results.length,
    precision: round4(matched + falsePositive === 0 ? 1 : matched / (matched + falsePositive)),
    recall: round4(matched + missed === 0 ? 1 : matched / (matched + missed)),
    matched,
    missed,
    false_positive: falsePositive,
  }
}

export async function runEvals(goldens: Row[]): Promise<EvalRunResult> {
  const startedAt = Date.now()
  let results: EvalResultPayload[]
  try {
    results = goldens.map((golden) => evaluateGolden(golden))
  } catch (error) {
    await insertRun({
      authorId: null,
      taskType: 'lint',
      model: 'rules-engine',
      tokensInput: 0,
      tokensOutput: 0,
      tokens: 0,
      cost: 0,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    })
    throw error
  }

  const generationRunId = await insertRun({
    authorId: null,
    taskType: 'lint',
    model: 'rules-engine',
    tokensInput: 0,
    tokensOutput: 0,
    tokens: 0,
    cost: 0,
    status: 'success',
    durationMs: Date.now() - startedAt,
  })

  const rows: EvalResultRow[] = results.map((result) => ({
    goldenId: result.golden_id,
    precision: result.precision,
    recall: result.recall,
    matched: result.matched,
    missed: result.missed,
    falsePositive: result.false_positive,
  }))
  await insertResults(generationRunId, rows)

  return {
    generation_run_id: generationRunId,
    summary: summarize(results),
    results,
  }
}
