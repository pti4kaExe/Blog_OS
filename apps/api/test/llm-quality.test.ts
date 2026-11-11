/**
 * Модульные проверки слоя LLM без сети и без базы:
 *  - замечание модели принимается только с цитатой из текста автора;
 *  - цена модели считается по прайсу, а не «молча ноль» для известных моделей.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLlmIssues } from '../src/services/lint.ts'
import { costFor, priceFor, PRICING } from '../src/services/llm/pricing.ts'

const TEXT =
  'Первый день нового проекта. Утром созвон, днём макеты, вечером ретро. ' +
  'Самое сложное — не код, а договориться о терминах.'

test('цитата, которой нет в тексте, отбрасывается', () => {
  const issues = normalizeLlmIssues(
    [
      {
        type: 'clarity',
        quote: 'Попробуйте завести свой файл решений и посмотрите на результат',
        start: 0,
        end: 20,
        explanation: 'Модель ушла в совет вместо цитаты',
      },
    ],
    TEXT,
  )
  assert.equal(issues.length, 0, 'замечание без цитаты из текста не должно попадать в отчёт')
})

test('цитата с корректным диапазоном принимается как есть', () => {
  const quote = 'Утром созвон, днём макеты'
  const start = TEXT.indexOf(quote)
  const issues = normalizeLlmIssues(
    [{ type: 'clarity', quote, start, end: start + quote.length, explanation: 'Поясните' }],
    TEXT,
  )
  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.quote, quote)
  assert.equal(issues[0]?.start, start)
  assert.equal(issues[0]?.source, 'llm')
})

test('неверный диапазон при верной цитате исправляется, а не отбрасывается', () => {
  const quote = 'договориться о терминах'
  const issues = normalizeLlmIssues(
    [{ type: 'logic', quote, start: 0, end: 5, explanation: 'Слишком категорично' }],
    TEXT,
  )
  assert.equal(issues.length, 1)
  const start = TEXT.indexOf(quote)
  assert.equal(issues[0]?.start, start)
  assert.equal(TEXT.slice(issues[0]!.start!, issues[0]!.end!), quote)
})

test('цитата с другими переносами строк находится по словам', () => {
  const issues = normalizeLlmIssues(
    [
      {
        type: 'clarity',
        quote: 'Самое сложное —\nне код, а договориться',
        explanation: 'Разбейте фразу',
      },
    ],
    TEXT,
  )
  assert.equal(issues.length, 1)
  assert.equal(TEXT.slice(issues[0]!.start!, issues[0]!.end!).includes('не код'), true)
})

test('невалидные элементы ответа модели не ломают разбор', () => {
  const issues = normalizeLlmIssues([null, 42, {}, { quote: '' }, { quote: '   ' }], TEXT)
  assert.equal(issues.length, 0)
})

test('известная бесплатная модель есть в прайсе и стоит ноль', () => {
  const model = 'dots-studio/dots-3-note-preview:free'
  assert.ok(PRICING[model], 'модель должна быть в прайсе явно, а не «неизвестной»')
  assert.equal(costFor(model, 100_000, 50_000), 0)
})

test('платные модели считают стоимость по прайсу', () => {
  assert.deepEqual(priceFor('deepseek-chat'), PRICING['deepseek-chat'])
  assert.equal(costFor('deepseek-chat', 1_000_000, 0), 24)
  assert.equal(costFor('gpt-4o-mini', 0, 1_000_000), 55)
})


test('принимает готовую замену от модели и отбрасывает негодную', () => {
  const text = 'В современном мире каждый автор обязан вести контент-план.'
  const quote = 'В современном мире'
  const good = normalizeLlmIssues(
    [{ type: 'cliche', quote, explanation: 'клише', suggestion: 'уберите', fix: 'Сейчас' }],
    text,
  )
  assert.equal(good.length, 1)
  assert.equal(good[0]?.fix, 'Сейчас')
  assert.equal(good[0]?.fixable, true)

  // Замена совпадает с цитатой — применять нечего.
  const same = normalizeLlmIssues([{ type: 'cliche', quote, fix: quote }], text)
  assert.equal(same[0]?.fixable, false)
  assert.equal(same[0]?.fix, null)

  // Слишком длинная «замена» — это пересказ, а не правка.
  const long = normalizeLlmIssues([{ type: 'cliche', quote, fix: 'а'.repeat(240) }], text)
  assert.equal(long[0]?.fixable, false)
})
