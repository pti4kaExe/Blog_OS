/**
 * Тонкий клиент BlogOS API.
 *
 * Задачи клиента:
 *  - хранить адрес сервера и JWT (localStorage, ключ `blogos.token.v1`);
 *  - единообразно разбирать конверт ошибок `{ error: { code, message, details } }`
 *    в объект `ApiError{ status, code, message, details }`;
 *  - не падать при сетевом сбое: вместо исключения fetch наружу выходит
 *    понятная ошибка «сервер недоступен» (offline: true), по которой интерфейс
 *    предлагает локальный режим;
 *  - ограничивать каждый запрос таймаутом через AbortController.
 *
 * Контракт методов — docs/API.md (59 методов, 11 групп). Все ответы-списки
 * приходят как `{ items, next_cursor }`, но клиент дополнительно принимает
 * голый массив — сервер и клиент развиваются параллельно.
 */

const DEFAULT_BASE = 'http://localhost:3000'
export const TOKEN_KEY = 'blogos.token.v1'
const DEFAULT_TIMEOUT = 20000

/** Адрес API: `VITE_API_URL` из .env, по умолчанию локальный сервер. */
export const API_BASE = String(
  (import.meta && import.meta.env && import.meta.env.VITE_API_URL) || DEFAULT_BASE,
).replace(/\/+$/, '')

/* -------------------------------- токен ----------------------------------- */

function readStorage(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // приватный режим браузера: просто работаем без сохранения
  }
}

export function getToken() {
  return readStorage(TOKEN_KEY) || null
}

export function setToken(token) {
  writeStorage(TOKEN_KEY, token || null)
}

export function clearToken() {
  writeStorage(TOKEN_KEY, null)
}

/* ------------------------------- ошибки ----------------------------------- */

const STATUS_CODES = {
  400: 'validation_error',
  401: 'unauthorized',
  402: 'ai_budget_exceeded',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  429: 'rate_limited',
  500: 'internal',
  502: 'platform_error',
  503: 'unavailable',
}

/**
 * Ошибка API. `status = 0` и `offline = true` — сервер недоступен или не ответил.
 */
export class ApiError extends Error {
  constructor({ status = 0, code = 'internal', message = '', details = null, offline = false } = {}) {
    super(message || 'Ошибка запроса')
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.offline = offline
  }
}

export function isApiError(error) {
  return error instanceof ApiError
}

function networkError(timedOut) {
  return new ApiError({
    status: 0,
    code: timedOut ? 'timeout' : 'network_error',
    offline: true,
    message: timedOut
      ? 'Сервер не ответил за 20 секунд'
      : 'Сервер недоступен',
  })
}

function buildQuery(query) {
  if (!query) return ''
  const parts = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    }
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

/* ------------------------------- запрос ----------------------------------- */

