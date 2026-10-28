/**
 * BlogOS — моушен.
 *
 * Пружины вместо кривых с фиксированной длительностью: пружину можно
 * перехватить на лету, она стартует с текущего значения на экране и
 * принимает скорость жеста. Всё, что пользователь может схватить,
 * анимируется отсюда.
 *
 * Два параметра вместо тройки «масса/жёсткость/затухание»:
 *   затухание (damping) — насколько сильно проскакивает цель;
 *     1.0 — без перелёта, 0.8 — лёгкий отскок;
 *   отклик (response)   — за сколько секунд значение доходит до цели.
 *
 * В API motion это bounce (= 1 − затухание) и duration (= отклик).
 */

import { useReducedMotion } from 'motion/react'

/**
 * Готовые пружины. Значения — те же, что Apple приводит для своих
 * системных взаимодействий.
 *
 * По умолчанию берём `move`: без перелёта, спокойно. Отскок уместен
 * только там, где жест сам нёс инерцию — бросок, смахивание, перетаскивание.
 * Перелёт у меню, которое просто проявилось, выглядит фальшиво.
 */
export const spring = {
  /** Перемещение, раскрытие, смена позиции. Затухание 1.0, отклик 0.4. */
  move: { type: 'spring', bounce: 0, duration: 0.4 },
  /** То же, но короче: мелкие элементы, смена состояния. */
  snappy: { type: 'spring', bounce: 0, duration: 0.28 },
  /** Лист, шторка, модалка. Затухание 0.8, отклик 0.3. */
  sheet: { type: 'spring', bounce: 0.2, duration: 0.3 },
  /** Бросок с инерцией и поворот. Затухание 0.8, отклик 0.4. */
  flick: { type: 'spring', bounce: 0.2, duration: 0.4 },
}

/** Замена движению, когда система просит понизить подвижность. */
export const crossfade = { duration: 0.2, ease: [0.32, 0.72, 0, 1] }

/**
 * Пружина с оглядкой на prefers-reduced-motion.
 * Возвращает либо пружину, либо мягкое угасание той же роли.
 *
 *   const transition = useSpring('sheet')
 */
export function useSpring(name = 'move') {
  const reduced = useReducedMotion()
  return reduced ? crossfade : (spring[name] || spring.move)
}

/**
 * Варианты появления/исчезновения. При пониженной подвижности движение
 * убирается, остаётся прозрачность — смысл перехода сохраняется.
 *
 *   const v = useEnter(8)   // 8px подъёма снизу
 *   <motion.div variants={v} initial="hidden" animate="shown" exit="hidden" />
 */
export function useEnter(offset = 8) {
  const reduced = useReducedMotion()
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      shown: { opacity: 1, transition: crossfade },
    }
  }
  return {
    hidden: { opacity: 0, y: offset },
    shown: { opacity: 1, y: 0, transition: spring.move },
  }
}

/**
 * Куда жест долетит по инерции, если отпустить прямо сейчас.
 *
 * Это та же функция, по которой тормозится системный скролл. Точку
 * прилипания выбираем по спроецированной точке, а не по месту отпускания —
 * тогда бросок действительно бросает, а не роняет на месте.
 *
 * @param {number} velocity     скорость в px/с на момент отпускания
 * @param {number} deceleration 0.998 — обычное торможение, 0.99 — резче
 * @returns {number} смещение от текущей точки до точки остановки
 */
export function project(velocity, deceleration = 0.998) {
  return (velocity / 1000) * deceleration / (1 - deceleration)
}

/**
 * Сопротивление за границей: чем дальше утащили, тем меньше элемент
 * следует за пальцем. Жёсткий упор читается как «подвисло», плавное
 * сопротивление — как «дальше ничего нет».
 *
 * @param {number} overshoot сколько утащили за границу, px
 * @param {number} dimension размер элемента по этой оси, px
 */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

/**
 * Относительная скорость для пружин, которым нужна не абсолютная величина,
 * а доля оставшегося пути.
 */
export function relativeVelocity(velocity, current, target) {
  const distance = target - current
  return distance === 0 ? 0 : velocity / distance
}

/**
 * Небольшая история последних точек указателя — по ней считается скорость
 * на момент отпускания. Одной последней точки не хватает: она шумит.
 *
 *   const track = createVelocityTracker()
 *   onPointerMove: track.push(event.clientY)
 *   onPointerUp:   track.velocity()   // px/с
 */
export function createVelocityTracker(window = 5) {
  const points = []
  return {
    push(value, time = performance.now()) {
      points.push({ value, time })
      if (points.length > window) points.shift()
    },
    velocity() {
      if (points.length < 2) return 0
      const first = points[0]
      const last = points[points.length - 1]
      const seconds = (last.time - first.time) / 1000
      return seconds > 0 ? (last.value - first.value) / seconds : 0
    },
    reset() { points.length = 0 },
  }
}
