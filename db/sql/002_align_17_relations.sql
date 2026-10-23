-- ═══════════════════════════════════════════════════════════════════════════════
-- BlogOS — миграция 002: приведение схемы к 17 связям и совместимость
-- неизменяемости lint_reports с обнулением ссылки на журнал AI.
--
-- Закрывает два расхождения, найденные на ревизии схемы (docs/DB-REVIEW.md):
--
-- DB-1. В ТЗ и в шапке DDL заявлено «14 таблиц, 17 связей», а фактически было 18:
--   лишней была tov_profiles.generation_run_id. Связь удалена — профиль стиля
--   по-прежнему виден в журнале через generation_runs (author_id + task_type =
--   'tov_analyze'), отдельная ссылка для этого не нужна. Колонка удаляется,
--   поэтому репозиторий стиля не должен её использовать.
--
-- DB-2. lint_reports.generation_run_id объявлен ON DELETE SET NULL (ТЗ, раздел 7:
--   «обнуление всегда для ссылок на generation_runs»), но триггер неизменяемости
--   запрещал любой UPDATE, и удаление вызова AI падало с ошибкой P0001.
--   Функция триггера заменена: разрешено только обнуление generation_run_id,
--   содержимое отчёта остаётся неизменным.
--
-- Файл идемпотентен: безопасен для повторного запуска и для чистой базы.
-- ═══════════════════════════════════════════════════════════════════════════════

-- DB-1: убираем служебную ссылку, чтобы связей стало ровно 17.
ALTER TABLE tov_profiles DROP COLUMN IF EXISTS generation_run_id;

-- DB-2: неизменяемость отчёта — с единственным разрешённым исключением.
CREATE OR REPLACE FUNCTION blogos_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'lint_reports'
     AND NEW.generation_run_id IS NULL
     AND OLD.generation_run_id IS NOT NULL
     AND (to_jsonb(NEW) - 'generation_run_id') = (to_jsonb(OLD) - 'generation_run_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Таблица % неизменяема после создания', TG_TABLE_NAME;
END $$;

COMMENT ON FUNCTION blogos_forbid_update() IS
  'Запрет UPDATE для неизменяемых таблиц. Единственное исключение: обнуление lint_reports.generation_run_id при удалении вызова AI (ON DELETE SET NULL)';
