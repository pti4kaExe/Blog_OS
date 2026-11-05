/**
 * BlogOS — полоса прогресса конвейера.
 *
 * Шаги занимают одну компактную полосу, а не половину первого экрана.
 * Подпись несёт только текущий шаг — остальные читаются по номеру
 * и положению.
 *
 * Подложка активного шага одна на всю полосу и переезжает к выбранному
 * шагу (раздел 12: «индикатор прогресса перемещается к новому шагу»).
 * Это единственное место, где движение само сообщает о смене состояния:
 * перекрашивать по кнопке на каждое нажатие — значит каждый раз рисовать
 * новый объект вместо того, чтобы двигать прежний.
 *
 * Недоступный шаг помечен aria-disabled, а не disabled: disabled выбрасывает
 * кнопку из обхода с клавиатуры, и причина «сначала пройдите предыдущие
 * шаги» до пользователя не доходит вовсе.
 */

import { useId } from 'react'
import { Check } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { spring } from '../../lib/motion.js'
import { Icon } from './Icon.jsx'

export default function ProgressRail({ steps, current, available, onGo, label = 'Шаги конвейера' }) {
  const reduced = useReducedMotion()
  /* Своя группа на каждую полосу: в приложении их две (облако и локальный
     режим), и общий layoutId заставил бы подложку перелетать между ними. */
  const group = useId()

  return (
    <nav className="rail" aria-label={label}>
      <ol className="rail-list">
        {steps.map((item, i) => {
          const state = item.n === current ? 'active' : item.n < current ? 'done' : 'idle'
          const can = available(item.n)
          return (
            <li className="rail-item" key={item.n} data-state={state}>
              {i > 0 && <span className="rail-link" aria-hidden="true" />}
              <button
                type="button"
                className="rail-btn"
                data-state={state}
                aria-current={state === 'active' ? 'step' : undefined}
                aria-disabled={!can || undefined}
                onClick={() => { if (can) onGo(item.n) }}
              >
                {state === 'active' && (
                  <motion.span
                    className="rail-pill"
                    aria-hidden="true"
                    layoutId={`rail-pill-${group}`}
                    transition={reduced ? { duration: 0 } : spring.snappy}
                  />
                )}
                <span className="rail-dot" aria-hidden="true">
                  {state === 'done' ? <Icon as={Check} size={13} /> : item.n}
                </span>
                <span className="rail-text">
                  <span className="rail-label">{item.label}</span>
                  <span className="rail-hint">{can ? item.hint : 'Сначала пройдите предыдущие шаги'}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
