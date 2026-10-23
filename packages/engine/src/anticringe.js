/**
 * AntiCringe — линтер черновика перед публикацией.
 * Четыре группы проверок: клише, логика, соответствие Tone of Voice, ясность.
 * Все проверки выполняются локально по тексту; часть правок применяется автоматически.
 */
import {
  sentences, words, stem, STOPWORDS, contentStems, countEmoji, capitalize,
} from './text.js'
import { buildDraftMetrics, compareToProfile } from './styleProfile.js'
import {
  compile, CLICHES, FILLERS, BUREAUCRACY, GUARANTEES, ABSOLUTES, HEDGES,
  SOURCE_MARKERS, CONSEQUENCE, CAUSE, SUPERLATIVES, COMPARISON_BASIS, ADDRESS_MAP,
  ABSOLUTE_EXCEPTIONS,
} from './rules.js'

const SEVERITY_WEIGHT = { high: 9, med: 5, low: 2.2 }

export const CATEGORIES = {
  cliche: { label: 'Клише', hint: 'Инфобизнес-штампы и пустые формулировки' },
  logic: { label: 'Логика', hint: 'Категоричность, цифры без источника, противоречия' },
  tov: { label: 'Tone of Voice', hint: 'Отклонения от вашего стиля' },
  clarity: { label: 'Ясность', hint: 'Длинные предложения, канцелярит, вода' },
}

/** Скомпилированные правила — один раз на загрузку модуля. */
const COMPILED = [
  ...CLICHES.map(([p, sev, why, fix, mode]) => ({
    ruleId: `cliche:${p}`, category: 'cliche', severity: sev, re: compile(p),
    title: 'Клише', message: why, fix, mode,
  })),
  ...GUARANTEES.map(([p, sev, why, fix, mode]) => ({
    ruleId: `guarantee:${p}`, category: 'logic', severity: sev, re: compile(p),
    title: 'Обещание результата', message: why, fix, mode,
  })),
  ...FILLERS.map(([p, why, fix, mode]) => ({
    ruleId: `filler:${p}`, category: 'clarity', severity: 'low', re: compile(p),
    title: 'Вода', message: why, fix, mode,
  })),
  ...BUREAUCRACY.map(([p, why, fix, mode]) => ({
    ruleId: `bureau:${p}`, category: 'clarity', severity: 'med', re: compile(p),
    title: 'Канцелярит', message: why, fix, mode,
  })),
]

/** Идентификатор устойчив между проверками: по нему запоминается «скрыть». */
function makeIssue(base) {
  const at = base.start === null || base.start === undefined ? 'g' : base.start
  return { id: `${base.ruleId}@${at}`, ...base }
}

/**
 * Основная проверка текста.
 * @param {string} text черновик
 * @param {object|null} profile профиль авторского стиля
 */
export function lint(text, profile = null) {
  const src = String(text || '')
  const issues = []
  const sents = sentences(src)
  const ws = words(src)

  if (ws.length < 5) {
    return {
      empty: true, score: null, grade: null, issues: [], metrics: buildDraftMetrics(src),
      categoryScores: {}, tovDeltas: [], notes: [],
    }
  }

  runDictionaries(src, issues)
  const textIsPersonal = buildDraftMetrics(src).firstPersonPer100Words >= 3
  runLogic(src, sents, issues, textIsPersonal)
  runClarity(src, sents, issues, profile)
  const notes = runToneOfVoice(src, sents, issues, profile)

  const deduped = dedupe(issues)
  const metrics = buildDraftMetrics(src)
  const { score, categoryScores } = scoreText(deduped, ws.length)

  return {
    empty: false,
    score,
    grade: grade(score),
    issues: deduped,
    metrics,
    categoryScores,
    tovDeltas: profile ? compareToProfile(src, profile) : [],
    notes,
    fixableCount: deduped.filter(isFixable).length,
  }
}

/* ---------------------------------- словари --------------------------------- */

