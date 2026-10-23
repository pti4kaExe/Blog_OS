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

/** Ошибка площадки после одной повторной попытки → 502 upstream_unavailable. */
export class PlatformError extends Error {
  constructor(
    readonly platform: PlatformName,
    message: string,
  ) {
    super(message)
    this.name = 'PlatformError'
  }
}
