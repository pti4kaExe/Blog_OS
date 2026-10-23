/**
 * Общие правила контракта docs/API.md для списков и параметров:
 * limit 50/200, курсор по (created_at, id), фильтры по датам, разбор id.
 */
import { z } from 'zod'
import { fromZodError, validationError } from '../errors.ts'
import { toId, type QueryParam } from '../db.ts'

export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {})
  if (!result.success) throw fromZodError(result.error)
  return result.data as z.output<S>
}

export function parseQuery<S extends z.ZodTypeAny>(schema: S, query: unknown): z.output<S> {
  const result = schema.safeParse(query ?? {})
  if (!result.success) throw fromZodError(result.error)
  return result.data as z.output<S>
}

/** Идентификатор из пути: целое положительное число. */
export function parseId(raw: unknown, field = 'id'): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw validationError(`Некорректный параметр пути: ${field}`, { field, value: String(raw) })
  }
  return value
}

/** Идентификатор из request.params (Fastify не типизирует params без схемы). */
export function paramsId(params: unknown, key = 'id'): number {
  const record = (params ?? {}) as Record<string, unknown>
  return parseId(record[key], key)
}

const dateString = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Ожидается дата в формате ISO 8601')

/** Базовые параметры списка: limit, cursor, from, to. */
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
})

export type ListQuery = z.infer<typeof listQuerySchema>

export interface Cursor {
  createdAt: string
  id: number | string
}

export interface ListOptions {
  limit: number
  cursor: Cursor | null
  from: string | null
  to: string | null
}

/** Курсор — непрозрачная строка: base64url от [created_at ISO, id]. */
export function encodeCursor(createdAt: unknown, id: unknown): string {
  const iso =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : new Date(String(createdAt)).toISOString()
  return Buffer.from(JSON.stringify([iso, toId(id)]), 'utf8').toString('base64url')
}

export function decodeCursor(raw?: string): Cursor | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error('shape')
    const [iso, id] = parsed as [unknown, unknown]
    if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) throw new Error('date')
    if (typeof id !== 'number' && typeof id !== 'string') throw new Error('id')
    return { createdAt: iso, id }
  } catch {
    throw validationError('Некорректный cursor', { cursor: raw })
  }
}

export function toListOptions(query: ListQuery): ListOptions {
  const from = query.from ? new Date(query.from) : null
  const to = query.to ? new Date(query.to) : null
  if (from && to && from.getTime() > to.getTime()) {
    throw validationError('Параметр from позже to', { from: query.from, to: query.to })
  }
  return {
    limit: query.limit,
    cursor: decodeCursor(query.cursor),
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
  }
}

export interface ListResult<T> {
  items: T[]
  next_cursor: string | null
}

/**
 * Собирает страницу из строк, выбранных с LIMIT = limit + 1.
 * Сортировка во всех репозиториях — created_at DESC, id DESC.
 */
export function paginate<T extends Record<string, unknown>>(rows: T[], limit: number): ListResult<T> {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return {
    items,
    next_cursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  }
}

/** Условие курсора и позиция следующих параметров. */
export function cursorCondition(
  cursor: Cursor | null,
  alias: string,
  params: QueryParam[],
  nextIndex: number,
): { sql: string; nextIndex: number } {
  if (!cursor) return { sql: '', nextIndex }
  const i = nextIndex
  params.push(cursor.createdAt, cursor.id)
  return {
    sql: ` AND (${alias}.created_at, ${alias}.id) < ($${i}::timestamptz, $${i + 1}::bigint)`,
    nextIndex: i + 2,
  }
}

/** Условия по диапазону дат для колонки created_at. */
export function dateRangeCondition(
  from: string | null,
  to: string | null,
  alias: string,
  params: QueryParam[],
  nextIndex: number,
  column = 'created_at',
): { sql: string; nextIndex: number } {
  let sql = ''
  let index = nextIndex
  if (from) {
    params.push(from)
    sql += ` AND ${alias}.${column} >= $${index}::timestamptz`
    index++
  }
  if (to) {
    params.push(to)
    sql += ` AND ${alias}.${column} <= $${index}::timestamptz`
    index++
  }
  return { sql, nextIndex: index }
}
