/**
 * BlogOS — иконки.
 *
 * Обёртка над lucide: держит размер и толщину штриха едиными по всему
 * интерфейсу. Толщина не масштабируется вместе с размером
 * (absoluteStrokeWidth) — иначе крупные иконки выглядят жирнее мелких
 * и набор перестаёт читаться как один.
 *
 *   import { Check } from 'lucide-react'
 *   <Icon as={Check} />                      — декоративная, рядом есть текст
 *   <Icon as={Check} label="Готово" />       — несёт смысл сама по себе
 */

const SIZES = {
  sm: 14,   /* внутри тегов и подписей */
  md: 18,   /* базовый: кнопки, строки списка */
  lg: 22,   /* заголовки карточек */
  xl: 28,   /* пустые состояния */
}

const STROKE = 1.75

export function Icon({ as: Glyph, size = 'md', label, className, ...rest }) {
  if (!Glyph) return null
  const px = SIZES[size] || size

  /* Без подписи иконка декоративна: озвучивать её — значит дублировать
     соседний текст. С подписью становится самостоятельным смыслом. */
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': 'true', focusable: 'false' }

  return (
    <Glyph
      size={px}
      strokeWidth={STROKE}
      absoluteStrokeWidth
      className={className}
      {...a11y}
      {...rest}
    />
  )
}

export default Icon
