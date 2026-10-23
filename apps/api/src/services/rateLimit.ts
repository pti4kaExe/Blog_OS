/**
 * Ограничение частоты сканирований: чаще раза в 60 секунд на источник → 429.
 *
 * Без REDIS_URL — in-memory Map (docs/DECISIONS.md, решение № 4): отказ Redis
 * не ломает функции. С REDIS_URL — общий ограничитель через SET NX PX.
 */
import { Redis } from 'ioredis'
import { env } from '../env.ts'
import { rateLimited } from '../errors.ts'

export const SCAN_WINDOW_MS = 60_000

const lastScanAt = new Map<number, number>()

let redisClient: Redis | null = null
let redisBroken = false

function getRedis(): Redis | null {
  if (!env.REDIS_URL || redisBroken) return null
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    })
    redisClient.on('error', () => {
      redisBroken = true
    })
  }
  return redisClient
}

function memoryCheck(sourceId: number): void {
  const now = Date.now()
  const previous = lastScanAt.get(sourceId)
  if (previous !== undefined && now - previous < SCAN_WINDOW_MS) {
    throw rateLimited('Источник сканировался меньше 60 секунд назад')
  }
  lastScanAt.set(sourceId, now)
}

export async function assertScanRateAllowed(sourceId: number): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      if (redis.status === 'wait') await redis.connect()
      const claimed = await redis.set(`blogos:scan:${sourceId}`, '1', 'PX', SCAN_WINDOW_MS, 'NX')
      if (claimed === null) {
        throw rateLimited('Источник сканировался меньше 60 секунд назад')
      }
      return
    } catch (error) {
      if ((error as { code?: string }).code === 'rate_limited') throw error
      redisBroken = true
    }
  }
  memoryCheck(sourceId)
}

/** Только для тестов: сбросить in-memory окна между сценариями. */
export function resetScanRateLimits(): void {
  lastScanAt.clear()
}
