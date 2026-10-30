/**
 * BlogOS — фирменный мотив: голос автора.
 *
 * Три полупрозрачные ленты проходят сквозь кадр и собираются в форму
 * кавычек. Это не робот, не мозг и не вращающийся шар: продукт про текст
 * и про голос, и знак должен говорить об этом же.
 *
 * Почему SVG, а не WebGL (раздел 13: «сначала проверь CSS, SVG и Motion»).
 * Нужны ровно три вещи — слои разной глубины, параллакс от курсора и
 * медленное изменение света. Всё три даёт композитор: градиенты, размытие
 * и transform. Сцена на R3F или Spline добавила бы мегабайты и собственный
 * цикл кадров ради того же впечатления, а на слабой машине отняла бы
 * отзывчивость у редактора — главного экрана продукта.
 *
 * Объём строится честно:
 *   • три слоя двигаются с разной амплитудой — ближние сильнее дальних;
 *   • блик смещается навстречу курсору, как отражение на матовом стекле;
 *   • дымка под лентами даёт глубину там, где её не дала бы тень.
 *
 * Движение останавливается, когда мотив ушёл из поля зрения, и не
 * запускается при prefers-reduced-motion — остаётся статичная сцена,
 * а не пустой блок.
 */

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

/* Глубина слоя: во сколько раз он отзывается на курсор слабее переднего.
   Передняя лента 1, дальняя 0.35 — разница заметна, но слои не разъезжаются. */
const DEPTH = { near: 1, mid: 0.62, far: 0.35 }

