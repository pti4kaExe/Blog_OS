import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Coffee, Cookie, EyeOff, FileText, Heart, Lightbulb, LogIn, MonitorCog, Pencil, RotateCcw, Settings2, ShieldCheck, Sparkles, Wand2, X,
} from 'lucide-react'
import { Icon } from '../ui/Icon.jsx'
import {
  emitPetSignal, hidePetFor, lastPetSignal, petHiddenUntil, showPet, subscribePet,
} from '../../lib/petSignals.js'
import { addPetCookie, petCookies, subscribePetPrefs } from '../../lib/petPrefs.js'
import { playPetPublish } from '../../lib/petSound.js'

// Кадры питомца: покой, моргание, взгляд. Сгенерированы из того же PNG,
// персонаж не перерисовывался (см. development_log, блок 10).
const BASE = import.meta.env.BASE_URL
const FRAMES = {
  idle: `${BASE}pet/pet-idle.png`,
  blink: `${BASE}pet/pet-blink.png`,
  left: `${BASE}pet/pet-look-left.png`,
  right: `${BASE}pet/pet-look-right.png`,
  happy: `${BASE}pet/pet-happy.png`,
  tired: `${BASE}pet/pet-tired.png`,
}
const FALLBACK_FRAME = `${BASE}blogos-pet-cat.png`

const POS_KEY = 'blogos.pet.pos.v1'
const DRAG_THRESHOLD = 6
const EDGE = 16

function clipText(text, max = 46) {
  if (!text) return ''
  const clean = String(text).replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function issuePhrase(issue) {
  if (!issue) return null
  const quote = issue.quote ? ` «${clipText(issue.quote, 34)}»` : ''
  if (issue.category === 'cliche') return `Тут клише${quote} — давайте сделаем живее?`
  if (issue.category === 'logic') return 'Тут просится связка между мыслями — поправим?'
  if (issue.category === 'tov') return 'Тон чуть съехал с голоса канала — выровняем?'
  if (issue.category === 'clarity') return `Здесь можно яснее${quote} — помогу сократить`
  return `${clipText(issue.title || 'Есть замечание')} — поправим?`
}

function screenPhrase(view) {
  if (view === 'archive') return 'В архиве живут прошлые посты — можно быстро поднять удачные формулировки'
  if (view === 'radar') return 'CommentRadar помогает увидеть, какие темы цепляют людей'
  if (view === 'knowledge') return 'База знаний — кладём факты сюда, чтобы черновики были плотнее'
  if (view === 'settings') return 'В настройках можно докрутить голос, правила и мои подсказки'
  return null
}

function moodIcon(mood) {
  if (mood === 'happy') return Heart
  if (mood === 'tired') return Coffee
  if (mood === 'thinking') return Lightbulb
  if (mood === 'working') return Pencil
  return Sparkles
}

function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.x !== 'number' || typeof parsed?.y !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function savePos(pos) {
  try {
    if (!pos) localStorage.removeItem(POS_KEY)
    else localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }))
  } catch {
    // приватный режим: позиция живёт до перезагрузки
  }
}

function clampPos(x, y, width, height = width) {
  const maxX = Math.max(EDGE, window.innerWidth - width - EDGE)
  const maxY = Math.max(EDGE, window.innerHeight - height - EDGE)
  return { x: Math.min(Math.max(EDGE, x), maxX), y: Math.min(Math.max(EDGE, y), maxY) }
}

