/**
 * Системные промпты LLM. Маркер «ЗАДАЧА: <name>» позволяет mock-провайдеру
 * вернуть ответ нужного формата, а «ВХОД:» отделяет данные автора от инструкции.
 * Модель никогда не выдумывает факты: для пропусков используется [дополните: …].
 *
 * Профиль стиля и факты автора добавляются В ПРОМПТ ДО маркера «ВХОД:»:
 * mock-провайдер берёт данные после последнего «ВХОД:», поэтому профиль не
 * попадает в блоки поста и в текст комментария.
 */

/** Профиль стиля в том виде, в каком он нужен промпту; значения нормализуются. */
export interface PromptProfile {
  address?: unknown
  avgSentenceLen?: unknown
  firstPersonPer100Words?: unknown
  stopWords?: unknown
  topTerms?: unknown
  signaturePhrases?: unknown
  samples?: unknown
  [key: string]: unknown
}

/** Пример поста обрезаем: больше 500 символов на образец промпт раздувает. */
const MAX_SAMPLE_CHARS = 500
const MAX_SAMPLES = 2
const MAX_TOP_TERMS = 8
const MAX_SIGNATURE_PHRASES = 5
const MAX_STOP_WORDS = 12
const MAX_FACTS = 8

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const items: string[] = []
  for (const item of value) {
    const text = asString(item)
    if (text && !items.includes(text)) items.push(text)
  }
  return items
}

/** topTerms приходят как { stem, label, weight } или строками. */
function termLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const labels: string[] = []
  for (const item of value) {
    const label =
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object'
          ? asString((item as { label?: unknown }).label)
          : ''
    if (label && !labels.includes(label)) labels.push(label)
  }
  return labels
}

/**
 * Блок «ПРОФИЛЬ АВТОРА»: обращение, ритм фраз, личный голос, стоп-слова,
 * темы канала, фразы-подписи и живые примеры постов.
 * null — профиля нет, промпт остаётся прежним.
 */
export function profileBlock(profile: PromptProfile | null | undefined): string | null {
  if (!profile || typeof profile !== 'object') return null
  const lines: string[] = []

  const address = asString(profile.address)
  if (address) lines.push(`- обращение к читателю: ${address}`)

  const avgSentenceLen = asNumber(profile.avgSentenceLen)
  if (avgSentenceLen !== null) lines.push(`- средняя длина фразы: ${avgSentenceLen} слов`)

  const firstPerson = asNumber(profile.firstPersonPer100Words)
  if (firstPerson !== null) lines.push(`- доля «я»: ${firstPerson} на 100 слов`)

  const stopWords = stringList(profile.stopWords).slice(0, MAX_STOP_WORDS)
  if (stopWords.length) {
    lines.push(`- стоп-слова (использовать нельзя): ${stopWords.join(', ')}`)
  }

  const topics = termLabels(profile.topTerms).slice(0, MAX_TOP_TERMS)
  if (topics.length) lines.push(`- топ-темы канала: ${topics.join(', ')}`)

  const phrases = stringList(profile.signaturePhrases).slice(0, MAX_SIGNATURE_PHRASES)
  if (phrases.length) lines.push(`- подпись-фразы: ${phrases.join('; ')}`)

  const samples = stringList(profile.samples)
    .slice(0, MAX_SAMPLES)
    .map((sample) => sample.slice(0, MAX_SAMPLE_CHARS))
  if (samples.length) {
    lines.push('- примеры постов автора:')
    samples.forEach((sample, index) => {
      lines.push(`  ${index + 1}. ${sample}`)
    })
  }

  if (lines.length === 0) return null
  return ['ПРОФИЛЬ АВТОРА:', ...lines].join('\n')
}

/** Блок «ФАКТЫ АВТОРА» — единственный источник фактов для модели. */
export function factsBlock(facts: string[] | null | undefined): string | null {
  const items = stringList(facts).slice(0, MAX_FACTS)
  if (items.length === 0) return null
  return ['ФАКТЫ АВТОРА:', ...items.map((fact) => `- ${fact}`)].join('\n')
}

/**
 * Инструкция «в чьём голосе и на каких фактах»: нужна только когда в промпте
 * есть профиль или факты, иначе промпт остаётся прежним.
 */
