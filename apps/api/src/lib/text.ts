/**
 * Текстовые правила контракта: пропуски [дополните: …] и лимиты длины
 * по типам контента (ТЗ, раздел 7). Используются и сервером, и тестами.
 */

/** Незаполненный пропуск из шаблона ответа/Narrative Engine. */
export const GAP_RE = /\[дополните:[^\]]*\]/iu

export function hasUnfilledGaps(text: string): boolean {
  return GAP_RE.test(String(text ?? ''))
}

/** Лимиты длины по content_type (символы). */
export const CONTENT_TYPE_LIMITS: Record<string, number> = {
  post: 4096,
  caption: 2200,
  video_script: 5000,
  video_description: 5000,
  reels_script: 5000,
}

export function contentLengthLimit(contentType: string): number | null {
  return CONTENT_TYPE_LIMITS[contentType] ?? null
}

/** Тип контента для площадки по умолчанию. */
export function defaultContentType(platform: string): string {
  if (platform === 'instagram') return 'caption'
  if (platform === 'youtube') return 'video_description'
  return 'post'
}

/** Проверка длины текста: возвращает лимит, если он превышен. */
export function exceededLimit(contentType: string, text: string): number | null {
  const limit = contentLengthLimit(contentType)
  if (limit === null) return null
  return text.length > limit ? limit : null
}

/** Первое непустое значение или null. */
export function trimmedOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text.length ? text : null
}
