/**
 * Простой ограничитель частоты для методов входа.
 *
 * Вход в бота и опрос статуса — публичные методы без токена, поэтому их нужно
 * защитить от перебора: коды в статусе подбираются, а старт кодов можно
 * заспамить. Хранится в памяти процесса: при нескольких инстансах лимит
 * действует на каждый, для нашего масштаба этого достаточно.
 */
import { rateLimited } from '../errors.ts'

const hits = new Map<string, number[]>()

export function assertRateAllowed(
  key: string,
  limit: number,
  windowMs: number,
  message = 'Слишком много попыток, попробуйте позже',
): void {
  const now = Date.now()
  const windowStart = now - windowMs
  const previous = hits.get(key) ?? []
  const fresh = previous.filter((time) => time > windowStart)
  if (fresh.length >= limit) {
    hits.set(key, fresh)
    throw rateLimited(message)
  }
  fresh.push(now)
  hits.set(key, fresh)
}

/** Только для тестов: сбросить окна между сценариями. */
export function resetAuthRateLimits(): void {
  hits.clear()
}

/** Периодическая уборка ключей, чтобы Map не рос бесконечно. */
export function sweepAuthRateLimits(): void {
  const now = Date.now()
  for (const [key, times] of hits) {
    const fresh = times.filter((time) => time > now - 10 * 60_000)
    if (fresh.length === 0) hits.delete(key)
    else hits.set(key, fresh)
  }
}