async function request(method, path, { body, query, timeout = DEFAULT_TIMEOUT } = {}) {
  const url = `${API_BASE}${path}${buildQuery(query)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    throw networkError(error && error.name === 'AbortError')
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 204) return null

  let payload = null
  const raw = await response.text().catch(() => '')
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = { raw }
    }
  }

  if (!response.ok) {
    const envelope = payload && typeof payload === 'object' ? payload.error : null
    throw new ApiError({
      status: response.status,
      code: (envelope && envelope.code) || STATUS_CODES[response.status] || 'internal',
      message:
        (envelope && envelope.message) ||
        (raw && raw.length < 300 ? raw : '') ||
        `Ошибка сервера (${response.status})`,
      details: envelope && envelope.details !== undefined ? envelope.details : null,
    })
  }

  return payload
}

const get = (path, query) => request('GET', path, { query })
const post = (path, body, options) => request('POST', path, { ...options, body })
const patch = (path, body) => request('PATCH', path, { body })
const put = (path, body) => request('PUT', path, { body })
const del = (path) => request('DELETE', path)

/* ----------------------- нормализация идентификаторов ---------------------- */

/**
 * Идентификаторы приходят `number` или строкой (bigint > 2^53).
 * Для URL приводим к строке, чтобы не зависеть от типа.
 */
const id = (value) => encodeURIComponent(String(value))

/** Список: `{items, next_cursor}` или массив. */
export function itemsOf(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.items)) return payload.items
  return []
}

/* --------------------------------- API ------------------------------------ */

export const api = {
  baseUrl: API_BASE,
  token: { get: getToken, set: setToken, clear: clearToken },
  itemsOf,

  /** Служебная проверка доступности сервера (для баннера «облако недоступно»). */
  async health(timeout = 6000) {
    return request('GET', '/health', { timeout })
  },

  /** Проверяет, что сервер отвечает. Не падает: возвращает {reachable, error}. */
  async probe(timeout = 6000) {
    try {
      await request('GET', '/health', { timeout })
      return { reachable: true, error: null }
    } catch (error) {
      if (isApiError(error) && !error.offline) return { reachable: true, error: null }
      return { reachable: false, error }
    }
  },

  /* 1. Вход и пользователь — 4 метода */
  auth: {
    /** `{initData}` для Telegram или `{telegram_id, name}` в DEV_AUTH=1. */
    telegram: (body) => post('/auth/telegram', body),
  },
  users: {
    me: () => get('/users/me'),
    updateMe: (body) => patch('/users/me', body),
    deleteMe: () => del('/users/me'),
  },

  /* 2. Каналы (author_profiles) — 6 методов */
  profiles: {
    list: (query) => get('/author-profiles', query),
    create: (body) => post('/author-profiles', body),
    get: (profileId) => get(`/author-profiles/${id(profileId)}`),
    update: (profileId, body) => patch(`/author-profiles/${id(profileId)}`, body),
    remove: (profileId) => del(`/author-profiles/${id(profileId)}`),
    usage: (profileId) => get(`/author-profiles/${id(profileId)}/usage`),
  },

  /* 3. Стиль — 3 метода */
  tov: {
    get: (profileId) => get(`/author-profiles/${id(profileId)}/tov`),
    put: (profileId, body) => put(`/author-profiles/${id(profileId)}/tov`, body),
    analyze: (profileId, body) => post(`/author-profiles/${id(profileId)}/tov/analyze`, body),
  },

  /* 4. Посты — 6 методов */
  posts: {
    list: (profileId, query) => get(`/author-profiles/${id(profileId)}/posts`, query),
    create: (profileId, body) => post(`/author-profiles/${id(profileId)}/posts`, body),
    get: (profileId, postId) => get(`/author-profiles/${id(profileId)}/posts/${id(postId)}`),
    update: (profileId, postId, body) => patch(`/author-profiles/${id(profileId)}/posts/${id(postId)}`, body),
    remove: (profileId, postId) => del(`/author-profiles/${id(profileId)}/posts/${id(postId)}`),
    import: (profileId, body) => post(`/author-profiles/${id(profileId)}/posts/import`, body),
  },

  /* 5. Черновики — 7 методов */
  drafts: {
    list: (profileId, query) => get(`/author-profiles/${id(profileId)}/drafts`, query),
    create: (profileId, body) => post(`/author-profiles/${id(profileId)}/drafts`, body),
    get: (draftId) => get(`/drafts/${id(draftId)}`),
    update: (draftId, body) => patch(`/drafts/${id(draftId)}`, body),
    remove: (draftId) => del(`/drafts/${id(draftId)}`),
    generate: (profileId, body) => post(`/author-profiles/${id(profileId)}/drafts/generate`, body),
    publish: (draftId, body) => post(`/drafts/${id(draftId)}/publish`, body || {}),
  },

  /* 6. Проверка — 3 метода */
  lint: {
    run: (draftId, body) => post(`/drafts/${id(draftId)}/lint`, body),
    reports: (draftId, query) => get(`/drafts/${id(draftId)}/lint-reports`, query),
    getReport: (reportId) => get(`/lint-reports/${id(reportId)}`),
  },

  /* 7. Источники — 5 методов */
  sources: {
    list: (profileId, query) => get(`/author-profiles/${id(profileId)}/sources`, query),
    create: (profileId, body) => post(`/author-profiles/${id(profileId)}/sources`, body),
    get: (sourceId) => get(`/sources/${id(sourceId)}`),
    update: (sourceId, body) => patch(`/sources/${id(sourceId)}`, body),
    remove: (sourceId) => del(`/sources/${id(sourceId)}`),
  },

  /* 8. Комментарии — 6 методов */
  comments: {
    list: (sourceId, query) => get(`/sources/${id(sourceId)}/comments`, query),
    create: (sourceId, body) => post(`/sources/${id(sourceId)}/comments`, body),
    get: (commentId) => get(`/comments/${id(commentId)}`),
    update: (commentId, body) => patch(`/comments/${id(commentId)}`, body),
    remove: (commentId) => del(`/comments/${id(commentId)}`),
    scan: (sourceId, body) => post(`/sources/${id(sourceId)}/comments/scan`, body || {}),
  },

  /* 9. Варианты ответа — 6 методов */
  responses: {
    list: (commentId, query) => get(`/comments/${id(commentId)}/responses`, query),
    create: (commentId, body) => post(`/comments/${id(commentId)}/responses`, body),
    get: (responseId) => get(`/responses/${id(responseId)}`),
    update: (responseId, body) => patch(`/responses/${id(responseId)}`, body),
    remove: (responseId) => del(`/responses/${id(responseId)}`),
    generate: (commentId, body) => post(`/comments/${id(commentId)}/responses/generate`, body || {}),
  },

  /* 10. База знаний — 6 методов */
  knowledge: {
    list: (profileId, query) => get(`/author-profiles/${id(profileId)}/knowledge`, query),
    create: (profileId, body) => post(`/author-profiles/${id(profileId)}/knowledge`, body),
    get: (knowledgeId) => get(`/knowledge/${id(knowledgeId)}`),
    update: (knowledgeId, body) => patch(`/knowledge/${id(knowledgeId)}`, body),
    remove: (knowledgeId) => del(`/knowledge/${id(knowledgeId)}`),
    search: (profileId, query) => get(`/author-profiles/${id(profileId)}/knowledge/search`, query),
  },

  /* 11. Служебные — 7 методов */
  service: {
    generationRuns: (query) => get('/generation-runs', query),
    goldenDataset: (query) => get('/golden-dataset', query),
    createGolden: (body) => post('/golden-dataset', body),
    updateGolden: (goldenId, body) => patch(`/golden-dataset/${id(goldenId)}`, body),
    removeGolden: (goldenId) => del(`/golden-dataset/${id(goldenId)}`),
    runEvals: (body) => post('/evals/run', body),
    evalRuns: (query) => get('/evals/runs', query),
  },
}

export default api
