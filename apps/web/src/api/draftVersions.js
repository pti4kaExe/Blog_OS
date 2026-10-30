/**
 * История версий черновика — фасад.
 *
 * Экраны импортируют только отсюда и не знают, откуда приходят данные.
 * Пока серверных методов нет, работает мок; когда напарник их сделает,
 * достаточно выключить `MOCKS_ENABLED` — ни один экран не меняется.
 *
 * Это единственное место, где встречаются оба источника, и встречаются они
 * одной строкой выбора — без общей логики и без условий внутри запросов.
 */
import api from './client.js'
import { MOCKS_ENABLED } from './mock/index.js'
import mockDraftVersions from './mock/draftVersions.js'

export const draftVersionsAreMocked = MOCKS_ENABLED

export const draftVersions = MOCKS_ENABLED ? mockDraftVersions : api.draftVersions

export default draftVersions
