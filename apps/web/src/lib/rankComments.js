/**
 * Ранжирование ленты CommentRadar в облачном режиме.
 *
 * ТЗ (раздел 4, сценарий «Поиск обсуждений») требует отсортированный список
 * обсуждений «по релевантности и свежести». Локальный режим это делает —
 * облачный выдавал ленту в порядке сервера (`posted_at DESC`).
 *
 * Считаем на клиенте по той же функции движка, что и локальный режим
 * (`rankDiscussions`), чтобы два режима давали одинаковый порядок на
 * одинаковых данных. Сервер при этом не меняется: ему хватает отдавать ленту.
 *
 * Профиль стиля на сервере хранит полную карточку локального движка
 * в `tov_profiles.metrics` — включая `topTerms`, по которым и считается
 * пересечение с темами автора.
 */
import { rankDiscussions } from '../engine/radar.js'

const HOUR = 36e5

/** Профиль для движка: серверный `tov.metrics` — это и есть карточка движка. */
export function engineProfile(tov) {
  if (!tov) return null
  const metrics = tov.metrics && typeof tov.metrics === 'object' ? tov.metrics : null
  if (!metrics || !Array.isArray(metrics.topTerms)) return null
  return metrics
}

/** Комментарий сервера → обсуждение в терминах движка. */
function toDiscussion(comment, sourceName, now) {
  const stamp = Date.parse(comment.posted_at || comment.created_at || '') || now
  const text = comment.text || ''
  return {
    id: String(comment.id),
    text,
    author: comment.commenter_name || 'Читатель',
    source: sourceName || 'Источник',
    hoursAgo: Math.max(0, Math.round((now - stamp) / HOUR)),
    replies: Number(comment.responses_count) || 0,
    kind: text.includes('?') ? 'question' : 'opinion',
  }
}

/**
 * Возвращает комментарии в порядке релевантности, дополнив каждый полями
 * `matchScore`, `matchedTerms`, `reason` и `hoursAgo`.
 *
 * Без профиля стиля порядок сервера сохраняется: движок в этом случае
 * ничего не сортирует, и выдумывать свою сортировку незачем.
 */
export function rankComments(comments, tov, sourceName, now = Date.now()) {
  if (!Array.isArray(comments) || comments.length === 0) return []
  const profile = engineProfile(tov)
  const discussions = comments.map((comment) => toDiscussion(comment, sourceName, now))
  const ranked = rankDiscussions(discussions, profile)
  const byId = new Map(comments.map((comment) => [String(comment.id), comment]))
  return ranked
    .map((item) => {
      const comment = byId.get(item.id)
      if (!comment) return null
      return {
        ...comment,
        matchScore: item.matchScore,
        matchedTerms: item.matchedTerms || [],
        reason: item.reason,
        hoursAgo: item.hoursAgo,
      }
    })
    .filter(Boolean)
}

/** Сколько обсуждений пересекается с темами автора. */
export function matchedCount(ranked) {
  return ranked.filter((item) => Number(item.matchScore) > 0).length
}
