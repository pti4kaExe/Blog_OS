/**
 * Подписи, форматирование и русские тексты ошибок для облачного режима.
 * Один источник словарей: статусы, площадки, типы задач и т.п.
 */

/* ------------------------------- площадки --------------------------------- */

export const PLATFORMS = [
  { value: 'telegram', label: 'Telegram' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
]

export const PLATFORM_HINTS = {
  telegram: 'Пост до 4096 символов',
  instagram: 'Подпись до 2200 символов, сценарии Reels',
  youtube: 'Сценарий и описание видео до 5000 символов',
}

/* -------------------------------- арки ------------------------------------ */

/** Ключи арок на сервере (db/sql/001_schema.sql, комментарий drafts.arc). */
export const CLOUD_ARCS = [
  {
    key: 'story_case',
    label: 'История / кейс',
    hint: 'Было → стало. Работает, когда есть личный опыт и результат.',
  },
  {
    key: 'problem_solution',
    label: 'Проблема → решение',
    hint: 'Для полезных постов: боль, разбор, шаги, результат.',
  },
  {
    key: 'opinion_breakdown',
    label: 'Мнение / разбор',
    hint: 'Тезис и аргументы. Когда важна позиция, а не история.',
  },
]

export const ARC_LABELS = {
  story_case: 'История / кейс',
  problem_solution: 'Проблема → решение',
  opinion_breakdown: 'Мнение / разбор',
  // локальные ключи движка — на случай, если сервер вернёт их
  story: 'История / кейс',
  problem: 'Проблема → решение',
  opinion: 'Мнение / разбор',
}

export function arcLabel(key) {
  return key ? ARC_LABELS[key] || key : 'Автоматически'
}

/** Роли блоков Narrative Engine. */
export const BLOCK_ROLE_LABELS = {
  hook: 'Зацепка',
  context: 'Как было до',
  conflict: 'Проблема',
  insight: 'Что изменилось',
  evidence: 'Доказательство',
  takeaway: 'Вывод',
  cta: 'Вопрос читателю',
}

/* ------------------------------- статусы ---------------------------------- */

export const DRAFT_STATUSES = [
  { value: 'draft', label: 'Черновик', tone: 'accent' },
  { value: 'on_check', label: 'На проверке', tone: 'warn' },
  { value: 'ready', label: 'Готов к публикации', tone: 'good' },
  { value: 'published', label: 'Опубликован', tone: 'good' },
]

export const RESPONSE_STATUSES = [
  { value: 'generated', label: 'Сгенерирован', tone: 'accent' },
  { value: 'pending_approval', label: 'Ждёт одобрения', tone: 'warn' },
  { value: 'approved', label: 'Одобрен', tone: 'good' },
  { value: 'rejected', label: 'Отклонён', tone: 'bad' },
  { value: 'sent', label: 'Отправлен', tone: 'good' },
]

export const SOURCE_TYPES = [
  { value: 'telegram_channel', label: 'Telegram-канал' },
  { value: 'telegram_chat', label: 'Telegram-чат' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'manual', label: 'Вручную' },
]

export const SCAN_STATUSES = [
  { value: 'never', label: 'Ещё не сканировали', tone: 'warn' },
  { value: 'ok', label: 'Успешно', tone: 'good' },
  { value: 'failed', label: 'Ошибка площадки', tone: 'bad' },
]

export const TASK_TYPES = [
  { value: 'tov_analyze', label: 'Разбор стиля' },
  { value: 'narrative_generate', label: 'Сборка черновика' },
  { value: 'lint', label: 'Проверка AntiCringe' },
  { value: 'response_generate', label: 'Ответы на комментарии' },
  { value: 'embeddings', label: 'Эмбеддинги' },
]

export const RUN_STATUSES = [
  { value: 'pending', label: 'В процессе', tone: 'warn' },
  { value: 'success', label: 'Успешно', tone: 'good' },
  { value: 'failed', label: 'Ошибка', tone: 'bad' },
]

export const LINT_ENGINE_LABELS = {
  rules: 'Только правила',
  'rules+llm': 'Правила + AI',
}

export function labelOf(list, value, fallback = '—') {
  const found = list.find((item) => item.value === value)
  return found ? found.label : value || fallback
}

export function toneOf(list, value) {
  const found = list.find((item) => item.value === value)
  return found ? found.tone : undefined
}

/* ------------------------------ форматирование ----------------------------- */

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

export function fmtDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return dateTimeFormatter.format(date)
}