function runDictionaries(src, issues) {
  for (const rule of COMPILED) {
    rule.re.lastIndex = 0
    let m
    while ((m = rule.re.exec(src)) !== null) {
      if (m[0].length === 0) { rule.re.lastIndex++; continue }
      issues.push(makeIssue({
        ruleId: rule.ruleId,
        category: rule.category,
        severity: rule.severity,
        title: rule.title,
        message: rule.message,
        quote: m[0],
        start: m.index,
        end: m.index + m[0].length,
        fix: rule.fix,
        mode: rule.mode || 'word',
      }))
    }
  }
}

/* ----------------------------------- логика --------------------------------- */

function runLogic(src, sents, issues, textIsPersonal) {
  sents.forEach((s, i) => {
    const low = s.text.toLowerCase()
    const sw = words(s.text)
    if (sw.length < 3) return

    // 1. Категоричное утверждение без оговорки
    const absolute = findAbsolute(low)
    if (absolute && !HEDGES.some((h) => low.includes(h))) {
      const pos = { start: s.start + absolute.index, end: s.start + absolute.index + absolute.word.length }
      issues.push(makeIssue({
        ruleId: 'logic:absolute',
        category: 'logic',
        severity: 'med',
        title: 'Категоричное утверждение',
        message: `«${absolute.word}» не оставляет исключений. Добавьте оговорку («обычно», «в моём опыте») или сузьте утверждение.`,
        quote: s.text.slice(absolute.index, absolute.index + absolute.word.length),
        ...pos,
      }))
    }

    // 2. Цифра без источника (личный опыт автора источником считается)
    const num = low.match(/(?<![а-яё\d])(\d[\d\s.,]*\s*%|\d{2,}(?:[.,]\d+)?)(?![а-яё])/)
    const personal = /(?<![а-яёa-z])(я|мне|меня|мы|нам|мой|моя|мои|у меня)(?![а-яёa-z])/iu.test(low)
    const bigClaim = /%/.test(num?.[0] || '') || Number(String(num?.[0] || '').replace(/[^\d]/g, '')) >= 100
    // в личном рассказе небольшие числа — это собственный опыт автора
    const smallInPersonalStory = textIsPersonal && !bigClaim
    if (num && !personal && !smallInPersonalStory && !SOURCE_MARKERS.some((mk) => low.includes(mk))) {
      issues.push(makeIssue({
        ruleId: 'logic:number-no-source',
        category: 'logic',
        severity: bigClaim ? 'med' : 'low',
        title: 'Цифра без источника',
        message: 'Читатель не может проверить число. Укажите, откуда оно: замер, проект, исследование.',
        quote: num[0].trim(),
        start: s.start + num.index,
        end: s.start + num.index + num[0].trimEnd().length,
      }))
    }

    // 3. Логический скачок: вывод без посылки
    const conseq = CONSEQUENCE.find((c) => low.includes(c))
    if (conseq) {
      const prev = sents[i - 1]
      const prevLow = (prev?.text || '').toLowerCase()
      const hasPremise = /\d/.test(prevLow)
        || CAUSE.some((c) => prevLow.includes(c) || low.includes(c))
        || SOURCE_MARKERS.some((mk) => prevLow.includes(mk))
      if (!hasPremise) {
        const pos = findWord(s, conseq)
        issues.push(makeIssue({
          ruleId: 'logic:causal-leap',
          category: 'logic',
          severity: 'low',
          title: 'Вывод без посылки',
          message: `Перед «${conseq}» нет факта или причины, из которых следует вывод. Добавьте основание.`,
          quote: conseq,
          ...pos,
        }))
      }
    }

    // 4. Превосходная степень без базы сравнения
    const sup = SUPERLATIVES.find((x) => containsWord(low, x))
    if (sup && !COMPARISON_BASIS.some((b) => low.includes(b))) {
      const pos = findWord(s, sup)
      issues.push(makeIssue({
        ruleId: 'logic:superlative',
        category: 'logic',
        severity: 'low',
        title: 'Сравнение без базы',
        message: `«${sup}» — по сравнению с чем? Укажите, с чем сравниваете.`,
        quote: sup,
        ...pos,
      }))
    }
  })

  findContradictions(sents, issues)
}

/**
 * Поиск возможных противоречий: два предложения говорят об одном и том же,
 * но с противоположной полярностью.
 */
