/**
 * BlogOS — переключатель темы.
 *
 * Три состояния вместо тумблера: «система», «светлая», «тёмная».
 * Отдельное состояние «система» нужно, чтобы интерфейс мог идти за
 * настройкой ОС — у тумблера из двух положений такого режима нет.
 *
 * Иконки без подписей, поэтому у каждой кнопки свой aria-label.
 */

import { Monitor, Moon, Sun } from 'lucide-react'
import { Icon } from './Icon.jsx'
import { useTheme } from '../../lib/theme.js'

const OPTIONS = [
  { value: 'system', glyph: Monitor, label: 'Как в системе' },
  { value: 'light', glyph: Sun, label: 'Светлая тема' },
  { value: 'dark', glyph: Moon, label: 'Тёмная тема' },
]

export default function ThemeSwitch() {
  const { preference, setPreference } = useTheme()

  return (
    <div className="mode-switch" role="group" aria-label="Тема оформления">
      {OPTIONS.map(({ value, glyph, label }) => (
        <button
          key={value}
          type="button"
          className="theme-btn"
          data-active={preference === value}
          aria-pressed={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
        >
          <Icon as={glyph} size="sm" />
        </button>
      ))}
    </div>
  )
}
