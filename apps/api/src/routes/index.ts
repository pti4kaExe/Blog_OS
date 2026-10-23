import type { FastifyInstance } from 'fastify'

/**
 * Регистрация всех групп методов API.
 *
 * Контракт: docs/API.md, 11 групп, 59 методов. Порядок групп совпадает
 * с разделами документа; каждый модуль группы лежит в src/routes/.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Группы подключаются здесь:
  //   1. auth + users            4 метода
  //   2. author-profiles         6
  //   3. tov                     3
  //   4. posts                   6
  //   5. drafts                  7
  //   6. lint                    3
  //   7. sources                 5
  //   8. comments                6
  //   9. responses               6
  //  10. knowledge               6
  //  11. service (runs, evals)   7
  app.get('/', async () => ({
    name: 'BlogOS API',
    version: '2.0.0',
    methods: 59,
    docs: '/api/v1 · docs/API.md',
  }))
}
