/**
 * Онбординг в Telegram-боте: анализ канала по ссылке прямо в чате.
 *
 * Сеть не используется: импорт t.me/s/<channel> и Bot API (sendMessage)
 * подменяются через installFetchMock. Команда /start login_<код> должна
 * продолжать работать как раньше — это отдельная проверка ниже.
 */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  NO_POSTS_REPLY,
  handleBotMessage,
  parseChannelLink,
} from '../src/services/telegramOnboarding.ts'
import {
  api,
  bootstrap,
  db,
  dbOne,
  installFetchMock,
  jsonResponse,
  nextTelegramId,
  textResponse,
} from './helpers.ts'

const BOT_TOKEN = '999001:test-onboarding-token'
const BOT_USERNAME = 'blogos_onboarding_test_bot'
const WEBHOOK_SECRET = 'test-onboarding-webhook-secret'

const saved = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  username: process.env.TELEGRAM_BOT_USERNAME,
  secret: process.env.TELEGRAM_WEBHOOK_SECRET,
}

function setBotEnv(): void {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN
  process.env.TELEGRAM_BOT_USERNAME = BOT_USERNAME
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET
}

function restoreEnv(): void {
  for (const [key, value] of [
    ['TELEGRAM_BOT_TOKEN', saved.token],
    ['TELEGRAM_BOT_USERNAME', saved.username],
    ['TELEGRAM_WEBHOOK_SECRET', saved.secret],
  ] as Array<[string, string | undefined]>) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

/** Приватное сообщение боту, как его присылает Telegram. */
function privateUpdate(text: string, telegramId: number, firstName = 'Автор') {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      chat: { id: telegramId, type: 'private' },
      from: { id: telegramId, first_name: firstName },
      text,
    },
  }
}

async function sendWebhook(payload: unknown) {
  return api('POST', '/telegram/webhook', {
    body: payload,
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
  })
}

interface TelegramMock {
  sent: string[]
  restore: () => void
}

/**
 * Подменяет сеть: Bot API отвечает ok, страница канала отдаётся по htmlFor.
 * Возвращает тексты sendMessage, чтобы проверять ответы бота.
 */
function mockTelegram(htmlFor?: (url: string) => string | null): TelegramMock {
  const sent: string[] = []
  const restore = installFetchMock((url, init) => {
    if (url.includes('/sendMessage')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { text?: string }
      sent.push(String(body.text ?? ''))
      return jsonResponse({ ok: true, result: { message_id: sent.length } })
    }
    const html = htmlFor?.(url)
    if (html) return textResponse(html)
    return new Response('not found', { status: 404 })
  })
  return { sent, restore }
}

const CHANNEL = 'onboarding_style_demo'
const CHANNEL_PAGE = `<html><body>
<div class="tgme_widget_message" data-post="${CHANNEL}/101">
  <div class="tgme_widget_message_text js-message_text">Контент и стиль важнее громких обещаний. Я пишу про контент, который помогает людям разобраться в сложном. Хороший контент экономит время читателя и держит внимание до последней строки.</div>
  <a class="tgme_widget_message_date" href="https://t.me/${CHANNEL}/101"><time datetime="2026-10-01T10:00:00+00:00"></time></a>
</div>
<div class="tgme_widget_message" data-post="${CHANNEL}/102">
  <div class="tgme_widget_message_text js-message_text">Сегодня расскажу, как контент превращается в систему. Мой стиль — короткие фразы и честные примеры. Контент без структуры теряет смысл, поэтому сначала план, потом текст.</div>
  <a class="tgme_widget_message_date" href="https://t.me/${CHANNEL}/102"><time datetime="2026-10-02T10:00:00+00:00"></time></a>
</div>
<div class="tgme_widget_message" data-post="${CHANNEL}/103">
  <div class="tgme_widget_message_text js-message_text">Стиль канала складывается из мелочей: ритм, длина фраз, любимые слова. Контент и стиль работают вместе, когда автор уважает время читателя. Пишу просто и по делу, без воды.</div>
  <a class="tgme_widget_message_date" href="https://t.me/${CHANNEL}/103"><time datetime="2026-10-03T10:00:00+00:00"></time></a>
</div>
</body></html>`

const EMPTY_CHANNEL = 'onboarding_empty_demo'
const EMPTY_CHANNEL_PAGE = `<html><body>
<div class="tgme_widget_message" data-post="${EMPTY_CHANNEL}/1">
  <div class="tgme_widget_message_text js-message_text">Единственный пост канала, которого мало для анализа стиля.</div>
</div>
</body></html>`

before(async () => {
  await bootstrap()
})

after(() => {
  restoreEnv()
})

test('разбор ссылки на канал: валидные и невалидные варианты', () => {
  assert.deepEqual(parseChannelLink('https://t.me/my_channel'), {
    channel: 'my_channel',
    url: 'https://t.me/my_channel',
  })
  assert.deepEqual(parseChannelLink('t.me/s/my_channel'), {
    channel: 'my_channel',
    url: 'https://t.me/my_channel',
  })
  assert.deepEqual(parseChannelLink('посмотрите https://t.me/my_channel?start=1'), {
    channel: 'my_channel',
    url: 'https://t.me/my_channel',
  })

  assert.equal(parseChannelLink('https://t.me/ab'), null, 'имя короче 3 символов')
  assert.equal(parseChannelLink('https://example.com/my_channel'), null, 'чужая площадка')
  assert.equal(parseChannelLink('https://t.me/'), null, 'имя не указано')
  assert.equal(parseChannelLink('привет'), null)
  assert.equal(parseChannelLink(''), null)
})

