/**
 * BlogOS — полоса прогресса конвейера.
 *
 * Заменяет четыре крупные кнопки-карточки: шаги те же и в том же порядке,
 * но занимают полосу, а не половину первого экрана. Подпись несёт только
 * текущий шаг — остальные читаются по номеру и положению.
 *
 * Недоступный шаг помечен aria-disabled, а не disabled: disabled выбрасывает
 * кнопку из обхода с клавиатуры, и причина «сначала пройдите предыдущие
 * шаги» до пользователя не доходит вовсе.
 */

import { Check } from 'lucide-react'
import { Icon } from './Icon.jsx'

export default function ProgressRail({ steps, current, available, onGo, label = 'Шаги конвейера' }) {
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
