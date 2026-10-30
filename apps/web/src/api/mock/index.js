/**
 * Слой моков — единственный переключатель.
 *
 * Здесь живут функции, для которых серверного метода ещё нет. Правило одно:
 * мок никогда не стоит рядом с настоящим запросом в одном модуле. Настоящие
 * вызовы — в `api/client.js`, моки — в этой папке, выбор между ними — в
 * фасадах (`api/draftVersions.js`).
 *
 * Как выключить, когда напарник сделает методы:
 *
 *   1. поставить `MOCKS_ENABLED = false` (или `VITE_MOCKS=0` при сборке);
 *   2. убедиться, что экраны работают;
 *   3. удалить папку `api/mock` и условие в фасаде.
 *
 * Экраны при этом не трогаются: они знают только фасад.
 *
 * Что сейчас на моках:
 *   - история версий черновика (`api/mock/draftVersions.js`).
 */

const flag = import.meta && import.meta.env ? import.meta.env.VITE_MOCKS : undefined

/** `true` — функции без API работают на моках. `VITE_MOCKS=0` выключает. */
export const MOCKS_ENABLED = String(flag ?? '1') !== '0'

/** Задержка, чтобы состояния загрузки на экранах были настоящими. */
export function delay(ms = 180) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Ошибка в том же конверте, что у настоящего клиента, — экраны разбирают
 * её тем же `apiErrorMessage`.
 */
export function mockError(status, code, message, details = null) {
  const error = new Error(message)
  error.name = 'ApiError'
  error.status = status
  error.code = code
  error.details = details
  error.offline = false
  return error
}
