/**
 * Ошибки API в одном конверте: { error: { code, message, details } }.
 *
 * Коды HTTP и code перечислены в docs/API.md, раздел «Ошибки».
 * Тексты наружу — только из этого файла: текст исключения в ответ не попадает
 * (утечка внутренностей), но попадает в лог.
 */
import { ZodError } from 'zod'

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'ai_budget_exceeded'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'not_configured'
  | 'internal'

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  ai_budget_exceeded: 402,
  rate_limited: 429,
  upstream_unavailable: 502,
  not_configured: 503,
  internal: 500,
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
    this.details = details
  }
}

export const validationError = (message: string, details?: Record<string, unknown>) =>
  new AppError('validation_error', message, details)

export const unauthorized = (message = 'Требуется вход') => new AppError('unauthorized', message)

export const forbidden = (message = 'Действие запрещено') => new AppError('forbidden', message)

/** Чужая запись неотличима от несуществующей: не раскрываем её наличие. */
export const notFound = (message = 'Запись не найдена') => new AppError('not_found', message)

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError('conflict', message, details)

export const unprocessable = (message: string, details?: Record<string, unknown>) =>
  new AppError('unprocessable', message, details)

export const budgetExceeded = (message = 'Месячный лимит расходов на AI исчерпан') =>
  new AppError('ai_budget_exceeded', message, { fallback: 'rules' })

export const rateLimited = (message = 'Слишком часто') => new AppError('rate_limited', message)

export const upstreamUnavailable = (message: string, details?: Record<string, unknown>) =>
  new AppError('upstream_unavailable', message, details)

export const notConfigured = (what: string) =>
  new AppError('not_configured', `${what}: доступ не настроен`, { reason: 'not_configured' })

/** Zod-ошибка → 400 с перечнем полей. */
export function fromZodError(error: ZodError): AppError {
  const fields = error.issues.map((issue) => ({
    path: issue.path.join('.') || '(тело запроса)',
    message: issue.message,
  }))
  return new AppError('validation_error', 'Данные не проходят проверку', { fields })
}

/** Ошибка уникального индекса PostgreSQL → 409 с именем ограничения. */
export function fromPostgresError(error: unknown): AppError | null {
  const code = (error as { code?: string } | null)?.code
  if (code === '23505') {
    const constraint = (error as { constraint?: string }).constraint ?? null
    return new AppError('conflict', 'Такая запись уже существует', { constraint })
  }
  if (code === '23514') {
    return new AppError('unprocessable', 'Данные нарушают ограничение базы', {
      constraint: (error as { constraint?: string }).constraint ?? null,
    })
  }
  if (code === '23503') {
    return new AppError('unprocessable', 'Ссылка на несуществующую запись', {
      constraint: (error as { constraint?: string }).constraint ?? null,
    })
  }
  return null
}
