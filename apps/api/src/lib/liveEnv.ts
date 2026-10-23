/**
 * «Живые» переменные окружения для переключаемых в тестах настроек.
 *
 * env.ts читает окружение один раз при импорте. Для флагов, которые тесты
 * меняют во время прогона (LLM_MOCK_FAIL, ключи площадок), значение читается
 * из process.env в момент вызова: на хостинге это те же значения, а в тестах
 * позволяет проверить и успешный путь, и отказы, не перезапуская процесс.
 */
import { env } from '../env.ts'

export function liveString(name: string, fallback: string): string {
  const value = process.env[name]
  return value === undefined ? fallback : value
}

export function liveFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

export const telegramBotToken = (): string =>
  liveString('TELEGRAM_BOT_TOKEN', env.TELEGRAM_BOT_TOKEN)

export const instagramAccessToken = (): string =>
  liveString('INSTAGRAM_ACCESS_TOKEN', env.INSTAGRAM_ACCESS_TOKEN)

export const youtubeApiKey = (): string => liveString('YOUTUBE_API_KEY', env.YOUTUBE_API_KEY)

export const llmMockFail = (): boolean => liveFlag('LLM_MOCK_FAIL', env.LLM_MOCK_FAIL)
