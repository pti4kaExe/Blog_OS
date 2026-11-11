/**
 * Проверка живости и базовых заголовков безопасности.
 *
 * Отдельный файл, потому что это сквозные вещи приложения, а не доменный
 * сценарий: конверт ошибок, CORS, health и защитные заголовки.
 */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { api, bootstrap } from './helpers.ts'
import { resetAuthRateLimits } from '../src/services/authRateLimit.ts'

before(async () => {
  await bootstrap()
})

after(async () => {
  // базу закрывает общий после-хук helpers
})

test('GET /health отвечает и отдаёт флаги входа', async () => {
  const response = await api<{ status: string; db: string; telegram_auth: boolean; dev_auth: boolean }>('GET', '/health')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
  assert.equal(response.body.db, 'ok')
  assert.equal(typeof response.body.telegram_auth, 'boolean')
  assert.equal(typeof response.body.dev_auth, 'boolean')
})

test('GET /health?light=1 не трогает базу и остаётся быстрым', async () => {
  const response = await api<{ status: string; db: string }>('GET', '/health?light=1')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
  // База не проверялась: этим режимом пользуется прогрев, чтобы не будить Neon.
  assert.equal(response.body.db, 'skipped')
})

test('ответы API несут защитные заголовки', async () => {
  const response = await api('GET', '/health?light=1')
  const headers = response.headers ?? {}
  assert.equal(headers['x-content-type-options'], 'nosniff')
  assert.equal(headers['x-frame-options'], 'DENY')
  assert.equal(headers['referrer-policy'], 'no-referrer')
  assert.match(String(headers['permissions-policy'] ?? ''), /camera=\(\)/)
  assert.equal(headers['cross-origin-opener-policy'], 'same-origin')
})

test('CORS пускает клиентский origin и не пускает посторонний', async () => {
  const allowed = await api('GET', '/health?light=1', {
    headers: { origin: 'http://localhost:5173' },
  })
  assert.equal(allowed.headers?.['access-control-allow-origin'], 'http://localhost:5173')

  const foreign = await api('GET', '/health?light=1', {
    headers: { origin: 'https://evil.example' },
  })
  // Посторонний origin не получает разрешения: браузер заблокирует ответ.
  assert.equal(foreign.headers?.['access-control-allow-origin'], undefined)
})

test('слишком большое тело запроса отклоняется, а не съедается памятью', async () => {
  const big = 'x'.repeat(600 * 1024) // 600 КБ > лимита 512 КБ
  const response = await api('POST', '/auth/telegram', {
    body: { telegram_id: 1, name: big },
  })
  assert.ok([400, 413].includes(response.status), `ожидали 400/413, получили ${response.status}`)
})

test('общий лимит запросов: сверх лимита с одного IP → 429, а /health не считается', async () => {
  process.env.RATE_LIMIT_PER_MINUTE = '3'
  resetAuthRateLimits()
  try {
    for (let index = 0; index < 3; index++) {
      const response = await api('GET', '/users/me')
      assert.equal(response.status, 401)
    }
    const blocked = await api<{ error: { code: string } }>('GET', '/users/me')
    assert.equal(blocked.status, 429)
    assert.equal(blocked.body.error.code, 'rate_limited')

    // Проверка живости исключена из лимита: её дёргает прогрев и мониторинг.
    const health = await api('GET', '/health?light=1')
    assert.equal(health.status, 200)
  } finally {
    delete process.env.RATE_LIMIT_PER_MINUTE
    resetAuthRateLimits()
  }
})

test('CORS пускает второй origin из списка (не только первый)', async () => {
  const second = await api('GET', '/health?light=1', {
    headers: { origin: 'http://127.0.0.1:5173' },
  })
  assert.equal(second.headers?.['access-control-allow-origin'], 'http://127.0.0.1:5173')
})
