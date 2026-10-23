/**
 * E2E негативные сценарии BlogOS по docs/API.md.
 *
 * Проверяем коды ошибок и правила прав: 400, 401, 402, 403, 404, 409, 422.
 * Каждый тест создаёт собственные фикстуры, поэтому файлы идут в любом порядке.
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
  CLEAN_TEXT,
} from './helpers.mjs'

/** Создать пользователя с каналом. Возвращает {token, userId, channelId}. */
async function makeAuthor(app, name, limit = 500) {
  const author = await login(app, nextTelegramId(), name)
  const channel = await api.post(app, '/author-profiles', {
    token: author.token,
    body: { name: `${name}: канал`, platform: 'telegram', monthly_cost_limit: limit },
  })
  assertStatus(channel, 201, `создание канала для ${name}`)
  return { token: author.token, userId: author.user.id, channelId: channel.json.id }
}

test('Негативные сценарии: коды ошибок и права', async (t) => {
  const { app } = await getContext()

  await t.test('401 — запрос без токена', async () => {
    const res = await api.get(app, '/users/me')
    assertError(res, 401, 'unauthorized', 'GET /users/me без токена')
  })

  await t.test('401 — битый токен', async () => {
    const res = await api.get(app, '/users/me', { token: 'not.a.jwt' })
    assertError(res, 401, 'unauthorized', 'GET /users/me с битым токеном')
  })

  await t.test('400 — пустое имя и неизвестная площадка', async () => {
    const author = await login(app, nextTelegramId(), 'QA Негатив')
    const emptyName = await api.patch(app, '/users/me', {
      token: author.token,
      body: { name: '' },
    })
    assertError(emptyName, 400, 'validation_error', 'PATCH /users/me с пустым именем', (details) => {
      if (!Array.isArray(details.fields)) return 'details.fields должен быть массивом'
      return null
    })

    const badPlatform = await api.post(app, '/author-profiles', {
      token: author.token,
      body: { name: 'Канал', platform: 'vk' },
    })
    assertError(badPlatform, 400, 'validation_error', 'POST /author-profiles с platform=vk')

    const badLimit = await api.get(app, '/author-profiles?limit=201', { token: author.token })
    assertError(badLimit, 400, 'validation_error', 'GET /author-profiles?limit=201 (максимум 200)')
  })

  await t.test('403 — golden-dataset и Evals доступны только admin', async () => {
    const author = await makeAuthor(app, 'QA Негатив 403')
    const cases = [
      ['GET', '/golden-dataset'],
      ['POST', '/golden-dataset'],
      ['POST', '/evals/run'],
      ['GET', '/evals/runs'],
    ]
    for (const [method, url] of cases) {
      const res = await api[method.toLowerCase()](app, url, {
        token: author.token,
        body: method === 'POST' ? {} : undefined,
      })
      assertError(res, 403, 'forbidden', `${method} ${url} обычным автором`)
    }
  })

  await t.test('404 — чужие записи неотличимы от несуществующих', async () => {
    const owner = await makeAuthor(app, 'QA Владелец')
    const stranger = await makeAuthor(app, 'QA Чужой')

    const foreignChannel = await api.get(app, `/author-profiles/${owner.channelId}`, {
      token: stranger.token,
    })
    assertError(foreignChannel, 404, 'not_found', 'GET чужого канала')

    const patchForeign = await api.patch(app, `/author-profiles/${owner.channelId}`, {
      token: stranger.token,
      body: { name: 'Взлом' },
    })
    assertError(patchForeign, 404, 'not_found', 'PATCH чужого канала')

    const deleteForeign = await api.delete(app, `/author-profiles/${owner.channelId}`, {
      token: stranger.token,
    })
    assertError(deleteForeign, 404, 'not_found', 'DELETE чужого канала')

    const ownerStillThere = await api.get(app, `/author-profiles/${owner.channelId}`, {
      token: owner.token,
    })
    assertStatus(ownerStillThere, 200, 'владелец по-прежнему видит канал')

    // Несуществующая запись отвечает так же, как чужая: существование не раскрывается.
    const missing = await api.get(app, '/author-profiles/999999999', { token: stranger.token })
    assertError(missing, 404, 'not_found', 'GET несуществующего канала')
  })

  await t.test('409 — дубли по уникальным ограничениям базы', async () => {
    const author = await makeAuthor(app, 'QA Негатив 409')

    const source = await api.post(app, `/author-profiles/${author.channelId}/sources`, {
      token: author.token,
      body: { name: 'Канал', source_type: 'telegram_channel', source_url: 'https://t.me/s/dup' },
    })
    assertStatus(source, 201, 'первый источник')
    const duplicateSource = await api.post(app, `/author-profiles/${author.channelId}/sources`, {
      token: author.token,
      body: { name: 'Канал 2', source_type: 'telegram_channel', source_url: 'https://t.me/s/dup' },
    })
    assertError(duplicateSource, 409, 'conflict', 'источник с тем же source_url')

    const postBody = { content_type: 'post', text: 'Пост для дедупликации', external_id: 'dup-1' }
    const firstPost = await api.post(app, `/author-profiles/${author.channelId}/posts`, {
      token: author.token,
      body: postBody,
    })
    assertStatus(firstPost, 201, 'первый пост')
    const duplicatePost = await api.post(app, `/author-profiles/${author.channelId}/posts`, {
      token: author.token,
      body: postBody,
    })
    assertError(duplicatePost, 409, 'conflict', 'пост с тем же external_id')
  })

  await t.test('422 — профиль стиля на коротком тексте', async () => {
    const author = await makeAuthor(app, 'QA Негатив 422 стиль')
    const res = await api.post(app, `/author-profiles/${author.channelId}/tov/analyze`, {
      token: author.token,
      body: { texts: ['Слишком короткий текст.', 'Ещё короче.'], use_archive: false },
    })
    assertError(res, 422, 'unprocessable', 'toV/analyze на <180 символах', (details) => {
      if (details.reason !== 'too_short') return `ожидался reason="too_short", получен ${JSON.stringify(details)}`
      if (typeof details.length !== 'number') return 'в details нет length'
      return null
    })
  })

  await t.test('422 — пустые заметки Narrative Engine', async () => {
    const author = await makeAuthor(app, 'QA Негатив 422 заметки')
    const res = await api.post(app, `/author-profiles/${author.channelId}/drafts/generate`, {
      token: author.token,
      body: { source_notes: '   \n  ', arc: null, mode: 'notes' },
    })
    assertError(res, 422, 'unprocessable', 'generate с пустыми заметками', (details) => {
      if (details.reason !== 'empty_notes') return `ожидался reason="empty_notes", получен ${JSON.stringify(details)}`
      return null
    })
  })

  await t.test('422 — lint пустого текста', async () => {
    const author = await makeAuthor(app, 'QA Негатив 422 lint')
    const draft = await api.post(app, `/author-profiles/${author.channelId}/drafts`, {
      token: author.token,
      body: { title: 'Пустой', text: '', origin: 'author' },
    })
    assertStatus(draft, 201, 'создание пустого черновика')
    const res = await api.post(app, `/drafts/${draft.json.id}/lint`, {
      token: author.token,
      body: { use_llm: false },
    })
    assertError(res, 422, 'unprocessable', 'lint пустого текста')
  })

  await t.test('422 — публикация не ready и публикация с пропуском', async () => {
    const author = await makeAuthor(app, 'QA Негатив публикация')

    const notReady = await api.post(app, `/author-profiles/${author.channelId}/drafts`, {
      token: author.token,
      body: { title: 'Не готов', text: CLEAN_TEXT, origin: 'author' },
    })
    assertStatus(notReady, 201, 'черновик для not_ready')
    const publishNotReady = await api.post(app, `/drafts/${notReady.json.id}/publish`, {
      token: author.token,
      body: {},
    })
    assertError(publishNotReady, 422, 'unprocessable', 'publish черновика в статусе draft', (details) => {
      if (details.reason !== 'not_ready') return `ожидался reason="not_ready", получен ${JSON.stringify(details)}`
      return null
    })

    const withGap = await api.post(app, `/author-profiles/${author.channelId}/drafts`, {
      token: author.token,
      body: {
        title: 'С пропуском',
        text: `${CLEAN_TEXT} [дополните: сколько времени это заняло]`,
        origin: 'author',
      },
    })
    assertStatus(withGap, 201, 'черновик с пропуском')
    const toReady = await api.patch(app, `/drafts/${withGap.json.id}`, {
      token: author.token,
      body: { status: 'on_check' },
    })
    assertStatus(toReady, 200, 'PATCH status=on_check')
    const ready = await api.patch(app, `/drafts/${withGap.json.id}`, {
      token: author.token,
      body: { status: 'ready' },
    })
    assertStatus(ready, 200, 'PATCH status=ready')
    const publishWithGap = await api.post(app, `/drafts/${withGap.json.id}/publish`, {
      token: author.token,
      body: {},
    })
    assertError(publishWithGap, 422, 'unprocessable', 'publish с [дополните: …]', (details) => {
      if (details.reason !== 'unfilled_gaps') return `ожидался reason="unfilled_gaps", получен ${JSON.stringify(details)}`
      return null
    })
  })

  await t.test('503 — адаптеры Instagram/YouTube без ключей; telegram — фактическое поведение', async (t) => {
    const author = await makeAuthor(app, 'QA Площадки')

    // Instagram и YouTube без ключей обязаны отвечать 503 not_configured.
    for (const platform of ['instagram', 'youtube']) {
      const res = await api.post(app, `/author-profiles/${author.channelId}/posts/import`, {
        token: author.token,
        body: { platform, source_url: 'https://example.com/channel', limit: 5 },
      })
      assertError(res, 503, 'not_configured', `import ${platform} без ключей`, (details) => {
        if (details.reason !== 'not_configured') {
          return `ожидался details.reason="not_configured", получен ${JSON.stringify(details)}`
        }
        return null
      })
    }

    const instagramSource = await api.post(app, `/author-profiles/${author.channelId}/sources`, {
      token: author.token,
      body: {
        name: 'Instagram',
        source_type: 'instagram',
        source_url: 'https://instagram.com/p/example',
      },
    })
    assertStatus(instagramSource, 201, 'создание instagram-источника')
    const scan = await api.post(app, `/sources/${instagramSource.json.id}/comments/scan`, {
      token: author.token,
      body: { limit: 5 },
    })
    assertError(scan, 503, 'not_configured', 'сканирование Instagram без ключей')

    // Telegram-адаптер работает по публичной веб-версии без ключа бота: сеть
    // может отсутствовать — тогда 502; при доступной странице — 200.
    const telegramImport = await api.post(app, `/author-profiles/${author.channelId}/posts/import`, {
      token: author.token,
      body: { platform: 'telegram', source_url: 'https://t.me/s/durov', limit: 5 },
    })
    t.diagnostic(`telegram import: HTTP ${telegramImport.status} ${telegramImport.text.slice(0, 300)}`)
    if (telegramImport.status === 200) {
      for (const key of ['imported', 'skipped_duplicates', 'skipped_invalid', 'errors', 'checked']) {
        assert.ok(key in telegramImport.json, `в ответе импорта есть ${key}`)
      }
    } else if (telegramImport.status === 502) {
      assertError(telegramImport, 502, 'upstream_unavailable', 'telegram import при недоступной сети')
    } else {
      assert.fail(
        `telegram import: договор допускает 200 или 502, получен ${telegramImport.status}: ${telegramImport.text}`,
      )
    }
  })

  await t.test('422 — лимит 20 каналов на пользователя', async () => {
    const author = await login(app, nextTelegramId(), 'QA Лимит каналов')
    let created = 0
    for (let i = 0; i < 20; i++) {
      const res = await api.post(app, '/author-profiles', {
        token: author.token,
        body: { name: `Канал ${i + 1}`, platform: 'telegram' },
      })
      if (res.status === 201) created += 1
    }
    assert.equal(created, 20, 'первые 20 каналов создаются')
    const excess = await api.post(app, '/author-profiles', {
      token: author.token,
      body: { name: 'Канал 21', platform: 'telegram' },
    })
    assertError(excess, 422, 'unprocessable', '21-й канал')
  })

  await t.test('402 — лимит расходов канала = 0: явный AI-вызов и откат на правила', async (t) => {
    const author = await makeAuthor(app, 'QA Негатив 402', 0)

    // 1. Тело без strict_ai: docs/DECISIONS.md №7 — при достигнутом лимите
    //    lint/generate не падают, а работают на правилах с verified_without_ai.
    const fallback = await api.post(app, `/author-profiles/${author.channelId}/tov/analyze`, {
      token: author.token,
      body: { texts: TOV_TEXTS, use_archive: false },
    })
    if (fallback.status === 402) {
      assertError(fallback, 402, 'ai_budget_exceeded', 'tov/analyze без strict_ai при лимите 0')
      t.diagnostic('без strict_ai: сервер ответил 402 (таблица ошибок docs/API.md)')
    } else {
      assertStatus(fallback, 200, 'tov/analyze без strict_ai при лимите 0 (откат на правила)')
      assert.equal(fallback.json.verified_without_ai, true, 'откат виден в ответе')
      t.diagnostic(
        `без strict_ai: HTTP 200, verified_without_ai=true, ` +
          `ai_skipped_reason=${fallback.json.ai_skipped_reason ?? '—'}`,
      )
    }

    // 2. Явный AI-запрос (strict_ai=true) обязан вернуть 402 из таблицы ошибок.
    const strict = await api.post(app, `/author-profiles/${author.channelId}/tov/analyze`, {
      token: author.token,
      body: { texts: TOV_TEXTS, use_archive: false, strict_ai: true },
    })
    assertError(strict, 402, 'ai_budget_exceeded', 'tov/analyze со strict_ai при лимите 0', (details) => {
      if (details.fallback !== 'rules') return `ожидался details.fallback="rules", получен ${JSON.stringify(details)}`
      return null
    })

    // 3. Проверка текста при достигнутом лимите не оставляет автора без проверки.
    const draft = await api.post(app, `/author-profiles/${author.channelId}/drafts`, {
      token: author.token,
      body: { title: 'При лимите', text: CLEAN_TEXT, origin: 'author' },
    })
    assertStatus(draft, 201, 'черновик на канале с лимитом 0')
    const lint = await api.post(app, `/drafts/${draft.json.id}/lint`, {
      token: author.token,
      body: { use_llm: true },
    })
    assertStatus(lint, 201, 'lint при достигнутом лимите (правила, не 402)')
    assert.equal(lint.json.verified_without_ai, true, 'lint выполнен правилами')
  })

  await t.test('204/404 — удаление записей и каскады через API', async () => {
    const author = await makeAuthor(app, 'QA Негатив удаление')

    const draft = await api.post(app, `/author-profiles/${author.channelId}/drafts`, {
      token: author.token,
      body: { title: 'На удаление', text: CLEAN_TEXT, origin: 'author' },
    })
    assertStatus(draft, 201, 'черновик на удаление')
    const lint = await api.post(app, `/drafts/${draft.json.id}/lint`, {
      token: author.token,
      body: { use_llm: false },
    })
    assertStatus(lint, 201, 'lint перед удалением')
    const reportId = lint.json.lint_report.id
    const removed = await api.delete(app, `/drafts/${draft.json.id}`, { token: author.token })
    assertStatus(removed, 204, 'DELETE /drafts/{id}')
    const gone = await api.get(app, `/drafts/${draft.json.id}`, { token: author.token })
    assertError(gone, 404, 'not_found', 'GET удалённого черновика')
    const reportGone = await api.get(app, `/lint-reports/${reportId}`, { token: author.token })
    assertError(reportGone, 404, 'not_found', 'GET отчёта удалённого черновика (cascade)')

    const source = await api.post(app, `/author-profiles/${author.channelId}/sources`, {
      token: author.token,
      body: { name: 'На удаление', source_type: 'manual', source_url: 'https://t.me/s/del' },
    })
    assertStatus(source, 201, 'источник на удаление')
    const comment = await api.post(app, `/sources/${source.json.id}/comments`, {
      token: author.token,
      body: { text: 'Комментарий на удаление' },
    })
    assertStatus(comment, 201, 'комментарий на удаление')
    const sourceRemoved = await api.delete(app, `/sources/${source.json.id}`, {
      token: author.token,
    })
    assertStatus(sourceRemoved, 204, 'DELETE /sources/{id}')
    const commentGone = await api.get(app, `/comments/${comment.json.id}`, {
      token: author.token,
    })
    assertError(commentGone, 404, 'not_found', 'GET комментария удалённого источника (cascade)')
  })

  await t.test('DELETE /users/me — 204, повторный запрос 401', async () => {
    const author = await login(app, nextTelegramId(), 'QA Удаление аккаунта')
    const removed = await api.delete(app, '/users/me', { token: author.token })
    assertStatus(removed, 204, 'DELETE /users/me')
    const after = await api.get(app, '/users/me', { token: author.token })
    assertError(after, 401, 'unauthorized', 'GET /users/me после удаления аккаунта')
  })
})
