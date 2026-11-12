import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { Icon } from './Icon.jsx'
import { useAppIntro } from './Motion.jsx'

/**
 * Каркас приложения: боковая панель слева, содержимое справа.
 *
 * Было четыре полосы навигации друг под другом — шапка, панель канала,
 * вкладки и полоса шагов, — и ни одна не говорила, где ты находишься.
 * Теперь «где я» живёт слева и видно всегда, а сверху остаётся только
 * заголовок текущего экрана.
 *
 * На узком экране панель уезжает в выдвижной ящик: сетка превращается
 * в одну колонку, сверху появляется полоса с кнопкой меню.
 *
 * Вступление играется один раз за загрузку: знак проявляется из
 * расфокуса, панель и сцена входят следом слоями (раздел 12). На смену
 * раздела оно не повторяется — оболочка остаётся смонтированной,
 * а повтор на каждое нажатие превратил бы впечатление в помеху.
 */
export default function AppShell({ sidebar, title, actions, children }) {
  const [open, setOpen] = useState(false)
  const intro = useAppIntro()

  /* Ящик закрывается по Esc и при уходе на другой экран: иначе он
     остаётся поверх содержимого, которое только что открыли. */
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="shell" data-drawer={open} data-intro={intro || undefined}>
      <aside className="shell-aside" data-open={open}>
        {sidebar}
      </aside>

      {/* Затемнение под ящиком — только на узком экране. */}
      {open && (
        <button
          type="button"
          className="shell-scrim"
          aria-label="Закрыть меню"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="shell-main">
        <div className="shell-bar">
          <button
            type="button"
            className="shell-burger"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={open}
          >
            <Icon as={open ? X : Menu} />
          </button>
          {title && <div className="shell-bar-title">{title}</div>}
          <div className="spacer" />
          {actions}
        </div>

        <main className="stage" onClickCapture={() => { if (open) setOpen(false) }}>
          {children}
        </main>
      </div>
    </div>
  )
}
