/**
 * Сквозная проверка живого сервера по HTTP (не через inject): ровно то, что
 * делает клиент, но без браузера.
 *
 *   # терминал 1
 *   npm run db:migrate && npm run db:seed && npm run dev:api
 *   # терминал 2
 *   node scripts/smoke-http.mjs
 *
 * По умолчанию работает с демо-базой после npm run db:seed.
 */
const BASE = process.env.API_URL ?? 'http://localhost:3000'

let step = 0
const results = []

async function call(method, path, { token, body, expect = [200, 201] } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  const ok = expect.includes(response.status)
  results.push({ step, method, path, status: response.status, ok })
  const label = `${String(step).padStart(2)} ${method} ${path} → ${response.status}`
  console.log(ok ? `ok   ${label}` : `FAIL ${label}`)
  if (!ok) {
    console.log('     ожидали', expect.join('/'), 'получили', JSON.stringify(json).slice(0, 300))
    throw new Error(`Шаг ${step}: ${method} ${path} → ${response.status}`)
  }
  return json
}

async function main() {
  step++
  const health = await call('GET', '/health')
  console.log(`     БД: ${health.db}, LLM: ${health.llm}, embeddings: ${health.embeddings}`)

  step++
  const authorLogin = await call('POST', '/auth/telegram', {
    body: { telegram_id: 200600, name: 'Демо-автор' },
  })
  const author = authorLogin.token
  console.log(`     автор: ${authorLogin.user.name}, роль ${authorLogin.user.role}`)

  step++
  const adminLogin = await call('POST', '/auth/telegram', {
    body: { telegram_id: 100500, name: 'Демо-админ' },
  })
  const admin = adminLogin.token

  step++
  const channels = await call('GET', '/author-profiles', { token: author })
  const channel = channels.items.find((item) => item.platform === 'telegram')
  if (!channel) throw new Error('В демо-базе нет telegram-канала автора: запустите npm run db:seed')
  console.log(`     канал: «${channel.name}» (id ${channel.id})`)

  step++
  const style = await call('POST', `/author-profiles/${channel.id}/tov/analyze`, {
    token: author,
    body: { use_llm: false },
  })
  console.log(
    `     профиль стиля: тон «${style.tov_profile.tone}», метрик ${
      Object.keys(style.tov_profile.metrics ?? {}).length
    }, проверено без AI: ${style.verified_without_ai}`,
  )

  step++
  // Создание пустого черновика: контракт допускает text: "", сервер не должен
  // подменять его пробелом — пустота проверяется на lint/publish.
  const emptyDraft = await call('POST', `/author-profiles/${channel.id}/drafts`, {
    token: author,
    body: { title: 'Пустой черновик', text: '' },
  })
  const emptyText = emptyDraft.text
  results[results.length - 1].ok = emptyText === ''
  console.log(
    `     пустой черновик ${emptyDraft.id}: text=${JSON.stringify(emptyText)}` +
      (emptyText === '' ? ' — пустая строка, как в контракте' : ' — ОЖИДАЛАСЬ пустая строка'),
  )
  await call('POST', `/drafts/${emptyDraft.id}/lint`, {
    token: author,
    body: { use_llm: false },
    expect: [422],
  })
  console.log('     проверка пустого текста → 422 empty_text')

  step++
  const generated = await call('POST', `/author-profiles/${channel.id}/drafts/generate`, {
    token: author,
    body: {
      mode: 'notes',
      source_notes:
        'Первый день нового проекта: утром созвон, днём макеты, вечером ретро\n' +
        'Оказалось, что самое сложное — не код, а договориться о терминах\n' +
        'Завёл файл решений: теперь каждое «мы решили» становится строкой с датой\n' +
        'Завтра проверю, помогает ли это не пересматривать одно и то же дважды',
    },
  })
  const draft = generated.draft
  console.log(
    `     черновик ${draft.id}: арка ${generated.build.arc}, блоков ${generated.build.blocks.length}, добавлено движком ${generated.build.added_by_engine.length}`,
  )

  step++
  const lint = await call('POST', `/drafts/${draft.id}/lint`, {
    token: author,
    body: { use_llm: false },
  })
  console.log(
    `     оценка ${lint.lint_report.score}, замечаний ${lint.lint_report.issues.length}, вердикт «${lint.verdict}», engine=${lint.lint_report.engine}`,
  )

  step++
  // Статусы идут по цепочке draft → on_check → ready → published,
  // прыжок через шаг сервер запрещает (422 invalid_transition).
  const checking = await call('PATCH', `/drafts/${draft.id}`, {
    token: author,
    body: { status: 'on_check' },
  })
  const patched = await call('PATCH', `/drafts/${draft.id}`, {
    token: author,
    body: { status: 'ready' },
  })
  console.log(`     статус черновика: ${checking.status} → ${patched.status}`)

  step++
  const published = await call('POST', `/drafts/${draft.id}/publish`, { token: author, body: {} })
  console.log(`     опубликован, пост в архиве: ${(published.post ?? published).id}`)

  step++
  const search = await call(
    'GET',
    `/author-profiles/${channel.id}/knowledge/search?q=${encodeURIComponent('сколько лет в аналитике')}`,
    { token: author },
  )
  console.log(`     RAG: найдено ${search.items.length} фрагментов, модель ${search.query_embedding_model}`)

  step++
  const usage = await call('GET', `/author-profiles/${channel.id}/usage`, { token: author })
  console.log(
    `     расходы: ${usage.spent} из ${usage.monthly_cost_limit ?? '∞'}, warning=${usage.warning}, blocked=${usage.blocked}`,
  )

  step++
  const runs = await call('GET', '/generation-runs?limit=5', { token: author })
  console.log(`     вызовов AI в журнале (свои): ${runs.items.length}`)

  step++
  const goldens = await call('GET', '/golden-dataset?limit=5', { token: admin })
  console.log(`     эталонов доступно админу: ${goldens.items.length}`)

  step++
  const evals = await call('POST', '/evals/run', { token: admin, body: { use_llm: false } })
  console.log(
    `     Evals: эталонов ${evals.summary.goldens}, precision ${evals.summary.precision}, recall ${evals.summary.recall}`,
  )

  step++
  await call('GET', '/golden-dataset', { token: author, expect: [403] })
  console.log('     права: обычный автор к эталонам не допущен (403)')

  step++
  await call('GET', '/users/me', { expect: [401] })
  console.log('     без токена — 401')

  const failed = results.filter((item) => !item.ok).length
  console.log(`\nИтог: ${results.length - failed} из ${results.length} шагов, провалов ${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('\nSmoke остановлен:', error.message)
  process.exitCode = 1
})
