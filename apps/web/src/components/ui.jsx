/** Мелкие переиспользуемые элементы интерфейса. */
import { useEffect, useState } from 'react'
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
    : <Tag kind="accent">AI-слой включён</Tag>
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

export function ScoreRing({ score, tone = 'ok' }) {
  const r = 38
  const c = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(100, score)) / 100
  return (
    <div className="ring">
      <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
        <circle cx="46" cy="46" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
        <circle
          cx="46" cy="46" r={r} fill="none" stroke={TONE_COLOR[tone] || 'var(--accent)'}
          strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${c * filled} ${c}`}
        />
      </svg>
      <div className="ring-val">{score}</div>
    </div>
  )
}

export function Bar({ value, tone = 'accent' }) {
  const color = TONE_COLOR[tone] || 'var(--accent)'
  return (
    <div className="bar">
      <i style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} />
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

export function CopyButton({ text, label = 'Скопировать' }) {
  const [done, setDone] = useState(false)
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
    <button type="button" className="btn btn-sm" onClick={onCopy} disabled={!text}>
      {done ? 'Скопировано' : label}
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

export function TextInput({ className, ...props }) {
  return <input className={className ? `inp ${className}` : 'inp'} {...props} />
}

export function Select({ className, children, ...props }) {
  return <select className={className ? `inp inp-select ${className}` : 'inp inp-select'} {...props}>{children}</select>
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
