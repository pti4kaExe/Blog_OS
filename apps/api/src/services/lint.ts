/**
 * AntiCringe на сервере: правила из @blogos/engine — всегда, LLM — второй слой.
 *
 * Оценка всегда пересчитывается правилами (scoreText) по объединённому списку
 * замечаний, поэтому ответ модели не может «нарисовать» произвольный балл.
 * Отчёт неизменяем: сервис только собирает данные, запись делает репозиторий.
 */
import { CATEGORIES, lint as engineLint, scoreText } from '@blogos/engine'
import type { EngineIssue } from '@blogos/engine'
import { callLlm, llmConfigured, parseJson } from './llm/index.ts'
import { LINT_SYSTEM, lintUser } from './llm/prompts.ts'
import type { EngineProfile } from './style.ts'

export interface ApiIssue {
  id: string
  type: string
  category: string
  quote: string | null
  start: number | null
  end: number | null
  explanation: string
  suggestion: string
  severity: 'high' | 'medium' | 'low'
  fixable: boolean
  source?: 'rules' | 'llm'
}

export type Severity = 'high' | 'med' | 'low'

const CATEGORY_KEYS = Object.keys(CATEGORIES)

function normalizeSeverity(severity: unknown): 'high' | 'medium' | 'low' {
  if (severity === 'high') return 'high'
  if (severity === 'med' || severity === 'medium') return 'medium'
  return 'low'
}

function toEngineSeverity(severity: string): Severity {
  if (severity === 'high') return 'high'
  if (severity === 'medium') return 'med'
  return 'low'
}

function typeOfCategory(category: string): string {
  return CATEGORY_KEYS.includes(category) ? category : 'clarity'
}

/** Правиловые замечания движка → контракт API. */
export function rulesIssues(engineIssues: EngineIssue[]): ApiIssue[] {
  return engineIssues.map((issue, index) => {
    const category = typeof issue.category === 'string' ? issue.category : 'clarity'
    const start = typeof issue.start === 'number' ? issue.start : null
    const end = typeof issue.end === 'number' ? issue.end : null
    return {
      id: typeof issue.id === 'string' ? issue.id : `${category}-${index + 1}`,
      type: typeOfCategory(category),
      category,
      quote: typeof issue.quote === 'string' ? issue.quote : null,
      start,
      end,
      explanation:
        typeof issue.message === 'string'
          ? issue.message
          : typeof issue.title === 'string'
            ? issue.title
            : 'Замечание правилового движка',
      suggestion:
        typeof issue.fix === 'string' && issue.fix.length > 0
          ? `Заменить на «${issue.fix}»`
          : 'Переформулируйте фрагмент',
      severity: normalizeSeverity(issue.severity),
      fixable: typeof issue.fix === 'string' && start !== null && end !== null,
      source: 'rules',
    }
  })
}

export interface RulesLintResult {
  score: number
  issues: ApiIssue[]
  engineReport: ReturnType<typeof engineLint>
}

export function runRulesLint(text: string, profile: EngineProfile | null): RulesLintResult {
  const report = engineLint(text, profile)
  const issues = rulesIssues(report.issues)
  const score =
    typeof report.score === 'number'
      ? report.score
      : scoreText([], Math.max(1, report.metrics.words ?? 1)).score
  return { score, issues, engineReport: report }
}

export interface LlmLintIssue {
  type?: string
  category?: string
  quote?: string
  start?: number
  end?: number
  explanation?: string
  suggestion?: string
  severity?: string
}

function normalizeLlmIssues(raw: unknown, text: string): ApiIssue[] {
  if (!Array.isArray(raw)) return []
  const result: ApiIssue[] = []
  for (const item of raw as LlmLintIssue[]) {
    if (!item || typeof item !== 'object') continue
    const type = String(item.type ?? item.category ?? 'clarity')
    const category = CATEGORY_KEYS.includes(type) ? type : 'clarity'
    const quote = typeof item.quote === 'string' ? item.quote : ''
    let start = Number.isFinite(item.start) ? Number(item.start) : null
    let end = Number.isFinite(item.end) ? Number(item.end) : null
    if (start === null || end === null || start < 0 || end <= start || end > text.length) {
      const index = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1
      if (index === -1) continue
      start = index
      end = index + quote.length
    }
    if (end > text.length) end = text.length
    if (start === null || end === null || end <= start) continue
    result.push({
      id: `llm-${type}-${start}`,
      type: typeOfCategory(category),
      category,
      quote: quote || text.slice(start, end),
      start,
      end,
      explanation: String(item.explanation ?? 'Замечание модели'),
      suggestion: String(item.suggestion ?? 'Переформулируйте фрагмент'),
      severity: normalizeSeverity(item.severity),
      fixable: false,
      source: 'llm',
    })
  }
  return result
}

