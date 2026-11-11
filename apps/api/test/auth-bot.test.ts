/**
 * Вход через Telegram-бота: коды, webhook, опрос статуса.
 *
 * Сеть не используется: Bot API подменяется там, где нужен (sendMessage),
 * а webhook вызывается напрямую, как это сделал бы Telegram.
 */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { api, bootstrap, db, dbOne, nextTelegramId } from './helpers.ts'

const BOT_TOKEN = '123456:test-bot-token-for-webhook'
const BOT_USERNAME = 'blogos_test_bot'
const WEBHOOK_SECRET = 'test-webhook-secret-0123456789'

const saved = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  username: process.env.TELEGRAM_BOT_USERNAME,
  secret: process.env.TELEGRAM_WEBHOOK_SECRET,
  ttl: process.env.LOGIN_CODE_TTL_MINUTES,
}

function setBotEnv({ token = BOT_TOKEN, username = BOT_USERNAME, secret = WEBHOOK_SECRET } = {}) {
  process.env.TELEGRAM_BOT_TOKEN = token
  process.env.TELEGRAM_BOT_USERNAME = username
  process.env.TELEGRAM_WEBHOOK_SECRET = secret
}

function restoreEnv() {
  const entries: Array<[string, string | undefined]> = [
    ['TELEGRAM_BOT_TOKEN', saved.token],
    ['TELEGRAM_BOT_USERNAME', saved.username],
    ['TELEGRAM_WEBHOOK_SECRET', saved.secret],
    ['LOGIN_CODE_TTL_MINUTES', saved.ttl],
  ]
  for (const [key, value] of entries) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

/** Имитация update от Telegram: /start login_<код>. */
function startUpdate(code: string, telegramId: number, firstName = 'Бот-тест') {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: telegramId, type: 'private' },
      from: { id: telegramId, first_name: firstName },
      text: `/start login_${code}`,
    },
  }
}

async function sendWebhook(payload: unknown, secret = WEBHOOK_SECRET) {
  return api('POST', '/telegram/webhook', {
    body: payload,
    headers: { 'x-telegram-bot-api-secret-token': secret },
  })
}

before(async () => {
  await bootstrap()
})

after(() => {
  restoreEnv()
})

test('без настроенного бота старт входа отвечает 503 not_configured', async () => {
  process.env.TELEGRAM_BOT_TOKEN = ''
  process.env.TELEGRAM_BOT_USERNAME = ''
  const response = await api<{ error: { code: string } }>('POST', '/auth/telegram/start', { body: {} })
  assert.equal(response.status, 503)
  assert.equal(response.body.error.code, 'not_configured')
})

test('старт возвращает код, ссылку на бота и срок жизни', async () => {
  setBotEnv()
  const response = await api('POST', '/auth/telegram/start', { body: {} })
  assert.equal(response.status, 201)
  const body = response.body as { code: string; bot_url: string; expires_at: string; ttl_minutes: number }
  assert.match(body.code, /^[0-9a-f]{16}$/)
  assert.equal(body.bot_url, `https://t.me/${BOT_USERNAME}?start=login_${body.code}`)
  // TTL кода входа: 5 минут по умолчанию (было 10 — сократили по аудиту).
  assert.equal(body.ttl_minutes, 5)
  const row = await dbOne<{ status: string }>('SELECT status FROM login_codes WHERE code = $1', [body.code])
  assert.equal(row?.status, 'pending')
})

test('webhook подтверждает код, а статус отдаёт токен', async () => {
  setBotEnv()
  const started = await api('POST', '/auth/telegram/start', { body: {} })
  const code = (started.body as { code: string }).code
  const telegramId = nextTelegramId()

  const pending = await api('GET', `/auth/telegram/status?code=${code}`)
  assert.equal(pending.status, 200)
  assert.equal((pending.body as { status: string }).status, 'pending')

  const hook = await sendWebhook(startUpdate(code, telegramId, 'Мария'))
  assert.equal(hook.status, 200)

  const confirmed = await api('GET', `/auth/telegram/status?code=${code}`)
  assert.equal(confirmed.status, 200)
  const body = confirmed.body as { status: string; token: string; user: { telegram_id: number; name: string } }
  assert.equal(body.status, 'confirmed')
  assert.equal(body.user.telegram_id, telegramId)
  assert.equal(body.user.name, 'Мария')
  assert.ok(body.token)

  // Токен из статуса — рабочий: им открывается профиль.
  const me = await api('GET', '/users/me', { token: body.token })
  assert.equal(me.status, 200)
  assert.equal((me.body as { telegram_id: number }).telegram_id, telegramId)

  // Код одноразовый: повторный /start с ним не перепривязывает вход.
  const otherId = nextTelegramId()
  const second = await sendWebhook(startUpdate(code, otherId))
  assert.equal(second.status, 200)
  const afterSecond = await dbOne<{ telegram_id: string | number }>(
    'SELECT telegram_id FROM login_codes WHERE code = $1',
    [code],
  )
  assert.equal(Number(afterSecond?.telegram_id), telegramId)

  await api('DELETE', '/users/me', { token: body.token })
})

