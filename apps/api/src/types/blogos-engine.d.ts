/**
 * Типы для @blogos/engine: пакет на чистом JavaScript (без .d.ts).
 * Объявления повторяют реальные экспорты packages/engine/src/index.js.
 */
declare module '@blogos/engine' {
  export interface EngineIssue {
    id?: string
    ruleId?: string
    category: string
    severity: 'high' | 'med' | 'low'
    title?: string
    message?: string
    quote?: string | null
    start: number | null
    end: number | null
    fix?: string
    mode?: string
  }

  export interface LintResult {
    empty: boolean
    score: number | null
    grade?: { label: string; tone: string } | null
    issues: EngineIssue[]
    metrics: Record<string, number>
    categoryScores: Record<string, { score: number; issues: number }>
    tovDeltas?: unknown[]
    notes?: Array<{ kind: string; text: string }>
    fixableCount?: number
  }

  export function lint(text: string, profile?: unknown): LintResult
  export function scoreText(
    issues: Array<{ severity: string; category: string }>,
    wordCount: number,
  ): { score: number; categoryScores: Record<string, { score: number; issues: number }> }
  export const CATEGORIES: Record<string, { label: string; hint: string }>
  export function buildDraftMetrics(text: string): Record<string, number>
  export function compareToProfile(text: string, profile: unknown): unknown[]
  export function buildStyleProfile(samples: string[]): Record<string, unknown> | null

  export function buildPost(
    notes: string,
    profile: unknown,
    arcKey?: string,
  ): {
    ok: boolean
    reason?: string
    fragments: Array<{ index: number; text: string }>
    arc?: { key: string; label: string; hint: string }
    title?: string
    blocks?: Array<{ role: string; label: string; sources: number[]; text: string }>
    text?: string
    additions?: Array<{ type: string; text: string }>
    coverage?: { used: number; total: number }
  }
  export function suggestArc(
    fragments: Array<{ index: number; text: string }>,
    debug?: boolean,
  ): string | Record<string, number>
  export function splitFragments(notes: string): Array<{ index: number; text: string }>
  export const ARCS: Record<
    string,
    {
      key: string
      label: string
      hint: string
      slots: Array<{ role: string; label: string; max: number }>
      spill: string
    }
  >

  export function rankDiscussions(discussions: unknown[], profile: unknown): unknown[]
  export function draftComment(
    discussion: unknown,
    profile: unknown,
  ): {
    text: string
    evidence: { quote: string; postIndex: number; score: number } | null
    parts: Array<{ kind: string; text: string; source?: string }>
  }
  export function hasGaps(text: string): boolean
  export function retrieveEvidence(discussion: unknown, profile: unknown): unknown

  export const DEMO_AUTHOR: { name: string; samples: string[] }
  export const DEMO_DISCUSSIONS: Array<Record<string, unknown>>
}
