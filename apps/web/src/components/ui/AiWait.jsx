import { useEffect, useState } from 'react'

/**
 * Секундомер ожидания ответа модели.
 *
 * Зачем: бесплатные модели OpenRouter отвечают 7–15 секунд, а проверка текста
 * с AI-слоем — до 15–20. Без счётчика кнопка «Проверяем…» выглядит как зависание.
 */
export function useElapsed(active) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return undefined
    }
    const started = Date.now()
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - started) / 1000))
    }, 500)
    return () => clearInterval(timer)
  }, [active])

  return seconds
}

/**
 * Строка ожидания под кнопкой. Появляется через секунду, чтобы не мигать
 * на быстрых ответах, и показывает, что именно происходит: модель или правила.
 */
export function AiWait({ active, ai = true, label }) {
  const seconds = useElapsed(active)
  if (!active || seconds < 1) return null

  const base = label ?? (ai ? 'Модель отвечает' : 'Считаем правилами')
  const hint = ai ? 'обычно 7–15 секунд' : 'обычно мгновенно'

  return (
    <p className="faint" style={{ margin: '8px 0 0' }} role="status" aria-live="polite">
      {base}: {seconds} с · {hint}
    </p>
  )
}

export default AiWait
