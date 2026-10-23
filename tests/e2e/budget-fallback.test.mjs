/**
 * E2E отказ LLM, отказ от AI и пороги расхода (docs/DECISIONS.md №7, 25; ТЗ разделы 11, 12).
 *
 * Проверяем «плановые» пункты раздела 12 ТЗ так, как их можно проверить на
 * сервере без внешней сети:
 *  - отказ провайдера LLM → одна повторная попытка, откат на правила,
 *    verified_without_ai: true, неудачный вызов записан в generation_runs;
 *  - отказ от AI (use_llm: false) → AI-вызов не выполняется;
 *  - 80% лимита — warning, 100% — blocked в GET …/usage.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getContext,
  api,
  login,
  assertStatus,
  nextTelegramId,
  CLEAN_TEXT,
} from './helpers.mjs'

async function makeAuthor(app, name, limit = 500) {
  const author = await login(app, nextTelegramId(), name)
  const channel = await api.post(app, '/author-profiles', {
    token: author.token,
    body: { name: `${name}: канал`, platform: 'telegram', monthly_cost_limit: limit },
  })
  assertStatus(channel, 201, `создание канала для ${name}`)
  return { token: author.token, channelId: channel.json.id }
}

test('Отказ LLM, отказ от AI и пороги расходов', async (t) => {
  const { app } = await getContext()

  await t.test('Отказ провайдера LLM: повтор, откат на правила, запись в generation_runs', async () => {
    const author = await makeAuthor(app, 'QA Отказ LLM')
    const draft = await api.post(app, `/author-profiles/${author.channelId}/drafts`, {
      token: author.token,
      body: { title: 'Отказ LLM', text: CLEAN_TEXT, origin: 'author' },
    })
    assertStatus(draft, 201, 'черновик для проверки отказа LLM')

    process.env.LLM_MOCK_FAIL = '1'
    try {
      const lint = await api.post(app, `/drafts/${draft.json.id}/lint`, {
        token: author.token,
        body: { use_llm: true },
      })
      assertStatus(lint, 201, 'lint при недоступной LLM')
      assert.equal(lint.json.verified_without_ai, true, 'откат виден в ответе')
      assert.equal(lint.json.lint_report.engine, 'rules', 'движок — правила')
      assert.ok(lint.json.lint_report.score >= 0, 'оценка не потеряна')
    } finally {
      process.env.LLM_MOCK_FAIL = '0'
    }

    const runs = await api.get(
      app,
      `/generation-runs?author_profile_id=${author.channelId}&task_type=lint&status=failed`,
      { token: author.token },
    )
    assertStatus(runs, 200, 'GET /generation-runs?status=failed')
    assert.ok(runs.json.items.length >= 1, 'неудачный вызов записан в журнал расходов')
    assert.ok(runs.json.items[0].error_message, 'в журнале есть текст ошибки')
  })

  await t.test('Отказ от AI (use_llm: false): AI-вызов не выполняется', async () => {
    const author = await makeAuthor(app, 'QA Без AI')
    const draft = await api.post(app, `/author-profiles/${author.channelId}/drafts`, {
      token: author.token,
      body: { title: 'Без AI', text: CLEAN_TEXT, origin: 'author' },
    })
    assertStatus(draft, 201, 'черновик для режима без AI')

    const before = await api.get(
      app,
      `/generation-runs?author_profile_id=${author.channelId}`,
      { token: author.token },
    )
    assertStatus(before, 200, 'журнал до вызова')

    const lint = await api.post(app, `/drafts/${draft.json.id}/lint`, {
      token: author.token,
      body: { use_llm: false },
    })
    assertStatus(lint, 201, 'lint с use_llm=false')
    assert.equal(lint.json.verified_without_ai, true)
    assert.equal(lint.json.lint_report.engine, 'rules')

    const after = await api.get(
      app,
      `/generation-runs?author_profile_id=${author.channelId}`,
      { token: author.token },
    )
    assertStatus(after, 200, 'журнал после вызова')
    assert.equal(
      after.json.items.length,
      before.json.items.length,
      'AI-вызов не выполнялся и не записан в журнал',
    )
  })

  await t.test('Пороги 80% и 100% в GET …/usage', async () => {
    const { db } = await getContext()
    const author = await makeAuthor(app, 'QA Пороги', 500)

    // mock-провайдер бесплатный по замыслу (DECISIONS.md №25), поэтому расход
    // для проверки порогов создаётся фикстурой в журнале генераций — так же,
    // как роль admin выдаётся в базе: иного способа получить ненулевой cost нет.
    const insertCost = (cost) =>
      db.query(
        `INSERT INTO generation_runs (author_id, task_type, model, tokens_input, tokens_output, tokens, cost, status)
         VALUES ($1, 'lint', 'mock', 100, 100, 200, $2, 'success')`,
        [author.channelId, cost],
      )

    await insertCost(400)
    const at80 = await api.get(app, `/author-profiles/${author.channelId}/usage`, {
      token: author.token,
    })
    assertStatus(at80, 200, 'GET …/usage после 80% расхода')
    assert.ok(at80.json.spent > 0, 'расход учтён')
    assert.ok(at80.json.limit_ratio >= 0.8, `limit_ratio ≥ 0.8, факт ${at80.json.limit_ratio}`)
    assert.equal(at80.json.warning, true, 'на 80% канал видит предупреждение')
    assert.equal(at80.json.blocked, false, 'на 80% AI ещё не заблокирован')

    await insertCost(100)
    const at100 = await api.get(app, `/author-profiles/${author.channelId}/usage`, {
      token: author.token,
    })
    assertStatus(at100, 200, 'GET …/usage после 100% расхода')
    assert.ok(at100.json.limit_ratio >= 1, `limit_ratio ≥ 1, факт ${at100.json.limit_ratio}`)
    assert.equal(at100.json.warning, true)
    assert.equal(at100.json.blocked, true, 'на 100% AI-вызовы заблокированы')
    assert.ok(at100.json.runs.total >= 2)
  })
})
