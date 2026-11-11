/**
 * Одноразовые коды входа через Telegram-бота.
 *
 * Смысл: сайт не может сам получить telegram_id — его знает только Telegram.
 * Поэтому сайт выдаёт код, человек открывает бота по ссылке, бот получает
 * /start login_<код>, подтверждает его, а сайт опрашивает статус и получает JWT.
 *
 * Подтверждение атомарно: UPDATE ... WHERE status='pending' AND expires_at > now()
 * гарантирует, что один код нельзя подтвердить дважды и что просроченный код
 * не сработает даже при гонке.
 */
import { randomBytes } from 'node:crypto'
import { query, queryOne } from '../db.ts'
import type { Row } from '../repositories/access.ts'
import { env } from '../env.ts'

export type LoginCodeStatus = 'pending' | 'confirmed' | 'expired' | 'used'

export interface LoginCodeRow {
  code: string
  status: LoginCodeStatus
  telegram_id: number | null
  name: string | null
  user_id: number | null
  created_at: string
  expires_at: string
  confirmed_at: string | null
}

/** Код из 16 hex-символов: достаточно случайности, удобно копировать. */
export function generateCode(): string {
  return randomBytes(8).toString('hex')
}

export async function createCode(): Promise<LoginCodeRow> {
  const ttlMinutes = env.LOGIN_CODE_TTL_MINUTES
  const row = await queryOne<LoginCodeRow>(
    `INSERT INTO login_codes (code, expires_at)
     VALUES ($1, now() + ($2 || ' minutes')::interval)
     RETURNING code, status, telegram_id, name, user_id, created_at, expires_at, confirmed_at`,
    [generateCode(), String(ttlMinutes)],
  )
  if (!row) throw new Error('Код входа не создан')
  return row
}

export async function getCode(code: string): Promise<LoginCodeRow | null> {
  return queryOne<LoginCodeRow>(
    `SELECT code, status, telegram_id, name, user_id, created_at, expires_at, confirmed_at
       FROM login_codes WHERE code = $1`,
    [code],
  )
}

export async function expireCode(code: string): Promise<void> {
  await query(
    `UPDATE login_codes SET status = 'expired'
      WHERE code = $1 AND status = 'pending' AND expires_at <= now()`,
    [code],
  )
}

/**
 * Подтверждение кода ботом. Возвращает строку только если код был свободен
 * и не истёк — иначе null (просрочен, уже использован или не существует).
 */
export async function confirmCode(
  code: string,
  data: { telegramId: number; name: string; userId: number },
): Promise<LoginCodeRow | null> {
  return queryOne<LoginCodeRow>(
    `UPDATE login_codes
        SET status = 'confirmed',
            telegram_id = $2,
            name = $3,
            user_id = $4,
            confirmed_at = now()
      WHERE code = $1 AND status = 'pending' AND expires_at > now()
      RETURNING code, status, telegram_id, name, user_id, created_at, expires_at, confirmed_at`,
    [code, data.telegramId, data.name, data.userId],
  )
}

/** Периодическая уборка: коды старше суток не нужны даже для диагностики. */
export async function cleanupOldCodes(): Promise<number> {
  const rows = await query<{ code: string }>(
    `DELETE FROM login_codes WHERE created_at < now() - interval '1 day' RETURNING code`,
  )
  return rows.length
}

/**
 * Атомарно «использует» подтверждённый код: после этого токен по нему не выдаётся.
 *
 * Раньше статус опрашивали сколько угодно раз, и каждый опрос confirmed
 * выпускал новый JWT. Теперь ровно один обмен: кто первый, того и токен.
 */
export async function claimCode(code: string): Promise<Row | null> {
  return queryOne<Row>(
    `UPDATE login_codes SET status = 'used', used_at = now()
      WHERE code = $1 AND status = 'confirmed'
      RETURNING *`,
    [code],
  )
}
