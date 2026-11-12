/** Guard Narrative Engine: не даём перенести в пост чужие события и даты. */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractDateKeys,
  extractEventClaims,
  findInventedEvents,
} from '../src/services/narrativeGuard.ts'

const NOTES = [
  'Три месяца вёл канал про продуктивность и выгорел.',
  'Понял: план работал, пока я оставлял пустое место под отдых.',
  'Теперь в плане три задачи и два пустых слота.',
].join('\n')

test('извлекает даты и месяцы в нормализованном виде', () => {
  const keys = extractDateKeys('Встречаемся 6 ноября, а отчёт — 12.11.2026 и 1/12.')
  assert.deepEqual([...keys.dates].sort(), ['12.11', '6.11', '1.12'].sort())
  assert.deepEqual([...keys.months].sort((a, b) => a - b), [11, 12])
})

test('текст без событий и дат проходит проверку', () => {
  const text = 'Выгорание приходит, когда в плане нет места отдыху. Оставьте пустой слот.'
  const result = findInventedEvents(text, NOTES)
  assert.equal(result.ok, true)
  assert.deepEqual(result.inventedDates, [])
  assert.deepEqual(result.inventedEvents, [])
})

test('дата из старого поста, которой нет в заметках, — это провал', () => {
  const text = 'Три месяца я вёл канал. Приходите 6 ноября на конференцию — регистрация открыта.'
  const result = findInventedEvents(text, NOTES)
  assert.equal(result.ok, false)
  assert.deepEqual(result.inventedDates, ['6.11'])
  assert.ok(result.inventedEvents.includes('конференция'))
  assert.deepEqual(result.inventedMonths, [11])
})

test('дата из заметок допустима в любой записи', () => {
  const notes = 'Встреча 6 ноября в 19:00. Записал три задачи.'
  const byWords = findInventedEvents('Встреча 6 ноября прошла спокойно.', notes)
  const byDigits = findInventedEvents('Встреча 06.11 прошла спокойно.', notes)
  assert.equal(byWords.ok, true)
  assert.equal(byDigits.ok, true)
})

test('месяц без даты, которого нет в заметках, тоже считается выдумкой', () => {
  const result = findInventedEvents('В ноябре я наконец выдохнул.', NOTES)
  assert.equal(result.ok, false)
  assert.deepEqual(result.inventedMonths, [11])
})

test('мероприятие из заметок не считается выдуманным', () => {
  const notes = 'Провёл конференцию про планирование. Устал, но доволен.'
  const result = findInventedEvents('Конференция закончилась — и я выдохнул.', notes)
  assert.equal(result.ok, true)
  assert.deepEqual(result.inventedEvents, [])
})

test('приглашение без мероприятия в заметках ловится как событие', () => {
  const text = 'Приходите на митап, билеты уже в продаже.'
  const result = findInventedEvents(text, NOTES)
  assert.equal(result.ok, false)
  assert.ok(result.inventedEvents.includes('митап'))
  assert.deepEqual(extractEventClaims(text), [
    {
      label: 'митап',
      excerpt: 'приходите на митап, билеты уже в продаже.',
    },
  ])
})

test('имя и цифры из примеров голоса не проходят как факты: только заметки', () => {
  const text = 'Позвал в поток обучения 12 человек — как в прошлом году.'
  const result = findInventedEvents(text, NOTES)
  assert.equal(result.ok, false)
  assert.ok(result.inventedEvents.includes('поток обучения'))
})
