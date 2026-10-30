/**
 * BlogOS — ритм текста.
 *
 * Волна из коротких линий: длинная линия — длинная фраза, короткая —
 * короткая. Рисуется по средней длине предложения и разбросу длин из
 * профиля (lib/tov.js → tovRhythm).
 *
 * Это намеренно декоративная вещь (раздел 06): у неё нет числовой
 * подписи и она не выдаёт себя за измерение. Она отвечает на вопрос
 * «как звучит мой текст», а не «сколько у меня чего».
 *
 * Линии набираются один раз при появлении профиля и останавливаются.
 * Бесконечного пульсирования здесь нет: карточка с результатом не должна
 * продолжать двигаться после того, как результат показан.
 */

import { motion, useReducedMotion } from 'motion/react'
import { canPlayIntro } from '../../lib/motion.js'

export default function VoiceRhythm({ rhythm, label }) {
  const reduced = useReducedMotion()
  if (!rhythm || !rhythm.bars.length) return null
  const play = !reduced && canPlayIntro()

  return (
    <figure className="rhythm">
      <div className="rhythm-wave" aria-hidden="true">
        {rhythm.bars.map((value, index) => (
          <motion.i
            key={index}
            style={{ height: `${Math.round(value * 100)}%` }}
            initial={play ? { scaleY: 0.06, opacity: 0.2 } : false}
            animate={{ scaleY: 1, opacity: 1 }}
            transition={{
              type: 'spring',
              bounce: 0,
              duration: 0.5,
              /* Каскад по волне, но не длиннее полусекунды на всю группу. */
              delay: Math.min(index, 20) * 0.022,
            }}
          />
        ))}
      </div>
      <figcaption className="rhythm-cap">{label}</figcaption>
    </figure>
  )
}
