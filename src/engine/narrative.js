/**
 * Narrative Engine — собирает из сырых заметок связный пост с сюжетной аркой
 * и подстраивает ритм под авторский Tone of Voice.
 *
 * Работает локально: раскладывает заметки по ролям в истории, расставляет их
 * в порядке выбранной арки, разбивает слишком длинные предложения и добавляет
 * минимум связок. Собственные слова автора не переписываются.
 */
import { sentences, words, capitalize } from './text.js'

/* --------------------------- роли и их маркеры ------------------------------ */

const ROLE_MARKERS = {
  hook: ['знакомо', 'бывало', 'представь', 'представьте', 'почему', 'что если', 'как часто', 'узнаёте', 'узнаете', 'признайтесь'],
  context: ['раньше', 'сначала', 'когда', 'назад', 'год', 'начинал', 'начинала', 'работал', 'работала', 'было', 'был', 'была', 'до этого', 'вначале', 'первое время', 'долго', 'привык'],
  conflict: ['но ', 'однако', 'проблема', 'не получалось', 'не работал', 'не работало', 'не приходил', 'почти не', 'застрял', 'сложно', 'трудно', 'боль', 'ошибка', 'провал', 'мешал', 'мешает', 'бесит', 'раздражал', 'раздражает', 'не хватало', 'страшно', 'выгорание', 'зря', 'тишина', 'отдачи ноль', 'теряют', 'теряю', 'тратят', 'трачу', 'путаниц', 'спорят', 'нет критери', 'по вкусу', 'некогда'],
  insight: ['понял', 'поняла', 'оказалось', 'выяснил', 'выяснилось', 'осознал', 'решил', 'решила', 'нашёл', 'нашла', 'попробовал', 'попробовала', 'сработало', 'помогло', 'дело в', 'ключ', 'вместо', 'начал', 'начала', 'правило', 'выписал', 'выписала', 'составил', 'завёл', 'завела', 'поменял', 'поменяла', 'изменил', 'изменила', 'перестал', 'перестала', 'добавил', 'убрал', 'записываю', 'сел и', 'села и', 'схем'],
  evidence: ['результат', 'вырос', 'выросла', 'выросло', 'стало', 'за месяц', 'за неделю', 'цифры', 'замерил', 'посчитал', 'подписчик', 'просмотр', 'конверсия', 'процент', 'раза', 'уже'],
  takeaway: ['вывод', 'итог', 'главное', 'советую', 'рекомендую', 'теперь', 'урок', 'в итоге', 'если коротко', 'поэтому', 'запомнил'],
  cta: ['а ты', 'а вы', 'расскажи', 'расскажите', 'напиши', 'напишите', 'поделись', 'поделитесь', 'как у вас', 'как у тебя', 'что думаете', 'что думаешь'],
}

/** Структурные признаки текста — по ним выбирается сюжетная арка. */
const PAST_FIRST_PERSON = /(?<![а-яёa-z])(я|мне|меня|мы|нам)(?![а-яёa-z])[^.!?]{0,40}(?<![а-яёa-z])[а-яё]{3,}л[аи]?(?![а-яёa-z])/iu
const TEMPORAL = ['назад', 'раньше', 'сначала', 'потом', 'дальше', 'теперь', 'когда', 'за месяц', 'за неделю', 'за квартал', 'за год', 'полгода', 'через', 'в итоге', 'до этого']
const ADVICE = ['можно', 'стоит', 'нужно', 'попробуй', 'сделай', 'заведи', 'проверяй', 'достаточно', 'советую', 'рекомендую', 'начните', 'начни', 'возьми', 'запиши', 'выдели']
const STANCE = ['считаю', 'по-моему', 'на мой взгляд', 'должен', 'должна', 'должны', 'не согласен', 'не согласна', 'спорно', 'претензия', 'вопрос в том', 'виноват', 'не прав', 'миф', 'заблуждение', 'убеждён', 'убежден', 'проблема не в', 'дело не в']

const ROLE_LABELS = {
  hook: 'Зацепка',
  context: 'Как было до',
  conflict: 'Проблема',
  insight: 'Что изменилось',
  evidence: 'Доказательство',
  takeaway: 'Вывод',
  cta: 'Вопрос читателю',
}

/* ----------------------------- сюжетные арки -------------------------------- */