function voiceRules(hasProfile: boolean, hasFacts: boolean, allowGaps = true): string | null {
  if (!hasProfile && !hasFacts) return null
  const rules: string[] = []
  if (hasProfile) {
    rules.push('Пиши в этом голосе: то же обращение, тот же ритм фраз, те же темы.')
    rules.push('Не используй стоп-слова из профиля.')
  }
  if (hasFacts) {
    rules.push('Не выдумывай факты — используй только факты из блока «ФАКТЫ АВТОРА».')
  } else if (allowGaps) {
    rules.push('Не выдумывай факты: опирайся только на данные автора во ВХОДЕ, а чего не хватает — оставь пропуском [дополните: …].')
  } else {
    rules.push('Не выдумывай факты: опирайся только на данные автора во ВХОДЕ. Если деталей мало, сделай короткий честный черновик, а недостающие вопросы перечисли в added_by_engine.')
  }
  return rules.join(' ')
}

export const LINT_SYSTEM = `Ты — внимательный редактор русскоязычных текстов для соцсетей.
Проверь текст и найди замечания, которых нет в правиловом движке: смысловые неточности,
неудачные формулировки, нарушения логики, канцелярит, потерю Tone of Voice.
Верни СТРОГО JSON без пояснений вокруг:
{"issues":[{"type":"cliche|logic|clarity|tov","quote":"фрагмент текста","start":0,"end":0,
"explanation":"почему это замечание","suggestion":"как исправить","fix":"текст, которым заменить quote","severity":"high|med|low"}]}
start и end — позиции в исходном тексте (символы, end не включается).
fix — готовая замена для quote (не объяснение, а текст), той же длины порядка; не придумывай новые факты. Если замена не нужна — пустая строка.
Если замечаний нет — {"issues":[]}.
ЗАДАЧА: lint`

/**
 * Краткий профиль для проверки: обращение, стоп-слова и темы канала.
 * Отклонение от него — замечание tov.
 */
function lintProfileBlock(profile: PromptProfile | null | undefined): string | null {
  if (!profile || typeof profile !== 'object') return null
  const lines: string[] = []

  const address = asString(profile.address)
  if (address) lines.push(`- обращение к читателю: ${address}`)

  const stopWords = stringList(profile.stopWords).slice(0, MAX_STOP_WORDS)
  if (stopWords.length) {
    lines.push(`- стоп-слова (использовать нельзя): ${stopWords.join(', ')}`)
  }

  const topics = termLabels(profile.topTerms).slice(0, MAX_TOP_TERMS)
  if (topics.length) lines.push(`- топ-темы канала: ${topics.join(', ')}`)

  if (lines.length === 0) return null
  return ['ПРОФИЛЬ АВТОРА:', ...lines].join('\n')
}

export function lintUser(text: string, profile?: PromptProfile | null): string {
  const sections = ['Проверь текст черновика. Верни только JSON.']
  const block = lintProfileBlock(profile)
  if (block) {
    sections.push(
      block,
      'Считай отклонением от профиля: другое обращение, стоп-слова из списка и уход от тем канала — замечание типа tov.',
    )
  }
  return `${sections.join('\n\n')}\n\nВХОД:\n${text}`
}

export const TOV_SYSTEM = `Ты — редактор, который описывает авторский стиль по его текстам.
Верни СТРОГО JSON: {"tone":"ты|вы|смешанное","slang":["слово"],"favorite_phrases":["фраза"]}.
Опирайся только на тексты, не придумывай факты.
ЗАДАЧА: tov_analyze`

export function tovUser(texts: string[]): string {
  return `Опиши стиль автора по этим текстам. Верни только JSON.\n\nВХОД:\n${texts.join('\n\n')}`
}

export const NARRATIVE_SYSTEM = `Ты — редактор Narrative Engine. Собери из сырых заметок автора связный пост,
сохраняя его слова и факты. Не придумывай новый опыт и цифры.
Не вставляй в текст черновика плейсхолдеры вида [дополните: …]. Если данных не хватает,
сделай короткий честный пост из имеющегося, а вопросы к автору перечисли в added_by_engine.
Верни СТРОГО JSON:
{"title":"заголовок","blocks":[{"role":"hook|context|conflict|insight|evidence|takeaway|cta","text":"абзац"}],
"added_by_engine":["что добавил движок"]}
ЗАДАЧА: narrative_generate`

export function narrativeUser(
  notes: string,
  arc: string | null,
  profile?: PromptProfile | null,
  facts?: string[] | null,
): string {
  const profileText = profileBlock(profile)
  const factsText = factsBlock(facts)
  const sections: string[] = [`Собери пост из заметок${arc ? `, арка: ${arc}` : ''}. Верни только JSON.`]

  if (profileText) sections.push(profileText)
  if (factsText) sections.push(factsText)
  const rules = voiceRules(Boolean(profileText), Boolean(factsText), false)
  if (rules) sections.push(rules)

  return `${sections.join('\n\n')}\n\nВХОД:\n${notes}`
}