function findContradictions(sents, issues) {
  const parsed = sents
    .map((s, i) => ({ i, s, tokens: words(s.text) }))
    .filter((x) => x.tokens.length > 3)
    .map((x) => {
      const polarity = new Map()
      const content = new Set()
      x.tokens.forEach((w, idx) => {
        if (w.length <= 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) return
        const st = stem(w)
        content.add(st)
        const neg = negationNear(x.tokens, idx)
        if (!polarity.has(st) || neg) polarity.set(st, neg)
      })
      return { ...x, polarity, content }
    })

  const reported = new Set()
  for (let a = 0; a < parsed.length; a++) {
    for (let b = a + 1; b < parsed.length; b++) {
      const A = parsed[a]
      const B = parsed[b]
      const shared = [...A.content].filter((st) => B.content.has(st))
      if (shared.length < 2) continue
      const flipped = shared.filter((st) => A.polarity.get(st) !== B.polarity.get(st))
      if (!flipped.length) continue
      const key = `${A.i}-${B.i}`
      if (reported.has(key)) continue
      reported.add(key)
      issues.push(makeIssue({
        ruleId: 'logic:contradiction',
        category: 'logic',
        severity: 'high',
        title: 'Возможное противоречие',
        message: `Это утверждение спорит с другим в тексте: «${truncate(A.s.text, 90)}». Общая тема — «${flipped[0]}». Проверьте, не противоречите ли вы себе.`,
        quote: truncate(B.s.text, 60),
        start: B.s.start,
        end: B.s.end,
      }))
      break
    }
  }
}

function negationNear(tokens, index) {
  const NEG = new Set(['не', 'нет', 'ни', 'без', 'никогда', 'никто', 'ничего', 'нельзя', 'перестал', 'бросил'])
  for (let i = Math.max(0, index - 2); i <= Math.min(tokens.length - 1, index + 1); i++) {
    if (i !== index && NEG.has(tokens[i])) return true
  }
  return false
}

/* ----------------------------------- ясность -------------------------------- */

function runClarity(src, sents, issues, profile) {
  const authorLen = profile?.avgSentenceLen || 0
  const longLimit = Math.max(26, Math.round(authorLen * 1.9) || 26)

  sents.forEach((s) => {
    const sw = words(s.text)
    if (sw.length > longLimit) {
      issues.push(makeIssue({
        ruleId: 'clarity:long-sentence',
        category: 'clarity',
        severity: sw.length > longLimit + 12 ? 'med' : 'low',
        title: 'Длинное предложение',
        message: `${sw.length} слов${authorLen ? `, у вас обычно ${authorLen}` : ''}. Разбейте на два-три.`,
        quote: truncate(s.text, 70),
        start: s.start,
        end: s.end,
      }))
    }

    // цепочка «который/что»
    const chain = (s.text.toLowerCase().match(/(?<![а-яё])(котор[а-яё]+|что|чтобы)(?![а-яё])/g) || []).length
    if (chain >= 3) {
      issues.push(makeIssue({
        ruleId: 'clarity:which-chain',
        category: 'clarity',
        severity: 'low',
        title: 'Цепочка придаточных',
        message: `${chain} подчинительных связки в одном предложении. Разделите мысли.`,
        quote: truncate(s.text, 70),
        start: s.start,
        end: s.end,
      }))
    }

    // скопление отглагольных существительных
    const nominal = sw.filter((w) => /(ание|ения|ение|ению|ением|ости|ость|остью)$/.test(w))
    if (nominal.length >= 3) {
      issues.push(makeIssue({
        ruleId: 'clarity:nominalization',
        category: 'clarity',
        severity: 'med',
        title: 'Отглагольные существительные',
        message: `«${nominal.slice(0, 3).join('», «')}» — замените действиями: кто что сделал.`,
        quote: truncate(s.text, 70),
        start: s.start,
        end: s.end,
      }))
    }

    // повтор одного корня внутри предложения
    const stems = contentStems(s.text)
    const counts = new Map()
    for (const st of stems) counts.set(st, (counts.get(st) || 0) + 1)
    const repeated = [...counts.entries()].find(([, n]) => n >= 3)
    if (repeated) {
      issues.push(makeIssue({
        ruleId: 'clarity:repeat',
        category: 'clarity',
        severity: 'low',
        title: 'Повтор',
        message: `Один корень «${repeated[0]}» повторяется ${repeated[1]} раза в предложении. Замените синонимом.`,
        quote: truncate(s.text, 70),
        start: s.start,
        end: s.end,
      }))
    }
  })

  // слишком плотные абзацы
  let offset = 0
  for (const p of String(src).split(/\n+/)) {
    const count = sentences(p).length
    if (count > 6) {
      const at = src.indexOf(p, offset)
      issues.push(makeIssue({
        ruleId: 'clarity:dense-paragraph',
        category: 'clarity',
        severity: 'low',
        title: 'Плотный абзац',
        message: `${count} предложений в одном абзаце. Разбейте — так текст легче читать с телефона.`,
        quote: truncate(p, 70),
        start: at >= 0 ? at : null,
        end: at >= 0 ? at + Math.min(p.length, 120) : null,
      }))
    }
    offset += p.length
  }
}