export const ARCS = {
  story: {
    key: 'story',
    label: 'История / кейс',
    hint: 'Было → стало. Работает, когда есть личный опыт и результат.',
    slots: [
      { role: 'hook', label: 'Зацепка', max: 1 },
      { role: 'context', label: 'Как было до', max: 2 },
      { role: 'conflict', label: 'Что не работало', max: 2 },
      { role: 'insight', label: 'Перелом', max: 3 },
      { role: 'evidence', label: 'Что получилось', max: 2 },
      { role: 'takeaway', label: 'Вывод', max: 2 },
      { role: 'cta', label: 'Вопрос читателю', max: 1 },
    ],
    spill: 'insight',
  },
  problem: {
    key: 'problem',
    label: 'Проблема → решение',
    hint: 'Для полезных постов: боль, разбор, шаги, результат.',
    slots: [
      { role: 'conflict', label: 'Проблема', max: 2 },
      { role: 'context', label: 'Почему так выходит', max: 2 },
      { role: 'insight', label: 'Что делать', max: 4 },
      { role: 'evidence', label: 'Что это даёт', max: 2 },
      { role: 'takeaway', label: 'Вывод', max: 1 },
      { role: 'cta', label: 'Вопрос читателю', max: 1 },
    ],
    spill: 'insight',
  },
  opinion: {
    key: 'opinion',
    label: 'Мнение / разбор',
    hint: 'Тезис и аргументы. Когда важна позиция, а не история.',
    slots: [
      { role: 'hook', label: 'Тезис', max: 1 },
      { role: 'context', label: 'Контекст', max: 2 },
      { role: 'insight', label: 'Аргументы', max: 4 },
      { role: 'conflict', label: 'Возражение', max: 1 },
      { role: 'evidence', label: 'Опора на факты', max: 2 },
      { role: 'takeaway', label: 'Позиция', max: 2 },
      { role: 'cta', label: 'Вопрос читателю', max: 1 },
    ],
    spill: 'insight',
  },
}

/** Связки по ролям. Подбираются по регистру автора, добавляются экономно. */
const TRANSITIONS = {
  conflict: ['Проблема была в другом.', 'И вот тут всё ломалось.'],
  insight: ['Что я изменил.', 'Вот что сработало.'],
  evidence: ['Что из этого вышло.', 'Теперь про цифры.'],
  takeaway: ['Если коротко.', 'Главное из этого.'],
}

/* --------------------------------- разбор ----------------------------------- */

/** Разбивает сырые заметки на фрагменты: строки и предложения внутри строк. */
export function splitFragments(notes) {
  const out = []
  const lines = String(notes || '').split(/\n+/)
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*([-–—•*·]|\d+[.)])\s*/, '').trim()
    if (!line) continue
    const parts = sentences(line)
    const chunks = parts.length > 1 ? parts.map((p) => p.text) : [line]
    for (const chunk of chunks) {
      const clean = chunk.trim()
      if (words(clean).length >= 2) out.push({ index: out.length, text: clean })
    }
  }
  return out
}

/** Содержательная оценка роли: только по словам фрагмента, без учёта позиции. */
function contentScores(fragment) {
  const low = fragment.text.toLowerCase()
  const scores = {}
  for (const [role, markers] of Object.entries(ROLE_MARKERS)) {
    let score = 0
    for (const m of markers) if (low.includes(m)) score += m.length > 4 ? 2 : 1.2
    scores[role] = score
  }
  if (/\d/.test(low)) scores.evidence += 2.5
  if (/%|(?<![а-яё])раз[аы]?(?![а-яё])|[хx]\d/u.test(low)) scores.evidence += 1.5
  // цифра с отрицанием описывает не результат, а исходную проблему
  const negated = /(?<![а-яёa-z])(не|ни|нет|ноль|почти не)(?![а-яёa-z])/iu.test(low)
  if (negated) {
    scores.evidence *= 0.45
    if (/\d/.test(low)) scores.conflict += 2
  }
  if (fragment.text.trim().endsWith('?')) {
    scores.hook += 2
    scores.cta += 2
  }
  if (ADVICE.some((m) => low.includes(m))) scores.insight += 2
  if (STANCE.some((m) => low.includes(m))) {
    scores.hook += 1.5
    scores.takeaway += 1
  }
  if (PAST_FIRST_PERSON.test(low)) scores.context += 1
  return scores
}

