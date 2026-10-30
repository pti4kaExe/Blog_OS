/** Мелкие переиспользуемые элементы интерфейса. */
import { useEffect, useState } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { Check, Copy } from 'lucide-react'
import { Icon } from './ui/Icon.jsx'
import { canPlayIntro } from '../lib/motion.js'
import { apiErrorMessage, isOffline, labelOf, toneOf } from '../lib/format.js'

export function Tag({ children, kind }) {
  const cls = kind ? `tag tag-${kind}` : 'tag'
  return <span className={cls}>{children}</span>
}

/** Статус из справочника: подпись и цвет. */
export function StatusTag({ list, value }) {
  if (!value) return null
  return <Tag kind={toneOf(list, value)}>{labelOf(list, value)}</Tag>
}

/** Индикатор «проверено без AI» / «работал AI-слой». */
export function AiBadge({ withoutAi }) {
  if (withoutAi === undefined || withoutAi === null) return null
  return withoutAi
    ? <Tag kind="good">Проверено без AI</Tag>
    : <Tag>AI-слой включён</Tag>
}

export function Metric({ value, label }) {
  return (
    <div className="metric">
      <div className="metric-val">{value}</div>
      <div className="metric-key">{label}</div>
    </div>
  )
}

const TONE_COLOR = { good: 'var(--good)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' }

/**
 * Кольцо итоговой оценки.
 *
 * Дуга набирается, а число догоняет её: это главный результат проверки,
 * и он должен появляться как результат, а не возникать готовым. Пружина
 * без перелёта — оценка не «пролетает» мимо своего значения.
 *
 * При prefers-reduced-motion кольцо сразу показывает итог.
 */
export function ScoreRing({ score, tone = 'ok' }) {
  const r = 38
  const c = 2 * Math.PI * r
  const target = Math.max(0, Math.min(100, Number(score) || 0))
  const reduced = useReducedMotion()

  /* Стартуем с итога: если вступление сыграть нельзя, значение уже верное. */
  const progress = useMotionValue(target)
  const dash = useTransform(progress, (v) => `${(c * v) / 100} ${c}`)
  const shown = useTransform(progress, (v) => Math.round(v))

  useEffect(() => {
    if (reduced || !canPlayIntro()) {
      progress.set(target)
      return undefined
    }
    progress.set(0)
    const controls = animate(progress, target, { type: 'spring', bounce: 0, duration: 0.9 })
    return () => controls.stop()
  }, [target, reduced, progress])

  return (
    <div className="ring" role="img" aria-label={`Оценка ${target} из 100`}>
      <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
        <circle cx="46" cy="46" r={r} fill="none" stroke="var(--surface-overlay)" strokeWidth="7" />
        <motion.circle
          cx="46" cy="46" r={r} fill="none" stroke={TONE_COLOR[tone] || 'var(--tint)'}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={dash}
        />
      </svg>
      <motion.div className="ring-val" aria-hidden="true">{shown}</motion.div>
    </div>
  )
}

export function Bar({ value, tone = 'accent' }) {
  const color = TONE_COLOR[tone] || 'var(--tint)'
  const reduced = useReducedMotion()
  const width = Math.max(2, Math.min(100, value))
  return (
    <div className="bar">
      <motion.i
        initial={reduced || !canPlayIntro() ? false : { width: '0%' }}
        animate={{ width: `${width}%` }}
        transition={{ type: 'spring', bounce: 0, duration: 0.7 }}
        style={{ background: color, display: 'block', height: '100%', borderRadius: 'var(--r-full)' }}
      />
    </div>
  )
}

export function Notice({ children, kind }) {
  const cls = kind === 'warn'
    ? 'notice notice-warn'
    : kind === 'error'
      ? 'notice notice-error'
      : kind === 'good'
        ? 'notice notice-good'
        : 'notice'
  return <div className={cls}>{children}</div>
}

/**
 * Копирование с подтверждением.
 *
 * Иконка и подпись меняются на месте — всплывающее сообщение ради одного
 * слова здесь лишнее, а смена прямо в кнопке отвечает ровно там, куда
 * человек смотрел в момент нажатия (раздел 12).
 *
 * Подтверждение дублируется в aria-live: «готово» не должно быть
 * сообщением одного только цвета и значка.
 */
