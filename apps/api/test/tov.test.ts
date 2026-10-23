/** Группа 3. Стиль: PUT/GET/analyze, 422 too_short, правила и LLM. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  api,
  authorToken,
  bootstrap,
  cleanupProfiles,
  createProfile,
  freshUser,
  loginDev,
} from './helpers.ts'

before(async () => {
  await bootstrap()
  const owner = await freshUser('Стиль')
  ownerToken = owner.token
  tokenRef.token = ownerToken
})

let ownerToken = ''
const created: Array<Record<string, unknown>> = []
const tokenRef: { token: string } = { token: '' }

after(async () => {
  if (tokenRef.token) await cleanupProfiles(tokenRef.token, created)
  if (ownerToken) await api('DELETE', '/users/me', { token: ownerToken })
})

const TOV_TEXT_1 =
  'Три месяца я вёл канал без плана и писал, когда было настроение. Потом сел и выписал темы, которые меня задевают. ' +
  'Дальше стало проще: пишу про них два раза в неделю. За месяц пришло триста человек, и это было круто.'
const TOV_TEXT_2 =
  'Я перестал редактировать посты ночью: утром текст выглядит по-другому. Теперь у меня правило — черновик вечером, публикация утром. ' +
  'За две недели я переписал шесть постов из восьми, и ни один не жалко.'

test('GET /tov до построения профиля → 404', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const response = await api('GET', `/author-profiles/${String(profile.id)}/tov`, { token })
  assert.equal(response.status, 404)
})

test('PUT /tov сохраняет профиль, повторный PUT идемпотентен', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const profileUrl = `/author-profiles/${String(profile.id)}/tov`
  const body = {
    tone: 'ты',
    slang: ['кринж', 'залипать'],
    stop_words: ['синергия'],
    favorite_phrases: ['по делу'],
    metrics: { avgSentenceLen: 11.4 },
  }
  const first = await api<Record<string, unknown>>('PUT', profileUrl, { token, body })
  assert.equal(first.status, 200)
  assert.equal(first.body.tone, 'ты')
  assert.deepEqual(first.body.slang, ['кринж', 'залипать'])

  const second = await api<Record<string, unknown>>('PUT', profileUrl, { token, body })
  assert.equal(second.status, 200)
  assert.equal(Number(second.body.id), Number(first.body.id), '1:1 — та же запись')

  const fetched = await api<Record<string, unknown>>('GET', profileUrl, { token })
  assert.equal(fetched.status, 200)
  assert.deepEqual(fetched.body.stop_words, ['синергия'])
})

test('PUT /tov: неверный tone → 400', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const response = await api('PUT', `/author-profiles/${String(profile.id)}/tov`, {
    token,
    body: { tone: 'нейтральное' },
  })
  assert.equal(response.status, 400)
})

test('POST /tov/analyze: меньше 180 символов → 422 too_short с length', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const response = await api<{
    error: { code: string; details: { reason?: string; length?: number } }
  }>('POST', `/author-profiles/${String(profile.id)}/tov/analyze`, {
    token,
    body: { texts: ['Короткий текст.', 'Ещё один короткий.'], use_llm: false },
  })
  assert.equal(response.status, 422)
  assert.equal(response.body.error.code, 'unprocessable')
  assert.equal(response.body.error.details.reason, 'too_short')
  assert.ok((response.body.error.details.length ?? 0) < 180)
})

test('POST /tov/analyze: правила строят карточку, LLM дополняет (mock)', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const response = await api<{
    tov_profile: { tone: string; slang: string[]; metrics: Record<string, unknown> }
    analysis: { source: string; chars: number; posts_used: number }
    verified_without_ai: boolean
    generation_run_id: number | null
  }>('POST', `/author-profiles/${String(profile.id)}/tov/analyze`, {
    token,
    body: { texts: [TOV_TEXT_1, TOV_TEXT_2] },
  })
  assert.equal(response.status, 200)
  assert.ok(['rules', 'rules+llm'].includes(response.body.analysis.source))
  assert.equal(response.body.analysis.posts_used, 2)
  assert.ok(response.body.analysis.chars >= 180)
  assert.ok(['ты', 'вы', 'смешанное'].includes(response.body.tov_profile.tone))
  assert.ok(response.body.tov_profile.metrics)
  // mock-провайдер доступен → второй слой сработал
  assert.equal(response.body.verified_without_ai, false)
  assert.equal(typeof response.body.generation_run_id, 'number')
})

test('POST /tov/analyze с use_llm=false → только правила, verified_without_ai=true', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const response = await api<{
    analysis: { source: string }
    verified_without_ai: boolean
    generation_run_id: number | null
  }>('POST', `/author-profiles/${String(profile.id)}/tov/analyze`, {
    token,
    body: { texts: [TOV_TEXT_1, TOV_TEXT_2], use_llm: false },
  })
  assert.equal(response.status, 200)
  assert.equal(response.body.analysis.source, 'rules')
  assert.equal(response.body.verified_without_ai, true)
  assert.equal(response.body.generation_run_id, null)
})

test('POST /tov/analyze по архиву постов канала', async () => {
  const { token } = await loginDev(200600, 'Демо-автор')
  // Демо-канал автора с постами из сида
  const list = await api<{ items: Array<{ id: number; platform: string; name?: string }> }>(
    'GET',
    '/author-profiles',
    { token, query: { platform: 'telegram', limit: 200 } },
  )
  const seeded = list.body.items.find(
    (item) => item.name === 'Заметки разработчика',
  )
  assert.ok(seeded, 'демо-канал автора должен существовать')
  const response = await api<{
    analysis: { posts_used: number }
    verified_without_ai: boolean
  }>('POST', `/author-profiles/${String(seeded.id)}/tov/analyze`, {
    token,
    body: { use_archive: true, use_llm: false },
  })
  assert.equal(response.status, 200)
  assert.ok(response.body.analysis.posts_used >= 1)
})
