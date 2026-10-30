/**
 * BlogOS — раскрывающаяся строка.
 *
 * Заголовок виден всегда, тело — только по клику. Нужна там, где список
 * состоит из самостоятельных записей с телом длиннее одной строки:
 * показывать все тела сразу значит превращать список в стену текста,
 * которую приходится проматывать, чтобы найти нужную запись.
 *
 * Открытых записей может быть несколько одновременно — это независимые
 * факты, а не шаги одного сценария, и закрывать соседний при открытии
 * нового было бы неожиданным поведением.
 *
 * Высота анимируется до 'auto': Motion умеет мерить реальную высоту
 * содержимого сам, явный расчёт не нужен.
 */

import { ChevronDown } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { spring } from '../../lib/motion.js'
import { Icon } from './Icon.jsx'

export default function Accordion({ title, meta, open, onToggle, actions, children }) {
  const reduced = useReducedMotion()

  return (
    <div className="accordion-item" data-open={open}>
      <button
        type="button"
        className="accordion-trigger"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="accordion-title">{title}</span>
        {meta && <span className="accordion-meta">{meta}</span>}
        <motion.span
          className="accordion-chevron"
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduced ? { duration: 0 } : spring.snappy}
        >
          <Icon as={ChevronDown} size="sm" />
        </motion.span>
      </button>

      <motion.div
        className="accordion-panel"
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={reduced ? { duration: 0.01 } : spring.move}
        style={{ overflow: 'hidden' }}
      >
        <div className="accordion-body">
          {children}
          {actions && <div className="accordion-actions">{actions}</div>}
        </div>
      </motion.div>
    </div>
  )
}
