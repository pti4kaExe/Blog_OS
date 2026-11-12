/**
 * Сигналы для питомца-помощника.
 *
 * Питомец живёт в CloudApp и не должен лезть в состояние конвейера напрямую:
 * конвейер и шаг проверки сообщают о событиях («черновик готов», «проверка X
 * баллов», «опубликовано»), а питомец решает, что сказать и какое действие
 * предложить. Без сигналов он опирается на контекст (канал, стиль, черновик).
 *
 * Хранение «скрыт на 24 часа» — здесь же: это часть поведения питомца,
 * а не бизнес-логика приложения.
 */

const listeners = new Set()
let lastSignal = null

/** Сообщить о событии (шаг проверки, готовый черновик, публикация). */
export function emitPetSignal(type, payload = {}) {
  lastSignal = { type, payload, at: Date.now() }
  for (const listener of listeners) {
    try {
      listener(lastSignal)
    } catch {
      // Падение одного подписчика не должно ломать сценарий.
    }
  }
  return lastSignal
}

/** Подписаться на сигналы. Возвращает функцию отписки. */
export function subscribePet(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Последний сигнал: нужен, если питомец смонтировался после события. */
export function lastPetSignal() {
  return lastSignal
}

// ─── «Не сейчас»: скрыть на 24 часа ────────────────────────────────────────
export const PET_HIDE_KEY = 'blogos.pet.hidden-until.v1'
export const PET_HIDE_MS = 24 * 60 * 60 * 1000

/** До какого времени питомец скрыт (0 — видим). */
export function petHiddenUntil() {
  try {
    const value = Number(localStorage.getItem(PET_HIDE_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

/** Скрыть питомца на 24 часа (или на заданный срок). */
export function hidePetFor(ms = PET_HIDE_MS) {
  const until = Date.now() + ms
  try {
    localStorage.setItem(PET_HIDE_KEY, String(until))
  } catch {
    // приватный режим — решение живёт до перезагрузки
  }
  return until
}

/** Вернуть питомца обратно (из настроек). */
export function showPet() {
  try {
    localStorage.removeItem(PET_HIDE_KEY)
  } catch {
    // нечего чистить
  }
}