function overlaps(a: ApiIssue, b: ApiIssue): boolean {
  if (a.start === null || a.end === null || b.start === null || b.end === null) return false
  return a.start < b.end && b.start < a.end
}

/** Добавляет замечания модели, не дублируя пересекающиеся замечания правил. */
export function mergeIssues(ruleIssues: ApiIssue[], llmIssues: ApiIssue[]): ApiIssue[] {
  const merged = [...ruleIssues]
  for (const issue of llmIssues) {
    const duplicate = merged.some(
      (existing) =>
        existing.type === issue.type &&
        (overlaps(existing, issue) ||
          (!!issue.quote && existing.quote === issue.quote && existing.category === issue.category)),
    )
    if (!duplicate) merged.push(issue)
  }
  return merged
}

export function groupsOf(issues: ApiIssue[]): Record<string, number> {
  const groups: Record<string, number> = { cliche: 0, logic: 0, tov: 0, clarity: 0 }
  for (const issue of issues) {
    groups[issue.category] = (groups[issue.category] ?? 0) + 1
  }
  return groups
}

/** contract: ≥75 «Можно публиковать», 40—74 «Требует правок», <40 «Переписать». */
export function verdictFor(score: number): string {
  if (score >= 75) return 'Можно публиковать'
  if (score >= 40) return 'Требует правок'
  return 'Переписать'
}

function scoreFor(issues: ApiIssue[], wordCount: number): number {
  return scoreText(
    issues.map((issue) => ({ severity: toEngineSeverity(issue.severity), category: issue.category })),
    Math.max(1, wordCount),
  ).score
}

export interface LintOptions {
  text: string
  profile: EngineProfile | null
  authorId: number
  useLlm: boolean
  /** Лимит исчерпан: AI не вызываем, работаем на правилах. */
  budgetBlocked: boolean
}

export interface LintOutcome {
  score: number
  issues: ApiIssue[]
  groups: Record<string, number>
  verdict: string
  engine: 'rules' | 'rules+llm'
  generationRunId: number | null
  verifiedWithoutAi: boolean
  aiSkippedReason?: string
}

export async function runLint(options: LintOptions): Promise<LintOutcome> {
  const rules = runRulesLint(options.text, options.profile)
  const words = rules.engineReport.metrics.words ?? 1

  const skipReason = (): string | undefined => {
    if (!options.useLlm) return undefined
    if (options.budgetBlocked) return 'budget_exceeded'
    if (!llmConfigured()) return 'llm_not_configured'
    return undefined
  }

  if (!options.useLlm || options.budgetBlocked || !llmConfigured()) {
    return {
      score: rules.score,
      issues: rules.issues,
      groups: groupsOf(rules.issues),
      verdict: verdictFor(rules.score),
      engine: 'rules',
      generationRunId: null,
      verifiedWithoutAi: true,
      aiSkippedReason: skipReason(),
    }
  }

  const outcome = await callLlm({
    authorId: options.authorId,
    taskType: 'lint',
    system: LINT_SYSTEM,
    user: lintUser(options.text),
    json: true,
    maxTokens: 1200,
  })

  if (!outcome.ok) {
    return {
      score: rules.score,
      issues: rules.issues,
      groups: groupsOf(rules.issues),
      verdict: verdictFor(rules.score),
      engine: 'rules',
      generationRunId: null,
      verifiedWithoutAi: true,
      aiSkippedReason: 'llm_unavailable',
    }
  }

  const parsed = parseJson<{ issues?: unknown }>(outcome.result.text)
  const llmIssues = normalizeLlmIssues(parsed?.issues, options.text)
  const issues = mergeIssues(rules.issues, llmIssues)
  const score = scoreFor(issues, words)
  return {
    score,
    issues,
    groups: groupsOf(issues),
    verdict: verdictFor(score),
    engine: 'rules+llm',
    generationRunId: outcome.generationRunId,
    verifiedWithoutAi: false,
  }
}
