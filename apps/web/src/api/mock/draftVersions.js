/**
 * Мок истории версий черновика.
 *
 * Серверных методов ещё нет — контракт описан в отчёте, раздел «Контракт API
 * для напарника». Формы запросов и ответов повторяют остальной API: списки
 * приходят как `{ items, next_cursor }`, идентификаторы — строки, даты — ISO.
 *
 * Хранилище — localStorage, ключ `blogos.mock.draftVersions.v1`:
 * `{ [draftId]: Version[] }`, свежие в начале. На сервере это станет
 * таблицей `draft_versions` (см. контракт), поэтому поля названы так же.
 *
 * Здесь нет ни одного настоящего запроса — это осознанно: мок и сеть
 * не должны встречаться в одном модуле.
 */
import { delay, mockError } from './index.js'

const KEY = 'blogos.mock.draftVersions.v1'
const MAX_PER_DRAFT = 30

function readAll() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* приватный режим или переполнение: история не сохранится,
       экран от этого не ломается */
  }
}

function listFor(draftId) {
  const all = readAll()
  const list = all[String(draftId)]
  return Array.isArray(list) ? list : []
}

/** Следующий номер версии в рамках черновика. */
function nextNumber(list) {
  return list.reduce((max, item) => Math.max(max, Number(item.version) || 0), 0) + 1
}

export const draftVersions = {
  /** `GET /drafts/{draftId}/versions` → `{ items, next_cursor }` */
  async list(draftId, { limit = 20 } = {}) {
    await delay()
    const items = listFor(draftId).slice(0, limit)
    return { items, next_cursor: null }
  },

  /** `GET /draft-versions/{id}` → версия целиком */
  async get(versionId) {
    await delay()
    const all = readAll()
    for (const list of Object.values(all)) {
      const found = (list || []).find((item) => String(item.id) === String(versionId))
      if (found) return found
    }
    throw mockError(404, 'not_found', 'Версия не найдена')
  },

  /**
   * `POST /drafts/{draftId}/versions` — снимок текущего текста.
   *
   * На сервере снимок будет делаться внутри `PATCH /drafts/{id}`, до записи
   * нового текста. Здесь его зовёт клиент — поведение то же.
   * Одинаковый текст подряд не сохраняется: история не должна расти
   * от повторных нажатий «Сохранить».
   */
  async create(draftId, { text, title = null, origin = 'author' } = {}) {
    await delay(120)
    const value = String(text ?? '')
    if (!value.trim()) throw mockError(422, 'unprocessable', 'Пустой текст не версионируется')

    const all = readAll()
    const list = listFor(draftId)
    if (list[0] && list[0].text === value) return list[0]

    const version = {
      id: `mv_${draftId}_${Date.now()}`,
      draft_id: String(draftId),
      version: nextNumber(list),
      text: value,
      title,
      origin,
      chars: value.length,
      created_at: new Date().toISOString(),
    }
    all[String(draftId)] = [version, ...list].slice(0, MAX_PER_DRAFT)
    writeAll(all)
    return version
  },

  /**
   * `POST /draft-versions/{id}/restore` → `{ draft, restored_from }`
   *
   * Возврат не стирает текущий текст: перед подменой он сам становится
   * версией. Поэтому «вернуть» всегда обратимо.
   *
   * Мок возвращает только `restored_from` и текст — записать его в черновик
   * должен настоящий `PATCH /drafts/{id}`, его делает экран.
   */
  async restore(versionId) {
    await delay(120)
    const version = await this.get(versionId)
    return { restored_from: version.version, text: version.text, title: version.title }
  },

  /** `DELETE /draft-versions/{id}` → `204` */
  async remove(versionId) {
    await delay(120)
    const all = readAll()
    for (const [draftId, list] of Object.entries(all)) {
      const next = (list || []).filter((item) => String(item.id) !== String(versionId))
      if (next.length !== (list || []).length) {
        all[draftId] = next
        writeAll(all)
        return null
      }
    }
    throw mockError(404, 'not_found', 'Версия не найдена')
  },
}

export default draftVersions
