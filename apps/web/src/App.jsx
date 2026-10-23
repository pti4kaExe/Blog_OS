import { useState } from 'react'
import LocalApp from './components/LocalApp.jsx'
import CloudApp from './components/cloud/CloudApp.jsx'

const MODE_KEY = 'blogos.mode.v1'

function loadMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'cloud' ? 'cloud' : 'local'
  } catch {
    return 'local'
  }
}

/**
 * Оболочка клиента: выбор режима работы и общая шапка.
 *
 * «Локально» — исходный прототип без сети (localStorage, движки в браузере).
 * «В облаке» — работа через BlogOS API: вход, каналы, стиль, черновики,
 * проверки, CommentRadar, база знаний и расходы.
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
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div>
            <div className="brand-name">BlogOS</div>
            <div className="brand-sub">Narrative Engine · AntiCringe · CommentRadar</div>
          </div>
        </div>

        <div className="mode-switch" role="group" aria-label="Режим работы">
          <button
            type="button"
            data-active={mode === 'local'}
            data-mode="local"
            onClick={() => changeMode('local')}
            title="Без сети: движки в браузере, данные в localStorage"
          >
            Локально
          </button>
          <button
            type="button"
            data-active={mode === 'cloud'}
            data-mode="cloud"
            onClick={() => changeMode('cloud')}
            title="Через BlogOS API: вход, серверные черновики и проверки"
          >
            В облаке
          </button>
        </div>
      </header>

      {mode === 'local'
        ? <LocalApp />
        : <CloudApp onUseLocal={() => changeMode('local')} />}
    </div>
  )
}