export function fmtDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return dateFormatter.format(date)
}

export function fmtMoney(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (Number.isNaN(number)) return String(value)
  return `${number.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })} ₽`
}

export function fmtCost(value) {
  if (value === null || value === undefined || value === '') return '—'
  const number = Number(value)
  if (Number.isNaN(number)) return String(value)
  if (number === 0) return '0 ₽'
  return `${number.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })} ₽`
}

export function fmtTokens(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return number.toLocaleString('ru-RU')
}

export function fmtPercent(value, digits = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${(number * 100).toFixed(digits)}%`
}

export function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/* -------------------------------- ошибки ----------------------------------- */

export function isOffline(error) {
  return Boolean(error && (error.offline || error.code === 'network_error' || error.code === 'timeout'))
}

const CODE_MESSAGES = {
  unauthorized: 'Сессия истекла — войдите заново.',
  forbidden: 'Это действие недоступно для вашей роли.',
  not_found: 'Запись не найдена или принадлежит другому автору.',
  conflict: 'Такая запись уже есть — измените данные.',
  validation_error: 'Проверьте заполненные поля.',
  rate_limited: 'Слишком часто. Повторите через минуту.',
  ai_budget_exceeded: 'Лимит расходов на AI исчерпан. Движок продолжит работать на правилах.',
  platform_error: 'Площадка не ответила. Повторите позже.',
  unavailable: 'Сервис временно недоступен.',
  internal: 'Внутренняя ошибка сервера. Повторите попытку.',
  timeout: 'Сервер не ответил вовремя. Проверьте подключение.',
  network_error: 'Сервер недоступен. Проверьте подключение или включите локальный режим.',
}

const REASON_MESSAGES = {
  too_short: 'Текста слишком мало: нужно не меньше 180 символов.',
  empty_notes: 'Добавьте хотя бы одну заметку.',
  not_ready: 'Черновик не готов к публикации — сначала пройдите проверку.',
  unfilled_gaps: 'В тексте остались незаполненные пропуски [дополните: …].',
  empty_text: 'В черновике нет текста.',
  approved_at_required: 'Сервер сам проставит дату одобрения.',
  not_configured: 'Площадка не настроена: нет ключей доступа.',
  mapping: '',
}

/**
 * Понятный русский текст ошибки. Используется везде, где показывается сбой.
 */
export function apiErrorMessage(error) {
  if (!error) return ''
  if (isOffline(error)) {
    return error.code === 'timeout' && error.message
      ? `${error.message}. Проверьте, запущен ли сервер, или включите локальный режим.`
      : 'Сервер недоступен. Проверьте подключение к сети или включите локальный режим.'
  }
  const reason = error.details && error.details.reason
  if (reason && REASON_MESSAGES[reason]) return REASON_MESSAGES[reason]
  if (error.details && error.details.platform) {
    return `${CODE_MESSAGES[error.code] || error.message} Площадка: ${error.details.platform}.`
  }
  return CODE_MESSAGES[error.code] || error.message || 'Не удалось выполнить запрос.'
}

/** Есть ли в тексте незаполненный пропуск `[дополните: …]`. */
export function hasUnfilledGaps(text) {
  return /\[\s*дополните\s*:/i.test(String(text || ''))
}

/** Ключи незаполненных пропусков из текста — для подсказки автору. */
export function unfilledGaps(text) {
  return [...String(text || '').matchAll(/\[\s*дополните\s*:[^\]]*\]/gi)].map((match) => match[0])
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
