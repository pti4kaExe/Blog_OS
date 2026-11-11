/**
 * Эксперимент: промт «предложи 3–4 замены запрещённому слову».
 *
 * Зачем скрипт в репозитории: промт — это тоже код, который надо проверять.
 * Скрипт гоняет один и тот же промт на четырёх случаях и автоматически
 * проверяет ответ модели по критериям из docs/features/stopword-synonyms.md.
 *
 * Запуск (нужен ключ модели в .env — тот же, что у сервиса):
 *   node scripts/experiments/synonyms-prompt.mjs
 *   node scripts/experiments/synonyms-prompt.mjs --case синергия
 *
 * Скрипт ничего не пишет в базу: это изолированный эксперимент.
 */
import { readFileSync } from 'node:fs'

// ─── Окружение ──────────────────────────────────────────────────────────────
function envFromFile(path) {
  const result = {}
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return result
  }
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    result[match[1]] = match[2].replace(/^"|"$/g, '')
  }
  return result
}

const env = { ...envFromFile('.env'), ...process.env }
const provider = (env.LLM_PROVIDER || 'mock').toLowerCase()

function resolveProvider() {
  if (provider === 'deepseek' && env.DEEPSEEK_API_KEY) {
    return {
      label: `DeepSeek (${env.DEEPSEEK_MODEL || 'deepseek-chat'})`,
      base: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      key: env.DEEPSEEK_API_KEY,
      headers: {},
    }
  }
  if (env.OPENAI_API_KEY) {
    return {
      label: `OpenAI-совместимый (${env.OPENAI_MODEL || 'модель по умолчанию'})`,
      base: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      key: env.OPENAI_API_KEY,
      headers: { 'HTTP-Referer': 'https://blogos.example', 'X-Title': 'BlogOS synonyms experiment' },
    }
  }
  return null
}

const target = resolveProvider()
if (!target) {
  console.error('Нет ключа модели: заполните OPENAI_API_KEY или DEEPSEEK_API_KEY в .env')
  process.exit(1)
}

// ─── Промт (копия из docs/features/stopword-synonyms.md) ────────────────────
const SYSTEM = `Ты — редактор текстов для автора блога. Твоя задача: заменить указанное «запрещённое» слово или оборот в предложенном контексте и предложить 3–4 альтернативы.

Правила:
1. Смысл предложения не меняется. Не добавляй факты, цифры, примеры и выводы, которых не было в исходном тексте.
2. Заменяй именно запрещённый фрагмент, а не переписывай предложение целиком: остальные слова автора сохраняются.
3. Альтернативы должны звучать как живая речь автора, а не как официальный документ. Разные варианты — разная стратегия: короче, разговорнее, конкретнее, без оценочности.
4. Запрещённое слово и его однокоренные формы не должны появляться ни в одной альтернативе.
5. У каждой альтернативы — короткая причина (до 8 слов), зачем она нужна.
6. Если заменить фрагмент нельзя без потери смысла — верни пустой список альтернатив и укажи причину в "needs_rewrite".

Ответ строго в JSON без markdown:
{
  "alternatives": [
    { "text": "полное предложение с заменой", "why": "почему так" }
  ],
  "needs_rewrite": false,
  "reason": ""
}`

function userPrompt({ word, sentence, style }) {
  return `Запрещённое слово или оборот: «${word}»
Контекст (предложение, где он встретился): «${sentence}»
Как пишет автор: ${style}

Предложи 3–4 альтернативы по правилам.`
}

// ─── Случаи ─────────────────────────────────────────────────────────────────
const CASES = [
  {
    id: 'синергия',
    word: 'синергия',
    sentence: 'Мы создаём синергию между командой и клиентом, поэтому продукт получается быстрее.',
    style: 'обращение на «ты», личный опыт, короткие фразы, без канцелярита',
  },
  {
    id: 'мир',
    word: 'в современном мире',
    sentence: 'В современном мире важно писать честно, иначе читатель уходит.',
    style: 'обращение на «ты», разговорный, иногда ирония, без клише',
  },
  {
    id: 'лидер',
    word: 'лидер рынка',
    sentence: 'Мы — лидер рынка по количеству публикаций в прошлом году.',
    style: 'обращение на «вы», деловой, но не официальный, без громких оценок',
  },
  {
    id: 'оптимизировать',
    word: 'оптимизировать',
    sentence: 'Сначала оптимизировали процесс, потом начали писать посты.',
    style: 'обращение на «ты», простой язык, вместо терминов — человеческие слова',
  },
]

const selected = process.argv.includes('--case')
  ? CASES.filter((item) => process.argv.includes(item.id))
  : CASES