test('онбординг не перехватывает прочие сообщения и команду входа', async () => {
  const stranger = await handleBotMessage({ message: privateUpdate('привет', 1).message })
  assert.deepEqual(stranger, { handled: false })

  const login = await handleBotMessage({
    message: privateUpdate('/start login_0123456789abcdef', 1).message,
  })
  assert.deepEqual(login, { handled: false })
})

test('webhook: /start без кода → приветствие с инструкцией, 200', async () => {
  setBotEnv()
  const mock = mockTelegram()
  try {
    const response = await sendWebhook(privateUpdate('/start', nextTelegramId(), 'Мария'))
    assert.equal(response.status, 200)
    assert.equal(mock.sent.length, 1)
    assert.match(mock.sent[0]!, /Привет, Мария!/)
    assert.match(
      mock.sent[0]!,
      /Пришлите ссылку на свой канал \(https:\/\/t\.me\/имя_канала\) — разберу стиль и покажу карточку\./,
    )
  } finally {
    mock.restore()
  }
})

test('webhook: сбой отправки ответа не роняет webhook', async () => {
  setBotEnv()
  // Сеть недоступна: callApi делает две попытки, sendMessage глотает ошибку.
  const restore = installFetchMock(() => {
    throw new Error('network down')
  })
  try {
    const response = await sendWebhook(privateUpdate('/start', nextTelegramId()))
    assert.equal(response.status, 200)
  } finally {
    restore()
  }
})

test('webhook: ссылка на публичный канал → карточка стиля и записи в БД', async () => {
  setBotEnv()
  const telegramId = nextTelegramId()
  const mock = mockTelegram((url) => (url.includes(`t.me/s/${CHANNEL}`) ? CHANNEL_PAGE : null))
  try {
    const response = await sendWebhook(privateUpdate(`https://t.me/${CHANNEL}`, telegramId))
    assert.equal(response.status, 200)
    assert.equal(mock.sent.length, 1)

    const reply = mock.sent[0]!
    assert.match(reply, /Готово!/)
    assert.match(reply, /Обращение:/)
    assert.match(reply, /Средняя длина фразы: \d/)
    assert.match(reply, /Главные темы:/)
    assert.match(reply, /Дальше: откройте сайт и нажмите «Собрать черновик»\./)

    const user = await dbOne<{ id: number }>('SELECT id FROM users WHERE telegram_id = $1', [
      telegramId,
    ])
    assert.ok(user, 'пользователь создан по telegram_id')

    const profile = await dbOne<{ id: number; user_id: number; name: string; platform: string }>(
      'SELECT id, user_id, name, platform FROM author_profiles WHERE name = $1',
      [CHANNEL],
    )
    assert.ok(profile, 'канал создан с названием по имени канала')
    assert.equal(Number(profile.user_id), Number(user.id))
    assert.equal(profile.platform, 'telegram')

    const tov = await dbOne<{
      tone: string
      metrics: Record<string, unknown> | null
      analyzed_at: string | null
    }>('SELECT tone, metrics, analyzed_at FROM tov_profiles WHERE author_id = $1', [profile.id])
    assert.ok(tov, 'профиль стиля сохранён')
    assert.ok(tov.metrics, 'метрики стиля сохранены')
    assert.ok(['ты', 'вы', 'смешанное'].includes(tov.tone))
    assert.ok(tov.analyzed_at)

    // Повторная ссылка на тот же канал: профиль находится, второй не создаётся.
    const again = await sendWebhook(privateUpdate(`https://t.me/${CHANNEL}`, telegramId))
    assert.equal(again.status, 200)
    assert.equal(mock.sent.length, 2)
    const count = await dbOne<{ count: number }>(
      'SELECT count(*)::int AS count FROM author_profiles WHERE name = $1',
      [CHANNEL],
    )
    assert.equal(Number(count?.count), 1)
  } finally {
    mock.restore()
    await db('DELETE FROM users WHERE telegram_id = $1', [telegramId])
  }
})

test('webhook: канал без постов → «Не вижу постов», канал не создаётся', async () => {
  setBotEnv()
  const telegramId = nextTelegramId()
  const mock = mockTelegram((url) =>
    url.includes(`t.me/s/${EMPTY_CHANNEL}`) ? EMPTY_CHANNEL_PAGE : null,
  )
  try {
    const response = await sendWebhook(privateUpdate(`https://t.me/${EMPTY_CHANNEL}`, telegramId))
    assert.equal(response.status, 200)
    assert.equal(mock.sent.length, 1)
    assert.match(mock.sent[0]!, new RegExp(NO_POSTS_REPLY))

    const profile = await dbOne('SELECT id FROM author_profiles WHERE name = $1', [EMPTY_CHANNEL])
    assert.equal(profile, null)
  } finally {
    mock.restore()
  }
})

test('webhook: /start login_<код> по-прежнему подтверждает вход', async () => {
  setBotEnv()
  const mock = mockTelegram()
  try {
    const started = await api('POST', '/auth/telegram/start', { body: {} })
    assert.equal(started.status, 201)
    const code = (started.body as { code: string }).code
    const telegramId = nextTelegramId()

    const hook = await sendWebhook(privateUpdate(`/start login_${code}`, telegramId, 'Иван'))
    assert.equal(hook.status, 200)

    const status = await api<{ status: string; token?: string; user?: { telegram_id: number } }>(
      'GET',
      `/auth/telegram/status?code=${code}`,
    )
    assert.equal(status.status, 200)
    assert.equal(status.body.status, 'confirmed')
    assert.equal(status.body.user?.telegram_id, telegramId)
    assert.ok(status.body.token)

    await api('DELETE', '/users/me', { token: status.body.token })
  } finally {
    mock.restore()
  }
})
