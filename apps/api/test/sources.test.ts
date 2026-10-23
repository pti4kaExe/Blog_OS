/** Группа 7. Источники: CRUD, 409 на дубль URL, фильтры, счётчики. */
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
  const owner = await freshUser('Источники')
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

async function makeProfile(): Promise<{ token: string; profile: Record<string, unknown> }> {
  const token = ownerToken
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  return { token, profile }
}

test('CRUD источника: create/list/get/patch/delete', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/sources`

  const source = await api<Record<string, unknown>>('POST', base, {
    token,
    body: {
      name: 'Канал про код',
      source_type: 'telegram_channel',
      source_url: 'https://t.me/s/code_demo_1',
    },
  })
  assert.equal(source.status, 201)
  assert.equal(source.body.is_active, true)
  assert.equal(source.body.last_scan_status, 'never')

  const list = await api<{ items: Array<{ id: number }> }>('GET', base, {
    token,
    query: { limit: 50 },
  })
  assert.equal(list.status, 200)
  assert.ok(list.body.items.some((item) => Number(item.id) === Number(source.body.id)))

  const fetched = await api<{ comments_count: number; last_scan_status: string }>(
    'GET',
    `/sources/${String(source.body.id)}`,
    { token },
  )
  assert.equal(fetched.status, 200)
  assert.equal(fetched.body.comments_count, 0)
  assert.equal(fetched.body.last_scan_status, 'never')

  const patched = await api<Record<string, unknown>>('PATCH', `/sources/${String(source.body.id)}`, {
    token,
    body: { name: 'Переименованный источник', is_active: false },
  })
  assert.equal(patched.status, 200)
  assert.equal(patched.body.is_active, false)

  const removed = await api('DELETE', `/sources/${String(source.body.id)}`, { token })
  assert.equal(removed.status, 204)
  const afterDelete = await api('GET', `/sources/${String(source.body.id)}`, { token })
  assert.equal(afterDelete.status, 404)
})

test('409 при повторении пары (author_id, source_url)', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/sources`
  const body = {
    name: 'Дубль',
    source_type: 'telegram_channel',
    source_url: 'https://t.me/s/duplicate_source',
  }
  const first = await api('POST', base, { token, body })
  assert.equal(first.status, 201)
  const second = await api<{ error: { code: string } }>('POST', base, { token, body })
  assert.equal(second.status, 409)
  assert.equal(second.body.error.code, 'conflict')
})

test('фильтры is_active и source_type', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/sources`
  const active = await api<{ id: number }>('POST', base, {
    token,
    body: {
      name: 'Активный',
      source_type: 'youtube',
      source_url: 'https://youtube.com/channel/UCactive',
    },
  })
  assert.equal(active.status, 201)
  const inactive = await api<{ id: number }>('POST', base, {
    token,
    body: {
      name: 'Выключенный',
      source_type: 'instagram',
      source_url: 'https://instagram.com/p/inactive',
    },
  })
  assert.equal(inactive.status, 201)
  await api('PATCH', `/sources/${String(inactive.body.id)}`, {
    token,
    body: { is_active: false },
  })

  const onlyInactive = await api<{ items: Array<{ is_active: boolean; source_type: string }> }>(
    'GET',
    base,
    { token, query: { is_active: 'false' } },
  )
  assert.equal(onlyInactive.status, 200)
  assert.ok(onlyInactive.body.items.length >= 1)
  assert.ok(onlyInactive.body.items.every((item) => item.is_active === false))

  const onlyYoutube = await api<{ items: Array<{ source_type: string }> }>('GET', base, {
    token,
    query: { source_type: 'youtube' },
  })
  assert.ok(onlyYoutube.body.items.every((item) => item.source_type === 'youtube'))
})

test('чужой источник → 404', async () => {
  const { token, profile } = await makeProfile()
  const source = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/sources`,
    {
      token,
      body: {
        name: 'Чужой',
        source_type: 'telegram_channel',
        source_url: 'https://t.me/s/foreign_source',
      },
    },
  )
  const stranger = await freshUser('Чужой источник')
  try {
    const response = await api('GET', `/sources/${String(source.body.id)}`, {
      token: stranger.token,
    })
    assert.equal(response.status, 404)
  } finally {
    await api('DELETE', '/users/me', { token: stranger.token })
  }
})
