/** HTTP-обвязка адаптеров: таймаут, текст/JSON, одна повторная попытка. */
import { AppError } from '../../errors.ts'

export const PLATFORM_TIMEOUT_MS = 15_000

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = PLATFORM_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} для ${url}`)
    }
    return await response.text()
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      throw new Error(`таймаут ${timeoutMs} мс: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = PLATFORM_TIMEOUT_MS,
): Promise<T> {
  const text = await fetchText(url, init, timeoutMs)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`ответ не является JSON: ${url}`)
  }
}

/** Одна повторная попытка; AppError (not_configured) не оборачивается. */
export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AppError) throw error
    return operation()
  }
}

/** Проверяет, что ссылка ведёт на поддерживаемую площадку. */
export function ensureHttpUrl(value: string): string {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) throw new Error('Пустой source_url')
  return trimmed
}
