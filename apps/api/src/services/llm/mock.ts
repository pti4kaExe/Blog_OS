/**
 * Детерминированный mock-провайдер: без сети и денег.
 *
 * Ответ зависит только от входа (system + user), поэтому тесты стабильны.
 * Формат JSON определяется задачей, указанной маркером «ЗАДАЧА: <name>»
 * в system-промпте, а входные данные берутся из user после «ВХОД:».
 * Режим LLM_MOCK_FAIL=1 имитирует недоступность провайдера.
 */
import { costFor, estimateTokens } from './pricing.ts'
import { LlmUnavailableError, type LlmCallParams, type LlmProvider, type ProviderResult } from './types.ts'
import { llmMockFail } from '../../lib/liveEnv.ts'

const TASK_RE = /ЗАДАЧА:\s*([a-z_]+)/i
const INPUT_MARKER = 'ВХОД:'

function hashInt(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function taskOf(system: string): string {
  const match = TASK_RE.exec(system)
  return match?.[1]?.toLowerCase() ?? 'generic'
}

function inputOf(user: string): string {
  const index = user.lastIndexOf(INPUT_MARKER)
  return index === -1 ? user : user.slice(index + INPUT_MARKER.length).trim()
}

function firstWords(text: string, count: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, count).join(' ')
}

function mockLint(input: string) {
  const clean = input.replace(/\s+/g, ' ').trim()
  const words = clean.split(' ')
  if (words.length < 6) return { issues: [] }
  const seed = hashInt(clean)
  const startWords = Math.min(2 + (seed % 5), Math.max(words.length - 4, 0))
  const quote = firstWords(words.slice(startWords).join(' '), 3)
  const index = clean.indexOf(quote)
  const start = index >= 0 ? index : 0
  const issues = [
    {
      type: 'clarity',
      quote,
      start,
      end: start + quote.length,
      explanation: 'Модель: формулировка требует пояснения, читатель может понять её иначе.',
      suggestion: 'Уточните мысль одним коротким предложением.',
      severity: 'low',
    },
  ]
  if (seed % 3 === 0) {
    issues.push({
      type: 'logic',
      quote,
      start,
      end: start + quote.length,
      explanation: 'Модель: утверждение звучит категоричнее, чем подтверждает текст.',
      suggestion: 'Добавьте оговорку или источник.',
      severity: 'low',
    })
  }
  return { issues }
}

function mockTov(input: string) {
  const seed = hashInt(input)
  const ty = /(?<![а-яёa-z])(ты|тебя|тебе|твой)(?![а-яёa-z])/iu.test(input)
  const vy = /(?<![а-яёa-z])(вы|вас|вам|ваш)(?![а-яёa-z])/iu.test(input)
  return {
    tone: ty && !vy ? 'ты' : vy && !ty ? 'вы' : 'смешанное',
    slang: seed % 2 === 0 ? ['норм', 'по делу'] : ['кринж'],
    favorite_phrases: ['по делу', seed % 2 === 0 ? 'если коротко' : 'вот что сработало'],
  }
}

function mockNarrative(input: string) {
  const lines = input
    .split(/\n+/)
    .map((line) => line.replace(/^\s*([-–—•*·]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
  const roles = ['hook', 'context', 'conflict', 'insight', 'takeaway', 'cta']
  const blocks = lines.slice(0, 7).map((line, index) => ({
    role: roles[index % roles.length],
    text: line.endsWith('.') || /[!?…]$/.test(line) ? line : `${line}.`,
  }))
  return {
    title: lines[0]?.slice(0, 60) ?? 'Пост',
    blocks,
    added_by_engine: ['Собрано моделью из заметок автора.'],
  }
}

function mockResponses(input: string) {
  const countMatch = /КОЛИЧЕСТВО:\s*(\d+)/i.exec(input)
  const count = Math.min(Math.max(Number(countMatch?.[1] ?? 2), 1), 5)
  const seed = hashInt(input)
  const responses = Array.from({ length: count }, (_, index) => ({
    text:
      `Спасибо за вопрос! В моём опыте было так: ${index === 0 ? 'сначала я делал это вручную' : 'я пробовал другой порядок'}. ` +
      '[дополните: что именно сработало у меня и в каких условиях] ' +
      (seed % 2 === 0 ? 'А у тебя как это устроено?' : 'А у вас как это устроено?'),
    parts: {
      reference: 'Спасибо за вопрос!',
      experience: index === 0 ? 'Сначала я делал это вручную.' : 'Я пробовал другой порядок.',
      gap: '[дополните: что именно сработало у меня и в каких условиях]',
      question: seed % 2 === 0 ? 'А у тебя как это устроено?' : 'А у вас как это устроено?',
    },
  }))
  return { responses }
}

function mockJson(task: string, input: string): unknown {
  if (task === 'lint') return mockLint(input)
  if (task === 'tov_analyze') return mockTov(input)
  if (task === 'narrative_generate') return mockNarrative(input)
  if (task === 'response_generate') return mockResponses(input)
  return { ok: true, echo_length: input.length }
}

export class MockProvider implements LlmProvider {
  readonly name = 'mock'
  readonly model = 'mock'

  async complete(params: LlmCallParams): Promise<ProviderResult> {
    if (llmMockFail()) {
      throw new LlmUnavailableError('mock-провайдер отключён через LLM_MOCK_FAIL=1')
    }
    const input = inputOf(params.user)
    const task = taskOf(params.system)
    const text = params.json ? JSON.stringify(mockJson(task, input)) : `mock:${hashInt(input).toString(16)}`
    const tokensIn = estimateTokens(params.system + params.user)
    const tokensOut = estimateTokens(text)
    return { text, tokensIn, tokensOut, cost: costFor(this.model, tokensIn, tokensOut), model: this.model }
  }
}
