/**
 * Общая инфраструктура тестов: приложение Fastify через app.inject(),
 * миграции + демо-сид на in-memory PGlite, dev-вход, HTTP-хелперы.
 *
 * ВАЖНО: этот модуль должен импортироваться первым — он выставляет тестовое
 * окружение до загрузки src/env.ts.
 */
import './env.ts'
import type { FastifyInstance } from 'fastify'

export interface ApiResponse<T = Record<string, unknown>> {
  status: number
  body: T
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

let app: FastifyInstance | null = null
let bootstrapPromise: Promise<FastifyInstance> | null = null
let telegramCounter = 7_000_000

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    const { buildApp } = await import('../src/app.ts')
    app = await buildApp()
  }
  return app
}

/**
 * Один раз на процесс: миграции 001+002 и демо-данные (идемпотентно).
 * Мемоизация промиса обязательна: при --test-isolation=none before-хуки
 * разных файлов могут стартовать одновременно в одном процессе.
 */
export function bootstrap(): Promise<FastifyInstance> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const instance = await getApp()
      const { applyMigrations } = await import('../src/migrations.ts')
      const { seed } = await import('../scripts/seed.ts')
      await applyMigrations()
      await seed()
      return instance
    })()
  }
  return bootstrapPromise
}

export async function db<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await bootstrap()
  const module = await import('../src/db.ts')
  return module.query<T>(sql, params as never[])
}

export async function dbOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await db<T>(sql, params)
  return rows[0] ?? null
}

export async function api<T = Record<string, unknown>>(
  method: HttpMethod,
  url: string,
  options: { token?: string; body?: unknown; query?: Record<string, unknown> } = {},
): Promise<ApiResponse<T>> {
  const instance = await bootstrap()
  let path = url
  if (options.query) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) search.set(key, String(value))
    }
    const qs = search.toString()
    if (qs) path += `?${qs}`
  }
  const headers: Record<string, string> = {}
  if (options.token) headers.authorization = `Bearer ${options.token}`
  const response = await instance.inject({
    method,
    url: path,
    headers,
    ...(options.body !== undefined ? { payload: options.body as never } : {}),
  })
  let body: unknown = null
  const text = response.body
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: response.statusCode, body: body as T }
}

export function nextTelegramId(): number {
  telegramCounter += 1
  return telegramCounter
}

export async function loginDev(
  telegramId: number,
  name: string,
): Promise<{ token: string; user: Record<string, unknown> }> {
  const response = await api<{
    token: string
    user: Record<string, unknown>
    error?: unknown
  }>('POST', '/auth/telegram', { body: { telegram_id: telegramId, name } })
  if (response.status !== 200) {
    throw new Error(`dev-вход не удался: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return { token: response.body.token, user: response.body.user }
}

/** Токен демо-автора из scripts/seed.ts (telegram_id=200600). */
export async function authorToken(): Promise<string> {
  return (await loginDev(200600, 'Демо-автор')).token
}

/** Токен демо-админа из scripts/seed.ts (telegram_id=100500). */
export async function adminToken(): Promise<string> {
  return (await loginDev(100500, 'Демо-админ')).token
}

/** Новый пользователь без каналов и данных (для проверок 404/прав). */
export async function freshUser(prefix = 'Тест'): Promise<{
  token: string
  user: Record<string, unknown>
  telegramId: number
}> {
  const telegramId = nextTelegramId()
  const result = await loginDev(telegramId, `${prefix}-${telegramId}`)
  return { ...result, telegramId }
}

export async function createProfile(
  token: string,
  platform = 'telegram',
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await api<Record<string, unknown>>('POST', '/author-profiles', {
    token,
    body: {
      name: `Канал-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      platform,
      monthly_cost_limit: 500,
      ...extra,
    },
  })
  if (response.status !== 201) {
    throw new Error(`канал не создан: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return response.body
}

/** Ответ фикстурного fetch для адаптеров площадок. */
export function installFetchMock(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): () => void {
  const original = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/** Удаляет каналы, созданные тестом (каскад уносит данные). */
export async function cleanupProfiles(
  token: string,
  profiles: Array<Record<string, unknown>>,
): Promise<void> {
  for (const profile of profiles) {
    await api('DELETE', `/author-profiles/${String(profile.id)}`, { token })
  }
}
