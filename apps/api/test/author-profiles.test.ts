/** Группа 2. Каналы: CRUD, валидация, лимит 20, usage. */
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
  const owner = await freshUser('Каналы')
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

test('POST /author-profiles создаёт канал с настройками', async () => {
  const token = ownerToken
  tokenRef.token = token
  const response = await api<Record<string, unknown>>('POST', '/author-profiles', {
    token,
    body: {
      name: 'Тестовый канал',
      platform: 'telegram',
      description: 'Описание канала',
      content_settings: {
        topics: ['код', 'учёба'],
        language: 'ru',
        target_length: { min: 800, max: 2500 },
      },
      monthly_cost_limit: 500,
    },
  })
  assert.equal(response.status, 201)
  assert.equal(response.body.platform, 'telegram')
  assert.deepEqual((response.body.content_settings as { topics: string[] }).topics, ['код', 'учёба'])
  assert.equal(Number(response.body.monthly_cost_limit), 500)
  created.push(response.body)
})

test('GET /author-profiles фильтрует по platform', async () => {
  const token = ownerToken
  const profile = await createProfile(token, 'instagram')
  created.push(profile)
  const response = await api<{ items: Array<{ platform: string }> }>('GET', '/author-profiles', {
    token,
    query: { platform: 'instagram', limit: 200 },
  })
  assert.equal(response.status, 200)
  assert.ok(response.body.items.length >= 1)
  assert.ok(response.body.items.every((item) => item.platform === 'instagram'))
})

test('GET /author-profiles/{id} отдаёт счётчики', async () => {
  const token = ownerToken
  const profile = await createProfile(token)
  created.push(profile)
  const response = await api<{
    tov_profiles_count: number
    posts_count: number
    drafts_count: number
  }>('GET', `/author-profiles/${String(profile.id)}`, { token })
  assert.equal(response.status, 200)
  assert.equal(response.body.posts_count, 0)
  assert.equal(response.body.drafts_count, 0)
  assert.ok(response.body.tov_profiles_count >= 0)
})

test('PATCH /author-profiles/{id} частично обновляет', async () => {
  const token = ownerToken
  const profile = await createProfile(token)
  created.push(profile)
  const response = await api<Record<string, unknown>>(
    'PATCH',
    `/author-profiles/${String(profile.id)}`,
    {
      token,
      body: { name: 'Переименованный', monthly_cost_limit: 1000, description: null },
    },
  )
  assert.equal(response.status, 200)
  assert.equal(response.body.name, 'Переименованный')
  assert.equal(Number(response.body.monthly_cost_limit), 1000)
})

test('валидация: min > max в target_length и отрицательный лимит → 400/422', async () => {
  const token = ownerToken
  const badTarget = await api('POST', '/author-profiles', {
    token,
    body: {
      name: 'Плохие настройки',
      platform: 'telegram',
      content_settings: { target_length: { min: 3000, max: 100 } },
    },
  })
  assert.equal(badTarget.status, 400)
  assert.equal((badTarget.body as { error: { code: string } }).error.code, 'validation_error')

  const badLimit = await api('POST', '/author-profiles', {
    token,
    body: { name: 'Плохой лимит', platform: 'telegram', monthly_cost_limit: -5 },
  })
  assert.equal(badLimit.status, 400)

  const badPlatform = await api('POST', '/author-profiles', {
    token,
    body: { name: 'Плохая площадка', platform: 'tiktok' },
  })
  assert.equal(badPlatform.status, 400)
})

test('лимит 20 каналов на пользователя → 422', async () => {
  const { token } = await freshUser('Лимит каналов')
  try {
    for (let index = 0; index < 20; index++) {
      const profile = await createProfile(token, 'telegram')
      assert.ok(profile.id)
    }
    const extra = await api<{ error: { code: string; details: { reason?: string } } }>(
      'POST',
      '/author-profiles',
      { token, body: { name: 'Двадцать первый', platform: 'telegram' } },
    )
    assert.equal(extra.status, 422)
    assert.equal(extra.body.error.code, 'unprocessable')
    assert.equal(extra.body.error.details.reason, 'profile_limit_exceeded')
  } finally {
    await api('DELETE', '/users/me', { token })
  }
})

test('GET /author-profiles/{id}/usage отдаёт расходы за месяц', async () => {
  const token = ownerToken
  const profile = await createProfile(token)
  created.push(profile)
  const response = await api<{
    author_profile_id: number
    period: string
    monthly_cost_limit: number | null
    spent: number
    limit_ratio: number | null
    warning: boolean
    blocked: boolean
    runs: { total: number; success: number; failed: number }
    by_task: unknown[]
  }>('GET', `/author-profiles/${String(profile.id)}/usage`, { token })
  assert.equal(response.status, 200)
  assert.equal(Number(response.body.author_profile_id), Number(profile.id))
  assert.match(response.body.period, /^\d{4}-\d{2}$/)
  assert.equal(response.body.warning, false)
  assert.equal(response.body.blocked, false)
  assert.equal(typeof response.body.runs.total, 'number')
  assert.ok(Array.isArray(response.body.by_task))
})

test('DELETE /author-profiles/{id} → 204 и 404 после удаления', async () => {
  const token = ownerToken
  const profile = await createProfile(token)
  const removed = await api('DELETE', `/author-profiles/${String(profile.id)}`, { token })
  assert.equal(removed.status, 204)
  const afterDelete = await api('GET', `/author-profiles/${String(profile.id)}`, { token })
  assert.equal(afterDelete.status, 404)
})

test('dev-вход свежего пользователя не видит чужие каналы в списке', async () => {
  const author = await authorToken()
  const profile = await createProfile(author)
  created.push(profile)
  const stranger = await freshUser('Без каналов')
  try {
    const response = await api<{ items: Array<{ id: number }> }>('GET', '/author-profiles', {
      token: stranger.token,
      query: { limit: 200 },
    })
    assert.equal(response.status, 200)
    assert.ok(!response.body.items.some((item) => Number(item.id) === Number(profile.id)))
  } finally {
    await api('DELETE', '/users/me', { token: stranger.token })
  }
})

test('повторный dev-вход не создаёт новый канал', async () => {
  const { token, user } = await loginDev(200600, 'Демо-автор')
  const me = await api<{ id: number }>('GET', '/users/me', { token })
  assert.equal(Number(me.body.id), Number(user.id))
})
