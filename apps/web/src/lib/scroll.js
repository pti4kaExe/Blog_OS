/**
 * Подвод экрана к узлу.
 *
 * Нужен там, где результат действия появляется ниже сгиба: итог проверки
 * на шаге 4, полоса шагов после нажатия в чеклисте. Человек нажал кнопку —
 * он должен увидеть, что произошло, а не остаться перед прежним экраном.
 *
 * Три правила, одинаковые для всех мест вызова:
 *
 *   1. Если узел и так целиком на экране, не делаем ничего. Дёргать экран
 *      ради того, что человек и так видит, — худшее из возможного.
 *   2. Отступ сверху — под липкую полосу заголовка, иначе она накрывает
 *      первую строку.
 *   3. При prefers-reduced-motion едем мгновенно.
 *
 * Запасной путь. Плавная прокрутка бывает выключена средой: во встроенных
 * webview и headless-браузерах `behavior: 'smooth'` тихо не делает ничего,
 * и подвод просто не случается (проверено). Поэтому через треть секунды
 * смотрим, тронулся ли экран, и если нет — доезжаем мгновенно.
 *
 * Таймер намеренно не привязан к жизни компонента: он сам проверяет, что
 * экран не двигали, поэтому безопасен, даже если успеет пережить
 * перерисовку. Если человек за эту треть секунды прокрутил сам — значит
 * он решил смотреть в другое место, и мы не мешаем.
 */

const STICKY_BAR = 72
const SMOOTH_FALLBACK_MS = 350

export function scrollNodeIntoView(node, { offset = STICKY_BAR } = {}) {
  if (!node || typeof window === 'undefined') return

  const box = node.getBoundingClientRect()
  if (box.top >= offset && box.bottom <= window.innerHeight) return

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const target = window.scrollY + box.top - offset
  const from = window.scrollY

  window.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' })
  if (reduced) return

  setTimeout(() => {
    if (Math.abs(window.scrollY - from) < 2) window.scrollTo({ top: target, behavior: 'auto' })
  }, SMOOTH_FALLBACK_MS)
}