// ─── Вызов модели ───────────────────────────────────────────────────────────
async function ask(word, sentence, style) {
  const started = Date.now()
  const response = await fetch(`${target.base}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.key}`,
      'content-type': 'application/json',
      ...target.headers,
    },
    body: JSON.stringify({
      model: target.model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt({ word, sentence, style }) },
      ],
      temperature: 0.5,
      max_tokens: 4000,
    }),
  })
  const body = await response.json().catch(() => ({}))
  const elapsed = Date.now() - started
  if (!response.ok) {
    return { ok: false, status: response.status, error: JSON.stringify(body).slice(0, 300), elapsed }
  }
  return {
    ok: true,
    content: body.choices?.[0]?.message?.content ?? '',
    finish: body.choices?.[0]?.finish_reason,
    tokens: body.usage?.completion_tokens ?? null,
    elapsed,
  }
}

// ─── Проверки ответа ────────────────────────────────────────────────────────
function parseAnswer(content) {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(content.slice(start, end + 1))
    return {
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      needsRewrite: Boolean(parsed.needs_rewrite),
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    }
  } catch {
    return null
  }
}

/** Грубая основа слова: без последних 2 символов, если слово длинное. */
function roughStem(word) {
  const clean = String(word).toLowerCase().replace(/[^а-яёa-z0-9]/g, '')
  return clean.length > 5 ? clean.slice(0, clean.length - 2) : clean
}

const NUMBERS = /\d+/g

function checkAlternative(alternative, original) {
  const problems = []
  const text = String(alternative.text || '').trim()
  if (!text) problems.push('пустой текст')
  if (text.length > 400) problems.push('длиннее 400 символов')
  if (text.split('\n').length > 1) problems.push('несколько строк')

  const lowerText = text.toLowerCase()
  const bannedStem = roughStem(original.word)
  if (bannedStem && lowerText.replace(/\s+/g, '').includes(bannedStem)) {
    problems.push('осталось запрещённое слово')
  }

  // Локализация замены: начало и конец предложения должны сохраниться.
  const originalTail = original.sentence.slice(-24).trim().toLowerCase()
  if (originalTail.length > 8 && !lowerText.includes(originalTail)) {
    problems.push('переписан конец предложения')
  }

  // Новые числа и имена — выдуманные факты.
  const originalNumbers = new Set((original.sentence.match(NUMBERS) || []))
  const newNumbers = (text.match(NUMBERS) || []).filter((number) => !originalNumbers.has(number))
  if (newNumbers.length) problems.push(`новые числа: ${newNumbers.join(', ')}`)

  return problems
}

// ─── Прогон ─────────────────────────────────────────────────────────────────
console.log(`Модель: ${target.label}`)
console.log(`Случаев: ${selected.length}`)
let accepted = 0
let total = 0

for (const testCase of selected) {
  console.log(`\n=== «${testCase.word}» ===`)
  console.log(`  контекст: ${testCase.sentence}`)
  const result = await ask(testCase.word, testCase.sentence, testCase.style)
  if (!result.ok) {
    console.log(`  ошибка ${result.status}: ${result.error}`)
    continue
  }
  console.log(`  время: ${(result.elapsed / 1000).toFixed(1)} с | finish: ${result.finish} | токенов: ${result.tokens ?? '?'}`)

  const answer = parseAnswer(result.content)
  if (!answer) {
    console.log('  JSON не разобран. Фрагмент ответа:', result.content.slice(0, 200))
    continue
  }
  if (answer.needsRewrite) {
    console.log(`  модель считает, что нужна переработка: ${answer.reason}`)
    continue
  }

  const countOk = answer.alternatives.length >= 3 && answer.alternatives.length <= 4
  console.log(`  альтернатив: ${answer.alternatives.length}${countOk ? '' : ' (ожидалось 3–4)'}`)

  for (const [index, alternative] of answer.alternatives.entries()) {
    total++
    const problems = checkAlternative(alternative, testCase)
    const mark = problems.length === 0 ? 'ok  ' : 'FAIL'
    if (problems.length === 0) accepted++
    console.log(`  ${mark} ${index + 1}. ${String(alternative.text).trim()}`)
    console.log(`        причина: ${alternative.why ?? '—'}`)
    if (problems.length) console.log(`        проблемы: ${problems.join('; ')}`)
  }
}

console.log(`\nИтог: ${accepted} из ${total} вариантов прошли автоматические проверки.`)
console.log('Ручная оценка (1–5): смысл, голос автора, отсутствие навязанных фактов.')
