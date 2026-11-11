/**
 * Онбординг в Telegram-боте: анализ канала по ссылке прямо в чате.
 *
 * Сценарий: человек присылает боту ссылку на свой публичный канал
 * (https://t.me/имя_канала). Бот импортирует до 10 последних постов через
 * публичную веб-версию t.me/s/<channel>, строит профиль стиля тем же
 * правиловым движком, что и POST /author-profiles/{id}/tov/analyze, сохраняет
 * его в tov_profiles и отвечает короткой карточкой.
 *
 * Сервис ничего не знает о Fastify: webhook зовёт handleBotMessage и сам
 * отправляет reply. Ошибки импорта не должны ронять доставку update:
 * они превращаются в понятный ответ (или handled: false для чужих сообщений).
 */
import type { SessionUser } from '../auth.ts'
import { assertRateAllowed } from './authRateLimit.ts'
import { env } from '../env.ts'
import * as authorProfiles from '../repositories/authorProfiles.ts'
import * as tovRepo from '../repositories/tov.ts'
import * as users from '../repositories/users.ts'
import { TelegramAdapter } from './adapters/telegram.ts'
import type { ImportedPost } from './adapters/types.ts'
import { analyzeTov, type TovAnalysis } from './style.ts'
import { displayName, type TelegramMessage, type TelegramUser } from './telegramBot.ts'

/** Сколько постов канала просим у адаптера: больше для карточки не нужно. */
export const IMPORT_POSTS_LIMIT = 10

/** Ссылка на канал: t.me/name, t.me/s/name, https://t.me/name (регистр — любой). */
export const CHANNEL_LINK_RE = /t\.me\/(?:s\/)?([A-Za-z0-9_]{3,})/i

/** Публичный канал без постов (или закрытый): импорт вернул меньше двух постов. */
export const NO_POSTS_REPLY = 'Не вижу постов, канал должен быть публичным'

/** Посты есть, но текста мало для правилового анализа (это не ошибка канала). */
export const TOO_SHORT_REPLY =
  'Постов для анализа стиля мало: нужно хотя бы два поста общим объёмом от 180 символов. Пришлите ссылку на канал с более длинными постами.'

export interface BotMessageResult {
  /** true — сообщение обработано ботом, webhook отвечает reply и выходит. */
  handled: boolean
  reply?: string
}

export interface ChannelLink {
  /** Имя канала без @, как его понимает t.me/s/<channel>. */
  channel: string
  /** Нормализованный адрес для TelegramAdapter.importPosts. */
  url: string
}

/**
 * Разбирает ссылку на канал из свободного текста.
 * Возвращает null для всего, что не похоже на t.me/<имя>: текст канала
 * https://example.com/name, слишком короткое имя, пустая ссылка.
 */
export function parseChannelLink(text: string): ChannelLink | null {
  const match = CHANNEL_LINK_RE.exec(String(text ?? ''))
  const channel = match?.[1]?.trim()
  if (!channel) return null
  return { channel, url: `https://t.me/${channel}` }
}

/** Приветствие на /start без кода: коротко объясняем, что прислать. */
function greeting(message: TelegramMessage): string {
  const name = displayName(message.from, 'друг')
  return [
    `Привет, ${name}! Я бот BlogOS.`,
    '',
    'Пришлите ссылку на свой канал (https://t.me/имя_канала) — разберу стиль и покажу карточку.',
  ].join('\n')
}

/** Похоже ли сообщение на команду /start (с кодом входа или без). */
function startPayload(text: string): string | null {
  if (!text.startsWith('/start')) return null
  return text.slice('/start'.length).trim()
}

/**
 * Главная точка входа. Вызывается webhook для приватных чатов ДО разбора
 * /start login_<код>: команда входа возвращается как handled: false и
 * обрабатывается прежней веткой, поэтому вход через бота не меняется.
 */
