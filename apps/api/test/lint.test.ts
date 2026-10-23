/** Группа 6. Проверка: правила+LLM, неизменяемость, лимит 402, откат LLM. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  api,
  authorToken,
  bootstrap,
  cleanupProfiles,
  createProfile,
  db,
  dbOne,
  freshUser,
} from './helpers.ts'

before(async () => {
  await bootstrap()
  const owner = await freshUser('Проверка')
  ownerToken = owner.token
  tokenRef.token = ownerToken
})

const created: Array<Record<string, unknown>> = []
let ownerToken = ''
const tokenRef: { token: string } = { token: '' }

after(async () => {
  process.env.LLM_MOCK_FAIL = '0'
  if (tokenRef.token) await cleanupProfiles(tokenRef.token, created)
  if (ownerToken) await api('DELETE', '/users/me', { token: ownerToken })
})

const TEXT_WITH_ISSUES =
  'В современном мире каждый автор обязан вести контент-план. Это очень важно для роста. ' +
  'Выйти на новый уровень без плана невозможно, и это секрет успеха.'

async function makeDraft(text = TEXT_WITH_ISSUES): Promise<{
  token: string
  profile: Record<string, unknown>
  draft: Record<string, unknown>
}> {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const draft = await api<Record<string, unknown>>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts`,
    { token, body: { title: 'Проверка', text } },
  )
  assert.equal(draft.status, 201)
  return { token, profile, draft: draft.body }
}

test('POST /drafts/{id}/lint: правила + LLM (mock), оценка и группы', async () => {
  const { token, draft } = await makeDraft()
  const response = await api<{
    lint_report: {
      id: number
      draft_id: number
      score: number
      engine: string
      generation_run_id: number | null
      issues: Array<{ type: string; category: string; severity: string }>
    }
    groups: Record<string, number>
    verdict: string
    verified_without_ai: boolean
  }>('POST', `/drafts/${String(draft.id)}/lint`, { token, body: { use_llm: true } })
  assert.equal(response.status, 201)
  assert.equal(response.body.lint_report.engine, 'rules+llm')
  assert.equal(response.body.verified_without_ai, false)
  assert.equal(typeof response.body.lint_report.generation_run_id, 'number')
  assert.ok(response.body.lint_report.score >= 0 && response.body.lint_report.score <= 100)
  assert.ok(response.body.lint_report.issues.length >= 1)
  for (const key of ['cliche', 'logic', 'tov', 'clarity']) {
    assert.equal(typeof response.body.groups[key], 'number')
  }
  assert.ok(['Можно публиковать', 'Требует правок', 'Переписать'].includes(response.body.verdict))
})

test('POST /drafts/{id}/lint с use_llm=false → engine=rules, verified_without_ai=true', async () => {
  const { token, draft } = await makeDraft()
  const response = await api<{
    lint_report: { engine: string; generation_run_id: number | null }
    verified_without_ai: boolean
  }>('POST', `/drafts/${String(draft.id)}/lint`, { token, body: { use_llm: false } })
  assert.equal(response.status, 201)
  assert.equal(response.body.lint_report.engine, 'rules')
  assert.equal(response.body.lint_report.generation_run_id, null)
  assert.equal(response.body.verified_without_ai, true)
})

test('пустой текст → 422 empty_text', async () => {
  const { token, draft } = await makeDraft('   ')
  const response = await api<{ error: { code: string; details: { reason?: string } } }>(
    'POST',
    `/drafts/${String(draft.id)}/lint`,
    { token, body: { use_llm: false } },
  )
  assert.equal(response.status, 422)
  assert.equal(response.body.error.details.reason, 'empty_text')
})

test('повторная проверка создаёт новый отчёт; история в created_at DESC', async () => {
  const { token, draft } = await makeDraft()
  const first = await api<{ lint_report: { id: number } }>(
    'POST',
    `/drafts/${String(draft.id)}/lint`,
    { token, body: { use_llm: false } },
  )
  const second = await api<{ lint_report: { id: number } }>(
    'POST',
    `/drafts/${String(draft.id)}/lint`,
    { token, body: { use_llm: false } },
  )
  assert.notEqual(first.body.lint_report.id, second.body.lint_report.id)

  const history = await api<{ items: Array<{ id: number; created_at: string }> }>(
    'GET',
    `/drafts/${String(draft.id)}/lint-reports`,
    { token, query: { limit: 10 } },
  )
  assert.equal(history.status, 200)
  assert.ok(history.body.items.length >= 2)
  assert.ok(
    Date.parse(history.body.items[0]!.created_at) >=
      Date.parse(history.body.items[1]!.created_at),
  )

  const reportId = second.body.lint_report.id
  const single = await api<{ id: number }>('GET', `/lint-reports/${String(reportId)}`, {
    token,
  })
  assert.equal(single.status, 200)
  assert.equal(Number(single.body.id), Number(reportId))
})

test('lint_reports неизменяемы: UPDATE через SQL запрещён триггером', async () => {
  const { draft } = await makeDraft()
  const token = tokenRef.token
  const report = await api<{ lint_report: { id: number; generation_run_id: number } }>(
    'POST',
    `/drafts/${String(draft.id)}/lint`,
    { token, body: { use_llm: true } },
  )
  assert.equal(report.status, 201)
  const reportId = report.body.lint_report.id

  await assert.rejects(
    db('UPDATE lint_reports SET score = 1 WHERE id = $1', [reportId]),
    /неизменяем/i,
  )
  await assert.rejects(
    db(`UPDATE lint_reports SET issues = '[]'::jsonb WHERE id = $1`, [reportId]),
    /неизменяем/i,
  )
  await assert.rejects(
    db('UPDATE lint_reports SET generation_run_id = $2 WHERE id = $1', [reportId, 999999]),
    /неизменяем/i,
  )
})

test('DB-2: удаление вызова AI обнуляет ссылку в отчёте и не падает', async () => {
  const { token, draft } = await makeDraft()
  const linted = await api<{ lint_report: { id: number; generation_run_id: number } }>(
    'POST',
    `/drafts/${String(draft.id)}/lint`,
    { token, body: { use_llm: true } },
  )
  const runId = Number(linted.body.lint_report.generation_run_id)
  const reportId = Number(linted.body.lint_report.id)
  assert.ok(runId > 0)

  await db('DELETE FROM generation_runs WHERE id = $1', [runId])
  const report = await dbOne<{ generation_run_id: number | null; score: number }>(
    'SELECT generation_run_id, score FROM lint_reports WHERE id = $1',
    [reportId],
  )
  assert.equal(report?.generation_run_id, null)
  assert.ok(Number(report?.score) >= 0)
})

test('GET /lint-reports/{id} чужого отчёта → 404', async () => {
  const { token, draft } = await makeDraft()
  const linted = await api<{ lint_report: { id: number } }>(
    'POST',
    `/drafts/${String(draft.id)}/lint`,
    { token, body: { use_llm: false } },
  )
  const stranger = await freshUser('Чужой lint')
  try {
    const response = await api('GET', `/lint-reports/${String(linted.body.lint_report.id)}`, {
      token: stranger.token,
    })
    assert.equal(response.status, 404)
  } finally {
    await api('DELETE', '/users/me', { token: stranger.token })
  }
})

test('лимит 100%: strict AI → 402 ai_budget_exceeded, иначе откат на правила', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token, 'telegram', { monthly_cost_limit: 1 })
  created.push(profile)
  const draft = await api<Record<string, unknown>>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts`,
    { token, body: { title: 'Лимит', text: TEXT_WITH_ISSUES } },
  )

  await db(
    `INSERT INTO generation_runs (author_id, task_type, model, tokens, cost, status)
     VALUES ($1, 'lint', 'mock', 1000, 5, 'success')`,
    [profile.id],
  )

  const usage = await api<{
    spent: number
    monthly_cost_limit: number
    limit_ratio: number
    warning: boolean
    blocked: boolean
  }>('GET', `/author-profiles/${String(profile.id)}/usage`, { token })
  assert.equal(usage.status, 200)
  assert.equal(usage.body.blocked, true)
  assert.equal(usage.body.warning, true)
  assert.ok(usage.body.limit_ratio >= 1)

  const strict = await api<{ error: { code: string; details: { fallback?: string } } }>(
    'POST',
    `/drafts/${String(draft.body.id)}/lint`,
    { token, body: { use_llm: true, strict_ai: true } },
  )
  assert.equal(strict.status, 402)
  assert.equal(strict.body.error.code, 'ai_budget_exceeded')
  assert.equal(strict.body.error.details.fallback, 'rules')

  const fallback = await api<{
    lint_report: { engine: string; generation_run_id: number | null }
    verified_without_ai: boolean
    ai_skipped_reason?: string
  }>('POST', `/drafts/${String(draft.body.id)}/lint`, {
    token,
    body: { use_llm: true },
  })
  assert.equal(fallback.status, 201)
  assert.equal(fallback.body.lint_report.engine, 'rules')
  assert.equal(fallback.body.lint_report.generation_run_id, null)
  assert.equal(fallback.body.verified_without_ai, true)
  assert.equal(fallback.body.ai_skipped_reason, 'budget_exceeded')

  const budgetRuns = await db<{ count: number }>(
    `SELECT count(*)::int AS count FROM generation_runs
      WHERE author_id = $1 AND task_type = 'lint' AND cost >= 5`,
    [profile.id],
  )
  assert.equal(Number(budgetRuns[0]?.count), 1, 'AI-вызов при лимите не выполнялся')
})

test('LLM_MOCK_FAIL=1: одна повторная попытка, откат на правила и failed в журнале', async () => {
  const { token, profile, draft } = await makeDraft()
  process.env.LLM_MOCK_FAIL = '1'
  try {
    const response = await api<{
      lint_report: { engine: string; generation_run_id: number | null }
      verified_without_ai: boolean
      ai_skipped_reason?: string
    }>('POST', `/drafts/${String(draft.id)}/lint`, { token, body: { use_llm: true } })
    assert.equal(response.status, 201)
    assert.equal(response.body.verified_without_ai, true)
    assert.equal(response.body.ai_skipped_reason, 'llm_unavailable')
    assert.equal(response.body.lint_report.generation_run_id, null)

    const failedRun = await dbOne<{ status: string; error_message: string | null }>(
      `SELECT status, error_message FROM generation_runs
        WHERE author_id = $1 AND task_type = 'lint'
        ORDER BY id DESC LIMIT 1`,
      [profile.id],
    )
    assert.equal(failedRun?.status, 'failed')
    assert.ok((failedRun?.error_message ?? '').length > 0)
  } finally {
    process.env.LLM_MOCK_FAIL = '0'
  }
})
