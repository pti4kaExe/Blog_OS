/**
 * YouTube Data API v3: импорт видео (search) и комментариев (commentThreads).
 * Без YOUTUBE_API_KEY — 503 not_configured. Квота проверяется при подключении
 * ключа (docs/DECISIONS.md, п. 22).
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

interface SearchItem {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
  }
}

interface CommentThreadItem {
  snippet?: {
    topLevelComment?: {
      id?: string
      snippet?: {
        textDisplay?: string
        textOriginal?: string
        authorDisplayName?: string
        publishedAt?: string
      }
    }
  }
}

function apiKey(): string {
  return liveString('YOUTUBE_API_KEY', env.YOUTUBE_API_KEY)
}

function apiBase(): string {
  return liveString('YOUTUBE_API_BASE', env.YOUTUBE_API_BASE).replace(/\/$/, '')
}

export function parseChannelId(sourceUrl: string): string | null {
  const match = /\/channel\/(UC[A-Za-z0-9_-]{10,})/.exec(sourceUrl)
  return match?.[1] ?? null
}

export function parseVideoId(sourceUrl: string): string | null {
  const direct = /(?:[?&]v=|\/shorts\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(sourceUrl)
  return direct?.[1] ?? null
}

function searchUrl(options: {
  key: string
  sourceUrl: string
  limit: number
  withSnippet: boolean
}): string {
  const params = new URLSearchParams({
    part: options.withSnippet ? 'snippet' : 'id',
    type: 'video',
    order: 'date',
    maxResults: String(Math.min(Math.max(options.limit, 1), 50)),
    key: options.key,
  })
  const channelId = parseChannelId(options.sourceUrl)
  if (channelId) params.set('channelId', channelId)
  else params.set('q', options.sourceUrl)
  return `${apiBase()}/search?${params.toString()}`
}

async function searchVideos(
  sourceUrl: string,
  limit: number,
  withSnippet: boolean,
): Promise<SearchItem[]> {
  const key = apiKey()
  if (!key) throw notConfigured('YouTube Data API')
  const data = await fetchJson<{ items?: SearchItem[] }>(
    searchUrl({ key, sourceUrl, limit, withSnippet }),
  )
  return data.items ?? []
}

export class YoutubeAdapter implements PlatformAdapter {
  readonly platform = 'youtube' as const

  async importPosts(options: ImportOptions): Promise<ImportedPost[]> {
    const sourceUrl = ensureHttpUrl(options.sourceUrl)
    const items = await searchVideos(sourceUrl, options.limit, true)
    return items
      .filter((item) => item.id?.videoId)
      .map((item) => {
        const videoId = String(item.id?.videoId)
        const title = item.snippet?.title ?? ''
        const description = item.snippet?.description ?? ''
        return {
          external_id: videoId,
          text: [title, description].filter(Boolean).join('\n\n').trim(),
          external_url: `https://www.youtube.com/watch?v=${videoId}`,
          published_at: item.snippet?.publishedAt ?? null,
          content_type: 'video_description',
        }
      })
      .filter((post) => post.text.length > 0)
  }

  async scanComments(options: ScanOptions): Promise<ScannedComment[]> {
    const key = apiKey()
    if (!key) throw notConfigured('YouTube Data API')
    const sourceUrl = ensureHttpUrl(options.sourceUrl)
    const directVideo = parseVideoId(sourceUrl)
    const videoIds = directVideo
      ? [directVideo]
      : (await searchVideos(sourceUrl, options.limit, false))
          .map((item) => item.id?.videoId)
          .filter((id): id is string => Boolean(id))

    const comments: ScannedComment[] = []
    for (const videoId of videoIds) {
      const params = new URLSearchParams({
        part: 'snippet',
        videoId,
        maxResults: String(Math.min(Math.max(options.limit, 1), 100)),
        textFormat: 'plainText',
        key,
      })
      const data = await fetchJson<{ items?: CommentThreadItem[] }>(
        `${apiBase()}/commentThreads?${params.toString()}`,
      )
      for (const item of data.items ?? []) {
        const comment = item.snippet?.topLevelComment
        const snippet = comment?.snippet
        if (!comment?.id || !snippet) continue
        const text = (snippet.textOriginal ?? snippet.textDisplay ?? '').trim()
        if (!text) continue
        comments.push({
          external_id: String(comment.id),
          commenter_name: snippet.authorDisplayName ?? null,
          text,
          posted_at: snippet.publishedAt ?? null,
        })
        if (comments.length >= options.limit) return comments
      }
    }
    return comments
  }
}
