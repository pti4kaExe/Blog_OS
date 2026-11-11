-- 005: лимит расходов по умолчанию для каналов, созданных раньше.
--
-- monthly_cost_limit по умолчанию был NULL, то есть «лимита нет»: AI-вызовы
-- никогда не блокировались, и любой аккаунт мог тратить ключ владельца без
-- ограничений. Новые каналы получают лимит из DEFAULT_MONTHLY_COST_LIMIT,
-- существующие — этот backfill. Явно заданный автором лимит не трогаем.
UPDATE author_profiles
   SET monthly_cost_limit = 100
 WHERE monthly_cost_limit IS NULL;
