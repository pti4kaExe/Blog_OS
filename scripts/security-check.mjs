// Живые проверки безопасности: что уже включено, что ждёт деплоя API.
const API = 'https://blogos-api-shlm.onrender.com'
const results = []
const add = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'WAIT'} ${name}${detail ? ' — ' + detail : ''}`)
}

const get = async (path, options = {}) => {
  try {
    const response = await fetch(API + path, { signal: AbortSignal.timeout(70000), ...options })
    return { status: response.status, headers: response.headers, text: await response.text() }
  } catch (error) {
    return { status: 0, headers: new Headers(), text: '', error: String(error.cause ?? error.message) }
  }
}

// 0. Сервер жив?
const health = await get('/health?light=1')
add('API отвечает', health.status === 200, `HTTP ${health.status}`)

let body = {}
try { body = JSON.parse(health.text) } catch {}
add('новый лёгкий /health', body.db === 'skipped', `db=${body.db ?? '—'}`)
add('/health не раскрывает провайдеров', body.llm === undefined && body.embeddings === undefined,
  body.llm ? `llm=${body.llm}` : 'скрыто')

// 1. Заголовки безопасности
const h = health.headers ?? new Headers()
add('x-content-type-options: nosniff', h.get('x-content-type-options') === 'nosniff')
add('x-frame-options: DENY', h.get('x-frame-options') === 'DENY')
add('referrer-policy: no-referrer', h.get('referrer-policy') === 'no-referrer')
add('HSTS', Boolean(h.get('strict-transport-security')), h.get('strict-transport-security') ?? '—')

// 2. CORS
const evil = await get('/health?light=1', { headers: { origin: 'https://evil.example' } })
add('чужой origin не разрешён', !evil.headers.get('access-control-allow-origin'),
  evil.headers.get('access-control-allow-origin') ?? 'нет заголовка')
const own = await get('/health?light=1', { headers: { origin: 'https://pti4kaexe.github.io' } })
add('свой origin разрешён', own.headers.get('access-control-allow-origin') === 'https://pti4kaexe.github.io',
  own.headers.get('access-control-allow-origin') ?? 'нет')

// 3. Dev-вход выключен
const dev = await get('/auth/telegram', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ telegram_id: 200600, name: 'проверка' }),
})
add('dev-вход закрыт', dev.status === 400 && dev.text.includes('dev_auth_disabled'), `HTTP ${dev.status}`)

// 4. Поддельный токен
const fake = await get('/users/me', { headers: { authorization: 'Bearer fake.token.value' } })
add('поддельный JWT отклонён', fake.status === 401, `HTTP ${fake.status}`)

// 5. Ошибки не раскрывают внутренности
const notFound = await get('/users/me')
add('ошибка без стека/внутренностей', !/at |stack|constraint/i.test(notFound.text), notFound.text.slice(0, 60))

// 6. Лимит запросов (проверяем на публичном старте: 12 запросов подряд)
let limited = false
let lastStatuses = []
for (let i = 0; i < 12; i++) {
  const response = await get('/auth/telegram/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  lastStatuses.push(response.status)
  if (response.status === 429) { limited = true; break }
}
add('лимит на старт кодов', limited, lastStatuses.join(','))

// 7. Одноразовость кода проверить нельзя без Telegram-подтверждения — нужна ручная проверка
console.log('\nИтог: ' + results.filter((r) => r.ok).length + ' из ' + results.length + ' проверок пройдено')
const waiting = results.filter((r) => !r.ok)
if (waiting.length) {
  console.log('\nЖдут деплоя API (Manual Deploy в Render):')
  for (const item of waiting) console.log('  - ' + item.name)
}
