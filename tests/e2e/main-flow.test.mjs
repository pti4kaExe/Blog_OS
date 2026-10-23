/**
 * E2E главный сценарий BlogOS по docs/API.md.
 *
 *   node --test --test-isolation=none tests/e2e/
 *
 * Чёрный ящик по HTTP: вход → канал → стиль → черновик → сборка → проверка →
 * правка → повторная проверка → публикация → источник → сканирование →
 * комментарий → генерация ответа → блокировка approve на пропуске → заполнение
 * → approve → база знаний → поиск → расходы → generation-runs → golden-dataset
 * и Evals (admin). Каждый шаг сверяется с контрактом docs/API.md.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getContext,
  api,
  login,
  loginAdmin,
  assertStatus,
  assertError,
  nextTelegramId,
  TOV_TEXTS,
  NOTES,
  CLEAN_TEXT,
} from './helpers.mjs'

function need(state, key, label) {
  if (state[key] === undefined || state[key] === null) {
    throw new Error(`Шаг «${label}» не выполнен: нет значения «${key}» — зависимый шаг не может идти дальше`)
  }
  return state[key]
}

test('Главный сценарий: конвейер автора целиком по HTTP', async (t) => {
  const { app, db } = await getContext()
  const state = {}

  await t.test('1. dev-вход создаёт пользователя и выдаёт JWT', async () => {
    const telegramId = nextTelegramId()
    const { token, user, res } = await login(app, telegramId, 'QA Автор')
    assertStatus(res, 200, 'POST /auth/telegram')
    assert.equal(user.telegram_id, telegramId)
    assert.equal(user.role, 'user')
    assert.ok(token.split('.').length === 3, 'токен должен быть JWT (три части)')
    assert.ok(res.json.expires_at, 'в ответе есть expires_at')
    state.token = token
    state.userId = user.id
  })

  await t.test('2. GET /users/me — профиль и число каналов', async () => {
    need(state, 'token', 'вход')
    const res = await api.get(app, '/users/me', { token: state.token })
    assertStatus(res, 200, 'GET /users/me')
    assert.equal(res.json.id, state.userId)
    assert.equal(res.json.role, 'user')
    assert.equal(typeof res.json.author_profiles_count, 'number')
    assert.equal(res.json.author_profiles_count, 0)
  })

  await t.test('3. PATCH /users/me — смена имени', async () => {
    need(state, 'token', 'вход')
    const res = await api.patch(app, '/users/me', {
      token: state.token,
      body: { name: 'QA Автор (обновлён)' },
    })
    assertStatus(res, 200, 'PATCH /users/me')
    assert.equal(res.json.name, 'QA Автор (обновлён)')
  })

  await t.test('4. POST /author-profiles — создание канала', async () => {
    need(state, 'token', 'вход')
    const res = await api.post(app, '/author-profiles', {
      token: state.token,
      body: {
        name: 'QA: Заметки разработчика',
        platform: 'telegram',
        description: 'Канал для приёмочного сценария',
        content_settings: {
          topics: ['код', 'учёба'],
          language: 'ru',
          target_length: { min: 800, max: 2500 },
        },
        monthly_cost_limit: 500,
      },
    })
    assertStatus(res, 201, 'POST /author-profiles')
    assert.ok(res.json.id, 'канал получил id')
    assert.equal(res.json.platform, 'telegram')
    assert.equal(res.json.monthly_cost_limit, 500)
    assert.equal(res.json.user_id, state.userId)
    state.channelId = res.json.id
  })

  await t.test('5. GET /author-profiles — список с пагинацией', async () => {
    need(state, 'channelId', 'создание канала')
    const res = await api.get(app, '/author-profiles?limit=50', { token: state.token })
    assertStatus(res, 200, 'GET /author-profiles')
    assert.ok(Array.isArray(res.json.items))
    assert.ok(res.json.next_cursor === null || typeof res.json.next_cursor === 'string')
    assert.ok(
      res.json.items.some((item) => item.id === state.channelId),
      'созданный канал есть в списке',
    )
  })

  await t.test('6. GET /author-profiles/{id} — счётчики связей', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.get(app, `/author-profiles/${channelId}`, { token: state.token })
    assertStatus(res, 200, 'GET /author-profiles/{id}')
    assert.equal(res.json.id, channelId)
    assert.equal(res.json.tov_profiles_count, 0)
    assert.equal(res.json.posts_count, 0)
    assert.equal(res.json.drafts_count, 0)
  })

  await t.test('7. POST …/tov/analyze — профиль стиля на 180+ символах', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.post(app, `/author-profiles/${channelId}/tov/analyze`, {
      token: state.token,
      body: { texts: TOV_TEXTS, use_archive: false },
    })
    assertStatus(res, 200, 'POST …/tov/analyze')
    assert.ok(res.json.tov_profile?.id, 'профиль стиля построен')
    assert.ok(['ты', 'вы', 'смешанное'].includes(res.json.tov_profile.tone))
    assert.equal(res.json.analysis.posts_used, 2)
    assert.ok(res.json.analysis.chars >= 180, `символов ≥ 180, факт ${res.json.analysis.chars}`)
    assert.equal(typeof res.json.verified_without_ai, 'boolean')
    state.tov = res.json.tov_profile
  })

  await t.test('8. GET …/tov — профиль читается после анализа', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.get(app, `/author-profiles/${channelId}/tov`, { token: state.token })
    assertStatus(res, 200, 'GET …/tov')
    assert.equal(res.json.author_id, channelId)
    assert.equal(res.json.id, state.tov.id)
  })

  await t.test('9. POST …/drafts — ручной черновик', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.post(app, `/author-profiles/${channelId}/drafts`, {
      token: state.token,
      body: { title: 'Черновик QA', source_notes: '', text: '', origin: 'author' },
    })
    assertStatus(res, 201, 'POST …/drafts')
    assert.equal(res.json.status, 'draft')
    assert.equal(res.json.origin, 'author')
    state.manualDraftId = res.json.id
  })

  await t.test('10. POST …/drafts/generate — Narrative Engine без потери заметок', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.post(app, `/author-profiles/${channelId}/drafts/generate`, {
      token: state.token,
      body: { source_notes: NOTES, arc: null, mode: 'notes' },
    })
    assertStatus(res, 201, 'POST …/drafts/generate')
    assert.ok(res.json.draft?.id, 'черновик создан')
    assert.equal(res.json.draft.origin, 'narrative_engine')
    assert.ok(Array.isArray(res.json.build.blocks) && res.json.build.blocks.length > 0, 'блоки собраны')
    const notesCount = NOTES.split('\n').filter((line) => line.trim()).length
    assert.equal(
      res.json.build.notes_used + res.json.build.notes_dropped,
      notesCount,
      'все заметки распределены по ролям (ТЗ, раздел 12: «без потерь»)',
    )
    assert.equal(res.json.build.notes_dropped, 0)
    assert.equal(typeof res.json.verified_without_ai, 'boolean')
    state.draftId = res.json.draft.id
    state.build = res.json.build
  })

  await t.test('10b. Переключение сюжетной арки вручную', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.post(app, `/author-profiles/${channelId}/drafts/generate`, {
      token: state.token,
      body: { source_notes: NOTES, arc: 'problem_solution', mode: 'notes' },
    })
    assertStatus(res, 201, 'POST …/drafts/generate с arc=problem_solution')
    assert.equal(res.json.build.arc, 'problem_solution', 'пост пересобран под выбранную арку')
    assert.equal(res.json.build.arc_auto, false, 'арка выбрана вручную, не автовыбором')
  })

  await t.test('11. POST /drafts/{id}/lint — оценка, замечания, группы, вердикт', async () => {
    const draftId = need(state, 'draftId', 'сборка черновика')
    const res = await api.post(app, `/drafts/${draftId}/lint`, {
      token: state.token,
      body: { use_llm: true },
    })
    assertStatus(res, 201, 'POST /drafts/{id}/lint')
    const report = res.json.lint_report
    assert.ok(report?.id, 'отчёт создан')
    assert.ok(Number.isInteger(report.score) && report.score >= 0 && report.score <= 100)
    assert.ok(Array.isArray(report.issues))
    for (const issue of report.issues) {
      assert.ok(issue.type && issue.quote !== undefined && issue.explanation && issue.suggestion)
      assert.ok(['cliche', 'logic', 'tov', 'clarity'].includes(issue.category))
    }
    for (const key of ['cliche', 'logic', 'tov', 'clarity']) {
      assert.ok(typeof res.json.groups[key] === 'number', `в groups есть ${key}`)
    }
    const expectedVerdict =
      report.score >= 75 ? 'Можно публиковать' : report.score >= 40 ? 'Требует правок' : 'Переписать'
    assert.equal(res.json.verdict, expectedVerdict, 'вердикт соответствует оценке')
    assert.equal(typeof res.json.verified_without_ai, 'boolean')
    state.firstLintId = report.id
    state.firstScore = report.score
  })

  await t.test('12. PATCH /drafts/{id} — правка текста и статус on_check', async () => {
    const draftId = need(state, 'draftId', 'сборка черновика')
    const res = await api.patch(app, `/drafts/${draftId}`, {
      token: state.token,
      body: { text: CLEAN_TEXT, status: 'on_check' },
    })
    assertStatus(res, 200, 'PATCH /drafts/{id}')
    assert.equal(res.json.text, CLEAN_TEXT)
    assert.equal(res.json.status, 'on_check')
  })

  await t.test('13. Повторный lint — новый отчёт, история растёт', async () => {
    const draftId = need(state, 'draftId', 'сборка черновика')
    const res = await api.post(app, `/drafts/${draftId}/lint`, {
      token: state.token,
      body: { use_llm: true },
    })
    assertStatus(res, 201, 'повторный POST /drafts/{id}/lint')
    assert.notEqual(res.json.lint_report.id, need(state, 'firstLintId', 'первый lint'), 'новый отчёт — новый id')
    state.secondLintId = res.json.lint_report.id

    const history = await api.get(app, `/drafts/${draftId}/lint-reports`, { token: state.token })
    assertStatus(history, 200, 'GET /drafts/{id}/lint-reports')
    assert.ok(history.json.items.length >= 2, `история выросла: ${history.json.items.length}`)
    const dates = history.json.items.map((item) => new Date(item.created_at).getTime())
    const sorted = [...dates].sort((a, b) => b - a)
    assert.deepEqual(dates, sorted, 'история отсортирована created_at DESC')
  })

  await t.test('14. GET /lint-reports/{id} — отчёт читается отдельно', async () => {
    const reportId = need(state, 'firstLintId', 'первый lint')
    const res = await api.get(app, `/lint-reports/${reportId}`, { token: state.token })
    assertStatus(res, 200, 'GET /lint-reports/{id}')
    assert.equal(res.json.id, reportId)
    assert.equal(res.json.score, state.firstScore)
  })

  await t.test('15. POST /drafts/{id}/publish — публикация после status=ready', async () => {
    const draftId = need(state, 'draftId', 'сборка черновика')
    const ready = await api.patch(app, `/drafts/${draftId}`, {
      token: state.token,
      body: { status: 'ready' },
    })
    assertStatus(ready, 200, 'PATCH status=ready')

    const res = await api.post(app, `/drafts/${draftId}/publish`, {
      token: state.token,
      body: { published_at: '2026-10-23T12:00:00Z' },
    })
    assertStatus(res, 200, 'POST /drafts/{id}/publish')
    assert.equal(res.json.draft.status, 'published')
    assert.ok(res.json.draft.published_post_id, 'связь с постом установлена')
    assert.ok(res.json.post?.id, 'пост создан')
    assert.equal(res.json.post.text, CLEAN_TEXT)
    state.postId = res.json.post.id
  })

  await t.test('16. GET /drafts/{id} — latest_lint_report и статус published', async () => {
    const draftId = need(state, 'draftId', 'сборка черновика')
    const res = await api.get(app, `/drafts/${draftId}`, { token: state.token })
    assertStatus(res, 200, 'GET /drafts/{id}')
    assert.equal(res.json.status, 'published')
    assert.equal(res.json.published_post_id, need(state, 'postId', 'публикация'))
    assert.ok(res.json.latest_lint_report?.id, 'последний отчёт отдан')
  })

  await t.test('17. POST …/sources — источник CommentRadar', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.post(app, `/author-profiles/${channelId}/sources`, {
      token: state.token,
      body: {
        name: 'QA: канал про код',
        source_type: 'telegram_channel',
        source_url: 'https://t.me/s/qa_blogos_channel',
      },
    })
    assertStatus(res, 201, 'POST …/sources')
    assert.equal(res.json.source_type, 'telegram_channel')
    assert.equal(res.json.is_active, true)
    state.sourceId = res.json.id
  })

  await t.test('18. GET /sources/{id} — счётчики и статус сканирования', async () => {
    const sourceId = need(state, 'sourceId', 'создание источника')
    const res = await api.get(app, `/sources/${sourceId}`, { token: state.token })
    assertStatus(res, 200, 'GET /sources/{id}')
    assert.equal(res.json.id, sourceId)
    assert.equal(res.json.comments_count, 0)
    assert.ok(['never', 'ok', 'failed'].includes(res.json.last_scan_status))
  })

  await t.test('19. POST /sources/{id}/comments — ручной комментарий (manual:<id>)', async () => {
    const sourceId = need(state, 'sourceId', 'создание источника')
    const res = await api.post(app, `/sources/${sourceId}/comments`, {
      token: state.token,
      body: {
        commenter_name: 'Читатель',
        text: 'А как вы это настроили?',
        posted_at: '2026-10-20T09:00:00Z',
      },
    })
    assertStatus(res, 201, 'POST /sources/{id}/comments')
    assert.match(String(res.json.external_id), /^manual:/, 'external_id = manual:<id>')
    state.commentId = res.json.id
  })

  await t.test('20. GET /sources/{id}/comments — комментарий в списке', async () => {
    const sourceId = need(state, 'sourceId', 'создание источника')
    const res = await api.get(app, `/sources/${sourceId}/comments?limit=50`, { token: state.token })
    assertStatus(res, 200, 'GET /sources/{id}/comments')
    assert.ok(res.json.items.some((item) => item.id === state.commentId))
  })

  await t.test('21. POST /sources/{id}/comments/scan — фактическое поведение при mock/без ключей', async (t) => {
    const sourceId = need(state, 'sourceId', 'создание источника')
    const res = await api.post(app, `/sources/${sourceId}/comments/scan`, {
      token: state.token,
      body: { limit: 10 },
    })
    // Контракт: 200 при рабочем адаптере, 502 при отказе площадки после повтора,
    // 503 not_configured при отсутствии ключей. Фиксируем фактический вариант.
    t.diagnostic(`scan: HTTP ${res.status} ${res.text}`)
    if (res.status === 200) {
      for (const key of ['source_id', 'found', 'created', 'duplicates', 'status']) {
        assert.ok(key in res.json, `в ответе сканирования есть ${key}`)
      }
      assert.ok(['ok', 'failed'].includes(res.json.status))
      state.scan = res.json
    } else if (res.status === 502) {
      assertError(res, 502, 'upstream_unavailable', 'POST …/comments/scan (502)')
      state.scan = { status: 'upstream_unavailable' }
    } else if (res.status === 503) {
      assertError(res, 503, 'not_configured', 'POST …/comments/scan (503)')
      state.scan = { status: 'not_configured' }
    } else {
      assert.fail(
        `POST …/comments/scan: договор допускает 200, 502 или 503, получен ${res.status}: ${res.text}`,
      )
    }
  })

  await t.test('22. POST …/responses/generate — ответ из четырёх частей с пропуском', async () => {
    const commentId = need(state, 'commentId', 'создание комментария')
    const res = await api.post(app, `/comments/${commentId}/responses/generate`, {
      token: state.token,
      body: { count: 2 },
    })
    assertStatus(res, 201, 'POST …/responses/generate')
    assert.ok(Array.isArray(res.json.responses) && res.json.responses.length === 2)
    const response = res.json.responses[0]
    assert.ok(response.id, 'вариант ответа создан')
    assert.ok(response.parts, 'вернулись части ответа')
    assert.ok(
      String(response.parts.gap).includes('[дополните:'),
      'движок оставил пропуск в части gap — факты не выдумываются',
    )
    assert.equal(typeof res.json.verified_without_ai, 'boolean')
    state.responseId = response.id
    state.responseParts = response.parts
  })

  await t.test('23. PATCH /responses/{id} — approve блокируется незаполненным пропуском', async () => {
    const responseId = need(state, 'responseId', 'генерация ответа')
    // Цепочка статусов контракта: generated → pending_approval → approved.
    const pending = await api.patch(app, `/responses/${responseId}`, {
      token: state.token,
      body: { status: 'pending_approval' },
    })
    assertStatus(pending, 200, 'PATCH /responses/{id} status=pending_approval')
    assert.equal(pending.json.status, 'pending_approval')

    const res = await api.patch(app, `/responses/${responseId}`, {
      token: state.token,
      body: { status: 'approved' },
    })
    assertError(res, 422, 'unprocessable', 'approve с [дополните: …]', (details) => {
      if (details.reason !== 'unfilled_gaps') {
        return `ожидался details.reason="unfilled_gaps", получен ${JSON.stringify(details)}`
      }
      return null
    })
  })

  await t.test('24. PATCH /responses/{id} — заполнили пропуск и одобрили', async () => {
    const responseId = need(state, 'responseId', 'генерация ответа')
    const filled = `Спасибо за вопрос! В моём опыте было так: сначала я делал это вручную, потом собрал простой конвейер. ${state.responseParts?.question ?? 'А у тебя как это устроено?'}`
    const res = await api.patch(app, `/responses/${responseId}`, {
      token: state.token,
      body: { edited_text: filled, status: 'approved' },
    })
    assertStatus(res, 200, 'PATCH /responses/{id} status=approved')
    assert.equal(res.json.status, 'approved')
    assert.ok(res.json.approved_at, 'approved_at проставлен сервером')
  })

  await t.test('25. GET /comments/{id}/responses?status=approved — одобренный ответ виден', async () => {
    const commentId = need(state, 'commentId', 'создание комментария')
    const res = await api.get(app, `/comments/${commentId}/responses?status=approved`, {
      token: state.token,
    })
    assertStatus(res, 200, 'GET /comments/{id}/responses')
    assert.ok(res.json.items.some((item) => item.id === state.responseId))
  })

  await t.test('26. База знаний: создать, прочитать, изменить, найти', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const created = await api.post(app, `/author-profiles/${channelId}/knowledge`, {
      token: state.token,
      body: { title: 'Обо мне', content: 'Работаю в продуктовой аналитике с 2019 года' },
    })
    assertStatus(created, 201, 'POST …/knowledge')
    assert.ok(created.json.id)
    state.knowledgeId = created.json.id

    const read = await api.get(app, `/knowledge/${state.knowledgeId}`, { token: state.token })
    assertStatus(read, 200, 'GET /knowledge/{id}')
    assert.equal(read.json.title, 'Обо мне')

    const updated = await api.patch(app, `/knowledge/${state.knowledgeId}`, {
      token: state.token,
      body: { content: 'Работаю в продуктовой аналитике с 2019 года, сейчас веду два канала' },
    })
    assertStatus(updated, 200, 'PATCH /knowledge/{id}')
    assert.match(updated.json.content, /два канала/)

    const search = await api.get(
      app,
      `/author-profiles/${channelId}/knowledge/search?q=${encodeURIComponent('сколько лет в аналитике')}&limit=5`,
      { token: state.token },
    )
    assertStatus(search, 200, 'GET …/knowledge/search')
    assert.ok(Array.isArray(search.json.items))
    assert.ok(typeof search.json.query_embedding_model === 'string')
    assert.ok(typeof search.json.searched_chunks === 'number')
    state.search = search.json
  })

  await t.test('27. GET …/usage — расходы AI за месяц', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.get(app, `/author-profiles/${channelId}/usage`, { token: state.token })
    assertStatus(res, 200, 'GET …/usage')
    assert.equal(res.json.author_profile_id, channelId)
    assert.equal(res.json.monthly_cost_limit, 500)
    assert.equal(typeof res.json.spent, 'number')
    assert.equal(typeof res.json.warning, 'boolean')
    assert.equal(typeof res.json.blocked, 'boolean')
    assert.ok(res.json.runs.total >= 1, 'AI-вызовы записаны в журнал')
    assert.ok(Array.isArray(res.json.by_task))
  })

  await t.test('28. GET /generation-runs — автор видит только свои вызовы', async () => {
    const channelId = need(state, 'channelId', 'создание канала')
    const res = await api.get(app, '/generation-runs?limit=50', { token: state.token })
    assertStatus(res, 200, 'GET /generation-runs')
    assert.ok(Array.isArray(res.json.items) && res.json.items.length >= 1)
    for (const run of res.json.items) {
      assert.equal(run.author_id, channelId, 'в журнале только вызовы своих каналов')
    }
    const filtered = await api.get(app, `/generation-runs?author_profile_id=${channelId}`, {
      token: state.token,
    })
    assertStatus(filtered, 200, 'GET /generation-runs?author_profile_id=')
    assert.ok(filtered.json.items.every((run) => run.author_id === channelId))
  })

  await t.test('29. admin: golden-dataset и прогон Evals', async (t) => {
    const admin = await loginAdmin(app, db, nextTelegramId(), 'QA Админ')
    state.adminToken = admin.token

    const created = await api.post(app, '/golden-dataset', {
      token: admin.token,
      body: {
        text: 'Эталонный текст: в современном мире каждый должен использовать синергию.',
        labels: [
          { type: 'cliche', quote: 'в современном мире', start: 18, end: 35 },
          { type: 'cliche', quote: 'синергию', start: 0, end: 0 },
        ],
        platform: 'telegram',
      },
    })
    assertStatus(created, 201, 'POST /golden-dataset')
    assert.ok(created.json.id, 'эталон создан')
    t.diagnostic(`golden id=${created.json.id}`)

    const list = await api.get(app, '/golden-dataset', { token: admin.token })
    assertStatus(list, 200, 'GET /golden-dataset')
    assert.ok(list.json.items.length >= 1)

    const run = await api.post(app, '/evals/run', {
      token: admin.token,
      body: { use_llm: false, platform: null },
    })
    assertStatus(run, 201, 'POST /evals/run')
    assert.ok(run.json.generation_run_id, 'прогон записан в generation_runs')
    assert.ok(run.json.summary.goldens >= 1)
    assert.ok(run.json.summary.precision >= 0 && run.json.summary.precision <= 1)
    assert.ok(run.json.summary.recall >= 0 && run.json.summary.recall <= 1)
    assert.ok(Array.isArray(run.json.results))
    state.evalRunId = run.json.generation_run_id

    const runs = await api.get(app, '/evals/runs', { token: admin.token })
    assertStatus(runs, 200, 'GET /evals/runs')
    assert.ok(Array.isArray(runs.json.items))
  })
})
