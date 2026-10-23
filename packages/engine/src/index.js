/**
 * Точка входа пакета движков.
 *
 * Все движки — чистые функции: на вход текст и профиль стиля, на выход данные.
 * Ни сети, ни DOM, ни React: поэтому один и тот же код исполняется в браузере
 * (Шаги 1—4 прототипа) и на сервере (первый слой проверки и откат при отказе LLM).
 *
 * Зависимости однонаправленные, без циклов:
 *   text.js → styleProfile.js → narrative.js / anticringe.js / radar.js
 */
export * from './text.js'
export * from './styleProfile.js'
export * from './narrative.js'
export * from './anticringe.js'
export * from './radar.js'
export * from './rules.js'
export * from './demoData.js'