export default function VoiceMark({ size = 'spot', className, interactive = true }) {
  const reduced = useReducedMotion()
  const host = useRef(null)
  const [visible, setVisible] = useState(true)

  /* Сцена вне экрана не должна занимать композитор. IntersectionObserver
     дешевле таймера и не требует собственного цикла кадров. */
  useEffect(() => {
    const node = host.current
    if (!node || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '64px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  /* Параллакс. Значение кладётся в CSS-переменную, а не в состояние React:
     перерисовка дерева на каждое движение мыши — это главный способ
     сделать красивый эффект медленным. */
  const onPointerMove = (event) => {
    if (reduced || !interactive) return
    const node = host.current
    if (!node) return
    const box = node.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width - 0.5
    const y = (event.clientY - box.top) / box.height - 0.5
    node.style.setProperty('--vx', x.toFixed(3))
    node.style.setProperty('--vy', y.toFixed(3))
  }

  const onPointerLeave = () => {
    const node = host.current
    if (!node) return
    node.style.setProperty('--vx', '0')
    node.style.setProperty('--vy', '0')
  }

  const still = reduced || !visible

  return (
    <div
      ref={host}
      className={className ? `voice voice-${size} ${className}` : `voice voice-${size}`}
      data-still={still || undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      aria-hidden="true"
    >
      <svg viewBox="0 0 200 200" width="100%" height="100%" role="presentation">
        <defs>
          <linearGradient id="voice-ribbon-a" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--voice-ribbon-1)" stopOpacity="0" />
            <stop offset="42%" stopColor="var(--voice-ribbon-1)" />
            <stop offset="100%" stopColor="var(--voice-ribbon-3)" stopOpacity="0.15" />
          </linearGradient>
          <linearGradient id="voice-ribbon-b" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--voice-ribbon-2)" stopOpacity="0" />
            <stop offset="52%" stopColor="var(--voice-ribbon-2)" />
            <stop offset="100%" stopColor="var(--voice-ribbon-2)" stopOpacity="0.1" />
          </linearGradient>
          {/* Стекло кавычек: плотное у основания, прозрачное к свету.
              Светлее фона, но не белое — белое читается наклейкой. */}
          <linearGradient id="voice-glass" x1="0.15" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="var(--voice-glass-top)" />
            <stop offset="100%" stopColor="var(--voice-glass-bottom)" />
          </linearGradient>
          <radialGradient id="voice-haze" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="var(--voice-haze)" />
            <stop offset="60%" stopColor="var(--voice-haze)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--voice-haze)" stopOpacity="0" />
          </radialGradient>
          {/* Матовость: лента размыта ровно настолько, чтобы читаться
              материалом, а не контуром. Фильтр статичный — он считается
              один раз, а двигаются уже готовые слои. */}
          <filter id="voice-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4.5" />
          </filter>
        </defs>

        {/* Дымка под сценой — глубина без чёрной тени. Широкая и слабая:
            это рассеянный свет позади материала, а не цветное пятно. */}
        <ellipse className="voice-haze" cx="100" cy="96" rx="96" ry="78" fill="url(#voice-haze)" />

        {/* Дальняя лента: самая широкая и самая тихая. */}
        <g className="voice-layer voice-far" style={{ '--depth': DEPTH.far }}>
          <path
            d="M -12 150 C 40 84 98 54 212 72"
            fill="none" stroke="url(#voice-ribbon-a)" strokeWidth="26"
            strokeLinecap="round" filter="url(#voice-soft)" opacity="0.6"
          />
        </g>

        {/* Кавычки: два стеклянных знака, набранные как фигуры, а не шрифтом —
            форма должна остаться одинаковой без загруженной гарнитуры. */}
        <g className="voice-layer voice-near" style={{ '--depth': DEPTH.near }}>
          <g className="voice-quote">
            <path
              d="M 52 88 a 24 24 0 1 1 48 0 c 0 21.6 -12 36 -33.6 45.6 l -13.2 -12 c 12 -8.4 18 -19.2 18 -33.6 z"
              fill="url(#voice-glass)"
            />
            <path
              d="M 52 88 a 24 24 0 1 1 48 0 c 0 21.6 -12 36 -33.6 45.6 l -13.2 -12 c 12 -8.4 18 -19.2 18 -33.6 z"
              fill="none" stroke="var(--voice-rim)" strokeWidth="1.25" opacity="0.75"
            />
            {/* Блик по верхней кромке — холодный и короткий. */}
            <path
              d="M 59 74 a 24 24 0 0 1 31 -8"
              fill="none" stroke="var(--voice-rim)" strokeWidth="2.4"
              strokeLinecap="round" opacity="0.5"
            />
          </g>
          <g className="voice-quote voice-quote-2">
            <path
              d="M 108 88 a 24 24 0 1 1 48 0 c 0 21.6 -12 36 -33.6 45.6 l -13.2 -12 c 12 -8.4 18 -19.2 18 -33.6 z"
              fill="url(#voice-glass)"
            />
            <path
              d="M 108 88 a 24 24 0 1 1 48 0 c 0 21.6 -12 36 -33.6 45.6 l -13.2 -12 c 12 -8.4 18 -19.2 18 -33.6 z"
              fill="none" stroke="var(--voice-rim)" strokeWidth="1.25" opacity="0.75"
            />
            <path
              d="M 115 74 a 24 24 0 0 1 31 -8"
              fill="none" stroke="var(--voice-rim)" strokeWidth="2.4"
              strokeLinecap="round" opacity="0.5"
            />
          </g>
        </g>

        {/* Передняя лента проходит поверх знаков. Один слой перед объектом
            и два позади — этого хватает, чтобы сцена читалась объёмной. */}
        <g className="voice-layer voice-mid" style={{ '--depth': DEPTH.mid }}>
          <path
            d="M -12 118 C 52 126 108 162 212 100"
            fill="none" stroke="url(#voice-ribbon-b)" strokeWidth="17"
            strokeLinecap="round" filter="url(#voice-soft)"
          />
        </g>

        {/* Блик идёт навстречу курсору: свет меняется по направлению
            движения, как на матовом стекле. */}
        <ellipse className="voice-gleam" cx="100" cy="58" rx="58" ry="24" fill="var(--voice-rim)" opacity="0.09" />
      </svg>
    </div>
  )
}
