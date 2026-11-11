-- 004: одноразовая выдача токена для входа через бота.
--
-- До этого код можно было обменять на JWT сколько угодно раз в течение TTL:
-- второй и последующие опросы статуса выдавали новый токен. Теперь статус
-- «использован» ставится атомарно в момент выдачи и повторно токен не выдаётся.
ALTER TABLE login_codes ADD COLUMN IF NOT EXISTS used_at timestamptz;

ALTER TABLE login_codes DROP CONSTRAINT IF EXISTS login_codes_status_check;
ALTER TABLE login_codes
  ADD CONSTRAINT login_codes_status_check
  CHECK (status IN ('pending', 'confirmed', 'expired', 'used'));

CREATE INDEX IF NOT EXISTS login_codes_used_idx
  ON login_codes (status, used_at)
  WHERE status = 'used';