export function CopyButton({ text, label = 'Скопировать' }) {
  const [done, setDone] = useState(false)
  const reduced = useReducedMotion()

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1800)
    } catch {
      // буфер обмена может быть недоступен — сценарий не ломаем
      window.prompt('Скопируйте текст вручную:', text)
    }
  }

  return (
    <button type="button" className="btn btn-sm btn-copy" onClick={onCopy} disabled={!text}>
      <span className="btn-copy-icon" aria-hidden="true">
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={done ? 'done' : 'idle'}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.14 }}
          >
            <Icon as={done ? Check : Copy} size={13} />
          </motion.span>
        </AnimatePresence>
      </span>
      <span>{done ? 'Скопировано' : label}</span>
      <span className="sr-only" role="status" aria-live="polite">
        {done ? 'Текст скопирован в буфер обмена' : ''}
      </span>
    </button>
  )
}

/** Русское склонение после числа: 1 замечание, 2 замечания, 5 замечаний. */
export function plural(n, one, few, many) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/* ------------------------------- состояния -------------------------------- */

/** Загрузка. */
export function Loading({ label = 'Загрузка…' }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

/**
 * Единый блок пустого и ошибочного состояния: заголовок, пояснение, действие.
 * Все новые экраны используют его, чтобы «пусто» и «не загрузилось» выглядели одинаково.
 */
export function StateBlock({ kind = 'empty', title, children, action }) {
  return (
    <div className={kind === 'error' ? 'state state-error' : 'state'}>
      <div className="state-icon" aria-hidden="true">{kind === 'error' ? '!' : '·'}</div>
      {title && <div className="state-title">{title}</div>}
      {children && <div className="state-text">{children}</div>}
      {action && <div className="state-action">{action}</div>}
    </div>
  )
}

export function EmptyState({ title = 'Пока пусто', children, action }) {
  return <StateBlock kind="empty" title={title} action={action}>{children}</StateBlock>
}

export function ErrorState({ error, title, onRetry, children }) {
  return (
    <StateBlock
      kind="error"
      title={title || (isOffline(error) ? 'Нет связи с сервером' : 'Не удалось загрузить данные')}
      action={(
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          {onRetry && <button type="button" className="btn btn-sm" onClick={onRetry}>Повторить</button>}
          {children}
        </div>
      )}
    >
      {apiErrorMessage(error)}
    </StateBlock>
  )
}

/** Компактная ошибка внутри карточки/формы. */
export function InlineError({ error }) {
  if (!error) return null
  return (
    <div style={{ marginTop: 12 }}>
      <Notice kind="error">{apiErrorMessage(error)}</Notice>
    </div>
  )
}

/* -------------------------------- поля ------------------------------------ */

export function Field({ label, hint, children, htmlFor }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/**
 * Секция формы: несколько полей об одном и том же.
 *
 * Семь полей подряд не говорят, что из них про канал, что про текст,
 * а что про деньги. Тихий заголовок отвечает на это без лишних слов —
 * и форма перестаёт читаться как анкета.
 */
export function FormSection({ title, hint, children }) {
  return (
    <section className="form-section">
      {(title || hint) && (
        <div className="form-section-head">
          {title && <h3 className="form-section-title">{title}</h3>}
          {hint && <p className="form-section-hint">{hint}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * Диапазон «от — до» одним полем.
 *
 * Две отдельные подписи («целевая длина, от» и «целевая длина, до»)
 * заставляли читать одно и то же дважды. Здесь подпись одна, а между
 * полями стоит тире — связь видна, а не описана словами.
 *
 * Элемент не <label>: подпись относится сразу к двум полям, и каждое
 * получает собственное имя для скринридера.
 */
export function RangeField({ label, hint, unit, from, to, onFrom, onTo, id }) {
  return (
    <div className="field">
      <span className="field-label" id={`${id}-label`}>{label}</span>
      <div className="field-range" role="group" aria-labelledby={`${id}-label`}>
        <input
          id={`${id}-from`}
          className="inp"
          inputMode="numeric"
          value={from}
          onChange={onFrom}
          placeholder="800"
          aria-label={`${label} — от`}
        />
        <span className="field-range-sep" aria-hidden="true">—</span>
        <input
          id={`${id}-to`}
          className="inp"
          inputMode="numeric"
          value={to}
          onChange={onTo}
          placeholder="2500"
          aria-label={`${label} — до`}
        />
        {unit && <span className="field-range-unit">{unit}</span>}
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

export function TextInput({ className, ...props }) {
  return <input className={className ? `inp ${className}` : 'inp'} {...props} />
}

/**
 * Поле выбора.
 *
 * Нативная стрелка `select` рисуется системой и не подчиняется теме: на
 * графите она выглядела светлой деталью из чужого интерфейса. Поэтому
 * стрелку снимаем (`appearance: none` в стилях) и рисуем свою — она берёт
 * цвет из токенов и живёт в обеих темах.
 *
 * Сам `select` остаётся нативным: список открывает система, клавиатура и
 * скринридер работают без нашего участия. Шеврон — только оформление,
 * поэтому он скрыт от скринридера и не перехватывает клики.
 */
export function Select({ className, children, ...props }) {
  return (
    <span className="select-wrap">
      <select className={className ? `inp inp-select ${className}` : 'inp inp-select'} {...props}>
        {children}
      </select>
      <svg className="select-chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/**
 * Скачать текст файлом.
 *
 * Копирование в буфер есть, но у готового текста обычно две судьбы: уйти
 * в площадку сразу или лечь в папку с черновиками. Вторую закрывает файл —
 * это стандарт любого пишущего инструмента.
 */
export function DownloadButton({ text, filename = 'post', label = 'Скачать .md', disabled }) {
  const download = () => {
    const safe = String(filename).replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().slice(0, 80) || 'post'
    const blob = new Blob([String(text || '')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safe}.md`
    document.body.appendChild(link)
    link.click()
    link.remove()
    /* Освобождаем ссылку после клика: иначе blob живёт до перезагрузки. */
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <button type="button" className="btn btn-sm" onClick={download} disabled={disabled || !text}>
      {label}
    </button>
  )
}

/**
 * Счётчик длины под лимит площадки.
 *
 * Лимит проверяет сервер (422 `details.limit`), но узнавать об отказе после
 * отправки длинного текста — плохо. Счётчик предупреждает заранее: жёлтый
 * с 90% лимита, красный при превышении.
 */
export function CharCounter({ value, limit }) {
  const length = String(value || '').length
  if (!limit) return <span className="counter">{length.toLocaleString('ru-RU')} символов</span>
  const ratio = length / limit
  const tone = ratio > 1 ? 'bad' : ratio >= 0.9 ? 'warn' : undefined
  return (
    <span className="counter" data-tone={tone}>
      {length.toLocaleString('ru-RU')} / {limit.toLocaleString('ru-RU')}
      {ratio > 1 && ` · лишних ${(length - limit).toLocaleString('ru-RU')}`}
    </span>
  )
}

/** Переключатель-тумблер. */
export function Toggle({ checked, onChange, label, hint, disabled, id }) {
  return (
    <label className={disabled ? 'toggle toggle-disabled' : 'toggle'} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
    </label>
  )
}

/**
 * Поле-список слов: ввод по Enter или запятой, удаление по клику и Backspace.
 *
 * Нужно там, где значение — набор коротких строк (стоп-слова, жаргон,
 * фирменные фразы). Текстовое поле с запятыми выглядит проще, но тогда
 * человек не видит, что именно сохранится, и не может убрать одно слово.
 */
export function TagInput({ value, onChange, placeholder, id, max = 50, tone }) {
  const list = Array.isArray(value) ? value : []
  const [typed, setTyped] = useState('')

  const add = (raw) => {
    const next = String(raw || '').trim().replace(/[,;]+$/, '')
    if (!next) return
    if (list.length >= max) return
    if (list.some((item) => item.toLowerCase() === next.toLowerCase())) {
      setTyped('')
      return
    }
    onChange([...list, next])
    setTyped('')
  }

  const removeAt = (index) => onChange(list.filter((_, i) => i !== index))

  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      add(typed)
      return
    }
    if (event.key === 'Backspace' && typed === '' && list.length > 0) {
      removeAt(list.length - 1)
    }
  }

  return (
    <div className="taginput">
      <div className="taginput-tags">
        {list.map((item, index) => (
          <span className={tone ? `tag tag-${tone} tag-removable` : 'tag tag-removable'} key={`${item}-${index}`}>
            {item}
            <button
              type="button"
              onClick={() => removeAt(index)}
              aria-label={`Убрать «${item}»`}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <input
        id={id}
        className="inp inp-sm"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(typed)}
        placeholder={list.length >= max ? `Больше ${max} не поместится` : placeholder}
        disabled={list.length >= max}
        autoComplete="off"
      />
    </div>
  )
}

/* -------------------------------- модалки ---------------------------------- */

export function Modal({ open, title, children, footer, onClose, wide }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open, title, children, confirmLabel = 'Подтвердить', busy, danger, onConfirm, onCancel,
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? undefined : onCancel}
      footer={(
        <div className="btn-row">
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Выполняем…' : confirmLabel}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        </div>
      )}
    >
      {children}
    </Modal>
  )
}