function elementSize(element, fallback = 92) {
  const rect = element?.getBoundingClientRect()
  if (!rect) return { width: fallback, height: fallback }
  return {
    width: Math.max(fallback, rect.width),
    height: Math.max(fallback, rect.height),
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

/**
 * Питомец BlogOS — живой помощник, а не украшение.
 *
 *  - говорит короткую фразу по текущему состоянию (вход, нет канала, не
 *    разобран стиль, готовый черновик, результат проверки);
 *  - по клику открывает меню реальных действий;
 *  - его можно перетащить в любое место (позиция запоминается) и вернуть
 *    на место из меню;
 *  - моргает каждые 3–6 секунд, смотрит в сторону курсора (кадры + наклон),
 *    плавно парит и откликается на клик;
 *  - уважает prefers-reduced-motion: при reduce нет моргания, взгляда и
 *    парения.
 */
export default function PetCompanion({
  mode = 'app',
  hasChannels = false,
  channel = null,
  view = 'pipeline',
  onCreateChannel,
  onView,
  onStep,
  onLogin,
  onUseLocal,
}) {
  const [hiddenUntil, setHiddenUntil] = useState(petHiddenUntil)
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [flash, setFlash] = useState(null)
  const [pos, setPos] = useState(loadPos)
  const [dragging, setDragging] = useState(false)
  const [blink, setBlink] = useState(false)
  const [look, setLook] = useState('idle')
  const [cookies, setCookies] = useState(petCookies)
  // Настроение с таймером (радость после победы) — поверх базового.
  const [moodBoost, setMoodBoost] = useState(null)
  const [cookieFlash, setCookieFlash] = useState(false)
  const [pipeline, setPipeline] = useState(() => {
    const signal = lastPetSignal()
    return signal?.type === 'pipeline-state' ? signal.payload : {}
  })

  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const flashTimer = useRef(null)
  const boostTimer = useRef(null)
  const cookieTimer = useRef(null)
  const activity = useRef({ first: 0, last: 0 })
  const dragState = useRef({ active: false, moved: false, startX: 0, startY: 0, originX: 0, originY: 0, size: 0, pointerId: null })
  const posRef = useRef(pos)
  const suppressClick = useRef(false)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => { posRef.current = pos }, [pos])

  // Сигналы конвейера и проверки.
  useEffect(() => subscribePet((signal) => {
    if (signal.type === 'pipeline-state') {
      setPipeline((prev) => ({ ...prev, ...signal.payload }))
      return
    }
    if (signal.type === 'lint-ready') {
      setPipeline((prev) => ({ ...prev, ...signal.payload, published: false }))
      showFlash(issuePhrase(signal.payload.topIssue) || 'Проверка готова — замечаний нет, можно финально пройтись глазами')
      if ((signal.payload.score ?? 0) >= 80) celebrate(4200)
      return
    }
    if (signal.type === 'published') {
      setPipeline((prev) => ({ ...prev, published: true }))
      const nextCookies = addPetCookie()
      setCookies(nextCookies)
      playPetPublish()
      celebrate(5000)
      setCookieFlash(true)
      if (cookieTimer.current) clearTimeout(cookieTimer.current)
      cookieTimer.current = setTimeout(() => setCookieFlash(false), 1500)
      showFlash(`Опубликовано! Ловлю первые лайки. Печеньки: ${nextCookies}`)
      return
    }
    if (signal.type === 'draft-text') {
      setPipeline((prev) => ({ ...prev, textLength: signal.payload?.length ?? 0 }))
      return
    }
    if (signal.type === 'draft-ready') {
      setPipeline((prev) => ({ ...prev, hasDraft: true }))
      showFlash('Черновик готов — я уже разминаю AntiCringe')
    }
  }), [])

  // Вернули из настроек — сразу показываемся.
  useEffect(() => {
    const onRestore = () => setHiddenUntil(petHiddenUntil())
    window.addEventListener('blogos:pet-restored', onRestore)
    return () => window.removeEventListener('blogos:pet-restored', onRestore)
  }, [])

  useEffect(() => subscribePetPrefs(() => {
    setCookies(petCookies())
  }), [])

  const showFlash = useCallback((text) => {
    setFlash(text)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 5000)
  }, [])

  /** Радость на несколько секунд: после публикации и отличной проверки. */
  const celebrate = useCallback((ms = 4500) => {
    setMoodBoost('happy')
    if (boostTimer.current) clearTimeout(boostTimer.current)
    boostTimer.current = setTimeout(() => setMoodBoost(null), ms)
  }, [])

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    if (boostTimer.current) clearTimeout(boostTimer.current)
    if (cookieTimer.current) clearTimeout(cookieTimer.current)
  }, [])

  // Моргание: каждые 3–6 секунд на ~130 мс.
  useEffect(() => {
    if (reducedMotion) {
      setBlink(false)
      return undefined
    }
    let next = null
    let close = null
    const schedule = () => {
      next = setTimeout(() => {
        setBlink(true)
        close = setTimeout(() => {
          setBlink(false)
          schedule()
        }, 130)
      }, 3000 + Math.random() * 3000)
    }
    schedule()
    return () => {
      clearTimeout(next)
      clearTimeout(close)
    }
  }, [reducedMotion])

  // Взгляд за курсором: направление + наклон. На тач-устройствах не нужно.
  useEffect(() => {
    if (reducedMotion || typeof window === 'undefined' || !window.matchMedia) return undefined
    if (!window.matchMedia('(pointer: fine)').matches) return undefined
    let frame = 0
    const onMove = (event) => {
      if (dragState.current.active) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = buttonRef.current?.getBoundingClientRect()
        if (!rect) return
        const dx = event.clientX - (rect.left + rect.width / 2)
        const dy = event.clientY - (rect.top + rect.height / 2)
        // Смотрит вперёд, когда курсор далеко или по центру.
        if (Math.abs(dx) < 16 || Math.hypot(dx, dy) > 340) {
          setLook('idle')
          return
        }
        setLook(dx > 0 ? 'right' : 'left')
      })
    }
    const onLeave = () => setLook('idle')
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [reducedMotion])

  // Усталость от долгой сессии: больше 20 минут активности без паузы.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onActivity = () => {
      const now = Date.now()
      if (!activity.current.first) activity.current.first = now
      activity.current.last = now
    }
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity)
    const timer = setInterval(() => {
      const { first, last } = activity.current
      if (!first || !last) return
      const now = Date.now()
      // Перерыв — сбрасываем сессию и усталость.
      if (now - last > 5 * 60 * 1000) {
        activity.current = { first: 0, last: 0 }
        setMoodBoost((current) => (current === 'tired' ? null : current))
        return
      }
      if (now - first > 20 * 60 * 1000 && now - last < 2 * 60 * 1000) {
        setMoodBoost((current) => (current === 'happy' ? current : 'tired'))
      }
    }, 30_000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [])

  // После монтирования подгоняем сохранённую позицию под текущий вьюпорт.
  useEffect(() => {
    if (!pos) return
    const { width, height } = elementSize(rootRef.current, buttonRef.current?.offsetWidth ?? 92)
    const next = clampPos(pos.x, pos.y, width, height)
    if (next.x !== pos.x || next.y !== pos.y) {
      setPos(next)
      savePos(next)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Позиция не должна вылезать за экран после ресайза.
  useEffect(() => {
    if (!pos) return undefined
    const onResize = () => {
      const { width, height } = elementSize(rootRef.current, buttonRef.current?.offsetWidth ?? 92)
      setPos((current) => {
        if (!current) return current
        const next = clampPos(current.x, current.y, width, height)
        if (next.x !== current.x || next.y !== current.y) savePos(next)
        return next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos])

  // Когда открываются подсказка или меню, размер блока меняется. Проверяем
  // уже весь блок, чтобы он не уходил за экран вместе с плашками.
  useEffect(() => {
    if (!pos || dragging) return undefined
    const frame = requestAnimationFrame(() => {
      const { width, height } = elementSize(rootRef.current, buttonRef.current?.offsetWidth ?? 92)
      setPos((current) => {
        if (!current) return current
        const next = clampPos(current.x, current.y, width, height)
        if (next.x !== current.x || next.y !== current.y) savePos(next)
        return next
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, hovered, flash, pos, dragging])

  // Сначала грузим только покой и моргание; кадры взгляда — лениво,
  // когда курсор впервые пошёл по экрану (экономим ~140 КБ на старте).
  useEffect(() => {
    ;[FRAMES.idle, FRAMES.blink, FRAMES.happy, FRAMES.tired].forEach((src) => {
      const image = new Image()
      image.src = src
    })
    let done = false
    const warmLook = () => {
      if (done) return
      done = true
      ;[FRAMES.left, FRAMES.right].forEach((src) => {
        const image = new Image()
        image.src = src
      })
    }
    window.addEventListener('pointermove', warmLook, { once: true, passive: true })
    return () => window.removeEventListener('pointermove', warmLook)
  }, [])

  // Клик мимо меню и Esc закрывают его.
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const phrase = useMemo(() => {
    if (mode === 'login') return 'Привет! Войдите через Telegram — и начнём'
    if (mode === 'local') return 'Локальный режим: черновики живут в браузере'
    if (!hasChannels) return 'Создайте первый канал — и начнём'
    if (!pipeline.tovReady) return 'Сначала разберу ваш стиль'
    if (pipeline.published) return 'Опубликовано! Отличная работа'
    const issueHint = issuePhrase(pipeline.topIssue)
    if (issueHint) return issueHint
    if (typeof pipeline.score === 'number') {
      if (pipeline.score >= 80) return 'Хорошо! Пара мелочей — и можно публиковать'
      if (pipeline.score >= 60) return 'Неплохо, но нужно добавить пару деталей'
      return 'Давайте усилим текст: есть что поправить'
    }
    const currentScreenPhrase = screenPhrase(view)
    if (currentScreenPhrase) return currentScreenPhrase
    if (pipeline.hasDraft) return 'Отлично, черновик готов'
    return 'Накидайте 4–6 мыслей — соберу черновик'
  }, [mode, hasChannels, pipeline, view])

  const baseMood = useMemo(() => {
    if (dragging) return 'working'
    // Длинный текст или много замечаний — питомец устал вместе с автором.
    if ((pipeline.textLength || 0) > 4000 || (pipeline.issueCount || 0) >= 6) return 'tired'
    if (!hasChannels || !pipeline.tovReady || view !== 'pipeline') return 'thinking'
    if (pipeline.hasDraft || typeof pipeline.score === 'number') return 'working'
    return 'hello'
  }, [dragging, hasChannels, pipeline, view])

  // Таймер радости важнее базового настроения, но проходит сам.
  const mood = moodBoost ?? baseMood

  const BubbleIcon = moodIcon(mood)

  const resetPosition = useCallback(() => {
    savePos(null)
    setPos(null)
    setOpen(false)
  }, [])

  const actions = useMemo(() => {
    const list = []
    if (mode === 'login') {
      if (onLogin) list.push({ key: 'login', label: 'Войти через Telegram', icon: LogIn, run: onLogin })
      if (onUseLocal) list.push({ key: 'local', label: 'Работать локально', icon: MonitorCog, run: onUseLocal })
    } else if (mode === 'local') {
      list.push({ key: 'what', label: 'Что дальше?', icon: Sparkles, run: () => showFlash(phrase) })
    } else if (!hasChannels) {
      list.push({ key: 'create', label: 'Создать первый канал', icon: Sparkles, run: onCreateChannel })
    } else if (!pipeline.tovReady) {
      list.push({ key: 'style', label: 'Разобрать стиль', icon: Wand2, run: () => onStep(1) })
    } else if (!pipeline.hasDraft) {
      list.push({ key: 'draft', label: 'Собрать черновик', icon: FileText, run: () => onStep(2) })
    } else {
      list.push({ key: 'check', label: 'Проверить черновик', icon: ShieldCheck, run: () => onStep(4) })
    }

    if (mode === 'app') {
      list.push({ key: 'what', label: 'Что дальше?', icon: Sparkles, run: () => showFlash(phrase) })
      if (pipeline.topIssue?.quote) {
        list.push({ key: 'issue', label: 'Открыть замечание', icon: ShieldCheck, run: () => onStep(4) })
      }
      list.push({
        key: 'cookies',
        label: `Печенек: ${cookies}`,
        icon: Cookie,
        run: () => showFlash(cookies > 0 ? `Съедено печенек: ${cookies}. Спасибо!` : 'Печенек пока нет — опубликуйте пост, и я угощусь'),
      })
      list.push({ key: 'rules', label: 'Настроить правила', icon: Settings2, run: () => onView('settings') })
    }
    if (pos) {
      list.push({ key: 'reset', label: 'Вернуть на место', icon: RotateCcw, run: resetPosition })
    }
    list.push({
      key: 'hide',
      label: 'Не сейчас',
      icon: EyeOff,
      run: () => {
        setHiddenUntil(hidePetFor())
        setOpen(false)
        emitPetSignal('pet-hidden', {})
      },
    })
    return list
  }, [mode, hasChannels, pipeline, phrase, pos, cookies, onCreateChannel, onStep, onView, onLogin, onUseLocal, showFlash, resetPosition])

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button > 0) return
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    dragState.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
      pointerId: event.pointerId,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event) => {
    const drag = dragState.current
    if (!drag.active) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      drag.moved = true
      setDragging(true)
      setOpen(false)
    }
    const next = clampPos(drag.originX + dx, drag.originY + dy, drag.width, drag.height)
    drag.lastPos = next
    setPos(next)
  }

  const onPointerUp = (event) => {
    const drag = dragState.current
    if (!drag.active) return
    drag.active = false
    try {
      event.currentTarget.releasePointerCapture?.(drag.pointerId)
    } catch {
      // захват уже снят
    }
    setDragging(false)
    if (drag.moved) {
      suppressClick.current = true
      // Сохраняем именно ту позицию, которую видел пользователь в конце drag.
      savePos(drag.lastPos ?? posRef.current)
    }
  }

  if (hiddenUntil > Date.now()) {
    // Не исчезаем бесследно: маленькая кнопка в углу возвращает помощника.
    return (
      <button
        type="button"
        className="pet-companion-restore"
        onClick={() => {
          showPet()
          setHiddenUntil(petHiddenUntil())
          window.dispatchEvent(new Event('blogos:pet-restored'))
        }}
        title="Вернуть питомца"
        aria-label="Вернуть питомца"
      >
        <Icon as={EyeOff} size="sm" />
        <span>Вернуть</span>
      </button>
    )
  }

  const bubbleVisible = open || hovered || Boolean(flash)
  const bubbleText = flash ?? phrase
  const frame = mood === 'happy'
    ? FRAMES.happy
    : mood === 'tired'
      ? FRAMES.tired
      : blink ? FRAMES.blink : look === 'left' ? FRAMES.left : look === 'right' ? FRAMES.right : FRAMES.idle
  const nearTop = Boolean(pos && pos.y < window.innerHeight * 0.38)
  const nearLeft = Boolean(pos && pos.x < 280)

  return (
    <div
      className="pet-companion"
      ref={rootRef}
      data-open={open}
      data-dragging={dragging}
      data-look={look}
      data-mood={mood}
      data-vertical={nearTop ? 'down' : 'up'}
      data-side={nearLeft ? 'left' : 'right'}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {bubbleVisible && (
        <div className="pet-companion-bubble" role="status" aria-live="polite">
          <Icon as={BubbleIcon} size="sm" />
          <span>{bubbleText}</span>
          {!open && (
            <button
              type="button"
              className="pet-companion-bubble-close"
              onClick={() => { setHovered(false); setFlash(null) }}
              aria-label="Скрыть подсказку"
            >
              <Icon as={X} size="sm" />
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="pet-companion-menu" role="menu" aria-label="Действия помощника">
          <div className="pet-companion-menu-head">
            <strong>Помощник</strong>
            <span className="faint">
              {cookies > 0 ? `Печеньки: ${cookies}` : mode === 'login' ? 'Вход' : channel ? channel.name : 'Нет канала'}
            </span>
          </div>
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className="pet-companion-action"
              onClick={() => {
                setOpen(false)
                action.run?.()
              }}
            >
              <Icon as={action.icon} size="sm" />
              <span>{action.label}</span>
              <Icon as={ArrowRight} size="sm" />
            </button>
          ))}
        </div>
      )}

      {cookieFlash && (
        <span className="pet-companion-cookie" aria-hidden="true">
          <Icon as={Cookie} size="sm" />
        </span>
      )}

      <button
        type="button"
        ref={buttonRef}
        className="pet-companion-button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          setOpen((value) => !value)
        }}
        aria-label={`Питомец BlogOS: ${phrase}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Помощник: подскажет следующий шаг. Можно перетащить"
      >
        <img
          className="pet-companion-image"
          src={frame}
          alt=""
          width="92"
          height="92"
          draggable={false}
          decoding="async"
          onError={(event) => {
            if (event.currentTarget.dataset.fallback === 'true') return
            event.currentTarget.dataset.fallback = 'true'
            event.currentTarget.src = FALLBACK_FRAME
          }}
        />
      </button>
    </div>
  )
}
