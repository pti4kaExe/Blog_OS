/**
 * Модульные проверки слоя LLM без сети и без базы:
 *  - замечание модели принимается только с цитатой из текста автора;
 *  - цена модели считается по прайсу, а не «молча ноль» для известных моделей;
 *  - промпты генерации, проверки и ответов содержат профиль стиля и факты автора.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLlmIssues } from '../src/services/lint.ts'
import {
  BANNED_CLICHES,
  lintUser,
  narrativeUser,
  narrativeUserV2,
  profileBlock,
  responseUser,
} from '../src/services/llm/prompts.ts'
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

const NOTES = 'Первая заметка про план.\nВторая заметка про регулярность.\nТретья заметка про результат.'

const FACTS = ['Веду канал про контент-маркетинг с 2021 года.', 'Пишу по вторникам и четвергам.']

/** Длинный пример обрезается до 500 символов; хвост в промпт попасть не должен. */
const LONG_SAMPLE = `${'А'.repeat(490)}${'Б'.repeat(100)}ХВОСТЗАПРЕДЕЛОМ`

const PROFILE = {
  address: 'ты',
  avgSentenceLen: 9.5,
  firstPersonPer100Words: 3.4,
  stopWords: ['просто', 'качественный'],
  topTerms: [
    { stem: 'план', label: 'планирование', weight: 9.1 },
    { stem: 'контент', label: 'контент', weight: 7.4 },
  ],
  signaturePhrases: ['если коротко', 'по делу'],
  samples: [LONG_SAMPLE, 'Второй пример поста автора.'],
}

/** Текст после последнего «ВХОД:» — то, что mock-провайдер считает данными. */
function inputOf(prompt: string): string {
  return prompt.slice(prompt.lastIndexOf('ВХОД:') + 'ВХОД:'.length).trim()
}

test('narrativeUser: профиль автора и факты попадают в промпт', () => {
  const prompt = narrativeUser(NOTES, 'story_case', PROFILE, FACTS)

  assert.ok(prompt.includes('ПРОФИЛЬ АВТОРА'), 'нужен блок профиля')
  assert.ok(prompt.includes('обращение к читателю: ты'), 'обращение из профиля')
  assert.ok(prompt.includes('средняя длина фразы: 9.5'), 'средняя длина фразы')
  assert.ok(prompt.includes('доля «я»: 3.4'), 'доля первого лица')
  assert.ok(prompt.includes('просто'), 'стоп-слово должно быть в промпте')
  assert.ok(prompt.includes('планирование'), 'топ-тема канала (label)')
  assert.ok(prompt.includes('если коротко'), 'фраза-подпись')
  assert.ok(prompt.includes('Второй пример поста автора'), 'примеры постов автора')
  assert.ok(prompt.includes('ФАКТЫ АВТОРА'), 'нужен блок фактов')
  assert.ok(prompt.includes('Веду канал про контент-маркетинг с 2021 года'), 'текст факта')
  assert.ok(prompt.includes('Не используй стоп-слова'), 'запрет стоп-слов')
  assert.ok(prompt.includes('используй только факты из блока «ФАКТЫ АВТОРА»'), 'запрет выдумок')

  // Профиль и факты — до «ВХОД:»: mock получает только заметки автора.
  assert.equal(inputOf(prompt), NOTES)
  assert.ok(prompt.indexOf('ПРОФИЛЬ АВТОРА') < prompt.lastIndexOf('ВХОД:'))
  assert.ok(prompt.indexOf('ФАКТЫ АВТОРА') < prompt.lastIndexOf('ВХОД:'))
})

test('narrativeUser: пример поста обрезан до 500 символов', () => {
  const prompt = narrativeUser(NOTES, null, PROFILE, [])
  assert.ok(prompt.includes('А'.repeat(490)), 'начало примера сохраняется')
  assert.equal(prompt.includes('ХВОСТЗАПРЕДЕЛОМ'), false, 'хвост длинного примера не нужен')
})

test('narrativeUser: без профиля и фактов промпт остаётся прежним', () => {
  const prompt = narrativeUser(NOTES, null, null, [])
  assert.equal(prompt.includes('ПРОФИЛЬ АВТОРА'), false)
  assert.equal(prompt.includes('ФАКТЫ АВТОРА'), false)
  assert.ok(prompt.startsWith('Собери пост из заметок.'))
  assert.equal(inputOf(prompt), NOTES)
  assert.equal(profileBlock(null), null)
  assert.equal(profileBlock({}), null)
})

test('narrativeUser: факты без профиля всё равно ограничивают модель', () => {
  const prompt = narrativeUser(NOTES, null, null, FACTS)
  assert.equal(prompt.includes('ПРОФИЛЬ АВТОРА'), false)
  assert.ok(prompt.includes('ФАКТЫ АВТОРА'))
  assert.ok(prompt.includes('используй только факты из блока «ФАКТЫ АВТОРА»'))
  assert.equal(inputOf(prompt), NOTES)
})

