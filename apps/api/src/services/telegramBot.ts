/**
 * Клиент Telegram Bot API — только то, что нужно для входа.
 *
 * Сетевые вызовы идут с сервера, ключ бота в клиентский код не попадает.
 * Все методы Telegram возвращают { ok, result } или { ok:false, description }.
 */
import { env } from '../env.ts'
import { liveString } from '../lib/liveEnv.ts'
import { notConfigured, upstreamUnavailable } from '../errors.ts'

const TIMEOUT_MS = 10_000

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  is_bot?: boolean
}

export interface TelegramMessage {
  message_id: number
  // date — unix-время сообщения; используется как posted_at комментария.
  date?: number
  chat: { id: number; type: string; username?: string; title?: string }
  from?: TelegramUser
  text?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

function botToken(): string {
  return liveString('TELEGRAM_BOT_TOKEN', env.TELEGRAM_BOT_TOKEN)
}

/** Настроен ли вход через бота: нужны и токен, и username для deep-link. */
export function telegramLoginConfigured(): boolean {
  return botToken().length > 0 && botUsername().length > 0
}

export function botUsername(): string {
  return liveString('TELEGRAM_BOT_USERNAME', env.TELEGRAM_BOT_USERNAME).trim().replace(/^@/, '')
}

export function webhookSecret(): string {
  return liveString('TELEGRAM_WEBHOOK_SECRET', env.TELEGRAM_WEBHOOK_SECRET)
}

function apiBase(): string {
  return `${env.TELEGRAM_API_BASE.replace(/\/$/, '')}/bot${botToken()}`
}

async function callApi<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!botToken()) throw notConfigured('Telegram Bot API')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    let lastError = 'неизвестная ошибка'
    // Одна повторная попытка, как и для остальных внешних сервисов (ТЗ, раздел 8).
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(`${apiBase()}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        const data = (await response.json()) as { ok?: boolean; result?: T; description?: string }
        if (!response.ok || !data.ok) {
          lastError = data.description ?? `HTTP ${response.status}`
          continue
        }
        return data.result as T
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
    throw upstreamUnavailable(`Telegram: ${method} не выполнен (${lastError})`, { method })
  } finally {
    clearTimeout(timer)
  }
}

/** Регистрирует webhook в Telegram. Без PUBLIC_API_URL ничего не делает. */
export async function registerWebhook(
  overrideUrl?: string,
): Promise<{ configured: boolean; url?: string }> {
  // Адрес можно передать явно (внутренний вызов на serverless) или взять из env.
  const publicUrl = (overrideUrl ?? env.PUBLIC_API_URL).trim().replace(/\/$/, '')
  if (!telegramLoginConfigured() || !publicUrl) return { configured: false }
  const url = `${publicUrl}/telegram/webhook`
  const payload: Record<string, unknown> = {
    url,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  }
  if (env.TELEGRAM_WEBHOOK_SECRET) payload.secret_token = env.TELEGRAM_WEBHOOK_SECRET
  await callApi<boolean>('setWebhook', payload)
  return { configured: true, url }
}

export async function getWebhookInfo(): Promise<{
  url?: string
  pending_update_count?: number
  last_error_message?: string
  last_error_date?: number
}> {
  return callApi('getWebhookInfo')
}

/** Сообщение пользователю в чат. Ошибки не должны ломать обработку update. */
export async function sendMessage(chatId: number, text: string): Promise<void> {
  try {
    await callApi('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    })
  } catch (error) {
    console.warn('[telegram] не удалось отправить сообщение:', error instanceof Error ? error.message : error)
  }
}

/** Кнопка меню бота открывает клиент BlogOS как Mini App (если задан адрес). */
export async function setMenuButton(webAppUrl: string, text = 'Открыть BlogOS'): Promise<void> {
  await callApi('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text,
      web_app: { url: webAppUrl },
    },
  })
}

export function displayName(user: TelegramUser | undefined, fallback = 'Пользователь'): string {
  if (!user) return fallback
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return full || (user.username ? `@${user.username}` : fallback)
}