/* -------------------------------- Tone of Voice ----------------------------- */

function runToneOfVoice(src, sents, issues, profile) {
  const notes = []
  if (!profile) {
    notes.push({
      kind: 'info',
      text: 'Профиль стиля не задан — проверка Tone of Voice отключена. Добавьте 2–3 своих поста на шаге «Стиль».',
    })
    return notes
  }

  const draft = buildDraftMetrics(src)

  // 1. обращение не в той форме
  const target = profile.address
  if (target === 'ты' || target === 'вы') {
    const map = ADDRESS_MAP[target]
    const foreign = Object.keys(map)
    const re = new RegExp(`(?<![а-яёa-z])(${foreign.join('|')})(?![а-яёa-z])`, 'gi')
    let m
    let found = 0
    while ((m = re.exec(src)) !== null && found < 12) {
      found++
      const raw = m[0]
      const replacement = matchCase(raw, map[raw.toLowerCase()])
      // именительный падеж управляет глаголом: «вы получаете» → «ты получаешь».
      // Автозамена тут сломала бы согласование, поэтому правим только косвенные формы.
      const nominative = ['вы', 'ты'].includes(raw.toLowerCase())
      issues.push(makeIssue({
        ruleId: 'tov:address',
        category: 'tov',
        severity: 'med',
        title: 'Другое обращение',
        message: nominative
          ? `Вы пишете на «${target}», здесь — «${raw}». Замените на «${replacement}» и поправьте глагол: форма лица изменится.`
          : `Вы пишете на «${target}», здесь — «${raw}». Заменить на «${replacement}».`,
        quote: raw,
        start: m.index,
        end: m.index + raw.length,
        fix: nominative ? undefined : replacement,
      }))
    }
  }

  // 2. обезличенный текст
  if (profile.firstPersonPer100Words >= 2.5 && draft.firstPersonPer100Words < 1) {
    issues.push(makeIssue({
      ruleId: 'tov:impersonal',
      category: 'tov',
      severity: 'med',
      title: 'Текст обезличен',
      message: `В ваших постах «я» встречается ${profile.firstPersonPer100Words} раз на 100 слов, здесь — ${draft.firstPersonPer100Words}. Добавьте личный опыт: что вы сами делали и что получилось.`,
      quote: null,
      start: null,
      end: null,
    }))
  }

  // 3. эмодзи: перебор относительно привычной нормы
  const emojiBudget = Math.max(1, Math.round((profile.emojiPer100Words * draft.words) / 100) + 1)
  const emojiCount = countEmoji(src)
  if (emojiCount > emojiBudget + 1) {
    const re = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F0FF}]/gu
    let m
    let seen = 0
    while ((m = re.exec(src)) !== null) {
      seen++
      if (seen <= emojiBudget) continue
      issues.push(makeIssue({
        ruleId: 'tov:emoji-excess',
        category: 'tov',
        severity: 'low',
        title: 'Эмодзи больше обычного',
        message: `Ваша норма — около ${emojiBudget} на такой текст, здесь ${emojiCount}. Лишние можно убрать.`,
        quote: m[0],
        start: m.index,
        end: m.index + m[0].length,
        fix: '',
      }))
    }
  } else if (profile.emojiPer100Words >= 1.5 && emojiCount === 0) {
    notes.push({
      kind: 'tov',
      text: `В ваших постах обычно есть эмодзи (${profile.emojiPer100Words} на 100 слов), здесь их нет — текст звучит суше обычного.`,
    })
  }

  // 4. восклицания
  if (draft.exclamationShare > profile.exclamationShare + 25 && draft.sentences >= 3) {
    let m
    const re = /!/g
    let seen = 0
    let flagged = 0
    while ((m = re.exec(src)) !== null && flagged < 3) {
      seen++
      if (seen <= 1) continue
      flagged++
      issues.push(makeIssue({
        ruleId: 'tov:exclamation',
        category: 'tov',
        severity: 'low',
        title: 'Много восклицаний',
        message: `У вас восклицательных предложений ${profile.exclamationShare}%, в черновике ${draft.exclamationShare}%. Точка звучит спокойнее и увереннее.`,
        quote: '!',
        start: m.index,
        end: m.index + 1,
        fix: '.',
      }))
    }
  }

  // 5. предложения длиннее привычных — сводная заметка
  if (draft.avgSentenceLen > profile.avgSentenceLen * 1.45) {
    notes.push({
      kind: 'tov',
      text: `Средняя длина предложения ${draft.avgSentenceLen} слов против ваших ${profile.avgSentenceLen}. Ритм стал тяжелее, чем в ваших постах.`,
    })
  }

  return notes
}