/** Клише, которые промт v2 запрещает явно; стенд качества считает их по тексту. */
export const BANNED_CLICHES: string[] = [
  'в современном мире',
  'не секрет, что',
  'давайте разберёмся',
  'давайте разберемся',
  'как известно',
  'ни для кого не секрет',
  'в наше время',
  'успешный успех',
  'играет важную роль',
  'является неотъемлемой частью',
  'итак,',
  'кстати,',
  'стоит отметить',
  'хочется отметить',
]

/**
 * Промт v2: роль, жёсткие ограничения, структура по арке, анти-клише и примеры
 * голоса. Профиль и факты по-прежнему идут ДО маркера «ВХОД:» — mock-провайдер
 * читает данные после последнего маркера, поэтому формат ответа не ломается.
 */
export function narrativeUserV2(
  notes: string,
  arc: string | null,
  profile?: PromptProfile | null,
  facts?: string[] | null,
): string {
  const profileText = profileBlock(profile)
  const factsText = factsBlock(facts)
  const sections: string[] = [
    `Ты — редактор блога и пишешь пост голосом автора по его заметкам. Арка: ${arc ?? 'подбери по заметкам'}.`,
    `ЖЁСТКИЕ ТРЕБОВАНИЯ:
- пиши только тем голосом, который задан профилем ниже; обращение, ритм и лексика — автора;
- не используй стоп-слова из профиля;
- не выдумывай факты: бери только факты из блока «ФАКТЫ АВТОРА» и данные из заметок;
- один пост, без вступлений о себе и без мета-комментариев к заданию;
- длина 600–1200 знаков.`,
    `СТРУКТУРА (по одному-два предложения на блок):
- hook — зацепка: конкретная ситуация или наблюдение, без общих слов;
- context — что было и почему это важно;
- insight — что понял автор, главная мысль;
- takeaway — вывод или совет;
- cta — короткий вопрос читателю (одно предложение).`,
    `ЗАПРЕЩЕНО (анти-клише): ${BANNED_CLICHES.map((phrase) => `«${phrase}»`).join(', ')};
пустые обещания, канцелярит, «успешный успех», вода, повторение заголовка в первом предложении.`,
  ]

  if (profileText) sections.push(profileText)
  if (factsText) sections.push(factsText)

  // Few-shot: живые примеры голоса автора (не больше двух, каждый до 500 знаков).
  const samples = stringList(profile?.samples)
    .slice(0, MAX_SAMPLES)
    .map((sample) => sample.slice(0, MAX_SAMPLE_CHARS).trim())
    .filter(Boolean)
  if (samples.length > 0) {
    sections.push(
      `ПРИМЕРЫ ГОЛОСА (стиль, а не факты для копирования):
${samples.map((sample, index) => `Пример голоса ${index + 1}:\n${sample}`).join('\n\n')}`,
    )
  }

  sections.push(`ВЕРНИ СТРОГО JSON без пояснений вокруг:
{"title":"заголовок","blocks":[{"role":"hook|context|insight|takeaway|cta","text":"текст блока"}]}`)

  return `${sections.join('\n\n')}\n\nВХОД:\n${notes}`
}

export const RESPONSE_SYSTEM = `Ты — автор блога, который отвечает на комментарии читателей в своём стиле.
Ответ состоит из четырёх частей: reference (отсылка к вопросу), experience (личный опыт),
gap (обязательный пропуск [дополните: …] — факт, который автор должен заполнить сам),
question (вопрос читателю). Не выдумывай факты: всё, чего нет в базе знаний, остаётся пропуском.
Верни СТРОГО JSON:
{"responses":[{"text":"полный текст","parts":{"reference":"…","experience":"…","gap":"[дополните: …]","question":"…"}}]}
ЗАДАЧА: response_generate`

export function responseUser(input: {
  commentText: string
  count: number
  styleHint: string
  knowledge: string[]
  profile?: PromptProfile | null
}): string {
  const profileText = profileBlock(input.profile)
  const factsText = factsBlock(input.knowledge)
  const sections: string[] = [
    `Сгенерируй КОЛИЧЕСТВО: ${input.count} варианта ответа на комментарий.`,
    `Стиль автора: ${input.styleHint || 'не задан'}`,
  ]

  if (profileText) sections.push(profileText)
  if (factsText) sections.push(factsText)
  const rules = voiceRules(Boolean(profileText), Boolean(factsText), true)
  if (rules) sections.push(rules)
  sections.push('Верни только JSON.')

  return `${sections.join('\n\n')}\n\nВХОД:\n${input.commentText}`
}
