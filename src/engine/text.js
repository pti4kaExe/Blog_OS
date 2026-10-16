/**
 * Базовый текстовый слой: разбор русского текста на предложения, слова, основы.
 * Всё считается локально в браузере, без внешних API.
 */

const VOWELS = 'аеёиоуыэюяaeiouy'

export const STOPWORDS = new Set(`и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по
только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас
нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб
без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти
мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот
через эти нас про всего них какая много разве три эту моя впрочем свою этой перед иногда лучше чуть том нельзя
такой им более всегда конечно всю между это её свой те эта ещё который которые которая этих таких том об же ты
мы наш ваш весь вся своих своей своим каждый любой этими этим оно оба либо тобой нами вами ими нам них тебе тобою
одну один одна одно одни раньше теперь потом снова совсем вообще именно почти около сразу пока затем тогда
ведь также тоже откуда куда всё все себя вроде итак кстати значит просто`
  .split(/\s+/).filter(Boolean))

/** Окончания для лёгкого стемминга (по убыванию длины). */
const ENDINGS = [
  'иваться', 'ываться', 'оваться', 'ившись', 'ывшись', 'ающий', 'ующий', 'ящий', 'ившие',
  'ениями', 'ностями', 'остями', 'ениями', 'аниями', 'ениях', 'аниях', 'остей', 'остях',
  'ность', 'ости', 'остью', 'ение', 'ения', 'анию', 'ения', 'аний', 'ение', 'ание',
  'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ей', 'ой', 'ый', 'ий', 'ая', 'яя',
  'ое', 'ее', 'ые', 'ие', 'ах', 'ях', 'ам', 'ям', 'ов', 'ев', 'ью', 'ия', 'ие', 'ий',
  'ешь', 'ишь', 'ете', 'ите', 'ают', 'яют', 'уют', 'юют', 'ать', 'ять', 'ить', 'еть', 'уть',
  'ала', 'яла', 'ила', 'ела', 'али', 'яли', 'или', 'ели', 'ало', 'яло', 'ило', 'ело',
  'ает', 'яет', 'ует', 'ит', 'ет', 'ут', 'ют', 'ат', 'ят', 'ла', 'ло', 'ли', 'л',
  'а', 'я', 'о', 'е', 'у', 'ю', 'ы', 'и', 'ь', 'й',
]

/** Грубая основа слова. Нужна для сопоставления тем и повторов, не для морфологии. */
export function stem(word) {
  const w = String(word).toLowerCase()
  if (w.length <= 4) return w
  for (const end of ENDINGS) {
    if (w.length - end.length >= 4 && w.endsWith(end)) return w.slice(0, w.length - end.length)
  }
  return w
}

/** Слова текста в нижнем регистре. */
export function words(text) {
  return String(text).toLowerCase().match(/[а-яёa-z0-9][а-яёa-z0-9-]*/gi) || []
}

/** Значимые основы: без стоп-слов, коротких и чисел. */
export function contentStems(text) {
  return words(text)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map(stem)
}

/**
 * Разбивает текст на предложения с сохранением позиций в исходной строке.
 * @returns {{text: string, start: number, end: number}[]}
 */
export function sentences(text) {
  const src = String(text)
  const out = []
  let start = 0
  const isBoundary = (i) => {
    const ch = src[i]
    if (ch === '\n') return true
    if (!'.!?…'.includes(ch)) return false
    let j = i
    while (j + 1 < src.length && '.!?…)»"'.includes(src[j + 1])) j++
    const next = src[j + 1]
    return next === undefined || /[\s\n]/.test(next)
  }
  for (let i = 0; i < src.length; i++) {
    if (!isBoundary(i)) continue
    let end = i + 1
    while (end < src.length && '.!?…)»"'.includes(src[end])) end++
    const raw = src.slice(start, end)
    if (raw.trim()) out.push(trimmed(src, start, end))
    start = end
    i = end - 1
  }
  if (start < src.length && src.slice(start).trim()) out.push(trimmed(src, start, src.length))
  return out
}

function trimmed(src, start, end) {
  let s = start
  let e = end
  while (s < e && /\s/.test(src[s])) s++
  while (e > s && /\s/.test(src[e - 1])) e--
  return { text: src.slice(s, e), start: s, end: e }
}

/** Абзацы. В соцсетях абзац — это строка, поэтому делим по любому переводу строки. */
export function paragraphs(text) {
  return String(text).split(/\n+/).map((p) => p.trim()).filter(Boolean)
}

export function countSyllables(word) {
  let n = 0
  for (const ch of String(word).toLowerCase()) if (VOWELS.includes(ch)) n++
  return Math.max(n, 1)
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu

export function countEmoji(text) {
  return (String(text).match(EMOJI_RE) || []).length
}

export function stripEmoji(text) {
  return String(text).replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ')
}

/** Есть ли отрицание рядом с позицией слова (в пределах 3 токенов слева). */
export function hasNegationNear(tokens, index) {
  const NEG = new Set(['не', 'нет', 'ни', 'без', 'никогда', 'никто', 'ничего', 'нельзя'])
  for (let i = Math.max(0, index - 3); i < index; i++) if (NEG.has(tokens[i])) return true
  return false
}

/**
 * Адаптированный для русского языка индекс читаемости (шкала 0-100, больше — легче).
 * Использует коэффициенты, адаптированные для русского текста.
 */
export function readability(text) {
  const sents = sentences(text)
  const ws = words(text)
  if (!sents.length || !ws.length) return 60
  const asl = ws.length / sents.length
  const asw = ws.reduce((a, w) => a + countSyllables(w), 0) / ws.length
  const score = 206.835 - 1.3 * asl - 60.1 * asw
  return Math.round(Math.max(0, Math.min(100, score)))
}

export function pct(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

/** Первая буква — заглавная, остальное не трогаем. */
export function capitalize(s) {
  const t = String(s)
  const i = t.search(/[а-яёa-z]/i)
  if (i === -1) return t
  return t.slice(0, i) + t[i].toUpperCase() + t.slice(i + 1)
}
