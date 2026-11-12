import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, EyeOff, FileText, Settings2, ShieldCheck, Sparkles, Wand2, X,
} from 'lucide-react'
import { Icon } from '../ui/Icon.jsx'
import {
  emitPetSignal, hidePetFor, lastPetSignal, petHiddenUntil, subscribePet,
} from '../../lib/petSignals.js'

// Облегчённые версии: 256 px для десктопа, 128 px для мобилы.
const PET_SRC = `${import.meta.env.BASE_URL}blogos-pet-cat-256.png`
const PET_SRC_SMALL = `${import.meta.env.BASE_URL}blogos-pet-cat-128.png`

/**
 * Питомец BlogOS — живой помощник, а не украшение.
 *
 * Что он делает:
 *  - говорит короткую фразу по текущему состоянию (нет канала, не разобран
 *    стиль, пустые заметки, готовый черновик, результат проверки);
 *  - по клику открывает меню реальных действий: «Что дальше?», переход к
 *    нужному шагу конвейера, настройки правил, «Не сейчас»;
 *  - реагирует на события конвейера через petSignals (сигналы шлют
 *    CloudPipeline и CloudCheckStep), поэтому не выдумывает состояние.
 *
 * Прячется на 24 часа по «Не сейчас», возвращается из настроек или сам по
 * истечении срока. Уважает prefers-reduced-motion (анимации только в CSS,
 * при reduce — отключены).
 */
export default function PetCompanion({
  hasChannels, channel, view, onCreateChannel, onView, onStep,
}) {
  const [hiddenUntil, setHiddenUntil] = useState(petHiddenUntil)
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [flash, setFlash] = useState(null)
  const [pipeline, setPipeline] = useState(() => {
    const signal = lastPetSignal()
    return signal?.type === 'pipeline-state' ? signal.payload : {}
  })
  const rootRef = useRef(null)
  const flashTimer = useRef(null)

  // Сигналы конвейера и проверки.
  useEffect(() => subscribePet((signal) => {
    if (signal.type === 'pipeline-state') {
      setPipeline((prev) => ({ ...prev, ...signal.payload }))
      return
    }
    if (signal.type === 'lint-ready') {
      setPipeline((prev) => ({ ...prev, ...signal.payload, published: false }))
      showFlash('Проверка готова — смотрите замечания')
      return
    }
    if (signal.type === 'published') {
      setPipeline((prev) => ({ ...prev, published: true }))
      showFlash('Опубликовано! Отличная работа')
      return
    }
    if (signal.type === 'draft-ready') {
      setPipeline((prev) => ({ ...prev, hasDraft: true }))
      showFlash('Отлично, черновик готов')
    }
  }), [])

  // Вернули из настроек — сразу показываемся.
  useEffect(() => {
    const onRestore = () => setHiddenUntil(petHiddenUntil())
    window.addEventListener('blogos:pet-restored', onRestore)
    return () => window.removeEventListener('blogos:pet-restored', onRestore)
  }, [])

  const showFlash = useCallback((text) => {
    setFlash(text)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 5000)
  }, [])

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

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
    if (!hasChannels) return 'Создайте первый канал — и начнём'
    if (!pipeline.tovReady) return 'Сначала разберу ваш стиль'
    if (pipeline.published) return 'Опубликовано! Отличная работа'
    if (typeof pipeline.score === 'number') {
      if (pipeline.score >= 80) return 'Хорошо! Пара мелочей — и можно публиковать'
      if (pipeline.score >= 60) return 'Неплохо, но нужно добавить пару деталей'
      return 'Давайте усилим текст: есть что поправить'
    }
    if (pipeline.hasDraft) return 'Отлично, черновик готов'
    if (view !== 'pipeline') return 'Вернёмся к конвейеру поста?'
    return 'Накидайте 4–6 мыслей — соберу черновик'
  }, [hasChannels, pipeline, view])

  const actions = useMemo(() => {
    const list = []
    if (!hasChannels) {
      list.push({ key: 'create', label: 'Создать первый канал', icon: Sparkles, run: onCreateChannel })
    } else if (!pipeline.tovReady) {
      list.push({ key: 'style', label: 'Разобрать стиль', icon: Wand2, run: () => onStep(1) })
    } else if (!pipeline.hasDraft) {
      list.push({ key: 'draft', label: 'Собрать черновик', icon: FileText, run: () => onStep(2) })
    } else {
      list.push({ key: 'check', label: 'Проверить черновик', icon: ShieldCheck, run: () => onStep(4) })
    }
    list.push({ key: 'what', label: 'Что дальше?', icon: Sparkles, run: () => showFlash(phrase) })
    list.push({ key: 'rules', label: 'Настроить правила', icon: Settings2, run: () => onView('settings') })
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
  }, [hasChannels, pipeline, phrase, onCreateChannel, onStep, onView, showFlash])

  if (hiddenUntil > Date.now()) return null

  const bubbleVisible = open || hovered || Boolean(flash)
  const bubbleText = flash ?? phrase

  return (
    <div
      className="pet-companion"
      ref={rootRef}
      data-open={open}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {bubbleVisible && (
        <div className="pet-companion-bubble" role="status" aria-live="polite">
          <Icon as={Sparkles} size="sm" />
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
            <span className="faint">{channel ? channel.name : 'Нет канала'}</span>
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

      <button
        type="button"
        className="pet-companion-button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Питомец BlogOS: ${phrase}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Помощник: подскажет следующий шаг"
      >
        <img
          src={PET_SRC}
          srcSet={`${PET_SRC_SMALL} 128w, ${PET_SRC} 256w`}
          sizes="(max-width: 660px) 64px, 96px"
          alt=""
          width="96"
          height="96"
          loading="lazy"
          decoding="async"
        />
        <span className="pet-companion-ring" aria-hidden="true" />
      </button>
    </div>
  )
}
