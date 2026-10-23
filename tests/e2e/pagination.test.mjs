/**
 * E2E пагинация и сортировка BlogOS по docs/API.md.
 *
 * Контракт: `?limit=` (по умолчанию 50, максимум 200), `?cursor=<opaque>`,
 * сортировка `created_at DESC`, формат `{ items, next_cursor }`.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getContext,
  api,
  login,
  assertStatus,
  assertError,
  nextTelegramId,
  TOV_TEXTS,
} from './helpers.mjs'

test('Пагинация limit/cursor и сортировка created_at DESC', async (t) => {
  const { app } = await getContext()
  const author = await login(app, nextTelegramId(), 'QA Пагинация')
  const channel = await api.post(app, '/author-profiles', {
    token: author.token,
    body: { name: 'QA: пагинация', platform: 'telegram' },
  })
  assertStatus(channel, 201, 'создание канала')
  const channelId = channel.json.id

  await t.test('limit по умолчанию 50, максимум 200', async () => {
    const res = await api.get(app, `/author-profiles/${channelId}/knowledge`, {
      token: author.token,
    })
    assertStatus(res, 200, 'GET …/knowledge без limit')
    assert.ok(Array.isArray(res.json.items))
    assert.ok(res.json.next_cursor === null || typeof res.json.next_cursor === 'string')

    const max = await api.get(app, `/author-profiles/${channelId}/knowledge?limit=200`, {
      token: author.token,
    })
    assertStatus(max, 200, 'limit=200 принимается')
    const tooMuch = await api.get(app, `/author-profiles/${channelId}/knowledge?limit=201`, {
      token: author.token,
    })
    assertError(tooMuch, 400, 'validation_error', 'limit=201 превышает максимум')
  })

  await t.test('курсорная пагинация: страницы не пересекаются, next_cursor завершается', async () => {
    const created = []
    for (let i = 1; i <= 3; i++) {
      const res = await api.post(app, `/author-profiles/${channelId}/knowledge`, {
        token: author.token,
        body: { title: `Факт ${i}`, content: `Содержание факта номер ${i}` },
      })
      assertStatus(res, 201, `создание факта ${i}`)
      created.push(res.json.id)
    }

    const first = await api.get(app, `/author-profiles/${channelId}/knowledge?limit=1`, {
      token: author.token,
    })
    assertStatus(first, 200, 'страница 1 (limit=1)')
    assert.equal(first.json.items.length, 1, 'на странице ровно limit записей')
    assert.equal(typeof first.json.next_cursor, 'string', 'next_cursor — строка, пока есть данные')

    const second = await api.get(
      app,
      `/author-profiles/${channelId}/knowledge?limit=1&cursor=${encodeURIComponent(first.json.next_cursor)}`,
      { token: author.token },
    )
    assertStatus(second, 200, 'страница 2')
    assert.equal(second.json.items.length, 1)
    assert.notEqual(second.json.items[0].id, first.json.items[0].id, 'страницы не пересекаются')

    // Собираем все страницы до next_cursor = null.
    const seen = [first.json.items[0].id, second.json.items[0].id]
    let cursor = second.json.next_cursor
    let guard = 0
    while (cursor && guard < 10) {
      const page = await api.get(
        app,
        `/author-profiles/${channelId}/knowledge?limit=1&cursor=${encodeURIComponent(cursor)}`,
        { token: author.token },
      )
      assertStatus(page, 200, `страница ${seen.length + 1}`)
      for (const item of page.json.items) seen.push(item.id)
      cursor = page.json.next_cursor
      guard += 1
    }
    assert.equal(new Set(seen).size, seen.length, 'нет дублей между страницами')
    for (const id of created) assert.ok(seen.includes(id), `факт ${id} встретился при обходе`)
  })

  await t.test('сортировка created_at DESC на списках', async () => {
    const res = await api.get(app, `/author-profiles/${channelId}/knowledge?limit=200`, {
      token: author.token,
    })
    assertStatus(res, 200, 'GET …/knowledge')
    const dates = res.json.items.map((item) => new Date(item.created_at).getTime())
    const sorted = [...dates].sort((a, b) => b - a)
    assert.deepEqual(dates, sorted, 'created_at по убыванию')
  })

  await t.test('пагинация журнала вызовов AI', async () => {
    // Создаём минимум два AI-вызова, чтобы журнал не был пустым.
    for (let i = 0; i < 2; i++) {
      const res = await api.post(app, `/author-profiles/${channelId}/tov/analyze`, {
        token: author.token,
        body: { texts: TOV_TEXTS, use_archive: false },
      })
      assertStatus(res, 200, `tov/analyze #${i + 1}`)
    }
    const first = await api.get(
      app,
      `/generation-runs?author_profile_id=${channelId}&limit=1`,
      { token: author.token },
    )
    assertStatus(first, 200, 'GET /generation-runs?limit=1')
    assert.equal(first.json.items.length, 1)
    const dates = first.json.items.map((run) => new Date(run.created_at).getTime())
    const second = await api.get(
      app,
      `/generation-runs?author_profile_id=${channelId}&limit=1&cursor=${encodeURIComponent(first.json.next_cursor ?? '')}`,
      { token: author.token },
    )
    assertStatus(second, 200, 'GET /generation-runs страница 2')
    if (second.json.items.length > 0) {
      assert.ok(
        new Date(second.json.items[0].created_at).getTime() <= dates[0],
        'журнал отсортирован created_at DESC',
      )
    }
  })
})