/** Полная оценка: содержание плюс слабая подсказка от позиции в заметках. */
function scoreFragment(fragment, position, total) {
  const scores = contentScores(fragment)
  const rel = total > 1 ? position / (total - 1) : 0
  scores.hook += (1 - rel) * 1.6
  scores.context += (1 - Math.abs(rel - 0.2) * 2) * 1.2
  scores.conflict += (1 - Math.abs(rel - 0.35) * 2) * 1.0
  scores.insight += (1 - Math.abs(rel - 0.6) * 2) * 1.0
  scores.evidence += rel * 0.8
  scores.takeaway += rel * 1.8
  scores.cta += rel * 1.4
  for (const k of Object.keys(scores)) scores[k] = Math.max(0, Math.round(scores[k] * 100) / 100)
  return scores
}

/**
 * Автовыбор арки по структурным признакам заметок:
 * рассказ о своём опыте с цифрами → история, боль плюс советы → проблема,
 * оценочные суждения без истории → мнение.
 */
export function suggestArc(fragments, debug) {
  if (fragments.length < 2) return 'story'
  let numbers = 0
  let narration = 0
  let advice = 0
  let stance = 0
  let conflict = 0
  let temporal = 0
  for (const f of fragments) {
    const low = f.text.toLowerCase()
    if (/\d/.test(low)) numbers++
    if (PAST_FIRST_PERSON.test(low)) narration++
    if (TEMPORAL.some((m) => low.includes(m))) temporal++
    if (ADVICE.some((m) => low.includes(m))) advice++
    if (STANCE.some((m) => low.includes(m))) stance++
    if (ROLE_MARKERS.conflict.some((m) => low.includes(m))) conflict++
  }
  const n = fragments.length
  const story = (narration * 1.4 + temporal * 1.2 + numbers) / n
  const problem = (conflict * 1.2 + advice * 1.6) / n
  const opinion = (stance * 2) / n

  if (debug) return { numbers, narration, advice, stance, conflict, temporal, story, problem, opinion }

  const best = Math.max(story, problem, opinion)
  if (best < 0.2) return 'story'
  if (best === opinion) return 'opinion'
  if (best === problem) return 'problem'
  return 'story'
}

/* -------------------------------- сборка ------------------------------------ */

/**
 * Собирает пост из заметок.
 * @param {string} notes сырые заметки
 * @param {object|null} profile профиль авторского стиля
 * @param {string} [arcKey] выбранная арка; по умолчанию подбирается автоматически
 */
