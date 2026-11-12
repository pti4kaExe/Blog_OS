/**
 * Настройки питомца: звук, прогулки и печеньки.
 *
 * Это игрушечные предпочтения, а не бизнес-логика: хранятся в localStorage,
 * переживают перезагрузку и не синхронизируются между устройствами.
 */

const SOUND_KEY = 'blogos.pet.sound.v1'
const WANDER_KEY = 'blogos.pet.wander.v1'
const COOKIES_KEY = 'blogos.pet.cookies.v1'
const PREFS_EVENT = 'blogos:pet-prefs'

function readBool(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return raw !== '0' && raw !== 'false'
  } catch {
    return fallback
  }
}

function writeBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // приватный режим — настройка живёт до перезагрузки
  }
  emitPrefs()
}

function emitPrefs() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PREFS_EVENT))
}

/** Звуки питомца: по умолчанию включены. */
export function petSoundEnabled() {
  return readBool(SOUND_KEY, true)
}

export function setPetSound(enabled) {
  writeBool(SOUND_KEY, enabled)
}

/** Прогулка по экрану: по умолчанию включена. */
export function petWanderEnabled() {
  return readBool(WANDER_KEY, true)
}

export function setPetWander(enabled) {
  writeBool(WANDER_KEY, enabled)
}

/** Счётчик съеденных печенек. */
export function petCookies() {
  try {
    const value = Number(localStorage.getItem(COOKIES_KEY))
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  } catch {
    return 0
  }
}

export function addPetCookie() {
  const next = petCookies() + 1
  try {
    localStorage.setItem(COOKIES_KEY, String(next))
  } catch {
    // не сохранилось — счётчик обновится в интерфейсе
  }
  emitPrefs()
  return next
}

/** Подписка на изменения настроек (тумблеры в настройках). */
export function subscribePetPrefs(listener) {
  if (typeof window === 'undefined') return () => {}
  const handler = () => listener()
  window.addEventListener(PREFS_EVENT, handler)
  return () => window.removeEventListener(PREFS_EVENT, handler)
}
