/**
 * BlogOS — тема оформления.
 *
 * Три состояния выбора: «система», «светлая», «тёмная».
 * «Система» — значение по умолчанию: интерфейс идёт за настройкой ОС и
 * переключается, когда она меняется, без перезагрузки страницы.
 *
 * Выбор хранится в localStorage; до загрузки скрипта тему успевает
 * проставить короткий скрипт в index.html — иначе светлая тема мигала бы
 * тёмным кадром на старте.
 */

import { useCallback, useEffect, useState } from 'react'

export const THEME_KEY = 'blogos.theme.v1'
export const THEMES = ['system', 'light', 'dark']

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** Что выбрано пользователем: system | light | dark. */
export function readPreference() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return THEMES.includes(stored) ? stored : 'system'
  } catch {
    /* приватный режим: выбор не прочитать, идём за системой */
    return 'system'
  }
}

/** Во что выбор разворачивается прямо сейчас: light | dark. */
export function resolveTheme(preference = readPreference()) {
  if (preference === 'light' || preference === 'dark') return preference
  return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark'
}

/**
 * Проставляет тему на <html>.
 *
 * При смене на короткое время включается плавный переход цвета: резкий
 * скачок яркости читается как вспышка. При prefers-reduced-motion
 * переключение мгновенное.
 */
export function applyTheme(resolved, { animate = false } = {}) {
  const root = document.documentElement
  const smooth = animate
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (smooth) {
    root.classList.add('theme-switching')
    window.setTimeout(() => root.classList.remove('theme-switching'), 280)
  }
  root.setAttribute('data-theme', resolved)
}

/* Подписчики на смену темы.
   Хук вызывается из нескольких мест (переключатель в шапке и палитра
   команд), и каждому нужно одно и то же значение. Без общего оповещения
   экземпляры расходятся: тема меняется, а переключатель показывает старый
   выбор. Контекст ради одного значения здесь избыточен. */
const listeners = new Set()

function broadcast(preference) {
  for (const listener of listeners) listener(preference)
}

/**
 * Хук темы.
 *
 *   const { preference, resolved, setPreference } = useTheme()
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState(readPreference)
  const [resolved, setResolved] = useState(() => resolveTheme())

  useEffect(() => {
    const listener = (next) => {
      setPreferenceState(next)
      setResolved(resolveTheme(next))
    }
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  /* Пока выбрана «система» — слушаем ОС и ходим за ней. */
  useEffect(() => {
    if (preference !== 'system') return undefined
    const media = window.matchMedia(LIGHT_QUERY)
    const onChange = () => {
      const next = media.matches ? 'light' : 'dark'
      setResolved(next)
      applyTheme(next, { animate: true })
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((next) => {
    const value = THEMES.includes(next) ? next : 'system'
    setPreferenceState(value)
    try {
      localStorage.setItem(THEME_KEY, value)
    } catch {
      /* приватный режим: выбор не сохранится, тема всё равно применится */
    }
    const nextResolved = resolveTheme(value)
    setResolved(nextResolved)
    applyTheme(nextResolved, { animate: true })
    broadcast(value)
  }, [])

  return { preference, resolved, setPreference }
}
