/** Группа 11. Служебные: журнал AI, golden-dataset (admin), Evals. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  adminToken,
  api,
  bootstrap,
  db,
  dbOne,
} from './helpers.ts'

before(async () => {
  await bootstrap()
})

after(async () => {
  process.env.EMBEDDINGS_PROVIDER = 'mock'
})

test('GET /golden-dataset: список с пагинацией и фильтром platform', async () => {
  const token = await adminToken()
  const response = await api<{ items: Array<{ id: number; platform: string; labels: unknown[] }> }>(
    'GET',
    '/golden-dataset',
    { token, query: { limit: 100 } },
  )
  assert.equal(response.status, 200)
  assert.ok(response.body.items.length >= 10)
  assert.ok(response.body.items.every((item) => Array.isArray(item.labels)))

  const filtered = await api<{ items: Array<{ platform: string }> }>('GET', '/golden-dataset', {
    token,
    query: { platform: 'telegram', limit: 100 },
  })
  assert.ok(filtered.body.items.every((item) => item.platform === 'telegram'))
})

test('golden-dataset CRUD доступен администратору', async () => {
  const token = await adminToken()
  const created = await api<{ id: number; text: string; labels: Array<{ type: string }> }>(
    'POST',
    '/golden-dataset',
    {
      token,
      body: {
        text: 'В современном мире каждый обязан выйти из зоны комфорта, это секрет успеха.',
        labels: [{ type: 'cliche', quote: 'выйти из зоны комфорта' }],
        platform: 'telegram',
      },
    },
  )
  assert.equal(created.status, 201)
  assert.equal(created.body.labels.length, 1)

  const patched = await api<{ text: string }>('PATCH', `/golden-dataset/${String(created.body.id)}`, {
    token,
    body: { text: 'Обновлённый эталонный текст с прокачать и секретом успеха.' },
  })
  assert.equal(patched.status, 200)

  const removed = await api('DELETE', `/golden-dataset/${String(created.body.id)}`, { token })
  assert.equal(removed.status, 204)
  const gone = await api('DELETE', `/golden-dataset/${String(created.body.id)}`, { token })
  assert.equal(gone.status, 404)
})

test('POST /evals/run: precision/recall, результаты и generation_run', async () => {
  const token = await adminToken()
  const response = await api<{
    generation_run_id: number
    summary: {
      goldens: number
      precision: number
      recall: number
      matched: number
      missed: number
      false_positive: number
    }
    results: Array<{
      golden_id: number
      precision: number
      recall: number
      matched: unknown[]
      missed: unknown[]
      false_positive: unknown[]
    }>
  }>('POST', '/evals/run', { token, body: { use_llm: false, platform: null } })
  assert.equal(response.status, 201)
  assert.ok(response.body.generation_run_id > 0)
  assert.equal(response.body.summary.goldens, response.body.results.length)
  assert.ok(response.body.summary.precision >= 0 && response.body.summary.precision <= 1)
  assert.ok(response.body.summary.recall >= 0 && response.body.summary.recall <= 1)
  assert.ok(response.body.summary.matched >= 1)

  const run = await dbOne<{ task_type: string; status: string }>(
    'SELECT task_type, status FROM generation_runs WHERE id = $1',
    [response.body.generation_run_id],
  )
  assert.equal(run?.task_type, 'lint')
  assert.equal(run?.status, 'success')

  const stored = await dbOne<{ count: number }>(
    'SELECT count(*)::int AS count FROM eval_results WHERE generation_run_id = $1',
    [response.body.generation_run_id],
  )
  assert.equal(Number(stored?.count), response.body.summary.goldens)

  const byRun = await api<{ items: Array<{ golden_id: number }> }>('GET', '/evals/runs', {
    token,
    query: { generation_run_id: response.body.generation_run_id, limit: 100 },
  })
  assert.equal(byRun.status, 200)
  assert.equal(byRun.body.items.length, response.body.summary.goldens)

  const summary = await api<{
    items: Array<{ generation_run_id: number; goldens: number; precision: number; recall: number }>
  }>('GET', '/evals/runs', { token, query: { limit: 50 } })
  assert.equal(summary.status, 200)
  const found = summary.body.items.find(
    (item) => Number(item.generation_run_id) === Number(response.body.generation_run_id),
  )
  assert.ok(found, 'сводка по прогонам содержит созданный прогон')
  assert.equal(Number(found?.goldens), response.body.summary.goldens)
})

test('GET /generation-runs: фильтры task_type и status', async () => {
  const token = await adminToken()
  const byTask = await api<{ items: Array<{ task_type: string }> }>('GET', '/generation-runs', {
    token,
    query: { task_type: 'lint', limit: 100 },
  })
  assert.equal(byTask.status, 200)
  assert.ok(byTask.body.items.length >= 1)
  assert.ok(byTask.body.items.every((item) => item.task_type === 'lint'))

  const byStatus = await api<{ items: Array<{ status: string }> }>('GET', '/generation-runs', {
    token,
    query: { status: 'failed', limit: 100 },
  })
  assert.ok(byStatus.body.items.every((item) => item.status === 'failed'))
})

test('POST /evals/run на пустом golden_dataset → 422', async () => {
  const token = await adminToken()
  await db('DELETE FROM golden_dataset')
  const response = await api<{ error: { code: string; details: { reason?: string } } }>(
    'POST',
    '/evals/run',
    { token, body: {} },
  )
  assert.equal(response.status, 422)
  assert.equal(response.body.error.code, 'unprocessable')
  assert.equal(response.body.error.details.reason, 'empty_golden_dataset')
})

test('POST /evals/run без токена → 401, пользователю → 403 (повторно, после DELETE)', async () => {
  const noToken = await api('POST', '/evals/run', { body: {} })
  assert.equal(noToken.status, 401)
})
