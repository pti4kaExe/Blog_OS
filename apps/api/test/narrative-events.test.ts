/**
 * Интеграция guard в маршрут генерации: модель вернула чужое событие —
 * пост не принимается, откат на правила с reason=invented_events.
 */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  api,
  bootstrap,
  cleanupProfiles,
  createProfile,
  freshUser,
} from './helpers.ts'

let ownerToken = ''
const created: Array<Record<string, unknown>> = []

before(async () => {
  await bootstrap()
  const owner = await freshUser('События')
  ownerToken = owner.token
})

after(async () => {
  process.env.LLM_MOCK_INVENTED_EVENTS = ''
  if (ownerToken) {
    await cleanupProfiles(ownerToken, created)
    await api('DELETE', '/users/me', { token: ownerToken })
  }
})

const NOTES = [
  'Три месяца вёл канал про продуктивность и выгорел.',
  'Понял: план работал, пока я оставлял пустое место под отдых.',
  'Теперь в плане три задачи и два пустых слота.',
].join('\n')

test('модель выдумала конференцию 6 ноября → откат на правила, текста события нет', async () => {
  const profile = await createProfile(ownerToken)
  created.push(profile)
  const profileId = String(profile.id)

  const previous = process.env.LLM_MOCK_INVENTED_EVENTS
  process.env.LLM_MOCK_INVENTED_EVENTS = '1'
  try {
    const response = await api<Record<string, unknown>>(
      'POST',
      `/author-profiles/${profileId}/drafts/generate`,
      {
        token: ownerToken,
        body: { source_notes: NOTES, use_llm: true },
      },
    )
    assert.equal(response.status, 201)
    // Два прогона mock дают одно и то же событие → сервер обязан откатиться на правила.
    assert.equal(response.body.verified_without_ai, true)
    assert.equal(response.body.ai_skipped_reason, 'invented_events')

    const draft = response.body.draft as Record<string, unknown>
    const text = String(draft.text ?? '')
    assert.ok(text.length > 0, 'текст черновика не пустой')
    assert.ok(!text.includes('6 ноября'), 'чужой даты в тексте нет')
    assert.ok(!/конференц/iu.test(text), 'чужого мероприятия в тексте нет')
    assert.equal(draft.origin, 'narrative_engine')
  } finally {
    if (previous === undefined) delete process.env.LLM_MOCK_INVENTED_EVENTS
    else process.env.LLM_MOCK_INVENTED_EVENTS = previous
  }
})

test('без флага mock-модели событий нет — ИИ-путь принимается', async () => {
  const profile = await createProfile(ownerToken)
  created.push(profile)
  const response = await api<Record<string, unknown>>(
    'POST',
    `/author-profiles/${String(profile.id)}/drafts/generate`,
    { token: ownerToken, body: { source_notes: NOTES, use_llm: true } },
  )
  assert.equal(response.status, 201)
  assert.equal(response.body.verified_without_ai, false)
  assert.equal(response.body.ai_skipped_reason, undefined)
})
