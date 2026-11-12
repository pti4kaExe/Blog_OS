/**
 * Пост-валидация текста Narrative Engine: не даём модели перенести в пост
 * чужие события и даты.
 *
 * Проблема, которую решает guard: в промт попадают примеры голоса (прошлые посты)
 * и факты автора. Модель принимала их за источник фактов и писала «приходите
 * 6 ноября на конференцию», хотя в заметках этого нет. Примеры нужны только для
 * стиля, факты — только как фон. Всё, что похоже на событие или дату, обязано
 * присутствовать в заметках автора.
 *
 * Функции чистые: без БД и сети — удобно тестировать.
 */

const MONTH_FORMS: Record<string, number> = {
  январь: 1, января: 1, январе: 1,
  февраль: 2, февраля: 2, феврале: 2,
  март: 3, марта: 3, марте: 3,
  апрель: 4, апреля: 4, апреле: 4,
  май: 5, мая: 5, мае: 5,
  июнь: 6, июня: 6, июне: 6,
  июль: 7, июля: 7, июле: 7,
  август: 8, августа: 8, августе: 8,
  сентябрь: 9, сентября: 9, сентябре: 9,
  октябрь: 10, октября: 10, октябре: 10,
  ноябрь: 11, ноября: 11, ноябре: 11,
  декабрь: 12, декабря: 12, декабре: 12,
}

const MONTH_WORDS = Object.keys(MONTH_FORMS).sort((a, b) => b.length - a.length)
const DATE_WITH_MONTH = new RegExp(`(\\d{1,2})\\s*(?:-?го\\s*)?(${MONTH_WORDS.join('|')})`, 'giu')
const MONTH_ONLY = new RegExp(`(?<![а-яёa-z])(${MONTH_WORDS.join('|')})(?![а-яёa-z])`, 'giu')
const DATE_NUMERIC = /(?<!\d)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?!\d)/g

/** Слова, которыми модель обычно объявляет событие. Основы, не целые слова. */
const EVENT_STEMS: Array<{ stem: string; label: string }> = [
  { stem: 'конференц', label: 'конференция' },
  { stem: 'вебинар', label: 'вебинар' },
  { stem: 'митап', label: 'митап' },
  { stem: 'встреч', label: 'встреча' },
  { stem: 'форум', label: 'форум' },
  { stem: 'семинар', label: 'семинар' },
  { stem: 'интенсив', label: 'интенсив' },
  { stem: 'марафон', label: 'марафон' },
  { stem: 'запуск потока', label: 'запуск потока' },
  { stem: 'поток обучен', label: 'поток обучения' },
  { stem: 'тренинг', label: 'тренинг' },
  { stem: 'воркшоп', label: 'воркшоп' },
]

export interface DateKeys {
  /** Даты в каноническом виде «день.месяц», например «6.11». */
  dates: Set<string>
  /** Упомянутые месяцы (числа 1–12). */
  months: Set<number>
}

function normalizeText(text: string): string {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ')
}

/** Достаёт из текста даты и месяцы в нормализованном виде. */
export function extractDateKeys(text: string): DateKeys {
  const source = normalizeText(text)
  const dates = new Set<string>()
  const months = new Set<number>()

  for (const match of source.matchAll(DATE_WITH_MONTH)) {
    const day = Number(match[1])
    const month = MONTH_FORMS[String(match[2]).toLowerCase()]
    if (month && day >= 1 && day <= 31) {
      dates.add(`${day}.${month}`)
      months.add(month)
    }
  }

  for (const match of source.matchAll(DATE_NUMERIC)) {
    const day = Number(match[1])
    const month = Number(match[2])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      dates.add(`${day}.${month}`)
      months.add(month)
    }
  }

  for (const match of source.matchAll(MONTH_ONLY)) {
    const month = MONTH_FORMS[String(match[1]).toLowerCase()]
    if (month) months.add(month)
  }

  return { dates, months }
}

/** Упоминания событий: какое слово-событие и фрагмент вокруг него. */
export function extractEventClaims(text: string): Array<{ label: string; excerpt: string }> {
  const source = normalizeText(text)
  const claims: Array<{ label: string; excerpt: string }> = []
  for (const { stem, label } of EVENT_STEMS) {
    const index = source.indexOf(stem)
    if (index === -1) continue
    const excerpt = source.slice(Math.max(0, index - 40), index + stem.length + 40).trim()
    claims.push({ label, excerpt })
  }
  return claims
}

export interface InventedEventsResult {
  ok: boolean
  /** Даты из текста, которых нет в заметках («6.11»). */
  inventedDates: string[]
  /** Месяцы из текста, которых нет в заметках (11). */
  inventedMonths: number[]
  /** События из текста, которых нет в заметках. */
  inventedEvents: string[]
}

/**
 * Проверяет, не выдумала ли модель события и даты.
 *
 * Правило: каждая дата/месяц и каждое упоминание мероприятия должны быть
 * в заметках автора. Иначе пост объявляет чужое событие (например, прошедшую
 * конференцию из старого поста).
 */
export function findInventedEvents(text: string, notes: string): InventedEventsResult {
  const generated = extractDateKeys(text)
  const source = extractDateKeys(notes)
  const sourceText = normalizeText(notes)

  const inventedDates = [...generated.dates].filter((date) => !source.dates.has(date)).sort()
  const inventedMonths = [...generated.months]
    .filter((month) => !source.months.has(month))
    .sort((a, b) => a - b)

  const inventedEvents: string[] = []
  for (const claim of extractEventClaims(text)) {
    const stem = EVENT_STEMS.find((item) => item.label === claim.label)?.stem ?? claim.label
    if (!sourceText.includes(stem)) inventedEvents.push(claim.label)
  }

  return {
    ok: inventedDates.length === 0 && inventedMonths.length === 0 && inventedEvents.length === 0,
    inventedDates,
    inventedMonths,
    inventedEvents: [...new Set(inventedEvents)],
  }
}
