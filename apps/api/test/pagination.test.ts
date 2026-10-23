/** Пагинация по (created_at, id): limit, cursor, неверные значения, границы. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  api,
  authorToken,
  bootstrap,
  cleanupProfiles,
  createProfile,
  freshUser,
} from './helpers.ts'

before(async () => {
  await bootstrap()
  const owner = await freshUser('Пагинация')
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

test('курсорная пагинация постов: limit и next_cursor', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const base = `/author-profiles/${String(profile.id)}/posts`

  const ids: number[] = []
  for (let index = 0; index < 3; index++) {
    const response = await api<{ id: number }>('POST', base, {
      token,
      body: {
        content_type: 'post',
        text: `Пост номер ${index + 1} для проверки курсорной пагинации.`,
        external_id: `pagination-${index + 1}-${Math.floor(Math.random() * 1e6)}`,
      },
    })
    assert.equal(response.status, 201)
    ids.push(Number(response.body.id))
  }

  const first = await api<{ items: Array<{ id: number }>; next_cursor: string | null }>(
    'GET',
    base,
    { token, query: { limit: 2 } },
  )
  assert.equal(first.status, 200)
  assert.equal(first.body.items.length, 2)
  assert.equal(typeof first.body.next_cursor, 'string')

  const second = await api<{ items: Array<{ id: number }>; next_cursor: string | null }>(
    'GET',
    base,
    { token, query: { limit: 2, cursor: first.body.next_cursor as string } },
  )
  assert.equal(second.status, 200)
  assert.equal(second.body.items.length, 1)
  assert.equal(second.body.next_cursor, null)

  const seen = new Set([...first.body.items, ...second.body.items].map((item) => Number(item.id)))
  assert.equal(seen.size, 3)
  for (const id of ids) assert.ok(seen.has(id))
})

test('неверный cursor → 400, limit > 200 → 400', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  const base = `/author-profiles/${String(profile.id)}/knowledge`

  const badCursor = await api<{ error: { code: string } }>('GET', base, {
    token,
    query: { cursor: 'not-a-cursor' },
  })
  assert.equal(badCursor.status, 400)
  assert.equal(badCursor.body.error.code, 'validation_error')

  const badLimit = await api('GET', base, { token, query: { limit: 201 } })
  assert.equal(badLimit.status, 400)
})

test('пагинация истории линта и комментариев', async () => {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)

  const draft = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts`,
    { token, body: { title: 'История', text: 'Текст черновика для истории проверок и пагинации.' } },
  )
  for (let index = 0; index < 3; index++) {
    const lint = await api('POST', `/drafts/${String(draft.body.id)}/lint`, {
      token,
      body: { use_llm: false },
    })
    assert.equal(lint.status, 201)
  }
  const reports = await api<{ items: unknown[]; next_cursor: string | null }>(
    'GET',
    `/drafts/${String(draft.body.id)}/lint-reports`,
    { token, query: { limit: 2 } },
  )
  assert.equal(reports.body.items.length, 2)
  assert.equal(typeof reports.body.next_cursor, 'string')
})
