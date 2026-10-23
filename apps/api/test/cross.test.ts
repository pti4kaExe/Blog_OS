/** Сквозные правила: 59 маршрутов, 401, 403, 404 на чужое, 409 на дубли, алиас. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  adminToken,
  api,
  authorToken,
  bootstrap,
  cleanupProfiles,
  createProfile,
  freshUser,
  getApp,
} from './helpers.ts'

before(async () => {
  await bootstrap()
})

const extraProfiles: Array<{ token: string; profile: Record<string, unknown> }> = []

after(async () => {
  for (const item of extraProfiles) {
    await cleanupProfiles(item.token, [item.profile])
  }
})

test('зарегистрировано ровно 59 доменных методов (корень и /api/v1)', async () => {
  const app = await getApp()
  const normalize = (url: string): string => url.replace(/^\/api\/v1(?=\/|$)/, '') || '/'
  const service = new Set(['/health', '/', '/*', '*'])
  const domain = app.routeList.filter((route) => !service.has(route.url))
  const unique = new Set(domain.map((route) => `${route.method} ${normalize(route.url)}`))
  assert.equal(unique.size, 59)
  assert.equal(domain.filter((route) => !route.url.startsWith('/api/v1')).length, 59)
  assert.equal(domain.filter((route) => route.url.startsWith('/api/v1')).length, 59)
  assert.equal(
    app.routeList.filter((route) => route.url === '/health').length,
    1,
    '/health не дублируется под /api/v1',
  )
})

test('401 без токена на маршрутах разных групп', async () => {
  for (const [method, url] of [
    ['GET', '/author-profiles'],
    ['GET', '/generation-runs'],
    ['GET', '/drafts/1'],
    ['POST', '/drafts/1/lint'],
    ['GET', '/comments/1'],
    ['GET', '/knowledge/1'],
    ['GET', '/golden-dataset'],
  ] as const) {
    const response = await api(method, url)
    assert.equal(response.status, 401, `${method} ${url}`)
  }
})

test('403 на админ-методы golden-dataset и evals для роли user', async () => {
  const token = await authorToken()
  for (const [method, url] of [
    ['GET', '/golden-dataset'],
    ['POST', '/golden-dataset'],
    ['POST', '/evals/run'],
    ['GET', '/evals/runs'],
    ['PATCH', '/golden-dataset/1'],
    ['DELETE', '/golden-dataset/1'],
  ] as const) {
    const response = await api(method, url, { token, body: {} })
    assert.equal(response.status, 403, `${method} ${url}`)
    assert.equal((response.body as { error: { code: string } }).error.code, 'forbidden')
  }
})

test('404 на чужую запись (не 403): канал, пост, черновик, источник', async () => {
  const owner = await authorToken()
  const profile = await createProfile(owner)
  extraProfiles.push({ token: owner, profile })

  const draftResponse = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts`,
    { token: owner, body: { title: 'Чужой черновик', text: 'Текст черновика для проверки доступа.' } },
  )
  assert.equal(draftResponse.status, 201)

  const postResponse = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/posts`,
    { token: owner, body: { content_type: 'post', text: 'Текст поста для проверки доступа.' } },
  )
  assert.equal(postResponse.status, 201)

  const sourceResponse = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/sources`,
    { token: owner, body: { name: 'Источник', source_type: 'telegram_channel', source_url: 'https://t.me/s/foreign' } },
  )
  assert.equal(sourceResponse.status, 201)

  const stranger = await freshUser('Чужой')
  for (const [method, url] of [
    ['GET', `/author-profiles/${String(profile.id)}`],
    ['PATCH', `/author-profiles/${String(profile.id)}`],
    ['DELETE', `/author-profiles/${String(profile.id)}`],
    ['GET', `/author-profiles/${String(profile.id)}/posts`],
    ['GET', `/author-profiles/${String(profile.id)}/posts/${String(postResponse.body.id)}`],
    ['GET', `/drafts/${String(draftResponse.body.id)}`],
    ['POST', `/drafts/${String(draftResponse.body.id)}/lint`],
    ['GET', `/sources/${String(sourceResponse.body.id)}`],
  ] as const) {
    const response = await api(method, url, { token: stranger.token, body: {} })
    assert.equal(response.status, 404, `${method} ${url}`)
    assert.equal((response.body as { error: { code: string } }).error.code, 'not_found')
  }
})

test('409 на дубли: источник с тем же source_url и пост с external_id', async () => {
  const token = await authorToken()
  const profile = await createProfile(token)
  extraProfiles.push({ token, profile })
  const profileUrl = `/author-profiles/${String(profile.id)}`

  const sourceBody = {
    name: 'Дубликат',
    source_type: 'telegram_channel',
    source_url: 'https://t.me/s/duplicate-test',
  }
  const firstSource = await api('POST', `${profileUrl}/sources`, { token, body: sourceBody })
  assert.equal(firstSource.status, 201)
  const secondSource = await api('POST', `${profileUrl}/sources`, { token, body: sourceBody })
  assert.equal(secondSource.status, 409)
  assert.equal((secondSource.body as { error: { code: string } }).error.code, 'conflict')

  const postBody = {
    content_type: 'post',
    text: 'Пост с внешним идентификатором для проверки уникальности.',
    external_id: 'duplicate-external-1',
  }
  const firstPost = await api('POST', `${profileUrl}/posts`, { token, body: postBody })
  assert.equal(firstPost.status, 201)
  const secondPost = await api('POST', `${profileUrl}/posts`, { token, body: postBody })
  assert.equal(secondPost.status, 409)
})

test('алиас /api/v1 повторяет корневые маршруты (на примере каналов)', async () => {
  const token = await authorToken()
  const root = await api<{ items: unknown[] }>('GET', '/author-profiles', { token })
  const alias = await api<{ items: unknown[] }>('GET', '/api/v1/author-profiles', { token })
  assert.equal(alias.status, 200)
  assert.equal(alias.body.items.length, root.body.items.length)
})

test('неизвестный маршрут → 404 not_found', async () => {
  const response = await api('GET', '/no-such-method')
  assert.equal(response.status, 404)
  assert.equal((response.body as { error: { code: string } }).error.code, 'not_found')
})

test('админ видит все generation-runs, автор — только свои каналы', async () => {
  const userToken = await authorToken()
  const admin = await adminToken()
  const own = await api<{ items: Array<{ author_id: number | null }> }>(
    'GET',
    '/generation-runs',
    { token: userToken },
  )
  assert.equal(own.status, 200)
  const all = await api<{ items: unknown[] }>('GET', '/generation-runs', { token: admin })
  assert.equal(all.status, 200)
  assert.ok(all.body.items.length >= own.body.items.length)
})
