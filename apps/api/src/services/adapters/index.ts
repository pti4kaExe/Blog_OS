/**
 * Реестр адаптеров площадок. Общее правило (docs/API.md, «Внешние сервисы»):
 * нет ключа → 503 not_configured; ошибка → одна повторная попытка → 502
 * upstream_unavailable с details.platform. Уже импортированное не откатывается.
 */
import { AppError } from '../../errors.ts'
import { withRetry } from './http.ts'
import { InstagramAdapter } from './instagram.ts'
import { TelegramAdapter } from './telegram.ts'
import { PlatformError, type PlatformAdapter, type PlatformName } from './types.ts'
import { YoutubeAdapter } from './youtube.ts'

const ADAPTERS: Record<PlatformName, PlatformAdapter> = {
  telegram: new TelegramAdapter(),
  instagram: new InstagramAdapter(),
  youtube: new YoutubeAdapter(),
}

export function isPlatformName(value: unknown): value is PlatformName {
  return value === 'telegram' || value === 'instagram' || value === 'youtube'
}

export function getAdapter(platform: PlatformName): PlatformAdapter {
  return ADAPTERS[platform]
}

async function runWithRetry<T>(platform: PlatformName, operation: () => Promise<T>): Promise<T> {
  try {
    return await withRetry(operation)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new PlatformError(
      platform,
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function importFromPlatform(
  platform: PlatformName,
  sourceUrl: string,
  limit: number,
): Promise<ReturnType<PlatformAdapter['importPosts']>> {
  return runWithRetry(platform, () => getAdapter(platform).importPosts({ sourceUrl, limit }))
}

export async function scanPlatform(
  platform: PlatformName,
  sourceUrl: string,
  limit: number,
): Promise<ReturnType<PlatformAdapter['scanComments']>> {
  return runWithRetry(platform, () => getAdapter(platform).scanComments({ sourceUrl, limit }))
}

export { PlatformError }
export type { ImportedPost, PlatformAdapter, PlatformName, ScannedComment } from './types.ts'
