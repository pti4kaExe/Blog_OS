/**
 * Профиль авторского стиля (Tone of Voice).
 * Строится из собственных публикаций автора: это «память» системы о том,
 * как автор пишет, и база для Narrative Engine, AntiCringe и CommentRadar.
 */
import {
  words, sentences, contentStems, countEmoji, paragraphs, stem, STOPWORDS, readability,
} from './text.js'

// \b в JavaScript не работает с кириллицей, поэтому границы слова задаём просмотрами
const B0 = '(?<![а-яёa-z])'
const B1 = '(?![а-яёa-z])'
const word = (alt) => new RegExp(`${B0}(?:${alt})${B1}`, 'giu')

const FIRST_PERSON = word('я|мне|меня|мной|мой|моя|моё|мои|моего|моей|моим|мою|со мной')
const TY_FORMS = word('ты|тебя|тебе|тобой|твой|твоя|твои|твоё|твоего|твоей')
const VY_FORMS = word('вы|вас|вам|вами|ваш|ваша|ваши|ваше|вашего|вашей')
const BUREAU = word('осуществ[а-яё]+|явля[а-яё]+|данн(?:ый|ая|ое|ого|ым|ой|ую)|в рамках|в связи с тем|на сегодняшний день|в целях|посредством|имеет место|в качестве|вышеуказанн[а-яё]+|соответствующ[а-яё]+|при наличии|в настоящее время')
const SLANG = word('кайф|жесть|норм|фигня|треш|трэш|чувак|прикол|круто|класс|зашло|качает|пушка|бомба|вайб|кринж|хайп|окей')
const MIN_CHARS = 180

export const EMPTY_PROFILE = null

/**
 * @param {string[]} samples — собственные посты автора
 * @returns {object|null} профиль или null, если материала слишком мало
 */
export function buildStyleProfile(samples) {
  const clean = (samples || []).map((s) => String(s).trim()).filter((s) => s.length > 30)
  const joined = clean.join('\n\n')
  if (!clean.length || joined.length < MIN_CHARS) return null

  const allWords = words(joined)
  const allSents = sentences(joined).filter((s) => words(s.text).length > 1)
  const per100 = (n) => Math.round((n / Math.max(allWords.length, 1)) * 1000) / 10

  const sentLens = allSents.map((s) => words(s.text).length)
  const avgSentenceLen = mean(sentLens)
  const longSentences = sentLens.filter((n) => n > 20).length

  const paras = clean.flatMap((s) => paragraphs(s))
  const paraSentCounts = paras.map((p) => Math.max(sentences(p).length, 1))

  const stems = contentStems(joined)
  const uniq = new Set(stems)

  const lines = joined.split('\n').map((l) => l.trim()).filter(Boolean)
  const listLines = lines.filter((l) => /^([-–—•*·]|\d+[.)])\s/.test(l)).length

  const profile = {
    version: 1,
    createdAt: new Date().toISOString(),
    samples: clean,
    stats: {
      posts: clean.length,
      words: allWords.length,
      sentences: allSents.length,
    },
    avgSentenceLen: round1(avgSentenceLen),
    sentenceLenSpread: round1(stdev(sentLens)),
    longSentenceShare: share(longSentences, allSents.length),
    avgParagraphSentences: round1(mean(paraSentCounts)),
    emojiPer100Words: per100(countEmoji(joined)),
    exclamationShare: share(allSents.filter((s) => s.text.includes('!')).length, allSents.length),
    questionShare: share(allSents.filter((s) => s.text.includes('?')).length, allSents.length),
    firstPersonPer100Words: per100(countMatches(joined, FIRST_PERSON)),
    bureaucracyPer100Words: per100(countMatches(joined, BUREAU)),
    slangPer100Words: per100(countMatches(joined, SLANG)),
    dashShare: share(allSents.filter((s) => /\s[—–-]\s/.test(s.text)).length, allSents.length),
    capsWords: countMatches(joined, /(?<![А-ЯЁа-яё])[А-ЯЁ]{3,}(?![А-ЯЁа-яё])/gu),
    listShare: share(listLines, lines.length),
    lexicalDiversity: Math.round((uniq.size / Math.max(stems.length, 1)) * 100),
    readability: readability(joined),
    address: detectAddress(joined),
    openingStyle: detectOpening(clean),
    topTerms: topTerms(clean),
    signaturePhrases: signaturePhrases(joined),
  }
  profile.summary = describeProfile(profile)
  return profile
}

function countMatches(text, re) {
  return (String(text).match(re) || []).length
}

function mean(arr) {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function stdev(arr) {
  if (arr.length < 2) return 0
  const m = mean(arr)
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)))
}

function share(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 100)
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function detectAddress(text) {
  const ty = countMatches(text, TY_FORMS)
  const vy = countMatches(text, VY_FORMS)
  if (ty === 0 && vy === 0) return 'нейтральное'
  return ty > vy * 1.2 ? 'ты' : vy > ty * 1.2 ? 'вы' : 'смешанное'
}

function detectOpening(samples) {
  let question = 0
  let greeting = 0
  let personal = 0
  for (const s of samples) {
    const first = (sentences(s)[0]?.text || '').toLowerCase()
    if (first.includes('?')) question++
    if (/^(привет|всем привет|друзья|здравствуйте|хей|йо|доброе утро)/.test(first)) greeting++
    if (countMatches(first, FIRST_PERSON)) personal++
  }
  const n = samples.length
  if (greeting / n >= 0.5) return 'приветствие'
  if (question / n >= 0.4) return 'вопрос'
  if (personal / n >= 0.4) return 'личная история'
  return 'утверждение'
}