/* ---------------------------------- сведение -------------------------------- */

const SEVERITY_ORDER = { high: 0, med: 1, low: 2 }

/** Убирает пересекающиеся замечания: остаётся более серьёзное. */
function dedupe(issues) {
  const ranged = issues.filter((i) => i.start !== null && i.end !== null)
  const global = issues.filter((i) => i.start === null || i.end === null)
  ranged.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (bySeverity !== 0) return bySeverity
    return (a.end - a.start) - (b.end - b.start)
  })
  const kept = []
  for (const issue of ranged) {
    const overlaps = kept.some((k) => issue.start < k.end && k.start < issue.end)
    if (!overlaps) kept.push(issue)
  }
  kept.sort((a, b) => a.start - b.start)
  const seenGlobal = new Set()
  const uniqueGlobal = global.filter((g) => {
    if (seenGlobal.has(g.ruleId)) return false
    seenGlobal.add(g.ruleId)
    return true
  })
  return [...kept, ...uniqueGlobal]
}

export function scoreText(issues, wordCount) {
  const base = Math.max(wordCount, 90)
  const byCategory = {}
  let total = 0
  for (const key of Object.keys(CATEGORIES)) byCategory[key] = 0
  for (const issue of issues) {
    const w = SEVERITY_WEIGHT[issue.severity] || 3
    total += w
    byCategory[issue.category] = (byCategory[issue.category] || 0) + w
  }
  const toScore = (penalty) => Math.max(0, Math.min(100, Math.round(100 / (1 + (penalty / base) * 100 / 33))))
  const categoryScores = {}
  for (const [key, penalty] of Object.entries(byCategory)) {
    categoryScores[key] = { score: toScore(penalty), issues: issues.filter((i) => i.category === key).length }
  }
  return { score: toScore(total), categoryScores }
}

function grade(score) {
  if (score >= 85) return { label: 'Можно публиковать', tone: 'good' }
  if (score >= 70) return { label: 'Почти готово', tone: 'ok' }
  if (score >= 50) return { label: 'Нужна правка', tone: 'warn' }
  return { label: 'Переписать', tone: 'bad' }
}

export function isFixable(issue) {
  return typeof issue.fix === 'string' && issue.start !== null && issue.end !== null
}

/**
 * Применяет выбранные правки к тексту.
 * Удаление расширяется до оборота или предложения, если правило так требует,
 * иначе от штампа остаются обрывки вроде «, что ...».
 */
