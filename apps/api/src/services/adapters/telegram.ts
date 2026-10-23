/**
 * Telegram-адаптер.
 *
 * Импорт постов — публичная веб-версия t.me/s/<channel> (без токена бота).
 * Сканирование обсуждений — публичные embed-страницы поста
 * t.me/<channel>/<id>?embed=1&discussion=1: у Bot API нет метода чтения
 * комментариев канала, поэтому текст обсуждения берётся из публичной версии
 * (условия живого Telegram проверяются при подключении — docs/DECISIONS.md).
 * Парсер устойчив к вёрстке tgme_widget_message и не тянет cheerio.
 */
import { fetchText, ensureHttpUrl } from './http.ts'
import type {
  ImportedPost,
  ImportOptions,
  PlatformAdapter,
  ScanOptions,
  ScannedComment,
} from './types.ts'

interface RawMessage {
  dataPost: string
  text: string
  datetime: string | null
  author: string | null
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
}

function stripTags(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' '),
  ).trim()
}

/** Имя канала из ссылки: https://t.me/s/name, @name, name. */
export function parseChannel(sourceUrl: string): string {
  const raw = ensureHttpUrl(sourceUrl)
  const withoutProtocol = raw.replace(/^https?:\/\//i, '')
  const withoutHost = withoutProtocol.replace(/^t\.me\//i, '')
  const withoutSection = withoutHost.replace(/^s\//i, '')
  const segment = withoutSection.split(/[/?#]/)[0] ?? ''
  const channel = segment.replace(/^@/, '').trim()
  if (!/^[A-Za-z0-9_]{3,}$/.test(channel)) {
    throw new Error(`Не удалось определить канал Telegram из source_url: ${raw}`)
  }
  return channel
}

export function parseMessages(html: string): RawMessage[] {
  const messages: RawMessage[] = []
  const blockRe = /data-post="([^"]+)"([\s\S]*?)(?=data-post="|$)/g
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html)) !== null) {
    const dataPost = match[1] ?? ''
    const block = match[2] ?? ''
    const textMatch =
      /class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block) ??
      /class="[^"]*js-message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block)
    if (!textMatch) continue
    const text = stripTags(textMatch[1] ?? '')
    if (!text) continue
    const timeMatch = /<time[^>]*datetime="([^"]+)"/.exec(block)
    const authorMatch =
      /class="[^"]*tgme_widget_message_author_name[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span)>/.exec(block) ??
      /class="[^"]*tgme_widget_message_owner_name[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span)>/.exec(block)
    messages.push({
      dataPost,
      text,
      datetime: timeMatch?.[1] ?? null,
      author: authorMatch ? stripTags(authorMatch[1] ?? '') : null,
    })
  }
  return messages
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram' as const

  async importPosts(options: ImportOptions): Promise<ImportedPost[]> {
    const channel = parseChannel(options.sourceUrl)
    const html = await fetchText(`https://t.me/s/${channel}`)
    return parseMessages(html)
      .slice(0, options.limit)
      .map((message) => ({
        external_id: message.dataPost,
        text: message.text,
        external_url: `https://t.me/${message.dataPost}`,
        published_at: message.datetime,
        content_type: 'post',
      }))
  }

  async scanComments(options: ScanOptions): Promise<ScannedComment[]> {
    const channel = parseChannel(options.sourceUrl)
    const html = await fetchText(`https://t.me/s/${channel}`)
    const posts = parseMessages(html).slice(0, Math.min(20, Math.max(options.limit, 1)))
    const comments: ScannedComment[] = []

    for (const post of posts) {
      const postId = post.dataPost.split('/')[1]
      if (!postId) continue
      let embedHtml: string
      try {
        embedHtml = await fetchText(`https://t.me/${channel}/${postId}?embed=1&discussion=1`)
      } catch {
        // У поста может не быть обсуждения — это не отказ площадки.
        continue
      }
      for (const message of parseMessages(embedHtml)) {
        if (message.dataPost === post.dataPost) continue
        comments.push({
          external_id: `${post.dataPost}:${message.dataPost}`,
          commenter_name: message.author,
          text: message.text,
          posted_at: message.datetime,
        })
        if (comments.length >= options.limit) return comments
      }
    }
    return comments
  }
}