export function buildPost(notes, profile, arcKey) {
  const fragments = splitFragments(notes)
  if (fragments.length < 2) {
    return { ok: false, reason: 'Нужно хотя бы две заметки — по одной мысли в строке.', fragments }
  }

  const key = ARCS[arcKey] ? arcKey : suggestArc(fragments)
  const arc = ARCS[key]
  const scores = fragments.map((f, i) => scoreFragment(f, i, fragments.length))

  // Шаг 1. Каждому фрагменту — его самая сильная роль.
  const primary = fragments.map((f, i) => {
    const entries = Object.entries(scores[i]).sort((a, b) => b[1] - a[1])
    const [role, value] = entries[0]
    return value > 1.2 ? role : null
  })

  const used = new Set()
  const assigned = arc.slots.map((slot) => ({ slot, items: [] }))
  const bySlotRole = new Map(assigned.map((a) => [a.slot.role, a]))

  // Шаг 2. Раскладываем по слотам тех, чья сильная роль совпала со слотом.
  fragments.forEach((f, i) => {
    const target = bySlotRole.get(primary[i])
    if (!target || target.items.length >= target.slot.max) return
    target.items.push({ f, i, score: scores[i][target.slot.role] })
    used.add(i)
  })

  // Шаг 3. Остальные — в слот, где их оценка выше всего и осталось место.
  fragments.forEach((f, i) => {
    if (used.has(i)) return
    const free = assigned
      .filter((a) => a.items.length < a.slot.max)
      .sort((a, b) => scores[i][b.slot.role] - scores[i][a.slot.role])[0]
    if (!free) return
    free.items.push({ f, i, score: scores[i][free.slot.role] })
    used.add(i)
  })

  for (const group of assigned) group.items.sort((a, b) => a.i - b.i)

  const targetLen = profile?.avgSentenceLen ? Math.max(8, Math.round(profile.avgSentenceLen * 1.6)) : 18
  const additions = []

  const blocks = []
  let transitionsUsed = 0
  for (const group of assigned) {
    if (!group.items.length) continue
    const lines = []
    const pool = TRANSITIONS[group.slot.role]
    const wantsTransition = pool
      && transitionsUsed < 2
      && group.items.length >= 2
      && blocks.length > 0
    if (wantsTransition) {
      const phrase = pool[transitionsUsed % pool.length]
      lines.push(phrase)
      additions.push({ type: 'связка', text: phrase })
      transitionsUsed++
    }
    for (const item of group.items) {
      for (const sentence of rewriteFragment(item.f.text, targetLen)) lines.push(sentence)
    }
    blocks.push({
      role: group.slot.role,
      label: group.slot.label || ROLE_LABELS[group.slot.role],
      sources: group.items.map((i) => i.i),
      text: lines.join(' '),
    })
  }

  // вопрос в конце — только если автор действительно задаёт вопросы
  const hasCta = blocks.some((b) => b.role === 'cta')
  const asksQuestions = !profile || profile.questionShare >= 8
  if (!hasCta && asksQuestions) {
    const question = buildQuestion(fragments, profile)
    if (question) {
      blocks.push({ role: 'cta', label: ROLE_LABELS.cta, sources: [], text: question })
      additions.push({ type: 'вопрос', text: question })
    }
  }

  const title = buildTitle(blocks, fragments, profile)
  const text = blocks.map((b) => b.text).join('\n\n')

  return {
    ok: true,
    arc: { key: arc.key, label: arc.label, hint: arc.hint },
    title,
    blocks,
    text,
    additions,
    fragments,
    coverage: { used: used.size, total: fragments.length },
  }
}

/** Нормализует фрагмент и при необходимости делит длинное предложение. */
function rewriteFragment(text, targetLen) {
  let t = String(text).replace(/\s+/g, ' ').trim()
  t = t.replace(/^([-–—•*·]|\d+[.)])\s*/, '')
  t = capitalize(t)
  if (!/[.!?…:]$/.test(t)) t += '.'

  if (words(t).length <= targetLen) return [t]

  // делим по естественным границам, не меняя слов автора
  const parts = []
  let rest = t
  const boundary = /,\s+(но|а|и|потому что|поэтому|хотя|зато|причём|причем)\s+/i
  let guard = 0
  while (words(rest).length > targetLen && guard < 4) {
    guard++
    const m = rest.match(boundary)
    if (!m || m.index < 12) break
    const head = rest.slice(0, m.index).trim()
    const tail = rest.slice(m.index + m[0].length).trim()
    if (words(head).length < 4 || words(tail).length < 4) break
    parts.push(`${head}.`)
    rest = capitalize(`${m[1]} ${tail}`)
  }
  parts.push(rest)
  return parts.map((p) => capitalize(p.trim())).filter(Boolean)
}

/** Заголовок из первой смысловой заметки, а не из добавленной движком связки. */
function buildTitle(blocks, fragments, profile) {
  const preferQuestion = profile?.openingStyle === 'вопрос'
  const questionFragment = fragments.find((f) => f.text.trim().endsWith('?'))
  const block = blocks.find((b) => b.role === 'hook') || blocks[0]
  const first = block?.sources?.[0]
  const source = (preferQuestion && questionFragment)
    || (first !== undefined ? fragments[first] : null)
    || fragments[0]

  let t = (source?.text || '').split(/(?<=[.!?…])\s/)[0]
  t = t.replace(/^(я\s+)?(хочу|хотел|хотела)\s+(рассказать|поделиться)\s*/i, '')
  t = t.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '')
  if (t.length > 72) {
    const cut = t.slice(0, 72)
    t = `${cut.slice(0, cut.lastIndexOf(' '))}…`
  }
  return capitalize(t)
}

/** Вопрос читателю. Тема не подставляется в текст: падежи ломают формулировку. */
function buildQuestion(fragments, profile) {
  const informal = profile?.address !== 'вы'
  return informal
    ? 'А у тебя как с этим? Расскажи в комментариях — интересно сравнить.'
    : 'А у вас как с этим? Расскажите в комментариях — интересно сравнить.'
}