test('narrativeUser: топ-темы и фразы-подписи ограничены по количеству', () => {
  const topTerms = Array.from({ length: 10 }, (_, index) => ({
    stem: `тема${String(index)}`,
    label: `тема-${String(index)}`,
    weight: 10 - index,
  }))
  const signaturePhrases = Array.from({ length: 7 }, (_, index) => `фраза номер ${String(index)}`)
  const samples = ['Первый пример.', 'Второй пример.', 'Третий пример.']
  const prompt = narrativeUser(NOTES, null, { topTerms, signaturePhrases, samples }, [])

  assert.ok(prompt.includes('тема-7'), 'восьмая тема ещё входит')
  assert.equal(prompt.includes('тема-8'), false, 'девятая тема уже лишняя')
  assert.ok(prompt.includes('фраза номер 4'), 'пятая фраза ещё входит')
  assert.equal(prompt.includes('фраза номер 5'), false, 'шестая фраза уже лишняя')
  assert.ok(prompt.includes('Второй пример.'))
  assert.equal(prompt.includes('Третий пример.'), false, 'достаточно двух примеров')
})

test('lintUser: профиль даёт эталон для замечаний tov', () => {
  const withProfile = lintUser(TEXT, PROFILE)
  assert.ok(withProfile.includes('ПРОФИЛЬ АВТОРА'))
  assert.ok(withProfile.includes('просто'), 'стоп-слово')
  assert.ok(withProfile.includes('планирование'), 'топ-тема')
  assert.ok(withProfile.includes('Считай отклонением от профиля'))
  assert.equal(inputOf(withProfile), TEXT)
})

test('lintUser: без профиля поведение прежнее', () => {
  const legacy = `Проверь текст черновика. Верни только JSON.\n\nВХОД:\n${TEXT}`
  assert.equal(lintUser(TEXT), legacy)
  assert.equal(lintUser(TEXT, null), legacy)
  assert.equal(lintUser(TEXT).includes('ПРОФИЛЬ АВТОРА'), false)
})

test('responseUser: профиль и факты автора в промпте ответа', () => {
  const prompt = responseUser({
    commentText: 'А как вы планируете контент?',
    count: 2,
    styleHint: 'обращение: ты',
    knowledge: FACTS,
    profile: PROFILE,
  })
  assert.ok(prompt.includes('ПРОФИЛЬ АВТОРА'))
  assert.ok(prompt.includes('просто'))
  assert.ok(prompt.includes('планирование'))
  assert.ok(prompt.includes('ФАКТЫ АВТОРА'))
  assert.ok(prompt.includes('Веду канал про контент-маркетинг с 2021 года'))
  assert.ok(prompt.includes('Не используй стоп-слова'))
  assert.equal(inputOf(prompt), 'А как вы планируете контент?')
  assert.ok(prompt.indexOf('ФАКТЫ АВТОРА') < prompt.lastIndexOf('ВХОД:'))
})


test('промт v2: структура, анти-клише и маркер ВХОД', () => {
  const prompt = narrativeUserV2('Заметка один\nЗаметка два', 'story_case')

  // Жёсткие требования и длина.
  assert.match(prompt, /600–1200/)
  assert.match(prompt, /не выдумывай факты/i)
  assert.match(prompt, /не используй стоп-слова/i)

  // Структура по арке.
  for (const role of ['hook', 'context', 'insight', 'takeaway', 'cta']) {
    assert.ok(prompt.includes(role), 'в промте должна быть роль ' + role)
  }

  // Анти-клише перечислены явно.
  for (const phrase of ['в современном мире', 'не секрет, что', 'давайте разберёмся']) {
    assert.ok(prompt.includes('«' + phrase + '»'), 'клише должно быть запрещено: ' + phrase)
  }
  assert.ok(BANNED_CLICHES.includes('в современном мире'))

  // Формат ответа и данные — после последнего ВХОД.
  assert.match(prompt, /ВЕРНИ СТРОГО JSON/)
  assert.ok(prompt.lastIndexOf('ВХОД:') > prompt.indexOf('СТРУКТУРА'))
  assert.ok(prompt.endsWith('ВХОД:\nЗаметка один\nЗаметка два'))
})

test('промт v2: примеры голоса из профиля, профиль и факты до ВХОД', () => {
  const longSample = 'а'.repeat(700)
  const prompt = narrativeUserV2(
    'Заметки',
    null,
    {
      address: 'ты',
      topTerms: [{ label: 'лендинги' }],
      stopWords: ['осуществлять'],
      samples: ['Первый пример голоса.', longSample, 'Третий не должен попасть.'],
    },
    ['Факт: конверсия выросла с 2% до 4%.'],
  )

  assert.match(prompt, /Пример голоса 1/)
  assert.match(prompt, /Пример голоса 2/)
  assert.ok(!prompt.includes('Пример голоса 3'), 'примеров не больше двух')
  assert.ok(!prompt.includes('а'.repeat(600)), 'пример обрезан до 500 знаков')
  assert.match(prompt, /ПРОФИЛЬ АВТОРА/)
  assert.match(prompt, /ФАКТЫ АВТОРА/)
  assert.match(prompt, /конверсия выросла/)

  const inputAt = prompt.lastIndexOf('ВХОД:')
  assert.ok(prompt.indexOf('ПРОФИЛЬ АВТОРА') < inputAt)
  assert.ok(prompt.indexOf('ФАКТЫ АВТОРА') < inputAt)
  assert.ok(prompt.indexOf('Пример голоса 1') < inputAt)
})

test('промт v2 без профиля не выдумывает примеры голоса', () => {
  const prompt = narrativeUserV2('Заметки', null, null, null)
  assert.ok(!prompt.includes('Пример голоса'))
  assert.ok(!prompt.includes('ПРОФИЛЬ АВТОРА'))
  assert.ok(prompt.endsWith('ВХОД:\nЗаметки'))
})