test('Второй опрос статуса не выдаёт токен (код одноразовый)', async () => {
  setBotEnv()
  const started = await api('POST', '/auth/telegram/start', { body: {} })
  const code = (started.body as { code: string }).code

  const hook = await sendWebhook(startUpdate(code, nextTelegramId()))
  assert.equal(hook.status, 200)

  const first = await api<{ status: string; token?: string }>('GET', `/auth/telegram/status?code=${code}`)
  assert.equal(first.status, 200)
  assert.equal(first.body.status, 'confirmed')
  assert.ok(first.body.token)

  // Код одноразовый: повторный опрос токен не выдаёт.
  const second = await api<{ status: string; token?: string }>('GET', `/auth/telegram/status?code=${code}`)
  assert.equal(second.status, 200)
  assert.equal(second.body.status, 'used')
  assert.equal(second.body.token, undefined)
})

test('webhook без секрета и с неверным секретом отклоняется', async () => {
  setBotEnv()
  const started = await api('POST', '/auth/telegram/start', { body: {} })
  const code = (started.body as { code: string }).code

  const noSecret = await api('POST', '/telegram/webhook', { body: startUpdate(code, nextTelegramId()) })
  assert.equal(noSecret.status, 401)

  const wrongSecret = await sendWebhook(startUpdate(code, nextTelegramId()), 'not-the-secret')
  assert.equal(wrongSecret.status, 401)

  // Код после отклонённых запросов остаётся свободным.
  const row = await dbOne<{ status: string }>('SELECT status FROM login_codes WHERE code = $1', [code])
  assert.equal(row?.status, 'pending')
})

test('просроченный код не подтверждается и статус отдаёт expired', async () => {
  setBotEnv()
  const started = await api('POST', '/auth/telegram/start', { body: {} })
  const code = (started.body as { code: string }).code
  await db(`UPDATE login_codes SET expires_at = now() - interval '1 minute' WHERE code = $1`, [code])

  const hook = await sendWebhook(startUpdate(code, nextTelegramId()))
  assert.equal(hook.status, 200)
  const row = await dbOne<{ status: string }>('SELECT status FROM login_codes WHERE code = $1', [code])
  assert.equal(row?.status, 'pending', 'просроченный код не должен подтверждаться')

  const status = await api('GET', `/auth/telegram/status?code=${code}`)
  assert.equal(status.status, 200)
  assert.equal((status.body as { status: string }).status, 'expired')
})

test('неизвестный код: статус 400, уведомление бота без падения', async () => {
  setBotEnv()
  const unknown = await api('GET', '/auth/telegram/status?code=0123456789abcdef')
  assert.equal(unknown.status, 400)
  assert.equal((unknown.body as { error: { details: { reason: string } } }).error.details.reason, 'code_not_found')

  const hook = await sendWebhook(startUpdate('fedcba9876543210', nextTelegramId()))
  assert.equal(hook.status, 200)
})

test('обычное сообщение боту не ломает webhook', async () => {
  setBotEnv()
  const response = await sendWebhook({
    update_id: 2,
    message: {
      message_id: 2,
      chat: { id: nextTelegramId(), type: 'private' },
      from: { id: 1, first_name: 'Кто-то' },
      text: 'привет',
    },
  })
  assert.equal(response.status, 200)
})

test('код из статуса нельзя подделать: несуществующий код не даёт токен', async () => {
  setBotEnv()
  const fake = await api('GET', '/auth/telegram/status?code=aaaaaaaaaaaaaaaa')
  assert.equal(fake.status, 400)
  assert.equal((fake.body as { token?: string }).token, undefined)
})
