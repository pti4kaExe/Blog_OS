/**
 * Приём обсуждений из Telegram-чата через бота.
 *
 * Публичный виджет комментариев Telegram отключил, поэтому единственный
 * надёжный способ получать обсуждения без пользовательского аккаунта —
 * бот, добавленный в чат: Telegram присылает все новые сообщения в webhook,
 * а мы сохраняем их как комментарии источника.
 *
 * Ограничения, которые важно понимать:
 *  - только новые сообщения (историю Bot API не отдаёт);
 *  - в группе без прав администратора бот видит только команды
 *    (privacy mode), поэтому его нужно добавить админом;
 *  - приватная группа без @username не сопоставится с источником.
 */
import { query } from '../db.ts'
import * as comments from '../repositories/comments.ts'
import * as sources from '../repositories/sources.ts'
import type { TelegramMessage } from './telegramBot.ts'
import { displayName } from './telegramBot.ts'

export interface ChatIngestResult {
  sources: number
  created: number
  duplicates: number
}

function postedAt(message: TelegramMessage): string | null {
  if (!message.date) return null
  return new Date(message.date * 1000).toISOString()
}

/**
 * Сохраняет сообщение группового чата в комментарии всех источников,
 * которые на этот чат подписаны.
 */
export async function ingestChatMessage(message: TelegramMessage): Promise<ChatIngestResult> {
  const empty: ChatIngestResult = { sources: 0, created: 0, duplicates: 0 }
  if (!message.text || !message.chat?.username) return empty
  // Команды и сообщения ботов — это не обсуждение.
  if (message.text.trim().startsWith('/')) return empty
  if (message.from?.is_bot) return empty

  const matched = await sources.findChatSourcesByUsername(message.chat.username)
  if (matched.length === 0) return empty

  const scanned = {
    external_id: `${message.chat.id}:${message.message_id}`,
    commenter_name: displayName(message.from),
    text: message.text.trim(),
    posted_at: postedAt(message),
  }

  let created = 0
  let duplicates = 0
  for (const source of matched) {
    const result = await comments.insertScanned(Number(source.id), [scanned])
    created += result.created
    duplicates += result.duplicates
    if (result.created > 0) {
      await sources.markScanOk(Number(source.id))
    }
  }
  return { sources: matched.length, created, duplicates }
}

/** Сколько сообщений из чатов пришло в источники канала (для диагностики). */
export async function chatCommentsCount(authorId: number): Promise<number> {
  const rows = await query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM comments c
       JOIN sources s ON s.id = c.source_id
      WHERE s.author_id = $1 AND c.external_id ~ '^[0-9]+:[0-9]+$'`,
    [authorId],
  )
  return Number(rows[0]?.count ?? 0)
}
