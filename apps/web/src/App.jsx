import { useState } from 'react'
import LocalApp from './components/LocalApp.jsx'
import CloudApp from './components/cloud/CloudApp.jsx'
import ThemeSwitch from './components/ui/ThemeSwitch.jsx'

const MODE_KEY = 'blogos.mode.v1'

function loadMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'cloud' ? 'cloud' : 'local'
  } catch {
    return 'local'
  }
}

/**
 * Оболочка клиента: плавающая шапка и сцена под ней.
 *
 * Шапка — полупрозрачный материал: содержимое уходит под неё при скролле,
 * а не упирается в сплошную полосу. Это единственное место интерфейса,
 * кроме модалок, где материал применяется.
 *
 * «Локально» — прототип без сети (localStorage, движки в браузере).
 * «В облаке» — работа через BlogOS API.
 */
export default function App() {
  const [mode, setMode] = useState(loadMode)

  const changeMode = (next) => {
    setMode(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      // приватный режим: выбор не сохранится, приложение продолжит работать
    }
  }

  return (
    <div className="app">
      <header className="appbar">
        <div className="appbar-inner">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">B</div>
            <div>
              <div className="brand-name">BlogOS</div>
              <div className="brand-sub">Narrative Engine · AntiCringe · CommentRadar</div>
            </div>
          </div>

          <div className="spacer" />

          <div className="mode-switch" role="group" aria-label="Режим работы">
            <button
              type="button"
              data-active={mode === 'local'}
              data-mode="local"
              aria-pressed={mode === 'local'}
              onClick={() => changeMode('local')}
              title="Без сети: движки в браузере, данные в localStorage"
            >
              Локально
            </button>
            <button
              type="button"
              data-active={mode === 'cloud'}
              data-mode="cloud"
              aria-pressed={mode === 'cloud'}
              onClick={() => changeMode('cloud')}
              title="Через BlogOS API: вход, серверные черновики и проверки"
            >
              В облаке
            </button>
          </div>

          <ThemeSwitch />
        </div>
      </header>

      <main className="stage">
        {mode === 'local'
          ? <LocalApp />
          : <CloudApp onUseLocal={() => changeMode('local')} />}
      </main>
    </div>
  )
}
