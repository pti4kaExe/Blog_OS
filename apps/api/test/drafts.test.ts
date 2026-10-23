/** Группа 5. Черновики: переходы статусов, Narrative Engine, публикация. */
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
  const owner = await freshUser('Черновики')
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

const GOOD_TEXT =
  'Три месяца я вёл канал без плана. Потом выписал темы, которые меня задевают, и стал писать два раза в неделю. ' +
  'За месяц пришло триста человек, и регулярность оказалась важнее гениальности.'

test('CRUD черновика: create → GET с latest_lint_report=null → PATCH → DELETE', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/drafts`
  const createdDraft = await api<Record<string, unknown>>('POST', base, {
    token,
    body: { title: 'Черновик', source_notes: 'заметка 1\nзаметка 2' },
  })
  assert.equal(createdDraft.status, 201)
  assert.equal(createdDraft.body.status, 'draft')

  const fetched = await api<Record<string, unknown>>('GET', `/drafts/${String(createdDraft.body.id)}`, {
    token,
  })
  assert.equal(fetched.status, 200)
  assert.equal(fetched.body.latest_lint_report, null)

  const patched = await api<Record<string, unknown>>(
    'PATCH',
    `/drafts/${String(createdDraft.body.id)}`,
    { token, body: { text: GOOD_TEXT, title: 'Новый заголовок' } },
  )
  assert.equal(patched.status, 200)
  assert.ok(String(patched.body.text).startsWith('Три месяца'))

  const removed = await api('DELETE', `/drafts/${String(createdDraft.body.id)}`, { token })
  assert.equal(removed.status, 204)
})

test('переходы статусов: draft → on_check → ready; прыжок draft → ready → 422', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/drafts`
  const draft = await api<{ id: number }>('POST', base, {
    token,
    body: { title: 'Переходы', text: GOOD_TEXT },
  })
  assert.equal(draft.status, 201)

  const onCheck = await api<Record<string, unknown>>('PATCH', `/drafts/${String(draft.body.id)}`, {
    token,
    body: { status: 'on_check' },
  })
  assert.equal(onCheck.status, 200)
  assert.equal(onCheck.body.status, 'on_check')

  const ready = await api<Record<string, unknown>>('PATCH', `/drafts/${String(draft.body.id)}`, {
    token,
    body: { status: 'ready' },
  })
  assert.equal(ready.status, 200)
  assert.equal(ready.body.status, 'ready')

  const back = await api<Record<string, unknown>>('PATCH', `/drafts/${String(draft.body.id)}`, {
    token,
    body: { status: 'on_check' },
  })
  assert.equal(back.status, 200, 'обратные переходы разрешены')

  const skip = await api<{ error: { code: string; details: { reason?: string } } }>(
    'PATCH',
    `/drafts/${String(draft.body.id)}`,
    { token, body: { status: 'ready' } },
  )
  assert.equal(skip.status, 200)

  const publishViaPatch = await api<{ error: { details: { reason?: string } } }>(
    'PATCH',
    `/drafts/${String(draft.body.id)}`,
    { token, body: { status: 'published' } },
  )
  assert.equal(publishViaPatch.status, 422)
  assert.equal(publishViaPatch.body.error.details.reason, 'use_publish_endpoint')

  const toReadyFromDraft = await api<{ id: number }>('POST', base, {
    token,
    body: { title: 'Прыжок', text: GOOD_TEXT },
  })
  const jump = await api<{ error: { details: { reason?: string } } }>(
    'PATCH',
    `/drafts/${String(toReadyFromDraft.body.id)}`,
    { token, body: { status: 'ready' } },
  )
  assert.equal(jump.status, 422)
  assert.equal(jump.body.error.details.reason, 'invalid_transition')
})

test('публикация не ready → 422 not_ready', async () => {
  const { token, profile } = await makeProfile()
  const draft = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts`,
    { token, body: { title: 'Не готов', text: GOOD_TEXT } },
  )
  const response = await api<{ error: { details: { reason?: string } } }>(
    'POST',
    `/drafts/${String(draft.body.id)}/publish`,
    { token, body: {} },
  )
  assert.equal(response.status, 422)
  assert.equal(response.body.error.details.reason, 'not_ready')
})

test('публикация ready с пропусками → 422 unfilled_gaps, с текстом → 200 и пост', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/drafts`

  const gapped = await api<{ id: number }>('POST', base, {
    token,
    body: {
      title: 'С пропуском',
      text: 'Начало текста. [дополните: что именно сработало у меня и в каких условиях] Конец текста.',
      status: undefined,
    },
  })
  await api('PATCH', `/drafts/${String(gapped.body.id)}`, { token, body: { status: 'on_check' } })
  await api('PATCH', `/drafts/${String(gapped.body.id)}`, { token, body: { status: 'ready' } })
  const gapPublish = await api<{ error: { details: { reason?: string } } }>(
    'POST',
    `/drafts/${String(gapped.body.id)}/publish`,
    { token, body: {} },
  )
  assert.equal(gapPublish.status, 422)
  assert.equal(gapPublish.body.error.details.reason, 'unfilled_gaps')

  const ready = await api<{ id: number }>('POST', base, {
    token,
    body: { title: 'Готов к публикации', text: GOOD_TEXT },
  })
  await api('PATCH', `/drafts/${String(ready.body.id)}`, { token, body: { status: 'on_check' } })
  await api('PATCH', `/drafts/${String(ready.body.id)}`, { token, body: { status: 'ready' } })
  const published = await api<{
    draft: { status: string; published_post_id: number }
    post: { id: number; text: string; published_at: string | null }
  }>('POST', `/drafts/${String(ready.body.id)}/publish`, {
    token,
    body: { published_at: '2026-10-23T12:00:00Z' },
  })
  assert.equal(published.status, 200)
  assert.equal(published.body.draft.status, 'published')
  assert.equal(Number(published.body.draft.published_post_id), Number(published.body.post.id))
  assert.ok(published.body.post.published_at)

  const draftAfter = await api<{ status: string }>('GET', `/drafts/${String(ready.body.id)}`, {
    token,
  })
  assert.equal(draftAfter.body.status, 'published')
})