/** Глагольные и служебные формы: как темы они не читаются. */
const NOT_A_TOPIC = /(ться|ть|ешь|ишь|ает|яет|ует|ет|ёт|ют|ут|ат|ят|ла|ли|ло|лся|лись)$/
const NOT_A_TOPIC_WORDS = new Set([
  'было', 'были', 'есть', 'быть', 'надо', 'нужно', 'можно', 'очень', 'стало', 'стал', 'хочу', 'хотел',
  'может', 'могу', 'сделал', 'делать',
  // единицы времени — слабый сигнал темы, из-за них совпадают посторонние обсуждения
  'день', 'дня', 'дни', 'дней', 'неделя', 'недели', 'месяц', 'месяца', 'месяцев', 'год', 'года', 'лет',
  'утром', 'вечером', 'ночью', 'время', 'времени', 'раза', 'часа', 'часов',
])

/** Топ-темы автора: частотные значимые основы с примером исходного слова. */
function topTerms(samples, limit = 14) {
  const freq = new Map()
  const forms = new Map()
  for (const sample of samples) {
    const seen = new Set()
    for (const w of words(sample)) {
      if (w.length <= 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue
      const st = stem(w)
      freq.set(st, (freq.get(st) || 0) + 1)
      if (!forms.has(st)) forms.set(st, w)
      seen.add(st)
    }
    for (const st of seen) freq.set(st, (freq.get(st) || 0) + 0.5) // бонус за охват постов
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([st, n]) => ({ stem: st, label: forms.get(st), weight: Math.round(n * 10) / 10 }))
    .filter((t) => t.label && !NOT_A_TOPIC.test(t.label) && !NOT_A_TOPIC_WORDS.has(t.label))
    .slice(0, limit)
}

/** Частотные биграммы — «фразы-подписи» автора. */
function signaturePhrases(text, limit = 6) {
  const ws = words(text)
  const freq = new Map()
  for (let i = 0; i < ws.length - 1; i++) {
    const a = ws[i]
    const b = ws[i + 1]
    if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue
    if (a.length < 4 || b.length < 4) continue
    const key = `${a} ${b}`
    freq.set(key, (freq.get(key) || 0) + 1)
  }
  return [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([p]) => p)
}

function describeProfile(p) {
  const parts = []
  parts.push(p.avgSentenceLen < 11 ? 'короткие предложения' : p.avgSentenceLen > 17 ? 'длинные развёрнутые предложения' : 'средняя длина предложений')
  parts.push(p.firstPersonPer100Words > 3 ? 'личный опыт от первого лица' : 'сдержанная подача без «я»')
  if (p.emojiPer100Words > 0.8) parts.push('эмодзи как часть речи')
  if (p.questionShare > 15) parts.push('вопросы к читателю')
  if (p.address === 'ты') parts.push('обращение на «ты»')
  if (p.address === 'вы') parts.push('обращение на «вы»')
  if (p.slangPer100Words > 0.6) parts.push('разговорная лексика')
  if (p.bureaucracyPer100Words > 1.2) parts.push('официальные формулировки')
  if (p.listShare > 20) parts.push('списки и перечисления')
  return parts.join(', ')
}

/**
 * Насколько текст отклоняется от профиля. Используется AntiCringe.
 * @returns {{key:string,label:string,author:string,draft:string,delta:number,direction:string}[]}
 */
export function compareToProfile(text, profile) {
  if (!profile) return []
  const draft = buildDraftMetrics(text)
  const rows = [
    metric('sentenceLen', 'Длина предложения', profile.avgSentenceLen, draft.avgSentenceLen, ' сл.'),
    metric('firstPerson', 'Личный голос («я»)', profile.firstPersonPer100Words, draft.firstPersonPer100Words, ' /100 сл.'),
    metric('emoji', 'Эмодзи', profile.emojiPer100Words, draft.emojiPer100Words, ' /100 сл.'),
    metric('questions', 'Вопросы к читателю', profile.questionShare, draft.questionShare, '%'),
    metric('exclamations', 'Восклицания', profile.exclamationShare, draft.exclamationShare, '%'),
    metric('bureaucracy', 'Канцелярит', profile.bureaucracyPer100Words, draft.bureaucracyPer100Words, ' /100 сл.'),
  ]
  return rows
}

export function buildDraftMetrics(text) {
  const ws = words(text)
  const sents = sentences(text).filter((s) => words(s.text).length > 1)
  const per100 = (n) => Math.round((n / Math.max(ws.length, 1)) * 1000) / 10
  return {
    words: ws.length,
    sentences: sents.length,
    avgSentenceLen: round1(mean(sents.map((s) => words(s.text).length))),
    firstPersonPer100Words: per100(countMatches(text, FIRST_PERSON)),
    emojiPer100Words: per100(countEmoji(text)),
    questionShare: share(sents.filter((s) => s.text.includes('?')).length, sents.length),
    exclamationShare: share(sents.filter((s) => s.text.includes('!')).length, sents.length),
    bureaucracyPer100Words: per100(countMatches(text, BUREAU)),
    readability: readability(text),
  }
}

function metric(key, label, author, draftValue, unit) {
  const base = Math.max(author, 0.4)
  const delta = Math.round(((draftValue - author) / base) * 100)
  return {
    key,
    label,
    author: `${author}${unit}`,
    draft: `${draftValue}${unit}`,
    authorValue: author,
    draftValue,
    delta,
    direction: delta > 25 ? 'выше' : delta < -25 ? 'ниже' : 'в норме',
  }
}
