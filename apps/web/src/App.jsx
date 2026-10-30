import { useState } from 'react'
import LocalApp from './components/LocalApp.jsx'
import CloudApp from './components/cloud/CloudApp.jsx'
import CommandPalette from './components/ui/CommandPalette.jsx'
import { CommandsProvider, useRegisterCommands } from './lib/commands.jsx'
import { useTheme } from './lib/theme.js'

const MODE_KEY = 'blogos.mode.v1'

/**
 * Режим по умолчанию — облачный.
 *
 * Продукт — это аккаунт, каналы, архив и история; локальный режим остаётся
 * запасным выходом, когда сервера нет. Открывать по умолчанию прототип
 * значило показывать новому человеку заведомо меньший продукт.
 * При недоступном API облачный экран сам предложит локальный режим.
 */
function loadMode() {
  try {
    return localStorage.getItem(MODE_KEY) === 'local' ? 'local' : 'cloud'
  } catch {
    return 'cloud'
  }
}

/** Команды оболочки: то, что доступно в любом режиме. */
function ShellCommands({ mode, changeMode }) {
  const { preference, setPreference } = useTheme()
  useRegisterCommands('shell', () => [
    {
      id: 'shell:mode-local',
      group: 'Режим',
      title: 'Работать локально',
      hint: 'без сети',
      disabled: mode === 'local',
      run: () => changeMode('local'),
    },
    {
      id: 'shell:mode-cloud',
      group: 'Режим',
      title: 'Работать в облаке',
      hint: 'через API',
      disabled: mode === 'cloud',
      run: () => changeMode('cloud'),
    },
    {
      id: 'shell:theme-dark',
      group: 'Оформление',
      title: 'Тёмная тема',
      disabled: preference === 'dark',
      run: () => setPreference('dark'),
    },
    {
      id: 'shell:theme-light',
      group: 'Оформление',
      title: 'Светлая тема',
      disabled: preference === 'light',
      run: () => setPreference('light'),
    },
    {
      id: 'shell:theme-system',
      group: 'Оформление',
      title: 'Тема как в системе',
      disabled: preference === 'system',
      run: () => setPreference('system'),
    },
  ])
  return null
}

/**
 * Корень клиента.
 *
 * Каркас (боковая панель и сцена) собирают сами режимы: состав панели
 * у них разный — в облаке каналы и пять разделов, локально два экрана.
 * Здесь остаётся только выбор режима и то, что живёт поверх всего:
 * палитра команд и общие команды.
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
    <CommandsProvider>
      {mode === 'local'
        ? <LocalApp onUseCloud={() => changeMode('cloud')} />
        : <CloudApp onUseLocal={() => changeMode('local')} />}

      <ShellCommands mode={mode} changeMode={changeMode} />
      <CommandPalette />
    </CommandsProvider>
  )
}
