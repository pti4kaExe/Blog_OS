/**
 * BlogOS — витрина фундамента.
 *
 * Служебная страница для проверки дизайн-системы целиком: цвет,
 * типографика, ритм, глубина, материалы, моушен, иконки, скелетоны.
 * Открывается по ?фундамент и в обычный интерфейс не входит.
 */

import { useState } from 'react'
import { motion } from 'motion/react'
import {
  AlertTriangle, ArrowRight, Check, FileText, Plus, Search, Settings, Sparkles, Trash2,
} from 'lucide-react'
import { Icon } from './ui/Icon.jsx'
import ThemeSwitch from './ui/ThemeSwitch.jsx'
import { Skeleton, SkeletonCard, SkeletonText } from './ui/Skeleton.jsx'
import { spring, useSpring } from '../lib/motion.js'
import '../styles/showcase.css'

const SURFACES = [
  ['--surface-base', 'фон страницы'],
  ['--surface-input', 'утопленные поля'],
  ['--surface-raised', 'карточки'],
  ['--surface-overlay', 'вложенные блоки'],
  ['--surface-elevated', 'верхний слой'],
]

const TINTS = [
  ['--tint', 'акцент'],
  ['--success', 'успех'],
  ['--caution', 'внимание'],
  ['--warning', 'предупреждение'],
  ['--danger', 'ошибка'],
]

const TYPE_SCALE = [
  ['t-display', 'Display', '34 / 1.08 / −0.022em / 700'],
  ['t-title1', 'Title 1', '28 / 1.14 / −0.018em / 680'],
  ['t-title2', 'Title 2', '22 / 1.2 / −0.014em / 650'],
  ['t-title3', 'Title 3', '19 / 1.26 / −0.01em / 640'],
  ['t-headline', 'Headline', '16 / 1.35 / −0.006em / 620'],
  ['t-body', 'Body', '15 / 1.55 / 0 / 400'],
  ['t-callout', 'Callout', '14 / 1.5 / 0 / 400'],
  ['t-subhead', 'Subhead', '13 / 1.45 / +0.002em / 530'],
  ['t-footnote', 'Footnote', '12.5 / 1.4 / +0.005em / 400'],
  ['t-caption', 'Caption', '11.5 / 1.35 / +0.012em / 530'],
]

const SPACING = [1, 2, 3, 4, 5, 6, 7, 8]
const SPACING_PX = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 }
const RADII = ['xs', 'sm', 'md', 'lg', 'xl']
const RADII_PX = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28 }

function Section({ id, title, note, children }) {
  return (
    <section className="fnd-section" id={id}>
      <h2 className="t-title2">{title}</h2>
      {note && <p className="fnd-note t-callout">{note}</p>}
      {children}
    </section>
  )
}

/** Пружины: кнопка переключает цель, квадрат едет выбранной пружиной. */
function MotionLab() {
  const [name, setName] = useState('move')
  const [far, setFar] = useState(false)
  const transition = useSpring(name)

  return (
    <>
      <div className="mo-track">
        <motion.div
          className="mo-dot"
          animate={{ x: far ? 'calc(100% + 0px)' : 0 }}
          style={{ x: 0 }}
          transition={transition}
        />
      </div>
      <div className="mo-row">
        {Object.keys(spring).map((key) => (
          <button
            key={key}
            type="button"
            className="fb t-subhead pressable"
            aria-pressed={name === key}
            onClick={() => { setName(key); setFar((v) => !v) }}
          >
            {key}
            <span className="label-tertiary">
              {spring[key].bounce === 0 ? ' · без перелёта' : ' · с отскоком'}
            </span>
          </button>
        ))}
      </div>
      <p className="fnd-note t-footnote">
        Нажимайте по очереди: разница между «без перелёта» и «с отскоком» видна
        только в движении. Отскок уместен там, где жест сам нёс инерцию.
      </p>
    </>
  )
}

