/**
 * Приведение профиля стиля из API к формату, понятному интерфейсу и движку.
 *
 * Сервер хранит `tov_profiles.metrics` как результат buildStyleProfile(),
 * но в контракте встречаются и snake_case-ключи. Клиент принимает оба варианта,
 * чтобы карточка стиля и сравнение с профилем работали при любом ответе.
 */

const ALIASES = {
  avgSentenceLen: ['avgSentenceLen', 'avg_sentence_length'],
  sentenceLenSpread: ['sentenceLenSpread', 'sentence_len_spread'],
  longSentenceShare: ['longSentenceShare', 'long_sentence_share'],
  avgParagraphSentences: ['avgParagraphSentences', 'avg_paragraph_sentences'],
  emojiPer100Words: ['emojiPer100Words', 'emoji_per_100_words'],
  exclamationShare: ['exclamationShare', 'exclamation_share'],
  questionShare: ['questionShare', 'question_share'],
  firstPersonPer100Words: ['firstPersonPer100Words', 'first_person_per_100_words'],
  bureaucracyPer100Words: ['bureaucracyPer100Words', 'bureaucracy_per_100_words'],
  slangPer100Words: ['slangPer100Words', 'slang_per_100_words'],
  dashShare: ['dashShare', 'dash_share'],
  capsWords: ['capsWords', 'caps_words'],
  listShare: ['listShare', 'list_share'],
  lexicalDiversity: ['lexicalDiversity', 'lexical_diversity'],
  readability: ['readability'],
  address: ['address'],
  openingStyle: ['openingStyle', 'opening_style'],
}

const ROWS = [
  { key: 'avgSentenceLen', label: 'слов в предложении', unit: '' },
  { key: 'firstPersonPer100Words', label: '«я» на 100 слов', unit: '' },
  { key: 'questionShare', label: 'вопросов', unit: '%' },
  { key: 'emojiPer100Words', label: 'эмодзи /100 слов', unit: '' },
  { key: 'readability', label: 'читаемость', unit: '' },
  { key: 'sentenceLenSpread', label: 'разброс длины фраз', unit: '' },
  { key: 'avgParagraphSentences', label: 'предложений в абзаце', unit: '' },
  { key: 'bureaucracyPer100Words', label: 'канцелярита /100 слов', unit: '' },
  { key: 'slangPer100Words', label: 'сленга /100 слов', unit: '' },
  { key: 'lexicalDiversity', label: 'лексическое разнообразие', unit: '%' },
]

function metricsSource(tov) {
  if (!tov) return null
  if (tov.metrics && typeof tov.metrics === 'object') return tov.metrics
  return tov
}

function pickNumber(source, key) {
  if (!source) return null
  for (const name of ALIASES[key] || [key]) {
    const value = source[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export function pickString(source, key) {
  if (!source) return null
  for (const name of ALIASES[key] || [key]) {
    const value = source[name]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

/** Метрики для карточки стиля: только понятные и заполненные. */
export function tovMetricRows(tov) {
  const source = metricsSource(tov)
  if (!source) return []
  const rows = []
  for (const row of ROWS) {
    const value = pickNumber(source, row.key)
    if (value === null) continue
    rows.push({
      key: row.key,
      label: row.label,
      value: `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}${row.unit}`,
    })
  }
  return rows
}

/** Профиль в форме, которую ожидает compareToProfile() из @blogos/engine. */
export function engineProfileFromTov(tov) {
  const source = metricsSource(tov)
  if (!source) return null
  const profile = {
    avgSentenceLen: pickNumber(source, 'avgSentenceLen'),
    firstPersonPer100Words: pickNumber(source, 'firstPersonPer100Words'),
    emojiPer100Words: pickNumber(source, 'emojiPer100Words'),
    questionShare: pickNumber(source, 'questionShare'),
    exclamationShare: pickNumber(source, 'exclamationShare'),
    bureaucracyPer100Words: pickNumber(source, 'bureaucracyPer100Words'),
    address: pickString(source, 'address') || (typeof tov?.tone === 'string' ? tov.tone : null),
  }
  const known = Object.values(profile).filter((value) => typeof value === 'number')
  // Сравнение имеет смысл, когда известна хотя бы длина фразы и ещё одна метрика.
  if (!known.length || profile.avgSentenceLen === null) return null
  for (const key of Object.keys(profile)) {
    if (profile[key] === null && key !== 'address') profile[key] = 0
  }
  return profile
}

/** Темы и фирменные фразы, если сервер прислал полный профиль движка. */
export function tovTags(tov) {
  const source = metricsSource(tov)
  if (!source) return { topics: [], phrases: [] }
  const topics = Array.isArray(source.topTerms)
    ? source.topTerms
      .map((term) => (typeof term === 'string' ? term : term && term.label))
      .filter(Boolean)
      .slice(0, 12)
    : []
  const phrases = Array.isArray(source.signaturePhrases)
    ? source.signaturePhrases.filter((phrase) => typeof phrase === 'string').slice(0, 8)
    : []
  return { topics, phrases }
}

/** Сводка «что разобрано» из ответа analyze. */
export function analysisSummary(analysis) {
  if (!analysis) return ''
  const parts = []
  if (analysis.posts_used) {
    parts.push(`${analysis.posts_used} ${analysis.posts_used === 1 ? 'пост' : 'поста'}`)
  }
  if (analysis.chars) parts.push(`${analysis.chars.toLocaleString('ru-RU')} символов`)
  if (analysis.source) parts.push(`источник: ${analysis.source === 'rules' ? 'правила' : analysis.source}`)
  return parts.join(' · ')
}
