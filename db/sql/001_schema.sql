-- ═══════════════════════════════════════════════════════════════════════════════
-- BlogOS — целевая схема базы данных, версия 2
-- PostgreSQL 16 + pgvector
--
-- Источник: ТЗ v1.1, раздел 7 «База и модель данных» и документ
-- «BlogOS: структура базы данных и методы сервиса».
-- 14 таблиц, 17 внешних ключей. Решения по открытым вопросам документа —
-- в docs/DECISIONS.md.
--
-- Порядок таблиц в файле — по зависимостям внешних ключей, а не по нумерации
-- документа; номер таблицы в документе указан в заголовке каждой секции.
-- Файл идемпотентен: повторный запуск не ломает существующую базу.
-- Применяется миграционным раннером apps/api/scripts/migrate.ts.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Перечисления ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('user', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE platform AS ENUM ('telegram', 'instagram', 'youtube');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Тип контента зависит от площадки: telegram → post; instagram → caption,
-- reels_script; youtube → video_script, video_description (ТЗ, раздел 7).
DO $$ BEGIN
  CREATE TYPE content_type AS ENUM (
    'post', 'caption', 'reels_script', 'video_script', 'video_description'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE draft_origin AS ENUM ('author', 'narrative_engine');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE draft_status AS ENUM ('draft', 'on_check', 'ready', 'published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE response_status AS ENUM (
    'generated', 'pending_approval', 'approved', 'rejected', 'sent'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE source_type AS ENUM (
    'telegram_channel', 'telegram_chat', 'instagram', 'youtube', 'manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_status AS ENUM ('never', 'ok', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_type AS ENUM (
    'narrative_generate', 'lint', 'tov_analyze', 'response_generate', 'embeddings'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE run_status AS ENUM ('pending', 'success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Служебные функции ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION blogos_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- Отчёт AntiCringe неизменяем после создания (ТЗ, раздел 7): история проверок —
-- это цепочка отчётов, а не перезапись одного и того же.
CREATE OR REPLACE FUNCTION blogos_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Таблица % неизменяема после создания', TG_TABLE_NAME;
END $$;

-- ─── 1. users ─────────────────────────────────────────────────────────────────
-- Учётные записи, вход через Telegram. Регистрации нет: запись создаётся при
-- первом входе. Роль admin выдаётся только вручную в базе.
CREATE TABLE IF NOT EXISTS users (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_id bigint      NOT NULL UNIQUE,
  name        text        NOT NULL CHECK (length(btrim(name)) > 0),
  role        user_role   NOT NULL DEFAULT 'user',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN users.role IS 'Роль выдаётся только вручную в базе: метода назначения роли нет намеренно';

CREATE OR REPLACE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 2. author_profiles ───────────────────────────────────────────────────────
-- Каналы и блоги одного автора на разных площадках. Всё остальное привязано
-- к каналу (author_id), а не к пользователю: у одного человека может быть
-- несколько площадок с разными стилями и лимитами.
CREATE TABLE IF NOT EXISTS author_profiles (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            bigint       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name               text         NOT NULL CHECK (length(btrim(name)) > 0),
  platform           platform     NOT NULL,
  description        text,
  content_settings   jsonb,
  monthly_cost_limit numeric(12, 2) CHECK (monthly_cost_limit IS NULL OR monthly_cost_limit >= 0),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON COLUMN author_profiles.content_settings IS '{"topics": [], "language": "ru", "target_length": {"min": 800, "max": 2500}}';
COMMENT ON COLUMN author_profiles.monthly_cost_limit IS 'Лимит расходов на AI в месяц. NULL — без лимита';

CREATE INDEX IF NOT EXISTS author_profiles_user_created_idx ON author_profiles (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS author_profiles_user_platform_idx ON author_profiles (user_id, platform);

CREATE OR REPLACE TRIGGER author_profiles_touch_updated_at
  BEFORE UPDATE ON author_profiles FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 12. generation_runs ──────────────────────────────────────────────────────
-- Журнал каждого вызова AI-модели и расходов. Создаётся раньше таблиц 3—10:
-- на неё ссылаются tov_profiles, lint_reports и generated_responses.
-- Переживает удаление канала: author_id обнуляется, запись остаётся — иначе
-- удаление автора стирало бы историю расходов.
CREATE TABLE IF NOT EXISTS generation_runs (
  id            bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id     bigint  REFERENCES author_profiles (id) ON DELETE SET NULL,
  task_type     task_type NOT NULL,
  model         text    NOT NULL,
  tokens_input  integer NOT NULL DEFAULT 0 CHECK (tokens_input >= 0),
  tokens_output integer NOT NULL DEFAULT 0 CHECK (tokens_output >= 0),
  tokens        integer NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  cost          numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  status        run_status NOT NULL DEFAULT 'pending',
  error_message text,
  duration_ms   integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN generation_runs.tokens IS 'Сумма tokens_input и tokens_output — для быстрых отчётов по расходам';

CREATE INDEX IF NOT EXISTS generation_runs_author_created_idx ON generation_runs (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generation_runs_author_status_idx ON generation_runs (author_id, status);
CREATE INDEX IF NOT EXISTS generation_runs_created_idx ON generation_runs (created_at DESC);

-- ─── 3. tov_profiles ──────────────────────────────────────────────────────────
-- Серверный аналог карточки стиля из Шага 1. Один профиль на канал:
-- уникальный author_id (ТЗ: «один профиль на канал»).
-- Поле metrics добавлено к перечню ТЗ: карточка — это 15+ посчитанных метрик,
-- без их хранения шаг «Стиль» на сервере не восстановить.
CREATE TABLE IF NOT EXISTS tov_profiles (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id         bigint      NOT NULL UNIQUE REFERENCES author_profiles (id) ON DELETE CASCADE,
  tone              text        NOT NULL CHECK (tone IN ('ты', 'вы', 'смешанное')),
  slang             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  stop_words        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  favorite_phrases  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  metrics           jsonb,
  analyzed_at       timestamptz,
  generation_run_id bigint      REFERENCES generation_runs (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tov_profiles_slang_is_array CHECK (jsonb_typeof(slang) = 'array'),
  CONSTRAINT tov_profiles_stop_words_is_array CHECK (jsonb_typeof(stop_words) = 'array'),
  CONSTRAINT tov_profiles_phrases_is_array CHECK (jsonb_typeof(favorite_phrases) = 'array')
);
COMMENT ON COLUMN tov_profiles.metrics IS 'Результат buildStyleProfile(): длина и разброс фраз, доля «я», темы, читаемость, стиль начала';
COMMENT ON COLUMN tov_profiles.generation_run_id IS 'Заполнен, если профиль собран AI-анализом; NULL — правиловым движком';

CREATE OR REPLACE TRIGGER tov_profiles_touch_updated_at
  BEFORE UPDATE ON tov_profiles FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 4. posts ─────────────────────────────────────────────────────────────────
-- Архив опубликованных постов — источник профиля стиля по реальной истории.
-- Дедупликация импорта: пара (author_id, external_id).
CREATE TABLE IF NOT EXISTS posts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id    bigint       NOT NULL REFERENCES author_profiles (id) ON DELETE CASCADE,
  content_type content_type NOT NULL,
  text         text         NOT NULL CHECK (length(text) > 0),
  external_id  text,
  external_url text,
  published_at timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON COLUMN posts.external_id IS 'ID поста на площадке. NULL для постов, вставленных вручную';

CREATE UNIQUE INDEX IF NOT EXISTS posts_author_external_id_key
  ON posts (author_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS posts_author_external_url_key
  ON posts (author_id, external_url) WHERE external_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_author_published_idx ON posts (author_id, published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS posts_author_created_idx ON posts (author_id, created_at DESC);

CREATE OR REPLACE TRIGGER posts_touch_updated_at
  BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 5. drafts ────────────────────────────────────────────────────────────────
-- Черновики — ручные или собранные Narrative Engine. При каждой правке
-- меняется текст, а не создаётся новый черновик.
-- published_post_id уникален и обнуляется при удалении поста: черновик
-- переживает удаление публикации (ТЗ, раздел 4).
CREATE TABLE IF NOT EXISTS drafts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id         bigint       NOT NULL REFERENCES author_profiles (id) ON DELETE CASCADE,
  title             text,
  source_notes      text,
  text              text         NOT NULL DEFAULT '',
  origin            draft_origin NOT NULL DEFAULT 'author',
  status            draft_status NOT NULL DEFAULT 'draft',
  arc               text,
  published_post_id bigint       UNIQUE REFERENCES posts (id) ON DELETE SET NULL,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON COLUMN drafts.source_notes IS 'Сырые заметки по строкам — вход Narrative Engine';
COMMENT ON COLUMN drafts.arc IS 'story_case, problem_solution, opinion_breakdown или NULL — автовыбор';

CREATE INDEX IF NOT EXISTS drafts_author_created_idx ON drafts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS drafts_status_idx ON drafts (status);

CREATE OR REPLACE TRIGGER drafts_touch_updated_at
  BEFORE UPDATE ON drafts FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 6. lint_reports ──────────────────────────────────────────────────────────
-- Отчёты AntiCringe, неизменяемые после создания.
-- generation_run_id пуст для правилового движка без AI.
-- issues: [{type, quote, start, end, explanation, suggestion, severity}]
CREATE TABLE IF NOT EXISTS lint_reports (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  draft_id          bigint      NOT NULL REFERENCES drafts (id) ON DELETE CASCADE,
  generation_run_id bigint      REFERENCES generation_runs (id) ON DELETE SET NULL,
  score             integer     NOT NULL CHECK (score BETWEEN 0 AND 100),
  issues            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  engine            text        NOT NULL DEFAULT 'rules'
                    CHECK (engine IN ('rules', 'rules+llm')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lint_reports_issues_is_array CHECK (jsonb_typeof(issues) = 'array')
);
COMMENT ON COLUMN lint_reports.engine IS 'rules — правиловый движок без AI; rules+llm — с замечаниями модели';

CREATE INDEX IF NOT EXISTS lint_reports_draft_created_idx ON lint_reports (draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lint_reports_run_idx ON lint_reports (generation_run_id);

CREATE OR REPLACE TRIGGER lint_reports_immutable
  BEFORE UPDATE ON lint_reports FOR EACH ROW EXECUTE FUNCTION blogos_forbid_update();

-- ─── 7. sources ───────────────────────────────────────────────────────────────
-- Отслеживаемые площадки и каналы для CommentRadar.
CREATE TABLE IF NOT EXISTS sources (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id        bigint      NOT NULL REFERENCES author_profiles (id) ON DELETE CASCADE,
  name             text        NOT NULL CHECK (length(btrim(name)) > 0),
  source_type      source_type NOT NULL,
  source_url       text        NOT NULL,
  is_active        boolean     NOT NULL DEFAULT true,
  last_scanned_at  timestamptz,
  last_scan_status scan_status NOT NULL DEFAULT 'never',
  last_scan_error  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN sources.last_scan_status IS 'Результат последнего сканирования: никогда, успех, отказ площадки';
COMMENT ON COLUMN sources.last_scan_error IS 'Текст ошибки последнего неудачного сканирования — для интерфейса';

CREATE UNIQUE INDEX IF NOT EXISTS sources_author_url_key ON sources (author_id, source_url);
CREATE INDEX IF NOT EXISTS sources_author_active_idx ON sources (author_id, is_active);

CREATE OR REPLACE TRIGGER sources_touch_updated_at
  BEFORE UPDATE ON sources FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 8. comments ──────────────────────────────────────────────────────────────
-- Найденные обсуждения и комментарии. Внешний ID уникален в рамках источника;
-- добавленные вручную помечаются значением manual:<номер>.
CREATE TABLE IF NOT EXISTS comments (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id      bigint      NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  external_id    text        NOT NULL,
  commenter_name text,
  text           text        NOT NULL CHECK (length(text) > 0),
  posted_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS comments_source_external_key ON comments (source_id, external_id);
CREATE INDEX IF NOT EXISTS comments_source_created_idx ON comments (source_id, created_at DESC);

CREATE OR REPLACE TRIGGER comments_touch_updated_at
  BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 9. generated_responses ───────────────────────────────────────────────────
-- Варианты ответа на комментарий. response_text неизменяем (что сгенерировал
-- движок), edited_text — правка автора.
CREATE TABLE IF NOT EXISTS generated_responses (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comment_id        bigint          NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  response_text     text            NOT NULL CHECK (length(response_text) > 0),
  edited_text       text,
  status            response_status NOT NULL DEFAULT 'generated',
  approved_at       timestamptz,
  sent_at           timestamptz,
  generation_run_id bigint          REFERENCES generation_runs (id) ON DELETE SET NULL,
  created_at        timestamptz     NOT NULL DEFAULT now(),
  updated_at        timestamptz     NOT NULL DEFAULT now(),
  CONSTRAINT generated_responses_approved_at_required
    CHECK (status NOT IN ('approved', 'sent') OR approved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS generated_responses_comment_idx ON generated_responses (comment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_responses_status_idx ON generated_responses (status);

CREATE OR REPLACE TRIGGER generated_responses_touch_updated_at
  BEFORE UPDATE ON generated_responses FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 10. knowledge_base ───────────────────────────────────────────────────────
-- Факты автора для RAG, чтобы AI не придумывала.
CREATE TABLE IF NOT EXISTS knowledge_base (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id  bigint      NOT NULL REFERENCES author_profiles (id) ON DELETE CASCADE,
  title      text        NOT NULL CHECK (length(btrim(title)) > 0),
  content    text        NOT NULL CHECK (length(btrim(content)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_base_author_created_idx ON knowledge_base (author_id, created_at DESC);

CREATE OR REPLACE TRIGGER knowledge_base_touch_updated_at
  BEFORE UPDATE ON knowledge_base FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 11. embeddings ───────────────────────────────────────────────────────────
-- Векторы текстов для поиска по базе знаний и прошлым постам.
-- Привязан ровно к одному из post_id / knowledge_id — открытый вопрос
-- документа «нужно поле связи» закрыт этим ограничением.
-- N = 1536 задаётся моделью text-embedding-3-small и фиксируется здесь:
-- смена модели — это миграция колонки, а не смена значения в env.
CREATE TABLE IF NOT EXISTS embeddings (
  id           bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id      bigint  REFERENCES posts (id) ON DELETE CASCADE,
  knowledge_id bigint  REFERENCES knowledge_base (id) ON DELETE CASCADE,
  chunk_index  integer NOT NULL DEFAULT 0 CHECK (chunk_index >= 0),
  chunk_text   text    NOT NULL CHECK (length(chunk_text) > 0),
  embedding    vector(1536) NOT NULL,
  model        text    NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT embeddings_exactly_one_owner
    CHECK ((post_id IS NOT NULL)::int + (knowledge_id IS NOT NULL)::int = 1)
);
COMMENT ON COLUMN embeddings.embedding IS 'pgvector(1536): размерность задаёт модель эмбеддингов. Разные модели не смешиваются — поле model обязательно';
COMMENT ON COLUMN embeddings.model IS 'Например text-embedding-3-small. При смене модели видно, какие векторы пересчитывать';

CREATE INDEX IF NOT EXISTS embeddings_post_idx
  ON embeddings (post_id, chunk_index) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS embeddings_knowledge_idx
  ON embeddings (knowledge_id, chunk_index) WHERE knowledge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS embeddings_model_idx ON embeddings (model);
-- Поиск по косинусному расстоянию: HNSW, как требует раздел 7 ТЗ.
CREATE INDEX IF NOT EXISTS embeddings_hnsw_cosine_idx
  ON embeddings USING hnsw (embedding vector_cosine_ops);

-- ─── 13. golden_dataset ───────────────────────────────────────────────────────
-- Эталонные тексты с разметкой — только администратор.
CREATE TABLE IF NOT EXISTS golden_dataset (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  text       text        NOT NULL CHECK (length(text) > 0),
  labels     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  platform   platform,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT golden_dataset_labels_is_array CHECK (jsonb_typeof(labels) = 'array')
);
COMMENT ON COLUMN golden_dataset.labels IS '[{"type": "cliche", "quote": "…", "start": 10, "end": 22}]';

CREATE INDEX IF NOT EXISTS golden_dataset_platform_idx ON golden_dataset (platform);

CREATE OR REPLACE TRIGGER golden_dataset_touch_updated_at
  BEFORE UPDATE ON golden_dataset FOR EACH ROW EXECUTE FUNCTION blogos_touch_updated_at();

-- ─── 14. eval_results ────────────────────────────────────────────────────────
-- Результат сравнения прогона с эталоном. Уникальная пара
-- (generation_run_id, golden_id): один эталон оценивается в прогоне один раз.
CREATE TABLE IF NOT EXISTS eval_results (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generation_run_id bigint NOT NULL REFERENCES generation_runs (id) ON DELETE CASCADE,
  golden_id         bigint NOT NULL REFERENCES golden_dataset (id) ON DELETE CASCADE,
  precision         numeric(5, 4) CHECK (precision IS NULL OR precision BETWEEN 0 AND 1),
  recall            numeric(5, 4) CHECK (recall IS NULL OR recall BETWEEN 0 AND 1),
  matched        jsonb NOT NULL DEFAULT '[]'::jsonb,
  missed         jsonb NOT NULL DEFAULT '[]'::jsonb,
  false_positive jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eval_results_run_golden_key UNIQUE (generation_run_id, golden_id)
);

CREATE INDEX IF NOT EXISTS eval_results_golden_idx ON eval_results (golden_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Итог: 14 таблиц, 17 внешних ключей.
-- Удаление по умолчанию каскадное. Обнуление (SET NULL) — только для ссылок
-- на generation_runs и для drafts.published_post_id: журнал расходов и
-- черновики не должны исчезать вместе с родителем.
-- ═══════════════════════════════════════════════════════════════════════════════
