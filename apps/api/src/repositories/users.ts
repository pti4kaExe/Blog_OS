/** Пользователи: вход через Telegram, профиль, удаление. */
import { query, queryOne } from '../db.ts'
import type { SessionUser } from '../auth.ts'

export async function findByTelegramId(telegramId: number | string): Promise<SessionUser | null> {
  return queryOne<SessionUser>(
    `SELECT id, telegram_id, name, role, created_at, updated_at
       FROM users WHERE telegram_id = $1`,
    [telegramId],
  )
}

export async function getById(userId: number | string): Promise<SessionUser | null> {
  return queryOne<SessionUser>(
    `SELECT id, telegram_id, name, role, created_at, updated_at
       FROM users WHERE id = $1`,
    [userId],
  )
}

/** Создаёт пользователя при первом входе; повторный вход возвращает существующего. */
export async function create(
  telegramId: number | string,
  name: string,
): Promise<SessionUser> {
  const created = await queryOne<SessionUser>(
    `INSERT INTO users (telegram_id, name) VALUES ($1, $2)
     RETURNING id, telegram_id, name, role, created_at, updated_at`,
    [telegramId, name],
  )
  if (!created) throw new Error('Пользователь не создан')
  return created
}

export async function updateName(userId: number | string, name: string): Promise<SessionUser> {
  const updated = await queryOne<SessionUser>(
    `UPDATE users SET name = $2 WHERE id = $1
     RETURNING id, telegram_id, name, role, created_at, updated_at`,
    [userId, name],
  )
  if (!updated) throw new Error('Пользователь не найден')
  return updated
}

export async function remove(userId: number | string): Promise<void> {
  await query(`DELETE FROM users WHERE id = $1`, [userId])
}

export async function profilesCount(userId: number | string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT count(*)::int AS count FROM author_profiles WHERE user_id = $1`,
    [userId],
  )
  return Number(row?.count ?? 0)
}
