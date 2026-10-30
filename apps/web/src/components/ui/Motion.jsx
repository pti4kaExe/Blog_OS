/**
 * BlogOS — общие моушен-примитивы.
 *
 * Здесь живёт то, что иначе расползлось бы по экранам копиями: вход
 * группы, каскад, появление результата. Длительности и интервалы —
 * из разделов 11–12 спецификации, и менять их нужно здесь, а не в
 * каждом компоненте.
 *
 * Три правила, общие для всего файла:
 *   1. Анимируются только transform и opacity — кадр собирает композитор.
 *   2. Каскад ограничен: 35–60 мс между элементами, не дольше 700 мс
 *      на всю группу. Длинная лента анимирует только начало.
 *   3. При prefers-reduced-motion движение заменяется угасанием, а не
 *      выключается совсем: смысл перехода сохраняется.
 */

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { canPlayIntro, crossfade, spring } from '../../lib/motion.js'

/* Шаг каскада и потолок: дальше элементы входят вместе с последним.
   Без потолка двадцатая карточка ленты появлялась бы через секунду
   после первой — это уже не отклик, а ожидание. */
export const STAGGER_STEP = 0.045
export const STAGGER_CAP = 12

/**
 * Вступление приложения играется один раз за загрузку страницы.
 *
 * Флаг модульный, а не в состоянии компонента: при переходе между
 * разделами оболочка перемонтируется, и состояние вернуло бы вступление
 * на каждый клик по навигации.
 */
let introPlayed = false

export function useAppIntro() {
  const reduced = useReducedMotion()
  const [play] = useState(() => !introPlayed && !reduced && canPlayIntro())
  useEffect(() => { introPlayed = true }, [])
  return play
}

/* Контекст каскада: Reveal внутри Stagger берёт свой номер по порядку,
   чтобы вызывающему коду не приходилось считать индексы руками. */
const StaggerContext = createContext(null)

/**
 * Группа с каскадом.
 *
 *   <Stagger>
 *     <Reveal>…</Reveal>
 *     <Reveal>…</Reveal>
 *   </Stagger>
 *
 * `replay` сменой значения перезапускает каскад: это нужно там, где
 * группа та же, а содержимое новое — например пересобранный пост.
 */
export function Stagger({ children, className, step = STAGGER_STEP, replay, as = 'div', ...rest }) {
  const counter = useRef(0)
  counter.current = 0
  const Tag = motion[as] || motion.div
  return (
    <StaggerContext.Provider value={{ next: () => counter.current++, step }}>
      <Tag className={className} key={replay} {...rest}>{children}</Tag>
    </StaggerContext.Provider>
  )
}

/**
 * Один элемент входа: лёгкий подъём снизу и проявление.
 *
 * Вне Stagger работает сам по себе — тогда это просто вход одного блока.
 * Внутри Stagger получает задержку по своему месту в группе.
 */
export function Reveal({
  children, className, offset = 10, delay = 0, index, as = 'div', style, ...rest
}) {
  const reduced = useReducedMotion()
  const group = useContext(StaggerContext)
  const own = useRef(null)
  if (own.current === null) own.current = group ? group.next() : 0

  const place = index === undefined ? own.current : index
  const step = group ? group.step : STAGGER_STEP
  const wait = delay + Math.min(place, STAGGER_CAP) * step

  const Tag = motion[as] || motion.div
  const play = !reduced && canPlayIntro()

  return (
    <Tag
      className={className}
      style={style}
      initial={play ? { opacity: 0, y: offset } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? crossfade : { ...spring.move, delay: wait }}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/**
 * Появление результата: то, что пользователь ждал после нажатия.
 *
 * Масштаб от 0.985 к 1 вместе с проявлением (раздел 06): блок не
 * «возникает готовым», но и не разъезжается на пол-экрана.
 */
export function ResultReveal({ children, className, replay, ...rest }) {
  const reduced = useReducedMotion()
  const play = !reduced && canPlayIntro()
  return (
    <motion.div
      key={replay}
      className={className}
      initial={play ? { opacity: 0, scale: 0.985, y: 8 } : false}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={reduced ? crossfade : { type: 'spring', bounce: 0, duration: 0.46 }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

/**
 * Контекстная панель: въезжает по горизонтали на 16px с проявлением
 * (разделы 10 и 12). На узком экране сдвиг не нужен — панель там
 * занимает всю ширину, и горизонтальное движение читается как сбой.
 */
export function PanelReveal({ children, className, replay, shift = 16, as = 'div', ...rest }) {
  const reduced = useReducedMotion()
  const narrow = typeof window !== 'undefined'
    && window.matchMedia('(max-width: 1240px)').matches
  const play = !reduced && canPlayIntro()
  const from = narrow ? 0 : shift
  const Tag = motion[as] || motion.div
  return (
    <Tag
      key={replay}
      className={className}
      initial={play ? { opacity: 0, x: from } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={reduced ? crossfade : spring.move}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/**
 * Переезжающая подложка выбора — для наборов карточек, где выбран
 * ровно один пункт: сюжетная арка, режим, фильтр.
 *
 *   const pick = useArcPick()
 *   <button aria-pressed={active}>{pick(active)}<b>…</b></button>
 *
 * Подложка одна на весь набор: motion переносит её между карточками,
 * вместо того чтобы гасить одну заливку и зажигать другую. Размеры
 * карточек не меняются — соседи остаются на месте (раздел 07).
 *
 * Свой layoutId на каждый набор: иначе подложка перелетала бы между
 * двумя наборами, если они оказались на экране одновременно.
 */
export function useArcPick(className = 'arc-glow') {
  const reduced = useReducedMotion()
  const group = useId()
  return (active) => (active ? (
    <motion.span
      className={className}
      aria-hidden="true"
      layoutId={`pick-${group}`}
      transition={reduced ? { duration: 0 } : spring.snappy}
    />
  ) : null)
}
