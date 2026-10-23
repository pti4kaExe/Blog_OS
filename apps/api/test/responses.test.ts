/** Группа 9. Варианты ответа: ручные, переходы статусов, пропуски, генерация. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  api,
  authorToken,
  bootstrap,
  cleanupProfiles,
  createProfile,
} from './helpers.ts'

before(async () => {
  await bootstrap()
})

const created: Array<Record<string, unknown>> = []
const tokenRef: { token: string } = { token: '' }

after(async () => {
  if (tokenRef.token) await cleanupProfiles(tokenRef.token, created)
})

async function makeComment(): Promise<{
  token: string
  comment: { id: number }
  commentUrl: string
}> {
  const token = await authorToken()
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const source = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/sources`,
    {
      token,
      body: {
        name: 'Источник для ответов',
        source_type: 'telegram_channel',
        source_url: `https://t.me/s/responses_${String(Date.now())}_${Math.floor(Math.random() * 1e6)}`,
      },
    },
  )
  assert.equal(source.status, 201)
  const comment = await api<{ id: number }>(
    'POST',
    `/sources/${String(source.body.id)}/comments`,
    {
      token,
      body: { commenter_name: 'Читатель', text: 'А как вы это настроили у себя?' },
    },
  )
  assert.equal(comment.status, 201)
  return { token, comment: { id: Number(comment.body.id) }, commentUrl: `/comments/${String(comment.body.id)}` }
}

test('ручной вариант ответа: create/list/get/delete', async () => {
  const { token, comment, commentUrl } = await makeComment()
  const createdResponse = await api<Record<string, unknown>>(
    'POST',
    `${commentUrl}/responses`,
    { token, body: { response_text: 'Спасибо! У меня было так: я выписал темы и пишу дважды в неделю.' } },
  )
  assert.equal(createdResponse.status, 201)
  assert.equal(createdResponse.body.status, 'generated')

  const list = await api<{ items: Array<{ id: number }> }>('GET', `${commentUrl}/responses`, {
    token,
    query: { status: 'generated' },
  })
  assert.equal(list.status, 200)
  assert.ok(list.body.items.some((item) => Number(item.id) === Number(createdResponse.body.id)))

  const fetched = await api<{ id: number }>(
    'GET',
    `/responses/${String(createdResponse.body.id)}`,
    { token },
  )
  assert.equal(fetched.status, 200)

  const removed = await api('DELETE', `/responses/${String(createdResponse.body.id)}`, { token })
  assert.equal(removed.status, 204)
  assert.ok(comment.id > 0)
})

test('переходы статусов: generated → pending_approval → approved → sent', async () => {
  const { token, commentUrl } = await makeComment()
  const response = await api<{ id: number }>('POST', `${commentUrl}/responses`, {
    token,
    body: { response_text: 'Спасибо за вопрос! Отвечу из своего опыта: регулярность важнее гениальности.' },
  })
  const id = String(response.body.id)
  const url = `/responses/${id}`

  const pending = await api<Record<string, unknown>>('PATCH', url, {
    token,
    body: { status: 'pending_approval' },
  })
  assert.equal(pending.status, 200)
  assert.equal(pending.body.status, 'pending_approval')

  const approved = await api<Record<string, unknown>>('PATCH', url, {
    token,
    body: { status: 'approved' },
  })
  assert.equal(approved.status, 200)
  assert.equal(approved.body.status, 'approved')
  assert.ok(approved.body.approved_at, 'сервер сам проставляет approved_at')

  const sent = await api<Record<string, unknown>>('PATCH', url, { token, body: { status: 'sent' } })
  assert.equal(sent.status, 200)
  assert.equal(sent.body.status, 'sent')
  assert.ok(sent.body.sent_at)
})

test('недопустимый переход generated → approved → 422 invalid_transition', async () => {
  const { token, commentUrl } = await makeComment()
  const response = await api<{ id: number }>('POST', `${commentUrl}/responses`, {
    token,
    body: { response_text: 'Спасибо! Ответ без перехода через pending.' },
  })
  const invalid = await api<{ error: { details: { reason?: string } } }>(
    'PATCH',
    `/responses/${String(response.body.id)}`,
    { token, body: { status: 'approved' } },
  )
  assert.equal(invalid.status, 422)
  assert.equal(invalid.body.error.details.reason, 'invalid_transition')
})

test('незаполненный пропуск [дополните: …] при одобрении → 422 unfilled_gaps', async () => {
  const { token, commentUrl } = await makeComment()
  const response = await api<{ id: number }>('POST', `${commentUrl}/responses`, {
    token,
    body: { response_text: 'Спасибо! [дополните: что именно сработало у меня]' },
  })
  const patch = await api<{ error: { details: { reason?: string } } }>(
    'PATCH',
    `/responses/${String(response.body.id)}`,
    { token, body: { edited_text: 'Спасибо! [дополните: что именно сработало у меня]' } },
  )
  assert.equal(patch.status, 422)
  assert.equal(patch.body.error.details.reason, 'unfilled_gaps')
})

test('POST /comments/{id}/responses/generate на правилах: 4 части и пропуск', async () => {
  const { token, commentUrl } = await makeComment()
  const response = await api<{
    responses: Array<{
      id: number
      response_text: string
      status: string
      parts: { reference: string; experience: string; gap: string; question: string }
    }>
    verified_without_ai: boolean
    based_on_post_id: number | null
  }>('POST', `${commentUrl}/responses/generate`, {
    token,
    body: { count: 2, use_llm: false },
  })
  assert.equal(response.status, 201)
  assert.equal(response.body.responses.length, 2)
  assert.equal(response.body.verified_without_ai, true)
  for (const item of response.body.responses) {
    assert.equal(item.status, 'generated')
    assert.ok(item.response_text.length > 0)
    assert.ok(item.parts.gap.includes('[дополните:'))
    assert.equal(typeof item.parts.reference, 'string')
  }
})

test('POST /responses/generate с use_llm=true: mock-модель, verified_without_ai=false', async () => {
  const { token, commentUrl } = await makeComment()
  const response = await api<{
    responses: Array<{ id: number; generation_run_id: number | null }>
    verified_without_ai: boolean
    generated?: number
  }>('POST', `${commentUrl}/responses/generate`, {
    token,
    body: { count: 2, use_llm: true },
  })
  assert.equal(response.status, 201)
  assert.equal(response.body.verified_without_ai, false)
  assert.equal(response.body.responses.length, 2)
  for (const item of response.body.responses) {
    assert.equal(typeof item.generation_run_id, 'number')
  }
})
