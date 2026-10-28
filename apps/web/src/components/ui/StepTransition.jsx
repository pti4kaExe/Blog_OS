/**
 * BlogOS — переход между шагами.
 *
 * Шаг вперёд приезжает справа, назад — слева: вход и выход зеркальны,
 * поэтому движение читается как перемещение по одной ленте.
 *
 * Сознательно без AnimatePresence с mode="wait". Там новый шаг монтируется
 * только после того, как доиграет выход старого, и любая заминка анимации —
 * фоновая вкладка, занятый поток, два быстрых нажатия подряд — оставляет
 * пользователя перед пустым или устаревшим экраном. Содержимое важнее
 * анимации ухода: новый шаг появляется сразу и въезжает на место.
 *
 * При prefers-reduced-motion смещение убирается, остаётся угасание.
 */

import { motion, useReducedMotion } from 'motion/react'
import { spring, crossfade } from '../../lib/motion.js'

export default function StepTransition({ step, direction = 1, children }) {
  const reduced = useReducedMotion()
  const shift = reduced ? 0 : 18 * direction

  return (
    <motion.div
      key={step}
      initial={{ opacity: 0, x: shift }}
      animate={{ opacity: 1, x: 0 }}
      transition={reduced ? crossfade : spring.move}
    >
      {children}
    </motion.div>
  )
}
