/**
 * Окружение тестов. Модуль импортируется ПЕРВЫМ (через helpers.ts):
 * env.ts сервера читает process.env один раз, поэтому тестовые значения
 * выставляются до динамического импорта приложения.
 *
 * DATABASE_URL=pglite://memory — настоящий PostgreSQL 16 + pgvector в WASM,
 * отдельная база на процесс тестов (docs/DECISIONS.md, решение № 25).
 */
process.env.DATABASE_URL = 'pglite://memory'
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.DEV_AUTH = '1'
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef'
process.env.LLM_PROVIDER = 'mock'
process.env.EMBEDDINGS_PROVIDER = 'mock'
process.env.TELEGRAM_BOT_TOKEN = ''
process.env.INSTAGRAM_ACCESS_TOKEN = ''
process.env.YOUTUBE_API_KEY = ''
process.env.REDIS_URL = ''
process.env.COST_WARN_RATIO = '0.8'
process.env.LLM_TIMEOUT_MS = '5000'

export {}
