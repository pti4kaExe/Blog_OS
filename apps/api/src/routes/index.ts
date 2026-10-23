import type { FastifyInstance } from 'fastify'
import { authRoutes } from './auth.ts'
import { authorProfileRoutes } from './authorProfiles.ts'
import { tovRoutes } from './tov.ts'
import { postRoutes } from './posts.ts'
import { draftRoutes } from './drafts.ts'
import { lintRoutes } from './lint.ts'
import { sourceRoutes } from './sources.ts'
import { commentRoutes } from './comments.ts'
import { responseRoutes } from './responses.ts'
import { knowledgeRoutes } from './knowledge.ts'
import { serviceRoutes } from './service.ts'

/**
 * Регистрация всех групп методов API.
 *
 * Контракт: docs/API.md, 11 групп, 59 методов. Каждая группа доступна дважды:
 * в корне (`/auth/telegram`) и по алиасу `/api/v1/...` — один и тот же плагин
 * регистрируется без префикса и повторно с префиксом. /health живёт в app.ts
 * и не дублируется.
 */
const GROUPS = [
  authRoutes, // 1. вход и пользователь — 4
  authorProfileRoutes, // 2. каналы — 6
  tovRoutes, // 3. стиль — 3
  postRoutes, // 4. посты — 6
  draftRoutes, // 5. черновики — 7
  lintRoutes, // 6. проверка — 3
  sourceRoutes, // 7. источники — 5
  commentRoutes, // 8. комментарии — 6
  responseRoutes, // 9. варианты ответа — 6
  knowledgeRoutes, // 10. база знаний — 6
  serviceRoutes, // 11. служебные — 7
] as const

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async () => ({
    name: 'BlogOS API',
    version: '2.0.0',
    methods: 59,
    docs: '/api/v1 · docs/API.md',
  }))

  for (const group of GROUPS) {
    await app.register(group)
    await app.register(group, { prefix: '/api/v1' })
  }
}
