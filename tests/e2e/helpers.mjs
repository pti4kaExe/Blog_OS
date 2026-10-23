/**
 * Общее окружение e2e-тестов BlogOS.
 *
 * Тесты — чёрный ящик по HTTP (`app.inject()` вместо реального порта: в песочнице
 * запрещён spawn дочерних процессов, а inject стабильнее). Внутри теста
 * разрешено трогать базу только для подготовки фикстур (роль admin, потому что
 * роли через API не выдаются намеренно).
 *
 * Окружение выставляется ДО импорта приложения: env.ts не перетирает уже
 * заданные переменные.
 */

process.env.DATABASE_URL = 'pglite://memory'
process.env.NODE_ENV = 'test'
process.env.PORT = '3100'
process.env.HOST = '127.0.0.1'
process.env.DEV_AUTH = '1'
process.env.LLM_PROVIDER = 'mock'
process.env.EMBEDDINGS_PROVIDER = 'mock'
process.env.LOG_LEVEL = 'silent'
process.env.COST_WARN_RATIO = '0.8'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-secret-0123456789abcdef0123456789'

const { buildApp } = await import('../../apps/api/src/app.ts')
const { applyMigrations } = await import('../../apps/api/src/migrations.ts')
const db = await import('../../apps/api/src/db.ts')

let contextPromise = null

/**
 * Один сервер и одна in-memory база на весь процесс тестов.
 * Миграции применяются до сборки приложения.
 */
export function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const migration = await applyMigrations()
      const app = await buildApp()
      await app.ready()
      return { app, db, migration }
    })()
  }
  return contextPromise
}

/** HTTP-запрос через inject. Возвращает status, json, text. */
export async function request(app, method, url, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.token) headers.authorization = `Bearer ${options.token}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  const response = await app.inject({
    method,
    url,
    headers,
    payload: options.body === undefined ? undefined : options.body,
  })
  let json = null
  try {
    json = response.payload ? JSON.parse(response.payload) : null
  } catch {
    json = null
  }
  return {
    status: response.statusCode,
    json,
    text: response.payload,
    headers: response.headers,
    method,
    url,
  }
}

/** Удобные сокращения: request(app, 'GET', ...) в тестах читается хуже. */
export const api = {
  get: (app, url, options) => request(app, 'GET', url, options),
  post: (app, url, options) => request(app, 'POST', url, options),
  put: (app, url, options) => request(app, 'PUT', url, options),
  patch: (app, url, options) => request(app, 'PATCH', url, options),
  delete: (app, url, options) => request(app, 'DELETE', url, options),
}

/** Вход через контрактный dev-режим POST /auth/telegram. */
export async function login(app, telegramId, name) {
  const res = await api.post(app, '/auth/telegram', { body: { telegram_id: telegramId, name } })
  if (res.status !== 200) {
    throw new Error(
      `Вход не выполнен: POST /auth/telegram → ${res.status} ${res.text}\n` +
        'Контракт: docs/API.md, группа 1 — при DEV_AUTH=1 принимается пара telegram_id+name.',
    )
  }
  return { token: res.json.token, user: res.json.user, res }
}

/** Создать администратора: dev-вход + выдача роли напрямую в базе (API роли не выдаёт). */
export async function loginAdmin(app, dbApi, telegramId, name) {
  const first = await login(app, telegramId, name)
  await dbApi.query(`UPDATE users SET role = 'admin' WHERE telegram_id = $1`, [telegramId])
  const second = await login(app, telegramId, name)
  if (second.user?.role !== 'admin') {
    throw new Error(`Не удалось выдать роль admin пользователю ${telegramId}: ${JSON.stringify(second.user)}`)
  }
  return second
}

/** Проверка успешного статуса с диагностикой запроса и ответа. */
export function assertStatus(res, expected, label) {
  if (res.status !== expected) {
    throw new Error(
      `${label}: ожидался HTTP ${expected}, получен ${res.status}\n` +
        `  запрос: ${res.method} ${res.url}\n  ответ: ${res.text}`,
    )
  }
}

/** Проверка конверта ошибки { error: { code, message, details } }. */
export function assertError(res, expectedStatus, expectedCode, label, detailsCheck) {
  assertStatus(res, expectedStatus, label)
  const error = res.json?.error
  if (!error || typeof error !== 'object') {
    throw new Error(`${label}: ответ не содержит конверт { error: … }: ${res.text}`)
  }
  if (error.code !== expectedCode) {
    throw new Error(
      `${label}: ожидался code=${expectedCode}, получен code=${error.code}\n  ответ: ${res.text}`,
    )
  }
  if (!('details' in error)) {
    throw new Error(`${label}: в конверте нет поля details: ${res.text}`)
  }
  if (typeof detailsCheck === 'function') {
    const problem = detailsCheck(error.details ?? {})
    if (problem) throw new Error(`${label}: ${problem}\n  ответ: ${res.text}`)
  }
  return error
}

/** Уникальные telegram_id между тестами одного прогона. */
let telegramSeq = 800000
export function nextTelegramId() {
  telegramSeq += 1
  return telegramSeq
}

/** Длинные тексты для шага стиля (суммарно ≥ 180 символов). */
export const TOV_TEXTS = [
  'Привет! Сегодня разберём, как я настроил локальную базу для проекта. Сначала выбрал PostgreSQL и расширение pgvector: так векторный поиск живёт рядом с обычными данными и не нужен второй сервис.',
  'Главный вывод: не тащите ORM туда, где нужен сырой SQL. Схема в одном DDL-файле оказалась проще, чем миграции в двух источниках истины. Если коротко — сначала данные, потом удобство.',
]

/** Заметки для Narrative Engine. */
export const NOTES = [
  'Сначала я делал проверку текста вручную и тратил на это час.',
  'Потом собрал словарь клише из своих же постов.',
  'Выяснилось, что половину замечаний даёт одна группа правил.',
  'Теперь проверка занимает минуту, а не час.',
].join('\n')

/** Текст без пропусков [дополните: …] и достаточной длины. */
export const CLEAN_TEXT =
  'Три месяца назад я собирал посты вручную: открывал заметки, переписывал их в редактор и проверял на слух. ' +
  'Потом собрал небольшой конвейер: заметки превращаются в связный текст, проверка подсказывает клише, а исправления я вношу сам. ' +
  'Главное, что я понял: инструмент не пишет за меня, он убирает рутину и оставляет место для смысла.'
