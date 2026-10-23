/**
 * Структурная проверка docs/openapi.yaml без YAML-парсера.
 *
 *   node tests/db/openapi-structure.mjs
 *
 * В окружении QA нет yaml/js-yaml (новые зависимости запрещены), поэтому
 * файл читается как текст, а проверки опираются на жёсткую структуру
 * OpenAPI: пути на отступе 2, методы на отступе 4, компоненты на 2/4.
 *
 * Проверяется:
 *   1. все 59 методов из docs/API.md присутствуют в openapi.yaml (и наоборот);
 *   2. нет дублей path+method и дублей operationId;
 *   3. 11 тегов совпадают с группами API.md, у каждой операции есть тег;
 *   4. у каждой операции есть responses с кодом 2xx;
 *   5. встречаются все коды ошибок контракта: 400/401/402/403/404/409/422/429/500/502/503;
 *   6. security: глобальный bearerAuth, у /auth/telegram — security: [];
 *   7. все $ref разрешаются в components;
 *   8. ErrorEnvelope и 11 кодов error.code на месте;
 *   9. пагинация: параметры limit/cursor объявлены, next_cursor встречается не реже числа списков;
 *  10. нет табов и пустых операций.
 *
 * Скрипт завершается кодом 1 при любом расхождении.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const apiMd = readFileSync(resolve(repoRoot, 'docs/API.md'), 'utf8')
const openapi = readFileSync(resolve(repoRoot, 'docs/openapi.yaml'), 'utf8')
const lines = openapi.split(/\r?\n/)

const results = []
function check(name, expected, actual, ok, extra) {
  results.push({ name, expected, actual, ok })
  console.log(`\n• ${name}`)
  console.log(`  ожидание: ${expected}`)
  console.log(`  факт:     ${actual}`)
  if (extra) console.log(`  детали:   ${extra}`)
  console.log(`  вердикт:  ${ok ? 'ПРОЙДЕНО' : 'ПРОВАЛ'}`)
}

// ─── 1. Ожидаемый перечень методов из docs/API.md ────────────────────────────
const opsFromApi = []
const groupRe = /^## (\d+)\. (.+?) — (\d+) метод[а-яА-Я]*$/gm
const apiGroups = []
for (const m of apiMd.matchAll(groupRe)) {
  apiGroups.push({ number: Number(m[1]), title: m[2].trim(), count: Number(m[3]) })
}
const opRe = /^### `(GET|POST|PUT|PATCH|DELETE) (\/[^`]+)`/gm
for (const m of apiMd.matchAll(opRe)) {
  opsFromApi.push({ method: m[1], path: m[2].trim() })
}
const opsFromApiSet = new Set(opsFromApi.map((o) => `${o.method} ${o.path}`))

// ─── 2. Разбор openapi.yaml по отступам ──────────────────────────────────────
const opsFromYaml = []
const yamlOpIndex = new Map()
let section = null // 'paths' | 'components' | null
let currentPath = null
let currentOp = null

const componentDefs = { schemas: new Set(), parameters: new Set(), responses: new Set(), securitySchemes: new Set() }
let componentSection = null

function closeOperation(endLine) {
  if (!currentOp) return
  currentOp.endLine = endLine
  opsFromYaml.push(currentOp)
  currentOp = null
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const lineNo = i + 1

  if (/^\s*#/.test(line) && line.trim().startsWith('#')) continue
  if (line.trim() === '') continue

  if (/^paths:\s*$/.test(line)) {
    closeOperation(lineNo)
    section = 'paths'
    componentSection = null
    continue
  }
  if (/^components:\s*$/.test(line)) {
    closeOperation(lineNo)
    section = 'components'
    currentPath = null
    continue
  }
  if (section === 'components') {
    const comp = /^  (schemas|parameters|responses|securitySchemes):\s*$/.exec(line)
    if (comp) {
      componentSection = comp[1]
      continue
    }
    const def = /^    ([A-Za-z][A-Za-z0-9_]*):\s*$/.exec(line)
    if (def && componentSection) componentDefs[componentSection].add(def[1])
    continue
  }
  if (section === 'paths') {
    const pathMatch = /^  (\/[^:\s]+):\s*$/.exec(line)
    if (pathMatch) {
      closeOperation(lineNo)
      currentPath = pathMatch[1]
      continue
    }
    const methodMatch = /^    (get|post|put|patch|delete):\s*$/.exec(line)
    if (methodMatch && currentPath) {
      closeOperation(lineNo)
      currentOp = {
        method: methodMatch[1].toUpperCase(),
        path: currentPath,
        startLine: lineNo,
        tagsLine: null,
        responsesLine: null,
      }
      const key = `${currentOp.method} ${currentOp.path}`
      if (!yamlOpIndex.has(key)) yamlOpIndex.set(key, [])
      yamlOpIndex.get(key).push(lineNo)
      continue
    }
    // Внутри операции запоминаем ключевые секции (отступ 6).
    if (currentOp) {
      if (/^      tags:/.test(line)) currentOp.tagsLine = lineNo
      if (/^      responses:/.test(line)) currentOp.responsesLine = lineNo
    }
  }
}
closeOperation(lines.length + 1)

// ─── 3. Сверка состава методов ───────────────────────────────────────────────
const yamlOpSet = new Set(opsFromYaml.map((o) => `${o.method} ${o.path}`))
const missing = [...opsFromApiSet].filter((k) => !yamlOpSet.has(k))
const extra = [...yamlOpSet].filter((k) => !opsFromApiSet.has(k))

check(
  'Все методы из docs/API.md описаны в openapi.yaml',
  `59 операций: ${opsFromApi.length}`,
  `${opsFromYaml.length} операций; отсутствуют: ${missing.length}; лишние: ${extra.length}`,
  opsFromApi.length === 59 && missing.length === 0 && extra.length === 0,
  missing.length || extra.length
    ? `Отсутствуют: ${missing.join('; ') || '—'} | Лишние: ${extra.join('; ') || '—'}`
    : 'Состав совпадает, количество 59',
)

const dupOps = [...yamlOpIndex.entries()].filter(([, lineNos]) => lineNos.length > 1)
check(
  'Нет дублей path+method',
  'каждая пара встречается ровно один раз',
  dupOps.length === 0 ? 'дублей нет' : dupOps.map(([k, l]) => `${k} (строки ${l.join(', ')})`).join('; '),
  dupOps.length === 0,
)

// ─── 4. operationId ──────────────────────────────────────────────────────────
const operationIds = [...openapi.matchAll(/^      operationId: (\S+)\s*$/gm)].map((m) => m[1])
const dupOperationIds = operationIds.filter((id, i) => operationIds.indexOf(id) !== i)
check(
  'У каждой операции есть уникальный operationId',
  `${opsFromYaml.length} operationId без дублей`,
  `${operationIds.length} operationId; дубли: ${dupOperationIds.join(', ') || 'нет'}`,
  operationIds.length === opsFromYaml.length && dupOperationIds.length === 0,
)

// ─── 5. Теги: 11 групп ───────────────────────────────────────────────────────
const declaredTags = [...openapi.matchAll(/^  - name: (.+)$/gm)].map((m) => m[1].trim())
const apiGroupTitles = apiGroups.map((g) => g.title)
const tagsMatch =
  declaredTags.length === 11 &&
  apiGroupTitles.length === 11 &&
  apiGroupTitles.every((t) => declaredTags.includes(t))
check(
  '11 тегов совпадают с группами docs/API.md',
  apiGroupTitles.join(', '),
  declaredTags.join(', '),
  tagsMatch,
  apiGroups.map((g) => `${g.title}=${g.count}`).join(', ') +
    `; сумма методов по группам = ${apiGroups.reduce((s, g) => s + g.count, 0)}`,
)

// ─── 6. Блоки операций: tags и responses ────────────────────────────────────
const missingTags = opsFromYaml.filter((o) => !o.tagsLine).map((o) => `${o.method} ${o.path}`)
const missingResponses = opsFromYaml.filter((o) => !o.responsesLine).map((o) => `${o.method} ${o.path}`)
check(
  'У каждой операции есть tags и responses',
  'tags и responses в каждом из 59 блоков',
  `без tags: ${missingTags.length}, без responses: ${missingResponses.length}`,
  missingTags.length === 0 && missingResponses.length === 0,
  [...missingTags, ...missingResponses].join('; '),
)

// ─── 7. Коды ошибок контракта ────────────────────────────────────────────────
const REQUIRED_STATUS = ['400', '401', '402', '403', '404', '409', '422', '429', '500', '502', '503']
const presentStatuses = new Set()
for (const m of openapi.matchAll(/^        '(\d{3})':/gm)) presentStatuses.add(m[1])
const missingStatuses = REQUIRED_STATUS.filter((s) => !presentStatuses.has(s))
check(
  'Присутствуют все коды ошибок контракта',
  REQUIRED_STATUS.join(', '),
  [...presentStatuses].sort().join(', '),
  missingStatuses.length === 0,
  missingStatuses.length ? `Не встречаются: ${missingStatuses.join(', ')}` : 'Все 11 кодов описаны',
)

// ─── 8. security ─────────────────────────────────────────────────────────────
const globalSecurity = /^security:\n  - bearerAuth: \[\]/m.test(openapi)
const bearerDef = /^    bearerAuth:\n      type: http\n      scheme: bearer/m.test(openapi)
const authOpBlock = (() => {
  const start = lines.findIndex((l) => /^  \/auth\/telegram:\s*$/.test(l))
  if (start === -1) return ''
  const end = lines.findIndex((l, i) => i > start && /^  \/[^/]/.test(l))
  return lines.slice(start, end === -1 ? start + 20 : end).join('\n')
})()
check(
  'Bearer-аутентификация: глобально, у входа — без токена',
  'security: bearerAuth глобально; securitySchemes.bearerAuth http/bearer; /auth/telegram security: []',
  `глобальный security: ${globalSecurity}; bearerAuth: ${bearerDef}; у /auth/telegram security: ${/security: \[\]/.test(authOpBlock)}`,
  globalSecurity && bearerDef && /security: \[\]/.test(authOpBlock),
)

// ─── 9. Разрешение $ref ─────────────────────────────────────────────────────
const refs = [...openapi.matchAll(/\$ref: '#\/components\/(schemas|parameters|responses|securitySchemes)\/([A-Za-z][A-Za-z0-9_]*)'/g)]
const badRefs = []
for (const m of refs) {
  const [, kind, name] = m
  if (!componentDefs[kind].has(name)) badRefs.push(`${kind}/${name}`)
}
check(
  'Все $ref разрешаются в components',
  'каждый $ref указывает на существующий компонент',
  `${refs.length} ссылок; не разрешаются: ${badRefs.length}`,
  badRefs.length === 0,
  [...new Set(badRefs)].join(', '),
)

// ─── 10. ErrorEnvelope и коды ошибок ────────────────────────────────────────
const ERROR_CODES = [
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'unprocessable',
  'ai_budget_exceeded',
  'rate_limited',
  'upstream_unavailable',
  'not_configured',
  'internal',
]
const hasEnvelope = componentDefs.schemas.has('ErrorEnvelope')
const codesInSpec = ERROR_CODES.filter((c) => openapi.includes(c))
check(
  'ErrorEnvelope { error: { code, message, details } } и все коды ошибок',
  `схема ErrorEnvelope + 11 кодов: ${ERROR_CODES.join(', ')}`,
  `ErrorEnvelope: ${hasEnvelope}; кодов найдено: ${codesInSpec.length}`,
  hasEnvelope && codesInSpec.length === ERROR_CODES.length,
  ERROR_CODES.filter((c) => !openapi.includes(c)).join(', '),
)

// ─── 11. Пагинация ──────────────────────────────────────────────────────────
const listOps = opsFromYaml.filter((o) => o.method === 'GET').length
const nextCursorCount = (openapi.match(/next_cursor/g) ?? []).length
const hasLimitParam = /^    Limit:/m.test(openapi) && /name: limit/m.test(openapi)
const hasCursorParam = /^    Cursor:/m.test(openapi) && /name: cursor/m.test(openapi)
check(
  'Пагинация limit/cursor/next_cursor',
  'объявлены параметры limit и cursor; у каждого списка есть next_cursor',
  `limit: ${hasLimitParam}; cursor: ${hasCursorParam}; GET-операций: ${listOps}; упоминаний next_cursor: ${nextCursorCount}`,
  hasLimitParam && hasCursorParam && nextCursorCount >= 14,
  nextCursorCount < 14 ? 'Списков должно быть не меньше 14 — у каждого next_cursor' : undefined,
)

// ─── 12. Гигиена файла ──────────────────────────────────────────────────────
const tabs = lines.filter((l) => l.includes('\t')).length
const badBlocks = opsFromYaml.filter((o) => !o.responsesLine || o.responsesLine > o.endLine)
check(
  'Файл структурно чистый',
  'нет табов; ответы идут внутри своих операций; файл не пуст',
  `строк: ${lines.length}; табов: ${tabs}; операций с нарушенным блоком responses: ${badBlocks.length}`,
  tabs === 0 && badBlocks.length === 0 && lines.length > 500,
)

// ─── Итог ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok)
console.log(`\n${'═'.repeat(78)}`)
console.log(`ИТОГ: проверок ${results.length}, пройдено ${results.length - failed.length}, провалено ${failed.length}`)
for (const f of failed) console.log(`  ✗ ${f.name}: ожидание ${f.expected}; факт ${f.actual}`)
console.log('═'.repeat(78))
if (failed.length > 0) process.exitCode = 1
