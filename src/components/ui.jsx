/** Мелкие переиспользуемые элементы интерфейса. */
import { useState } from 'react'

export function Tag({ children, kind }) {
  const cls = kind === 'accent' ? 'tag tag-accent' : kind === 'demo' ? 'tag tag-demo' : 'tag'
  return <span className={cls}>{children}</span>
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
  return <div className={kind === 'warn' ? 'notice notice-warn' : 'notice'}>{children}</div>
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
