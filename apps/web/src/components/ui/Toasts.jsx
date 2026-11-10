/**
 * BlogOS — короткое подтверждение действия.
 *
 * Зачем свой, а не библиотека. Готовых решений хватает (sonner,
 * react-hot-toast), но каждое приносит свою систему стилей, которую
 * пришлось бы подгонять под токены, и свой моушен-слой поверх уже
 * установленного motion. Здесь нужно одно сообщение на три секунды —
 * семьдесят строк своего кода дешевле зависимости и сразу говорят
 * на языке тем и токенов.
 *
 * Когда показывать. Только там, где действие прошло, а на экране от
 * этого ничего не изменилось: «Сохранить правку» перезагружала список
 * и молчала, и человек не знал, сохранилось ли. Там, где результат
 * виден сам — статус сменился, список пополнился, — подтверждение
 * лишнее и превращается в шум.
 *
 * Доступность: живой регион читает текст вслух, поэтому сообщение не
 * остаётся новостью одного только цвета и движения. При
 * prefers-reduced-motion появление идёт угасанием, без сдвига.
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check } from 'lucide-react'
import { Icon } from './Icon.jsx'

/* Три секунды — успеть прочитать короткую фразу и не мешать дальше. */
const LIFETIME = 3200
/* Больше трёх одновременно — уже не подтверждение, а лента. */
const MAX_VISIBLE = 3

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const lastId = useRef(0)
  const timers = useRef(new Set())

  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
  }, [])

  const drop = useCallback((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const show = useCallback((text, { kind = 'good' } = {}) => {
    if (!text) return
    lastId.current += 1
    const id = lastId.current
    setItems((prev) => [...prev, { id, text, kind }].slice(-MAX_VISIBLE))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      drop(id)
    }, LIFETIME)
    timers.current.add(timer)
  }, [drop])

  return (
    <ToastContext.Provider value={show}>
      {children}
      <ToastHost items={items} onDrop={drop} />
    </ToastContext.Provider>
  )
}

/** Показать короткое подтверждение: `const toast = useToast()`. */
export function useToast() {
  return useContext(ToastContext) || noop
}

function noop() {}

function ToastHost({ items, onDrop }) {
  const reduced = useReducedMotion()
  if (items.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.button
            key={item.id}
            type="button"
            className="toast"
            data-kind={item.kind}
            onClick={() => onDrop(item.id)}
            title="Убрать"
            layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: reduced ? 0.12 : 0.2 }}
          >
            {item.kind === 'good' && (
              <span className="toast-icon" aria-hidden="true"><Icon as={Check} size={14} /></span>
            )}
            <span>{item.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
