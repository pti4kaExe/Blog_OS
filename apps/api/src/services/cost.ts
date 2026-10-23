/**
 * Стоимость AI и лимит канала (docs/DECISIONS.md, решение № 7):
 *  80% monthly_cost_limit — предупреждение в GET …/usage;
 *  100% — AI-вызовы не выполняются, движок работает на правилах.
 *
 * Явный AI-запрос со strict_ai при достигнутом лимите получает 402
 * ai_budget_exceeded (details.fallback = "rules"). lint/generate никогда
 * не падают из-за лимита: они отдают результат правил с verified_without_ai.
 */
import { env } from '../env.ts'
import { budgetExceeded, notFound } from '../errors.ts'
import { query, queryOne, toNum } from '../db.ts'

export interface BudgetState {
  authorProfileId: number
  limit: number | null
  spent: number
  /** Доля израсходованного лимита 0…N; null — лимит не задан. */
  ratio: number | null
  warning: boolean
  blocked: boolean
}

export interface UsageByTask {
  task_type: string
  runs: number
  tokens: number
  cost: number
}

export interface UsageReport {
  author_profile_id: number
  period: string
  monthly_cost_limit: number | null
  spent: number
  limit_ratio: number | null
  warning: boolean
  blocked: boolean
  runs: { total: number; success: number; failed: number }
  by_task: UsageByTask[]
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export async function getBudgetState(authorId: number): Promise<BudgetState> {
  const row = await queryOne<{
    monthly_cost_limit: number | null
    spent: number | string | null
  }>(
    `SELECT ap.monthly_cost_limit,
            coalesce((
              SELECT sum(gr.cost) FROM generation_runs gr
               WHERE gr.author_id = ap.id
                 AND gr.created_at >= date_trunc('month', now())
            ), 0) AS spent
       FROM author_profiles ap
      WHERE ap.id = $1`,
    [authorId],
  )
  if (!row) throw notFound('Канал не найден')

  const limit = toNum(row.monthly_cost_limit)
  const spent = toNum(row.spent) ?? 0
  let ratio: number | null
  if (limit === null) ratio = null
  else if (limit <= 0) ratio = spent > 0 ? spent : 1
  else ratio = spent / limit

  const warning = ratio !== null && ratio >= env.COST_WARN_RATIO
  const blocked = ratio !== null && ratio >= 1
  return { authorProfileId: authorId, limit, spent, ratio, warning, blocked }
}

/** strict=true — явный AI-запрос: при достигнутом лимите 402. */
export async function assertAiBudget(
  authorId: number,
  options: { strict?: boolean } = {},
): Promise<BudgetState> {
  const state = await getBudgetState(authorId)
  if (state.blocked && options.strict) throw budgetExceeded()
  return state
}

export async function getUsage(authorId: number): Promise<UsageReport> {
  const state = await getBudgetState(authorId)
  const totals = await queryOne<{ total: number; success: number; failed: number; period: string }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'success')::int AS success,
            count(*) FILTER (WHERE status = 'failed')::int AS failed,
            to_char(now(), 'YYYY-MM') AS period
       FROM generation_runs
      WHERE author_id = $1 AND created_at >= date_trunc('month', now())`,
    [authorId],
  )
  const byTask = await query<{
    task_type: string
    runs: number
    tokens: number | string | null
    cost: number | string | null
  }>(
    `SELECT task_type,
            count(*)::int AS runs,
            coalesce(sum(tokens), 0)::int AS tokens,
            coalesce(sum(cost), 0) AS cost
       FROM generation_runs
      WHERE author_id = $1 AND created_at >= date_trunc('month', now())
      GROUP BY task_type
      ORDER BY task_type`,
    [authorId],
  )

  return {
    author_profile_id: authorId,
    period: totals?.period ?? new Date().toISOString().slice(0, 7),
    monthly_cost_limit: state.limit,
    spent: round(state.spent, 2),
    limit_ratio: state.ratio === null ? null : round(state.ratio, 4),
    warning: state.warning,
    blocked: state.blocked,
    runs: {
      total: Number(totals?.total ?? 0),
      success: Number(totals?.success ?? 0),
      failed: Number(totals?.failed ?? 0),
    },
    by_task: byTask.map((row) => ({
      task_type: row.task_type,
      runs: Number(row.runs),
      tokens: Number(row.tokens ?? 0),
      cost: round(toNum(row.cost) ?? 0, 2),
    })),
  }
}
