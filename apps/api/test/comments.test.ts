/** Группа 8. Комментарии: ручные, сканирование, дедупликация, 429/502/503. */
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  api,
  authorToken,
  bootstrap,
  cleanupProfiles,
  createProfile,
  installFetchMock,
  textResponse,
} from './helpers.ts'
import { resetScanRateLimits } from '../src/services/rateLimit.ts'

before(async () => {
  await bootstrap()
})

const created: Array<Record<string, unknown>> = []
const tokenRef: { token: string } = { token: '' }

after(async () => {
  resetScanRateLimits()
  if (tokenRef.token) await cleanupProfiles(tokenRef.token, created)
})

async function makeProfile(): Promise<{ token: string; profile: Record<string, unknown> }> {
  const token = await authorToken()
  tokenRef.token = token
  const profile = await createProfile(token)
  created.push(profile)
  return { token, profile }
}

async function makeSource(
  token: string,
  profileId: number,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await api<Record<string, unknown>>(
    'POST',
    `/author-profiles/${String(profileId)}/sources`,
    { token, body },
  )
  if (response.status !== 201) {
    throw new Error(`источник не создан: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return response.body
}

const SCAN_PAGE = `<html><body>
<div class="tgme_widget_message" data-post="scan_demo/201">
  <div class="tgme_widget_message_text js-message_text">Пост, под которым идёт обсуждение регулярности.</div>
</div>
</body></html>`

const DISCUSSION_PAGE = `<html><body>
<div class="tgme_widget_message" data-post="scan_demo/201">
  <div class="tgme_widget_message_text js-message_text">Пост, под которым идёт обсуждение регулярности.</div>
</div>
<div class="tgme_widget_message" data-post="scan_discussion/301">
  <a class="tgme_widget_message_author_name" href="https://t.me/marina">Марина</a>
  <div class="tgme_widget_message_text js-message_text">Как вы удерживаете ритм публикаций?</div>
  <time datetime="2026-10-20T10:00:00+00:00"></time>
</div>
<div class="tgme_widget_message" data-post="scan_discussion/302">
  <a class="tgme_widget_message_author_name" href="https://t.me/denis">Денис</a>
  <div class="tgme_widget_message_text js-message_text">У меня регулярность держится на одной строке заметок в день.</div>
  <time datetime="2026-10-21T10:00:00+00:00"></time>
</div>
</body></html>`

function installScanMock(): () => void {
  return installFetchMock((url) => {
    if (url.includes('t.me/s/scan_demo')) return textResponse(SCAN_PAGE)
    if (url.includes('t.me/scan_demo/201')) return textResponse(DISCUSSION_PAGE)
    throw new Error(`неожиданный URL: ${url}`)
  })
}

test('ручное добавление комментария: external_id = manual:<id>', async () => {
  const { token, profile } = await makeProfile()
  const source = await makeSource(token, Number(profile.id), {
    name: 'Ручной',
    source_type: 'telegram_channel',
    source_url: 'https://t.me/s/manual_comments',
  })
  const base = `/sources/${String(source.id)}/comments`
  const createdComment = await api<Record<string, unknown>>('POST', base, {
    token,
    body: {
      commenter_name: 'Читатель',
      text: 'А как вы это настроили?',
      posted_at: '2026-10-20T10:00:00Z',
    },
  })
  assert.equal(createdComment.status, 201)
  assert.match(String(createdComment.body.external_id), /^manual:\d+$/)

  const list = await api<{ items: Array<{ id: number }> }>('GET', base, { token })
  assert.equal(list.status, 200)
  assert.ok(list.body.items.some((item) => Number(item.id) === Number(createdComment.body.id)))

  const fetched = await api<{ responses_count: number }>(
    'GET',
    `/comments/${String(createdComment.body.id)}`,
    { token },
  )
  assert.equal(fetched.status, 200)
  assert.equal(fetched.body.responses_count, 0)

  const patched = await api<Record<string, unknown>>(
    'PATCH',
    `/comments/${String(createdComment.body.id)}`,
    { token, body: { text: 'Уточнённый вопрос по настройке.' } },
  )
  assert.equal(patched.status, 200)

  const removed = await api('DELETE', `/comments/${String(createdComment.body.id)}`, { token })
  assert.equal(removed.status, 204)
})

test('сканирование Telegram: создание, дедупликация и 429 на частоту', async () => {
  const { token, profile } = await makeProfile()
  const source = await makeSource(token, Number(profile.id), {
    name: 'Сканируемый канал',
    source_type: 'telegram_channel',
    source_url: 'https://t.me/s/scan_demo',
  })
  const scanUrl = `/sources/${String(source.id)}/comments/scan`
  resetScanRateLimits()
  const restore = installScanMock()
  try {
    const first = await api<{
      found: number
      created: number
      duplicates: number
      status: string
      last_scanned_at: string | null
    }>('POST', scanUrl, { token, body: { limit: 100 } })
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.found, 2)
    assert.equal(first.body.created, 2)
    assert.equal(first.body.duplicates, 0)
    assert.equal(first.body.status, 'ok')
    assert.ok(first.body.last_scanned_at)

    const tooFast = await api<{ error: { code: string } }>('POST', scanUrl, {
      token,
      body: { limit: 100 },
    })
    assert.equal(tooFast.status, 429)
    assert.equal(tooFast.body.error.code, 'rate_limited')

    resetScanRateLimits()
    const second = await api<{ created: number; duplicates: number }>('POST', scanUrl, {
      token,
      body: { limit: 100 },
    })
    assert.equal(second.status, 200)
    assert.equal(second.body.created, 0)
    assert.equal(second.body.duplicates, 2)
  } finally {
    restore()
    resetScanRateLimits()
  }
})

test('выключенный источник → 422 source_inactive', async () => {
  const { token, profile } = await makeProfile()
  const source = await makeSource(token, Number(profile.id), {
    name: 'Выключенный',
    source_type: 'telegram_channel',
    source_url: 'https://t.me/s/inactive_demo',
  })
  await api('PATCH', `/sources/${String(source.id)}`, { token, body: { is_active: false } })
  const response = await api<{ error: { details: { reason?: string } } }>(
    'POST',
    `/sources/${String(source.id)}/comments/scan`,
    { token, body: {} },
  )
  assert.equal(response.status, 422)
  assert.equal(response.body.error.details.reason, 'source_inactive')
})

test('Instagram без ключа → 503 not_configured', async () => {
  const { token, profile } = await makeProfile()
  const source = await makeSource(token, Number(profile.id), {
    name: 'Инстаграм без ключа',
    source_type: 'instagram',
    source_url: 'https://instagram.com/p/demo_scan',
  })
  const response = await api<{
    error: { code: string; details: { reason?: string } }
  }>('POST', `/sources/${String(source.id)}/comments/scan`, { token, body: {} })
  assert.equal(response.status, 503)
  assert.equal(response.body.error.code, 'not_configured')
  assert.equal(response.body.error.details.reason, 'not_configured')
})

test('ошибка площадки → 502, last_scan_status=failed с текстом ошибки', async () => {
  const { token, profile } = await makeProfile()
  const source = await makeSource(token, Number(profile.id), {
    name: 'Сломанный канал',
    source_type: 'telegram_channel',
    source_url: 'https://t.me/s/broken_scan',
  })
  const restore = installFetchMock(() => new Response('fail', { status: 500 }))
  try {
    const response = await api<{
      error: { code: string; details: { platform?: string } }
    }>('POST', `/sources/${String(source.id)}/comments/scan`, { token, body: {} })
    assert.equal(response.status, 502)
    assert.equal(response.body.error.code, 'upstream_unavailable')
    assert.equal(response.body.error.details.platform, 'telegram')

    const fetched = await api<{
      last_scan_status: string
      last_scan_error: string | null
    }>('GET', `/sources/${String(source.id)}`, { token })
    assert.equal(fetched.body.last_scan_status, 'failed')
    assert.ok((fetched.body.last_scan_error ?? '').length > 0)
  } finally {
    restore()
  }
})