export function applyFixes(text, issues) {
  const src = String(text)
  const sents = sentences(src)
  const ranges = issues
    .filter(isFixable)
    .map((issue) => expandRange(src, sents, issue))
    .filter((r) => r && r.start >= 0 && r.end <= src.length && r.end > r.start)

  // при пересечении оставляем более широкую правку, чтобы не резать текст дважды
  ranges.sort((a, b) => (b.end - b.start) - (a.end - a.start))
  const kept = []
  for (const r of ranges) {
    if (kept.some((k) => r.start < k.end && k.start < r.end)) continue
    kept.push(r)
  }

  kept.sort((a, b) => b.start - a.start)
  let out = src
  for (const r of kept) out = out.slice(0, r.start) + r.replacement + out.slice(r.end)
  return { text: tidy(out), applied: kept.length }
}

/** Расширяет диапазон правки по её режиму. */
function expandRange(src, sents, issue) {
  const base = { start: issue.start, end: issue.end, replacement: issue.fix }
  if (issue.fix !== '') return base
  const mode = issue.mode || 'word'

  if (mode === 'sentence') {
    const s = sents.find((x) => issue.start >= x.start && issue.start < x.end)
    if (!s) return base
    let end = s.end
    while (end < src.length && /[\s]/.test(src[end])) end++
    return { start: s.start, end, replacement: '' }
  }

  if (mode === 'clause') {
    let end = issue.end
    const tail = src.slice(end)
    const m = tail.match(/^\s*,\s*(что|чтобы|как|но)?\s*/)
    if (m) end += m[0].length
    return { start: issue.start, end, replacement: '' }
  }

  if (mode === 'lead') {
    let end = issue.end
    const m = src.slice(end).match(/^\s*[,—–-]\s*/)
    if (m) end += m[0].length
    return { start: issue.start, end, replacement: '' }
  }

  // обычное слово: съедаем один соседний пробел, чтобы не оставить двойной
  let start = issue.start
  let end = issue.end
  if (/\s/.test(src[end] || '')) end++
  else if (/\s/.test(src[start - 1] || '')) start--
  return { start, end, replacement: '' }
}

/** Косметика после удаления слов: пробелы, запятые, точки, заглавные буквы. */
export function tidy(text) {
  const out = String(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.!?;:…])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/([,;:])\s*([.!?…])/g, '$2')
    .replace(/([.!?])[.!?]+/g, '$1')
    .replace(/([.!?…])\s*([,;:])/g, '$1')
    .replace(/^[ \t]*[,;:.!?]+[ \t]*/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(^|[.!?…]\s+|\n[ \t]*)([а-яё])/gu, (m0, pre, ch) => pre + ch.toUpperCase())
  return out.split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/* ---------------------------------- утилиты --------------------------------- */

/** Первый абсолютный квантор, не входящий в допустимую конструкцию. */
function findAbsolute(low) {
  const blocked = []
  for (const re of ABSOLUTE_EXCEPTIONS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(low)) !== null) blocked.push([m.index, m.index + m[0].length])
  }
  for (const word of ABSOLUTES) {
    const re = new RegExp(`(?<![а-яёa-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![а-яёa-z])`, 'giu')
    let m
    while ((m = re.exec(low)) !== null) {
      const inside = blocked.some(([s, e]) => m.index >= s && m.index < e)
      if (!inside) return { word, index: m.index }
    }
  }
  return null
}

function containsWord(low, word) {
  const re = new RegExp(`(?<![а-яёa-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![а-яёa-z])`, 'iu')
  return re.test(low)
}

function findWord(sentence, word) {
  const idx = sentence.text.toLowerCase().indexOf(word.toLowerCase())
  if (idx === -1) return { start: sentence.start, end: sentence.end }
  return { start: sentence.start + idx, end: sentence.start + idx + word.length }
}

function matchCase(source, target) {
  if (!target) return source
  if (source[0] === source[0].toUpperCase()) return capitalize(target)
  return target
}

function truncate(s, n) {
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`
}

/** Короткая сводка для карточек. */
export function summarize(report) {
  if (!report || report.empty) return 'Нет текста для проверки'
  const high = report.issues.filter((i) => i.severity === 'high').length
  const parts = [`${report.issues.length} замечаний`]
  if (high) parts.push(`${high} критичных`)
  return parts.join(', ')
}