export async function handleBotMessage(input: {
  message?: TelegramMessage | null
}): Promise<BotMessageResult> {
  const message = input?.message
  const text = message?.text?.trim() ?? ''
  if (!message || !message.chat || !text) return { handled: false }

  const payload = startPayload(text)
  if (payload !== null) {
    // /start login_<код> и прочие /start с параметром — не онбординг.
    if (payload.length > 0) return { handled: false }
    return { handled: true, reply: greeting(message) }
  }

  const link = parseChannelLink(text)
  if (!link) return { handled: false }
  // Приватное сообщение всегда с автором; без него некого привязывать к каналу.
  if (!message.from) return { handled: false }
  // Спам ссылками: бот создаёт каналы в обход HTTP-лимитов, поэтому
  // ограничиваем частоту по telegram_id (одна ссылка в минуту).
  assertRateAllowed(`bot-link:${message.from.id}`, 2, 60_000, 'Слишком часто: пришлите ссылку ещё раз через минуту')

  return { handled: true, reply: await analyzeChannel(link, message.from) }
}

/** Импорт постов → анализ → сохранение профиля → текст карточки. */
async function analyzeChannel(link: ChannelLink, from: TelegramUser): Promise<string> {
  let posts: ImportedPost[]
  try {
    posts = await new TelegramAdapter().importPosts({
      sourceUrl: link.url,
      limit: IMPORT_POSTS_LIMIT,
    })
  } catch (error) {
    // Ошибка сети/404 по каналу для человека выглядит так же, как пустой канал.
    console.warn(
      '[telegram-onboarding] импорт постов не удался:',
      error instanceof Error ? error.message : error,
    )
    return NO_POSTS_REPLY
  }

  const texts = posts.map((post) => String(post.text ?? '').trim()).filter(Boolean)
  if (posts.length < 2 || texts.length < 2) return NO_POSTS_REPLY

  const analysis = analyzeTov(texts)
  if (!analysis) return TOO_SHORT_REPLY

  const user = await findOrCreateUser(from)
  const profile = await findOrCreateProfile(user.id, link.channel)
  // Тот же upsert, что и в POST /author-profiles/{id}/tov/analyze.
  await tovRepo.upsert(Number(profile.id), analysis.input)

  return renderCard(link.channel, analysis)
}

async function findOrCreateUser(from: TelegramUser): Promise<SessionUser> {
  const existing = await users.findByTelegramId(from.id)
  if (existing) return existing
  return users.create(from.id, displayName(from))
}

/**
 * Канал ищем среди telegram-каналов пользователя по имени (имя канала в
 * Telegram уникально и регистронезависимо). Нет — создаём с дефолтным
 * лимитом расходов, как POST /author-profiles.
 */
async function findOrCreateProfile(userId: number, channel: string): Promise<authorProfiles.Row> {
  const listed = await authorProfiles.list(
    userId,
    { limit: 200, cursor: null, from: null, to: null },
    'telegram',
  )
  const wanted = channel.toLowerCase()
  const existing = listed.items.find((profile) => String(profile.name).toLowerCase() === wanted)
  if (existing) return existing

  return authorProfiles.create(userId, {
    name: channel,
    platform: 'telegram',
    description: `https://t.me/${channel}`,
    monthly_cost_limit: env.DEFAULT_MONTHLY_COST_LIMIT,
  })
}

/** Число без лишних нулей: 9.4 → «9.4», 10 → «10». */
function formatNumber(value: unknown): string {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return String(Math.round(parsed * 10) / 10)
}

/** Короткая карточка стиля: обращение, ритм, темы, стоп-слова. */
function renderCard(channel: string, analysis: TovAnalysis): string {
  const metrics = analysis.engineProfile
  const address = String(metrics.address ?? analysis.input.tone ?? 'смешанное')
  const topics = (metrics.topTerms ?? [])
    .slice(0, 3)
    .map((term) => term?.label)
    .filter((label): label is string => typeof label === 'string' && label.length > 0)
  const stopWords = (analysis.input.stop_words ?? []).filter(
    (word): word is string => typeof word === 'string' && word.length > 0,
  )

  const lines = [
    `Готово! Разобрал канал «${channel}».`,
    '',
    `• Обращение: ${address}`,
    `• Средняя длина фразы: ${formatNumber(metrics.avgSentenceLen)} слов`,
  ]
  if (topics.length > 0) lines.push(`• Главные темы: ${topics.join(', ')}`)
  if (stopWords.length > 0) lines.push(`• Стоп-слова: ${stopWords.join(', ')}`)
  lines.push('', 'Дальше: откройте сайт и нажмите «Собрать черновик».')

  return lines.join('\n')
}
