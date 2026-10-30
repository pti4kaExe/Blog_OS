import { useEffect, useMemo, useRef, useState } from 'react'
import { useCommandRegistry } from '../../lib/commands.jsx'

/** ⌘K на Mac, Ctrl+K на остальных. */
export const PALETTE_HINT = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
  ? '⌘K'
  : 'Ctrl+K'

/** Нечёткий поиск: буквы запроса идут по названию в том же порядке. */
function match(query, text) {
  const q = query.toLowerCase().trim()
  if (!q) return 0
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct === 0) return 3
  if (direct > 0) return 2
  let i = 0
  for (const char of t) {
    if (char === q[i]) i += 1
    if (i === q.length) return 1
  }
  return -1
}

/**
 * Палитра команд.
 *
 * Для продукта сложнее десяти экранов ⌘K — ожидание, а не украшение:
 * она даёт прямой путь к любому экрану и действию, минуя навигацию по
 * шагам. Заодно это единственное место, где видно все действия сразу,
 * поэтому она же служит списком горячих клавиш.
 *
 * Команды приходят из реестра (`lib/commands.jsx`) и собираются в момент
 * открытия — палитра ничего не знает про экраны.
 */
export default function CommandPalette() {
  const registry = useCommandRegistry()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [items, setItems] = useState([])
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    const onKey = (event) => {
      const isK = event.key === 'k' || event.key === 'K' || event.key === 'л' || event.key === 'Л'
      if (isK && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
        return
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setItems(registry ? registry.collect() : [])
    setQuery('')
    setCursor(0)
    /* Фокус после отрисовки: поле появляется в этом же кадре. */
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, registry])

  const found = useMemo(() => {
    if (!query.trim()) return items
    return items
      .map((item) => ({ item, score: Math.max(match(query, item.title), match(query, item.group || '')) }))
      .filter((row) => row.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((row) => row.item)
  }, [items, query])

  useEffect(() => {
    setCursor((value) => Math.min(value, Math.max(found.length - 1, 0)))
  }, [found.length])

  /* Выбранная строка всегда в поле зрения при движении стрелками. */
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [cursor, open])

  const run = (item) => {
    if (!item || item.disabled) return
    setOpen(false)
    /* Действие после закрытия: иначе модалка, которую оно открывает,
       закроется этим же кадром. */
    setTimeout(() => item.run(), 0)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => (found.length ? (value + 1) % found.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => (found.length ? (value - 1 + found.length) % found.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(found[cursor])
    }
  }

  if (!open) return null

  let lastGroup = null

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Команды">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setCursor(0) }}
          onKeyDown={onKeyDown}
          placeholder="Куда перейти или что сделать…"
          aria-label="Поиск команды"
          autoComplete="off"
        />

        <div className="palette-list" ref={listRef} role="listbox">
          {found.length === 0 && (
            <div className="palette-empty">Ничего не нашлось. Попробуйте другое слово.</div>
          )}
          {found.map((item, index) => {
            const head = item.group && item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <div key={item.id}>
                {head && <div className="palette-group">{head}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className="palette-item"
                  data-active={index === cursor}
                  data-disabled={Boolean(item.disabled)}
                  disabled={item.disabled}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => run(item)}
                >
                  <span className="palette-item-title">{item.title}</span>
                  {item.hint && <span className="palette-item-hint">{item.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>

        <div className="palette-foot">
          <span>↑ ↓ — выбрать</span>
          <span>Enter — выполнить</span>
          <span>Esc — закрыть</span>
          <span className="spacer" />
          <span>{PALETTE_HINT}</span>
        </div>
      </div>
    </div>
  )
}
