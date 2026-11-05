/**
 * Обсуждения Telegram: честный отказ публичного виджета и приём сообщений
 * из чата, в который добавлен бот.
 */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { TelegramAdapter } from '../src/services/adapters/telegram.ts'
import {
  api,
  bootstrap,
  cleanupProfiles,
  freshUser,
  installFetchMock,
  textResponse,
} from './helpers.ts'

const BOT_TOKEN = '123456:test-token'
const BOT_USERNAME = 'blogos_test_bot'
const WEBHOOK_SECRET = 'test-secret-comments'

const saved = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  username: process.env.TELEGRAM_BOT_USERNAME,
  secret: process.env.TELEGRAM_WEBHOOK_SECRET,
}

let token = ''
let profileId = 0
const createdProfiles: Array<Record<string, unknown>> = []

before(async () => {
  await bootstrap()
  const owner = await freshUser('Источники')
  token = owner.token
  const profile = await api<{ id: number }>('POST', '/author-profiles', {
    token,
    body: { name: 'Канал с чатом', platform: 'telegram' },
  })
  profileId = Number(profile.body.id)
  createdProfiles.push({ id: profileId })
})

after(async () => {
  for (const [key, value] of [
    ['TELEGRAM_BOT_TOKEN', saved.token],
    ['TELEGRAM_BOT_USERNAME', saved.username],
    ['TELEGRAM_WEBHOOK_SECRET', saved.secret],
  ] as Array<[string, string | undefined]>) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (token) {
    if (createdProfiles.length) await cleanupProfiles(token, createdProfiles)
    await api('DELETE', '/users/me', { token })
  }
})

/** В общем процессе тестовых файлов env меняют соседи, поэтому ставим перед вызовом. */
function setBotEnv() {
  process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN
  process.env.TELEGRAM_BOT_USERNAME = BOT_USERNAME
  process.env.TELEGRAM_WEBHOOK_SECRET = WEBHOOK_SECRET
}

const COMMENT_WIDGET_CLOSED = `
<html><body><div class="tgme_widget_message">
<div class="tgme_widget_message_text">пост канала</div>
<div class="tgme_widget_message_error">Comments Discussion is not available at the moment.</div>
</div></body></html>`

const CHANNEL_PAGE = `
<div class="tgme_widget_message" data-post="demo_channel/10">
  <div class="tgme_widget_message_text">Пост номер десять</div>
</div>`

test('адаптер распознаёт отключённый публичный виджет обсуждений', async () => {
  const restore = installFetchMock((url) => {
    if (url.includes('t.me/s/')) return textResponse(CHANNEL_PAGE)
    if (url.includes('embed=1')) return textResponse(COMMENT_WIDGET_CLOSED)
    return textResponse('')
  })
  try {
    const adapter = new TelegramAdapter()
    await assert.rejects(
      adapter.scanComments({ sourceUrl: 'https://t.me/demo_channel', limit: 10 }),
      (error: unknown) => {
        const typed = error as { name?: string; reason?: string }
        assert.equal(typed.name, 'DiscussionsUnavailableError')
        assert.equal(typed.reason, 'telegram_discussions_closed')
        return true
      },
    )
  } finally {
    restore()
  }
})

test('сканирование канала отвечает 200 с причиной, а не «обсуждений нет»', async () => {
  const source = await api<{ id: number }>('POST', `/author-profiles/${profileId}/sources`, {
    token,
    body: {
      name: 'Канал без публичных обсуждений',
      source_type: 'telegram_channel',
      source_url: 'https://t.me/demo_channel',
    },
  })
  assert.equal(source.status, 201)
  const sourceId = Number((source.body as { id: number }).id)

  const restore = installFetchMock((url) => {
    if (url.includes('t.me/s/')) return textResponse(CHANNEL_PAGE)
    if (url.includes('embed=1')) return textResponse(COMMENT_WIDGET_CLOSED)
    return textResponse('')
  })
  try {
    const scan = await api<{ status: string; found: number; reason: string; hint: string }>(
      'POST',
      `/sources/${sourceId}/comments/scan`,
      { token, body: { limit: 10 } },
    )
    assert.equal(scan.status, 200)
    const body = scan.body
    assert.equal(body.status, 'unavailable')
    assert.equal(body.found, 0)
    assert.equal(body.reason, 'telegram_discussions_closed')
    assert.match(body.hint, /вручную|бот/i)
  } finally {
    restore()
  }

  const sourceAfter = await api<{ last_scan_status: string; last_scan_error: string }>(
    'GET',
    `/sources/${sourceId}`,
    { token },
  )
  assert.equal(sourceAfter.body.last_scan_status, 'failed')
  assert.match(String(sourceAfter.body.last_scan_error), /виджет|обсуждени/i)
})

test('сообщение из чата с ботом сохраняется как комментарий источника', async () => {
  setBotEnv()
  const source = await api<{ id: number }>('POST', `/author-profiles/${profileId}/sources`, {
    token,
    body: {
      name: 'Чат обсуждений канала',
      source_type: 'telegram_chat',
      source_url: 'https://t.me/blogos_test_chat',
    },
  })
  const sourceId = Number((source.body as { id: number }).id)

  const update = {
    update_id: 501,
    message: {
      message_id: 77,
      date: 1762345678,
      chat: { id: -1001234567890, type: 'supergroup', username: 'BlogOS_Test_Chat', title: 'Чат канала' },
      from: { id: 555000111, first_name: 'Читатель', is_bot: false },
      text: 'А как вы настроили проверку перед публикацией?',
    },
  }
  const hook = await api('POST', '/telegram/webhook', {
    body: update,
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
  })
  assert.equal(hook.status, 200)

  const list = await api<{ items: Array<{ text: string; commenter_name: string }> }>(
    'GET',
    `/sources/${sourceId}/comments`,
    { token },
  )
  assert.equal(list.body.items.length, 1)
  assert.equal(list.body.items[0]?.text, 'А как вы настроили проверку перед публикацией?')
  assert.equal(list.body.items[0]?.commenter_name, 'Читатель')

  // Повторная доставка того же update не создаёт дубль.
  await api('POST', '/telegram/webhook', {
    body: update,
    headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
  })
  const again = await api<{ items: unknown[] }>('GET', `/sources/${sourceId}/comments`, { token })
  assert.equal(again.body.items.length, 1)
})

test('команды и сообщения ботов в чате не становятся комментариями', async () => {
  setBotEnv()
  const source = await api<{ id: number }>('POST', `/author-profiles/${profileId}/sources`, {
    token,
    body: {
      name: 'Чат с командами',
      source_type: 'telegram_chat',
      source_url: '@blogos_test_chat',
    },
  })
  const sourceId = Number((source.body as { id: number }).id)

  for (const text of ['/start', '/help']) {
    await api('POST', '/telegram/webhook', {
      body: {
        update_id: 600 + text.length,
        message: {
          message_id: 90 + text.length,
          date: 1762345678,
          chat: { id: -1001234567890, type: 'supergroup', username: 'blogos_test_chat' },
          from: { id: 555000111, first_name: 'Читатель' },
          text,
        },
      },
      headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
    })
  }

  const list = await api<{ items: unknown[] }>('GET', `/sources/${sourceId}/comments`, { token })
  assert.equal(list.body.items.length, 0)
})
