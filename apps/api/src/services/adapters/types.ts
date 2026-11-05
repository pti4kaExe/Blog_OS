/** Общие типы адаптеров площадок и ошибка площадки. */
export type PlatformName = 'telegram' | 'instagram' | 'youtube'

export interface ImportedPost {
  external_id: string
  text: string
  external_url: string | null
  published_at: string | null
  content_type: string
}

export interface ScannedComment {
  external_id: string
  commenter_name: string | null
  text: string
  posted_at: string | null
}

export interface ImportOptions {
  sourceUrl: string
  limit: number
}

export interface ScanOptions {
  sourceUrl: string
  limit: number
}

export interface PlatformAdapter {
  readonly platform: PlatformName
  importPosts(options: ImportOptions): Promise<ImportedPost[]>
  scanComments(options: ScanOptions): Promise<ScannedComment[]>
}

/**
 * Ошибка площадки после одной повторной попытки → 502 upstream_unavailable.
 * Поле объявлено явно: strip-only режим Node не поддерживает parameter properties.
 */
export class PlatformError extends Error {
  readonly platform: PlatformName

  constructor(platform: PlatformName, message: string) {
    super(message)
    this.name = 'PlatformError'
    this.platform = platform
  }
}

/**
 * Площадка технически доступна, но обсуждения публично не отдаёт.
 *
 * Отдельный тип нужен, чтобы не выдавать это за сбой площадки (502) и не
 * делать вид, что «обсуждений нет»: для Telegram публичный виджет
 * комментариев отключён, поэтому причина должна быть видна автору.
 */
export class DiscussionsUnavailableError extends Error {
  readonly platform: PlatformName
  readonly reason: string
  readonly hint: string

  constructor(platform: PlatformName, reason: string, hint: string) {
    super(hint)
    this.name = 'DiscussionsUnavailableError'
    this.platform = platform
    this.reason = reason
    this.hint = hint
  }
}
