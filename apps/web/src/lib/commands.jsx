/**
 * Реестр команд для палитры ⌘K.
 *
 * Экраны не знают про палитру — они только объявляют, что умеют делать.
 * Палитра собирает объявленное и показывает одним списком. Так новый экран
 * попадает в палитру одной строкой и не тянет за собой ничего из оболочки.
 *
 * Команда: `{ id, title, hint, group, run, disabled }`.
 *
 * Экран регистрирует не список, а функцию, которая его строит. Список
 * собирается в момент открытия палитры — поэтому команды всегда замкнуты
 * на свежее состояние экрана, и ни один рендер не тратится на публикацию.
 */
import {
  createContext, useContext, useEffect, useMemo, useRef,
} from 'react'

const CommandsContext = createContext(null)

export function CommandsProvider({ children }) {
  const buildersRef = useRef(new Map())

  const value = useMemo(() => ({
    register(owner, buildRef) {
      buildersRef.current.set(owner, buildRef)
      return () => {
        if (buildersRef.current.get(owner) === buildRef) buildersRef.current.delete(owner)
      }
    },
    /** Собрать актуальный список команд. Вызывается при открытии палитры. */
    collect() {
      const out = []
      for (const buildRef of buildersRef.current.values()) {
        const list = typeof buildRef.current === 'function' ? buildRef.current() : []
        if (Array.isArray(list)) out.push(...list.filter(Boolean))
      }
      return out
    },
  }), [])

  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>
}

/** Доступ к реестру: `collect()` отдаёт команды на текущий момент. */
export function useCommandRegistry() {
  return useContext(CommandsContext)
}

/**
 * Объявить команды экрана.
 *
 * `owner` — устойчивая строка («shell», «cloud», «local»). `build`
 * пересохраняется каждый рендер, поэтому замыкания внутри команд свежие.
 */
export function useRegisterCommands(owner, build) {
  const registry = useContext(CommandsContext)
  const buildRef = useRef(build)
  buildRef.current = build

  useEffect(() => {
    if (!registry) return undefined
    return registry.register(owner, buildRef)
  }, [registry, owner])
}
