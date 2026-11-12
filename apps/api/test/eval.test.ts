/**
 * Стенд качества: правила доступа, валидация и прогон генерации на mock-модели.
 */
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { api, bootstrap } from './helpers.ts'

const TOKEN = 'test-internal-token'
const NOTES = [
  'Вчера переписал лендинг и впервые получил нормальный отклик.',
  'Оказалось, дело было не в заголовке, а в первом абзаце: люди уходили, не поняв выгоду.',
  'Теперь показываю цифру до/после в первом предложении — конверсия выросла.',
  'Если у вас такая же проблема, проверьте, о чём вы говорите в первом абзаце.',
].join('\n')

before(async () => {
  await bootstrap()
})

test('стенд скрыт без секретного заголовка', async () => {
  const response = await api('POST', '/internal/eval', { body: { notes: NOTES } })
  assert.equal(response.status, 404, 'без токена маршрут должен выглядеть как несуществующий')
})

test('стенд отклоняет пустые заметки', async () => {
  const response = await api('POST', '/internal/eval', {
    body: { notes: '  ' },
    headers: { 'x-internal-token': TOKEN },
  })
  assert.equal(response.status, 400)
})

test('стенд прогоняет два варианта промта на mock-модели', async () => {
  const response = await api('POST', '/internal/eval', {
    body: { notes: NOTES, variants: ['v1', 'v2'], runs: 1 },
    headers: { 'x-internal-token': TOKEN },
  })
  assert.equal(response.status, 200)
  const results = response.body.results as Array<Record<string, unknown>>
  assert.equal(results.length, 2, 'два варианта — два результата')
  assert.deepEqual(
    results.map((result) => result.variant),
    ['v1', 'v2'],
  )
  for (const result of results) {
    assert.equal(result.ok, true, `вариант ${result.variant} должен дать текст`)
    assert.ok(Number(result.chars) > 0)
    assert.ok(Number(result.rules_score) > 0)
    assert.ok(Array.isArray(result.banned_used))
  }
})

test('стенд не делает больше двух вызовов модели за запрос', async () => {
  const response = await api('POST', '/internal/eval', {
    body: { notes: NOTES, variants: ['v1', 'v2'], runs: 2 },
    headers: { 'x-internal-token': TOKEN },
  })
  assert.equal(response.status, 200)
  const results = response.body.results as unknown[]
  assert.ok(results.length <= 2, 'даже при runs=2 стенд ограничен двумя вызовами')
})
