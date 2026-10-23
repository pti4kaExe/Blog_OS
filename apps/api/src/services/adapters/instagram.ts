/**
 * Instagram Graph API: импорт публикаций (/me/media) и комментариев (/comments).
 * Без INSTAGRAM_ACCESS_TOKEN адаптер отвечает 503 not_configured с details.reason.
 * Условия Business-аккаунта и доступа приложения — docs/DECISIONS.md, п. 22.
 */
import { env } from '../../env.ts'
import { liveString } from '../../lib/liveEnv.ts'
import { notConfigured } from '../../errors.ts'
import { ensureHttpUrl, fetchJson } from './http.ts'
import type {
  ImportedPost,
  ImportOptions,
  PlatformAdapter,
  ScanOptions,
  ScannedComment,
} from './types.ts'

interface MediaItem {
  id?: string
  caption?: string | null
  permalink?: string | null
  timestamp?: string | null
  media_type?: string | null
}

interface CommentItem {
  id?: string
  text?: string | null
  username?: string | null
  timestamp?: string | null
}

function accessToken(): string {
  return liveString('INSTAGRAM_ACCESS_TOKEN', env.INSTAGRAM_ACCESS_TOKEN)
}

function graphBase(): string {
  return liveString('INSTAGRAM_GRAPH_BASE', env.INSTAGRAM_GRAPH_BASE).replace(/\/$/, '')
}

/** Короткий код публикации из ссылки вида /p/<code>/ или /reel/<code>/. */
export function parseShortcode(sourceUrl: string): string | null {
  const match = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(sourceUrl)
  return match?.[1] ?? null
}

async function fetchCommentsForMedia(mediaId: string, limit: number): Promise<ScannedComment[]> {
  const token = accessToken()
  const url =
    `${graphBase()}/${encodeURIComponent(mediaId)}/comments` +
    `?fields=id,text,username,timestamp&limit=${limit}&access_token=${encodeURIComponent(token)}`
  const data = await fetchJson<{ data?: CommentItem[] }>(url)
  return (data.data ?? [])
    .filter((item) => item.id && item.text)
    .map((item) => ({
      external_id: String(item.id),
      commenter_name: item.username ?? null,
      text: String(item.text),
      posted_at: item.timestamp ?? null,
    }))
}

export class InstagramAdapter implements PlatformAdapter {
  readonly platform = 'instagram' as const

  async importPosts(options: ImportOptions): Promise<ImportedPost[]> {
    const token = accessToken()
    if (!token) throw notConfigured('Instagram Graph API')
    const sourceUrl = ensureHttpUrl(options.sourceUrl)
    const url =
      `${graphBase()}/me/media` +
      `?fields=id,caption,permalink,timestamp,media_type` +
      `&limit=${Math.min(Math.max(options.limit, 1), 100)}&access_token=${encodeURIComponent(token)}`
    const data = await fetchJson<{ data?: MediaItem[] }>(url)
    return (data.data ?? [])
      .filter((item) => item.id && item.caption && item.caption.trim().length > 0)
      .slice(0, options.limit)
      .map((item) => ({
        external_id: String(item.id),
        text: String(item.caption).trim(),
        external_url: item.permalink ?? sourceUrl,
        published_at: item.timestamp ?? null,
        content_type: item.media_type === 'VIDEO' ? 'reels_script' : 'caption',
      }))
  }

  async scanComments(options: ScanOptions): Promise<ScannedComment[]> {
    const token = accessToken()
    if (!token) throw notConfigured('Instagram Graph API')
    const sourceUrl = ensureHttpUrl(options.sourceUrl)
    const shortcode = parseShortcode(sourceUrl)
    const result: ScannedComment[] = []

    if (shortcode) {
      return (await fetchCommentsForMedia(shortcode, options.limit)).slice(0, options.limit)
    }

    const mediaUrl =
      `${graphBase()}/me/media?fields=id&limit=5&access_token=${encodeURIComponent(token)}`
    const media = await fetchJson<{ data?: MediaItem[] }>(mediaUrl)
    for (const item of media.data ?? []) {
      if (!item.id) continue
      const comments = await fetchCommentsForMedia(item.id, options.limit - result.length)
      result.push(...comments)
      if (result.length >= options.limit) break
    }
    return result.slice(0, options.limit)
  }
}
