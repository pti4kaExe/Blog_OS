#!/usr/bin/env node
/**
 * Сравнение версий промта на одних и тех же заметках.
 *
 * Запуск:
 *   MIGRATE_TOKEN=… node scripts/eval-quality.mjs "текст заметок" --variants v1,v2
 *   MIGRATE_TOKEN=… node scripts/eval-quality.mjs --file notes.txt --runs 2
 *
 * Печатает таблицу: вариант, прогон, символы, оценка правил, клише, запрещённые
 * фразы, первые 300 знаков текста. Ничего не пишет в БД, кроме журнала вызовов
 * модели (generation_runs), как обычная генерация.
 */
import { readFileSync } from 'node:fs'

const API_URL = (process.env.API_URL || 'https://blog-os-gules.vercel.app').replace(/\/$/, '')
const TOKEN = process.env.MIGRATE_TOKEN || ''

const args = process.argv.slice(2)
const takeValue = (name) => {
  const index = args.indexOf(name)
  if (index === -1) return null
  const value = args[index + 1]
  args.splice(index, 2)
  return value ?? null
}

const variantsArg = takeValue('--variants')
const runsArg = takeValue('--runs')
const fileArg = takeValue('--file')
const profileArg = takeValue('--profile')

const notes = fileArg ? readFileSync(fileArg, 'utf8').trim() : args.join(' ').trim()
if (!notes) {
  console.error('Передайте заметки текстом или через --file notes.txt')
  process.exit(1)
}
if (!TOKEN) {
  console.error('Нужен MIGRATE_TOKEN в окружении: он открывает внутренний стенд.')
  process.exit(1)
}

const variants = (variantsArg || 'v1,v2')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => item === 'v1' || item === 'v2')
const body = {
  notes,
  variants: variants.length > 0 ? variants : ['v1', 'v2'],
  runs: Number(runsArg || 1),
  ...(profileArg ? { profile_id: Number(profileArg) } : {}),
}

console.log(`Стенд: ${API_URL}/internal/eval`)
console.log(`Заметки: ${notes.length} символов, варианты: ${body.variants.join(' + ')}, прогонов: ${body.runs}\n`)

let response
try {
  response = await fetch(`${API_URL}/internal/eval`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
} catch (error) {
  console.error(`Стенд недоступен: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

const payload = await response.json().catch(() => ({}))
if (!response.ok) {
  console.error(`HTTP ${response.status}: ${payload?.error?.message ?? JSON.stringify(payload).slice(0, 300)}`)
  process.exit(1)
}

const results = payload.results ?? []
const bad = []
for (const result of results) {
  console.log('─'.repeat(72))
  console.log(
    `${result.variant} · прогон ${result.run} · ${result.ok ? 'ok' : 'ошибка'} · ${result.chars} знаков · правила ${result.rules_score ?? '—'}`,
  )
  if (result.latency_ms) console.log(`время: ${(result.latency_ms / 1000).toFixed(1)} с`)
  if (result.ai_skipped_reason) console.log(`ИИ пропущен: ${result.ai_skipped_reason}`)
  if (result.cliches?.length) console.log(`клише: ${result.cliches.join(' | ')}`)
  if (result.banned_used?.length) console.log(`запрещённые фразы: ${result.banned_used.join(' | ')}`)
  if (result.error) console.log(`ошибка: ${result.error}`)
  const preview = String(result.text ?? '').slice(0, 300).replace(/\s+/g, ' ')
  if (preview) console.log(`текст: ${preview}${result.text.length > 300 ? '…' : ''}`)
  if (!result.ok) bad.push(`${result.variant}: ${result.error ?? result.ai_skipped_reason ?? 'пустой текст'}`)
}

console.log('\n' + '─'.repeat(72))
const summary = results
  .map((result) => `${result.variant}: ${result.ok ? `${result.rules_score} баллов, ${result.banned_used?.length ?? 0} запрещённых` : 'неудача'}`)
  .join(' · ')
console.log(`Итог: ${summary}`)
if (bad.length > 0) {
  console.error(`Неудачные прогоны: ${bad.join('; ')}`)
  process.exit(1)
}
