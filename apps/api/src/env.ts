/**
 * Переменные окружения: загрузка .env, проверка схемой, значения по умолчанию.
 *
 * Правила проекта:
 *  - секреты живут только здесь и только в переменных окружения сервера;
 *  - приложение падает на старте, если окружение неверно, — а не через час
 *    в первом запросе;
 *  - значения по умолчанию безопасны: mock-провайдеры, AI без денег и сети.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')

/** Минимальный парсер .env: KEY=VALUE, # комментарии, кавычки снимаются. */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

// Порядок: сначала .env рядом с процессом, затем корень монорепо.
// Уже заданные переменные окружения не перетираются: на хостинге они главнее.
loadEnvFile(resolve(process.cwd(), '.env'))
loadEnvFile(resolve(repoRoot, '.env'))

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === '1' || v.toLowerCase() === 'true'))

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max))

const csv = (def: string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v === '' ? def : v.split(',').map((s) => s.trim()).filter(Boolean),
    )

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3000, 1, 65535),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен: см. .env.example'),
  REDIS_URL: z.string().optional().default(''),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET короче 16 символов — небезопасно'),
  DEV_AUTH: bool(true),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(''),

  LLM_PROVIDER: z.enum(['mock', 'deepseek', 'openai']).default('mock'),
  DEEPSEEK_API_KEY: z.string().optional().default(''),
  DEEPSEEK_BASE_URL: z.string().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  LLM_TIMEOUT_MS: int(45_000, 1_000, 600_000),

  EMBEDDINGS_PROVIDER: z.enum(['mock', 'openai', 'none']).default('mock'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIM: int(1536, 1, 16_000),
  RAG_TOP_K: int(5, 1, 50),

  COST_WARN_RATIO: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 0.8 : Number(v)))
    .pipe(z.number().min(0).max(1)),

  CORS_ORIGIN: csv(['http://localhost:5173', 'http://127.0.0.1:5173']),

  // Площадки: пустой ключ означает «адаптер не настроен» и ответ 503 not_configured.
  TELEGRAM_API_BASE: z.string().default('https://api.telegram.org'),
  INSTAGRAM_GRAPH_BASE: z.string().default('https://graph.facebook.com/v21.0'),
  INSTAGRAM_ACCESS_TOKEN: z.string().optional().default(''),
  YOUTUBE_API_BASE: z.string().default('https://www.googleapis.com/youtube/v3'),
  YOUTUBE_API_KEY: z.string().optional().default(''),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.') || '(корень)'}: ${i.message}`)
    .join('\n')
  console.error(`\nОкружение сервера настроено неверно:\n${issues}\n\nСкопируйте .env.example в .env и заполните.\n`)
  process.exit(1)
}

export const env = parsed.data

export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'

/** Размерность вектора должна совпадать с vector(N) в схеме базы. */
export const EMBEDDING_DIM_EXPECTED = 1536
if (env.EMBEDDING_DIM !== EMBEDDING_DIM_EXPECTED) {
  console.warn(
    `[env] EMBEDDING_DIM=${env.EMBEDDING_DIM}, а колонка embeddings.embedding объявлена как vector(${EMBEDDING_DIM_EXPECTED}). ` +
      'Смена модели эмбеддингов требует миграции колонки — см. docs/DECISIONS.md, решение № 5.',
  )
}