/** Перетаскивание: сопротивление у границы и возврат пружиной. */
function DragLab() {
  const transition = useSpring('flick')
  return (
    <>
      <div className="mo-drag-rail">
        <motion.div
          className="mo-drag t-subhead"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.18}
          dragTransition={{ bounceStiffness: 300, bounceDamping: 32 }}
          whileDrag={{ scale: 1.04 }}
          transition={transition}
        >
          Потяните вбок
        </motion.div>
      </div>
      <p className="fnd-note t-footnote">
        Элемент идёт за курсором один к одному, у границы сопротивляется тем
        сильнее, чем дальше его тянут, и возвращается пружиной с инерцией —
        без жёсткого упора.
      </p>
    </>
  )
}

export default function FoundationShowcase() {
  return (
    <div className="fnd">
      <header className="fnd-head">
        <div className="fnd-head-row">
          <h1 className="t-display">Фундамент дизайн-системы</h1>
          <ThemeSwitch />
        </div>
        <p className="t-body">
          Служебная страница. Здесь собраны все решения фундамента: цвет,
          типографика, ритм, глубина, материалы, моушен и примитивы.
          Ориентир — Apple HIG. Переключателем справа можно сравнить обе
          темы: «как в системе», светлая, тёмная.
        </p>
      </header>

      <Section
        id="цвет" title="Цвет"
        note="В тёмной теме глубину несёт светлота: чем выше слой, тем он светлее. В светлой — наоборот: карточка белая и поднимается тенью над серым фоном. Поэтому токены названы по роли, а не по светлоте: --surface-elevated — это «нажатое и выбранное», в тёмной теме самый светлый слой, в светлой самый серый. Текст в обеих темах — один цвет в четырёх уровнях прозрачности."
      >
        <div className="fnd-grid">
          {SURFACES.map(([token, role]) => (
            <div className="sw" key={token}>
              <div className="sw-chip" style={{ background: `var(${token})` }} />
              <div className="sw-meta">
                <span className="sw-name t-subhead">{role}</span>
                <span className="sw-val t-caption t-mono">{token}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="fnd-grid" style={{ marginTop: 'var(--sp-3)' }}>
          {TINTS.map(([token, role]) => (
            <div className="sw" key={token}>
              <div className="sw-chip" style={{ background: `var(${token})` }} />
              <div className="sw-meta">
                <span className="sw-name t-subhead">{role}</span>
                <span className="sw-val t-caption t-mono">{token}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="fnd-labels" style={{ marginTop: 'var(--sp-4)' }}>
          <span className="t-body">Основной текст — заголовки и содержание</span>
          <span className="t-body label-secondary">Второй уровень — пояснения и подписи</span>
          <span className="t-body label-tertiary">Третий уровень — метаданные, служебное</span>
        </div>
      </Section>

      <Section
        id="типографика" title="Типографика"
        note="Размер, интерлиньяж, трекинг и насыщенность задаются одним набором. Трекинг зависит от размера: крупный текст стягиваем, мелкий распускаем — одно значение letter-spacing на всю шкалу всегда где-то неверно."
      >
        {TYPE_SCALE.map(([cls, name, spec]) => (
          <div className="ty-row" key={cls}>
            <span className={cls}>{name} — пост в вашем голосе</span>
            <span className="ty-spec t-caption t-mono">{spec}</span>
          </div>
        ))}
      </Section>

      <Section
        id="ритм" title="Ритм"
        note="Шаг 4px, заданный в rem: при увеличении системного размера текста вместе с ним едут и отступы, поэтому вёрстка не ломается."
      >
        {SPACING.map((n) => (
          <div className="rh-row" key={n}>
            <span className="rh-name t-caption t-mono">sp-{n}</span>
            <span className="rh-bar" style={{ width: `var(--sp-${n})` }} />
            <span className="rh-val t-caption t-nums">{SPACING_PX[n]}px</span>
          </div>
        ))}
      </Section>

      <Section
        id="скругления" title="Скругления"
        note="Радиус растёт вместе с площадью элемента: одинаковый радиус на теге и на модалке читается как разный материал."
      >
        <div className="fnd-grid">
          {RADII.map((r) => (
            <div className="rad-box t-caption t-mono" key={r} style={{ borderRadius: `var(--r-${r})` }}>
              r-{r} · {RADII_PX[r]}px
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="глубина" title="Глубина"
        note="Крупная поверхность должна читаться толще: у неё сильнее размытие тени и больше смещение."
      >
        <div className="fnd-grid">
          {[1, 2, 3].map((n) => (
            <div className="elev t-subhead" key={n} style={{ boxShadow: `var(--shadow-${n})` }}>
              shadow-{n}
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="материалы" title="Материалы"
        note="Полупрозрачный слой поверх содержимого — точечно: модалки, поповеры, плавающая шапка. Светлая кромка сверху читается как блик на материале. Светлый материал поверх светлого не кладём. При системной настройке «понизить прозрачность» размытие снимается, подложка становится плотной."
      >
        <div className="mat-stage">
          <p className="t-callout">
            Под материалом — цветное содержимое, чтобы было видно, как слой
            размывает и подкрашивает то, что под ним.
          </p>
          <div className="mat-layer material">
            <h3 className="t-headline">Обычный материал</h3>
            <span className="t-footnote">размытие 20px · для поповеров и шапки</span>
          </div>
          <div className="mat-layer material-thick">
            <h3 className="t-headline">Плотный материал</h3>
            <span className="t-footnote">размытие 40px · для модалок и листов</span>
          </div>
        </div>
      </Section>

      <Section
        id="моушен" title="Моушен"
        note="Пружина стартует с текущего значения на экране и перехватывается на лету — поэтому ей можно управлять посреди движения. Два параметра: затухание (насколько проскакивает цель) и отклик (за сколько доходит)."
      >
        <MotionLab />
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <DragLab />
        </div>
        <div className="mo-row" style={{ marginTop: 'var(--sp-4)' }}>
          <button type="button" className="fb fb-primary t-subhead pressable">
            <Icon as={Check} size="sm" />
            Отклик на нажатие
          </button>
          <button type="button" className="fb t-subhead pressable">
            <Icon as={Plus} size="sm" />
            Вторичная
          </button>
          <span className="t-footnote label-tertiary">
            Реакция приходит в момент нажатия, а не отпускания.
          </span>
        </div>
      </Section>

      <Section
        id="иконки" title="Иконки"
        note="Единый набор с постоянной толщиной штриха: толщина не масштабируется вместе с размером, иначе крупные иконки выглядят жирнее мелких. По умолчанию иконка декоративна и скринридером не озвучивается — рядом есть текст."
      >
        <div className="ic-row">
          {[['sm', 14], ['md', 18], ['lg', 22], ['xl', 28]].map(([size, px]) => (
            <div className="ic-cell" key={size}>
              <Icon as={Sparkles} size={size} />
              <span className="t-caption t-mono">{size} · {px}px</span>
            </div>
          ))}
        </div>
        <div className="ic-row" style={{ marginTop: 'var(--sp-4)' }}>
          {[Check, Plus, Search, Settings, Trash2, FileText, AlertTriangle, ArrowRight].map((Glyph, i) => (
            <Icon as={Glyph} key={i} size="md" />
          ))}
        </div>
      </Section>

      <Section
        id="скелетоны" title="Скелетоны"
        note="Вместо спиннера — форма того, что грузится: страница не прыгает при появлении данных. Блик идёт на transform, кадр собирает композитор. При пониженной подвижности блик выключается."
      >
        <div className="fnd-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </div>
        <div style={{ marginTop: 'var(--sp-4)', maxWidth: 420 }}>
          <SkeletonText lines={3} />
        </div>
        <div style={{ marginTop: 'var(--sp-4)', display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
          <Skeleton width="44px" height="44px" radius="var(--r-full)" />
          <Skeleton width="180px" height="0.9rem" />
        </div>
      </Section>
    </div>
  )
}