test('пустой текст черновика → 422 empty_text', async () => {
  const { token, profile } = await makeProfile()
  const draft = await api<{ id: number }>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts`,
    { token, body: { title: 'Пустой' } },
  )
  assert.equal(draft.status, 201)
  const response = await api<{ error: { details: { reason?: string } } }>(
    'POST',
    `/drafts/${String(draft.body.id)}/publish`,
    { token, body: {} },
  )
  assert.equal(response.status, 422)
  assert.equal(response.body.error.details.reason, 'empty_text')
})

test('Narrative Engine из заметок (правила): verified_without_ai=true', async () => {
  const { token, profile } = await makeProfile()
  const response = await api<{
    draft: { id: number; origin: string; text: string }
    build: {
      arc: string
      arc_auto: boolean
      blocks: Array<{ role: string; text: string; fragment: string | null }>
      added_by_engine: string[]
      notes_used: number
      notes_dropped: number
    }
    verified_without_ai: boolean
    generation_run_id: number | null
  }>('POST', `/author-profiles/${String(profile.id)}/drafts/generate`, {
    token,
    body: {
      source_notes:
        'Три месяца я вёл канал без плана.\nПотом выписал темы, которые меня задевают.\nЗа месяц пришло триста человек.',
      mode: 'notes',
    },
  })
  assert.equal(response.status, 201)
  assert.equal(response.body.draft.origin, 'narrative_engine')
  assert.ok(response.body.build.blocks.length >= 1)
  assert.equal(response.body.build.arc_auto, true)
  assert.equal(typeof response.body.build.arc, 'string')
  assert.equal(response.body.verified_without_ai, true)
  assert.equal(response.body.generation_run_id, null)
  assert.ok(response.body.draft.text.length > 20)
})

test('Narrative Engine mode=draft пропускает сборку', async () => {
  const { token, profile } = await makeProfile()
  const notes = 'Готовый текст как есть, без сборки.\nВторая строка остаётся второй строкой.'
  const response = await api<{ draft: { text: string } }>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts/generate`,
    { token, body: { source_notes: notes, mode: 'draft' } },
  )
  assert.equal(response.status, 201)
  assert.equal(response.body.draft.text, notes.trim())
})

test('пустые заметки → 422 empty_notes', async () => {
  const { token, profile } = await makeProfile()
  const response = await api<{ error: { code: string; details: { reason?: string } } }>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts/generate`,
    { token, body: { source_notes: '   \n  ' } },
  )
  assert.equal(response.status, 422)
  assert.equal(response.body.error.details.reason, 'empty_notes')
})

test('Narrative Engine с use_llm=true: блоки собирает mock-модель', async () => {
  const { token, profile } = await makeProfile()
  const response = await api<{
    build: { blocks: Array<{ role: string; text: string }> }
    verified_without_ai: boolean
    generation_run_id: number | null
  }>('POST', `/author-profiles/${String(profile.id)}/drafts/generate`, {
    token,
    body: {
      source_notes: 'Первая заметка про план.\nВторая заметка про регулярность.\nТретья заметка про результат.',
      use_llm: true,
    },
  })
  assert.equal(response.status, 201)
  assert.equal(response.body.verified_without_ai, false)
  assert.equal(typeof response.body.generation_run_id, 'number')
  assert.ok(response.body.build.blocks.length >= 1)
})

test('фильтры списка черновиков по status и origin', async () => {
  const { token, profile } = await makeProfile()
  const base = `/author-profiles/${String(profile.id)}/drafts`
  const authorDraft = await api<{ id: number }>('POST', base, {
    token,
    body: { title: 'Авторский', text: GOOD_TEXT },
  })
  await api('PATCH', `/drafts/${String(authorDraft.body.id)}`, {
    token,
    body: { status: 'on_check' },
  })
  await api('POST', `${base}/generate`, {
    token,
    body: { source_notes: 'Заметка первая.\nЗаметка вторая про результат.' },
  })

  const byStatus = await api<{ items: Array<{ status: string }> }>('GET', base, {
    token,
    query: { status: 'on_check' },
  })
  assert.equal(byStatus.status, 200)
  assert.ok(byStatus.body.items.every((item) => item.status === 'on_check'))

  const byOrigin = await api<{ items: Array<{ origin: string }> }>('GET', base, {
    token,
    query: { origin: 'narrative_engine' },
  })
  assert.ok(byOrigin.body.items.every((item) => item.origin === 'narrative_engine'))
})
