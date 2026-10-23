/** Группа 10. База знаний: CRUD, пересчёт векторов, RAG-поиск, 503 при none. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  api,
  authorToken,
  bootstrap,
  cleanupProfiles,
  createProfile,
  dbOne,
  freshUser,
} from './helpers.ts'

before(async () => {
  await bootstrap()
})

const created: Array<Record<string, unknown>> = []
const tokenRef: { token: string } = { token: '' }

after(async () => {
  process.env.EMBEDDINGS_PROVIDER = 'mock'
  if (tokenRef.token) await cleanupProfiles(tokenRef.token, created)
})

async function makeProfile(): Promise<{ token: string; profile: Record<string, unknown> }> {
  const token = await authorToken()
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  return { token, profile }
}

test('CRUD факта базы знаний и пересчёт embeddings', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/knowledge`
  const createdFact = await api<Record<string, unknown>>('POST', base, {
    token,
    body: {
      title: 'Обо мне',
      content: 'Работаю в продуктовой аналитике с 2019 года и веду канал о данных и текстах.',
    },
  })
  assert.equal(createdFact.status, 201)

  const vectors = await dbOne<{ count: number }>(
    'SELECT count(*)::int AS count FROM embeddings WHERE knowledge_id = $1',
    [createdFact.body.id],
  )
  assert.ok(Number(vectors?.count) >= 1)

  const fetched = await api<{ title: string }>('GET', `/knowledge/${String(createdFact.body.id)}`, {
    token,
  })
  assert.equal(fetched.status, 200)
  assert.equal(fetched.body.title, 'Обо мне')

  const patched = await api<{ title: string; content: string }>(
    'PATCH',
    `/knowledge/${String(createdFact.body.id)}`,
    {
      token,
      body: {
        title: 'Обо мне (обновлено)',
        content: 'Работаю в аналитике с 2019 года. Пишу о метриках, данных и проверке текстов.',
      },
    },
  )
  assert.equal(patched.status, 200)
  assert.equal(patched.body.title, 'Обо мне (обновлено)')
  const afterPatch = await dbOne<{ count: number }>(
    'SELECT count(*)::int AS count FROM embeddings WHERE knowledge_id = $1',
    [createdFact.body.id],
  )
  assert.ok(Number(afterPatch?.count) >= 1)

  const removed = await api('DELETE', `/knowledge/${String(createdFact.body.id)}`, { token })
  assert.equal(removed.status, 204)
  const gone = await api('GET', `/knowledge/${String(createdFact.body.id)}`, { token })
  assert.equal(gone.status, 404)
})

test('список фактов и фильтр limit', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/knowledge`
  for (const [title, content] of [
    ['Темы', 'Пишу про регулярность, аналитику и проверку текстов.'],
    ['Инструменты', 'Файл заметок и еженедельный разбор заготовок.'],
  ] as const) {
    const response = await api('POST', base, { token, body: { title, content } })
    assert.equal(response.status, 201)
  }
  const list = await api<{ items: unknown[]; next_cursor: string | null }>('GET', base, {
    token,
    query: { limit: 1 },
  })
  assert.equal(list.status, 200)
  assert.equal(list.body.items.length, 1)
  assert.equal(typeof list.body.next_cursor, 'string')
})

test('RAG-поиск: находит факт по смыслу и отдаёт модель/счётчик чанков', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/knowledge`
  const fact = await api<{ id: number }>('POST', base, {
    token,
    body: {
      title: 'Опыт в аналитике',
      content:
        'Работаю в продуктовой аналитике с 2019 года: считаю метрики, проверяю гипотезы и пишу об этом в канале.',
    },
  })
  assert.equal(fact.status, 201)

  const search = await api<{
    items: Array<{ knowledge_id: number; title: string; chunk_text: string; score: number; chunk_index: number }>
    query_embedding_model: string
    searched_chunks: number
  }>('GET', `${base}/search`, { token, query: { q: 'сколько лет в аналитике', limit: 5 } })
  assert.equal(search.status, 200, JSON.stringify(search.body))
  assert.ok(search.body.items.length >= 1)
  assert.equal(Number(search.body.items[0]?.knowledge_id), Number(fact.body.id))
  assert.equal(search.body.query_embedding_model, 'text-embedding-3-small')
  assert.ok(search.body.searched_chunks >= 1)
  assert.ok(Number(search.body.items[0]?.score) <= 1)
})

test('пустой q → 400 validation_error', async () => {
  const { token, profile } = await makeProfile()
  const response = await api('GET', `/author-profiles/${String(profile.id)}/knowledge/search`, {
    token,
    query: { q: '' },
  })
  assert.equal(response.status, 400)
})

test('EMBEDDINGS_PROVIDER=none → поиск 503, CRUD продолжает работать', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/knowledge`
  const fact = await api('POST', base, {
    token,
    body: { title: 'Факт без вектора', content: 'Этот факт создан при выключенных эмбеддингах.' },
  })
  assert.equal(fact.status, 201)

  process.env.EMBEDDINGS_PROVIDER = 'none'
  try {
    const search = await api<{ error: { code: string } }>('GET', `${base}/search`, {
      token,
      query: { q: 'факт' },
    })
    assert.equal(search.status, 503)
    assert.equal(search.body.error.code, 'not_configured')

    const list = await api<{ items: unknown[] }>('GET', base, { token })
    assert.equal(list.status, 200)
    assert.ok(list.body.items.length >= 1)
  } finally {
    process.env.EMBEDDINGS_PROVIDER = 'mock'
  }
})

test('чужой факт → 404', async () => {
  const { token, profile } = await makeProfile()
  const fact = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/knowledge`,
    { token, body: { title: 'Чужой факт', content: 'Проверка доступа к чужому факту.' } },
  )
  const stranger = await freshUser('Чужой факт')
  try {
    const response = await api('GET', `/knowledge/${String(fact.body.id)}`, {
      token: stranger.token,
    })
    assert.equal(response.status, 404)
  } finally {
    await api('DELETE', '/users/me', { token: stranger.token })
  }
})
