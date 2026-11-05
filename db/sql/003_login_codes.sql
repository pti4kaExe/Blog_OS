-- ═══════════════════════════════════════════════════════════════════════════════
-- BlogOS — миграция 003: одноразовые коды входа через Telegram-бота.
--
-- Служебная таблица, а не доменная: 14 таблиц из ТЗ описывают предметную
-- область (авторы, стиль, посты, проверки), а эта таблица нужна только
-- механизму входа. Второй служебной таблицей уже является _migrations.
--
-- Как работает вход:
--   1. сайт просит код: POST /auth/telegram/start → строка status='pending';
--   2. человек открывает https://t.me/<бот>?start=login_<код>, бот получает
--      /start с кодом и подтверждает его: status='confirmed', telegram_id, user_id;
--   3. сайт опрашивает GET /auth/telegram/status?code=… и получает JWT.
-- Код живёт 10 минут и после подтверждения больше не принимается ботом.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS login_codes (
  code         text PRIMARY KEY,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'confirmed', 'expired')),
  telegram_id  bigint,
  name         text,
  -- Ссылка на пользователя без внешнего ключа: служебная таблица не должна
  -- менять контракт доменной схемы (17 связей из ТЗ). Если пользователь удалён,
  -- статус просто не выдаст токен — код живёт минуты, это безопасно.
  user_id      bigint,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  confirmed_at timestamptz
);

-- Совместимость с базами, где 003 успел создать внешний ключ.
ALTER TABLE login_codes DROP CONSTRAINT IF EXISTS login_codes_user_id_fkey;

COMMENT ON TABLE login_codes IS 'Одноразовые коды входа через Telegram-бота (служебная таблица)';
COMMENT ON COLUMN login_codes.code IS 'Случайный код из 16 hex-символов; попадает в deep-link бота';
COMMENT ON COLUMN login_codes.user_id IS 'Пользователь, созданный или найденный при подтверждении кода';

-- Поиск протухших кодов и уборка: индексы только под два реальных запроса.
CREATE INDEX IF NOT EXISTS login_codes_expires_idx ON login_codes (expires_at);
CREATE INDEX IF NOT EXISTS login_codes_status_idx ON login_codes (status, created_at DESC);
