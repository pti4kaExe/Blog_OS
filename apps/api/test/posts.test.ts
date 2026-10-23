/** Группа 4. Посты: CRUD, лимиты длины, импорт с дедупликацией, embeddings. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  api,
  authorToken,
  bootstrap,
  cleanupProfiles,
  createProfile,
  dbOne,
  installFetchMock,
  textResponse,
  freshUser,
} from './helpers.ts'

before(async () => {
  await bootstrap()
  const owner = await freshUser('Посты')
  ownerToken = owner.token
  tokenRef.token = ownerToken
})

const created: Array<Record<string, unknown>> = []
let ownerToken = ''
const tokenRef: { token: string } = { token: '' }

after(async () => {
  if (tokenRef.token) await cleanupProfiles(tokenRef.token, created)
  if (ownerToken) await api('DELETE', '/users/me', { token: ownerToken })
})

const TELEGRAM_PAGE = `<html><body>
<div class="tgme_widget_message" data-post="import_demo/101">
  <div class="tgme_widget_message_text js-message_text">Первый импортированный пост про регулярность и планы.</div>
  <a class="tgme_widget_message_date" href="https://t.me/import_demo/101"><time datetime="2026-10-01T10:00:00+00:00"></time></a>
</div>
<div class="tgme_widget_message" data-post="import_demo/102">
  <div class="tgme_widget_message_text js-message_text">Второй импортированный пост про контент и стиль.</div>
  <a class="tgme_widget_message_date" href="https://t.me/import_demo/102"><time datetime="2026-10-02T10:00:00+00:00"></time></a>
</div>
<div class="tgme_widget_message" data-post="import_demo/103">
  <div class="tgme_widget_message_text js-message_text">Третий пост с пустым внешним идентификатором не нужен.</div>
</div>
</body></html>`

async function makeProfile(): Promise<{ token: string; profile: Record<string, unknown> }> {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  return { token, profile }
}

test('CRUD поста: create/get/patch/delete', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/posts`

  const createdPost = await api<Record<string, unknown>>('POST', base, {
    token,
    body: {
      content_type: 'post',
      text: 'Первый пост про то, как я наладил регулярность публикаций за месяц.',
      external_id: 'manual-1',
      published_at: '2026-10-01T10:00:00Z',
    },
  })
  assert.equal(createdPost.status, 201)
  assert.equal(createdPost.body.content_type, 'post')

  const fetched = await api<Record<string, unknown>>(
    'GET',
    `${base}/${String(createdPost.body.id)}`,
    { token },
  )
  assert.equal(fetched.status, 200)
  assert.equal(fetched.body.external_id, 'manual-1')

  const patched = await api<Record<string, unknown>>(
    'PATCH',
    `${base}/${String(createdPost.body.id)}`,
    { token, body: { text: 'Обновлённый текст поста про регулярность и планы.' } },
  )
  assert.equal(patched.status, 200)
  assert.ok(String(patched.body.text).startsWith('Обновлённый'))

  const removed = await api('DELETE', `${base}/${String(createdPost.body.id)}`, { token })
  assert.equal(removed.status, 204)
  const afterDelete = await api('GET', `${base}/${String(createdPost.body.id)}`, { token })
  assert.equal(afterDelete.status, 404)
})

test('превышение лимита длины телеграм-поста (4096) → 422 details.limit', async () => {
  const { token, profile } = await makeProfile()
  const response = await api<{ error: { code: string; details: { limit?: number } } }>(
    'POST',
    `/author-profiles/${String(profile.id)}/posts`,
    { token, body: { content_type: 'post', text: 'а'.repeat(4097) } },
  )
  assert.equal(response.status, 422)
  assert.equal(response.body.error.details.limit, 4096)
})

test('превышение лимита instagram caption (2200) → 422', async () => {
  const { token, profile } = await makeProfile()
  const response = await api<{ error: { details: { limit?: number } } }>(
    'POST',
    `/author-profiles/${String(profile.id)}/posts`,
    { token, body: { content_type: 'caption', text: 'б'.repeat(2201) } },
  )
  assert.equal(response.status, 422)
  assert.equal(response.body.error.details.limit, 2200)
})

test('импорт Telegram: дедупликация по (author_id, external_id)', async () => {
  const { token, profile } = await makeProfile()
  const restore = installFetchMock((url) => {
    if (url.includes('t.me/s/import_demo')) return textResponse(TELEGRAM_PAGE)
    throw new Error(`неожиданный URL: ${url}`)
  })
  try {
    const first = await api<{
      imported: number
      skipped_duplicates: number
      skipped_invalid: number
      checked: number
    }>('POST', `/author-profiles/${String(profile.id)}/posts/import`, {
      token,
      body: { platform: 'telegram', source_url: 'https://t.me/s/import_demo', limit: 10 },
    })
    assert.equal(first.status, 200)
    assert.equal(first.body.checked, 3)
    assert.equal(first.body.imported, 3)
    assert.equal(first.body.skipped_duplicates, 0)

    const second = await api<{ imported: number; skipped_duplicates: number }>(
      'POST',
      `/author-profiles/${String(profile.id)}/posts/import`,
      {
        token,
        body: { platform: 'telegram', source_url: 'https://t.me/s/import_demo', limit: 10 },
      },
    )
    assert.equal(second.status, 200)
    assert.equal(second.body.imported, 0)
    assert.equal(second.body.skipped_duplicates, 3)

    const count = await dbOne<{ count: number }>(
      'SELECT count(*)::int AS count FROM posts WHERE author_id = $1',
      [profile.id],
    )
    assert.equal(Number(count?.count), 3)
  } finally {
    restore()
  }
})

test('ошибка площадки: одна повторная попытка → 502 details.platform', async () => {
  const { token, profile } = await makeProfile()
  let calls = 0
  const restore = installFetchMock(() => {
    calls++
    return new Response('upstream error', { status: 500 })
  })
  try {
    const response = await api<{
      error: { code: string; details: { platform?: string } }
    }>('POST', `/author-profiles/${String(profile.id)}/posts/import`, {
      token,
      body: { platform: 'telegram', source_url: 'https://t.me/s/broken_demo', limit: 10 },
    })
    assert.equal(response.status, 502)
    assert.equal(response.body.error.code, 'upstream_unavailable')
    assert.equal(response.body.error.details.platform, 'telegram')
    assert.equal(calls, 2, 'ровно одна повторная попытка')
  } finally {
    restore()
  }
})

test('импорт Instagram без ключа → 503 not_configured', async () => {
  const { token, profile } = await makeProfile()
  const response = await api<{
    error: { code: string; details: { reason?: string } }
  }>('POST', `/author-profiles/${String(profile.id)}/posts/import`, {
    token,
    body: { platform: 'instagram', source_url: 'https://instagram.com/p/demo', limit: 10 },
  })
  assert.equal(response.status, 503)
  assert.equal(response.body.error.code, 'not_configured')
  assert.equal(response.body.error.details.reason, 'not_configured')
})

test('создание и правка поста пересчитывают embeddings (mock 1536)', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/posts`
  const createdPost = await api<Record<string, unknown>>('POST', base, {
    token,
    body: {
      content_type: 'post',
      text: 'Текст поста для проверки векторов: он должен попасть в embeddings.',
    },
  })
  assert.equal(createdPost.status, 201)
  const first = await dbOne<{ count: number; model: string }>(
    'SELECT count(*)::int AS count, min(model) AS model FROM embeddings WHERE post_id = $1',
    [createdPost.body.id],
  )
  assert.ok(Number(first?.count) >= 1)
  assert.ok(String(first?.model).includes('text-embedding-3-small'))

  const patched = await api(
    'PATCH',
    `${base}/${String(createdPost.body.id)}`,
    { token, body: { text: 'Обновлённый текст поста для пересчёта векторов.' } },
  )
  assert.equal(patched.status, 200)
  const after = await dbOne<{ count: number }>(
    'SELECT count(*)::int AS count FROM embeddings WHERE post_id = $1',
    [createdPost.body.id],
  )
  assert.ok(Number(after?.count) >= 1)
})
