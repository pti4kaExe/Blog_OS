/**
 * CommentRadar — находит в ленте обсуждения, близкие к темам автора,
 * и готовит черновик комментария, опираясь на его же прошлые посты.
 *
 * Релевантность и черновик считаются локально. Финальное решение —
 * публиковать или нет — всегда остаётся за человеком.
 */
import { contentStems, sentences, words, capitalize } from './text.js'

/**
 * Сортирует обсуждения по близости к темам автора.
 * @param {object[]} discussions лента (в MVP — демо-данные)
 * @param {object|null} profile профиль стиля автора
 */
export function rankDiscussions(discussions, profile) {
  if (!profile) return discussions.map((d) => ({ ...d, matchScore: null, matchedTerms: [], reason: 'Профиль стиля не задан' }))

  const weights = new Map()
  const labels = new Map()
  for (const t of profile.topTerms) {
    weights.set(t.stem, t.weight)
    labels.set(t.stem, t.label)
  }

  const scored = discussions.map((d) => {
    const stems = contentStems(d.text)
    const seen = new Map()
    let raw = 0
    for (const st of stems) {
      const w = weights.get(st)
      if (!w) continue
      raw += seen.has(st) ? w * 0.3 : w
      seen.set(st, (seen.get(st) || 0) + 1)
    }
    const norm = raw / Math.sqrt(Math.max(stems.length, 8))
    const freshness = d.hoursAgo <= 6 ? 1.15 : d.hoursAgo <= 24 ? 1 : 0.85
    return {
      ...d,
      rawScore: norm * freshness,
      matchedTerms: [...seen.keys()].map((st) => labels.get(st)).filter(Boolean).slice(0, 5),
    }
  })

  const best = Math.max(...scored.map((s) => s.rawScore), 0.0001)
  return scored
    .map((s) => ({
      ...s,
      matchScore: Math.round((s.rawScore / best) * 100),
      reason: buildReason(s),
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
}

function buildReason(d) {
  if (!d.matchedTerms.length) return 'Нет пересечений с вашими темами'
  const when = d.hoursAgo <= 6 ? 'обсуждение свежее' : d.hoursAgo <= 24 ? 'обсуждение сегодняшнее' : 'обсуждение вчерашнее'
  return `Совпадает с вашими темами: ${d.matchedTerms.join(', ')}. ${capitalize(when)}, ${d.replies} ответов.`
}

/**
 * Черновик комментария: опора на собственный опыт автора из его прошлых постов.
 * Движок не выдумывает факты за автора — вместо этого оставляет явный пропуск,
 * который человек заполняет сам. Решение публиковать всегда за человеком.
 */
export function draftComment(discussion, profile) {
  if (!profile) return { text: '', evidence: null, parts: [] }

  const evidence = retrieveEvidence(discussion, profile)
  const informal = profile.address !== 'вы'
  const parts = []

  parts.push({
    kind: 'opener',
    text: discussion.kind === 'question' ? 'Отвечу из своего опыта.' : 'Соглашусь частично — есть нюанс.',
  })

  if (evidence) {
    parts.push({ kind: 'evidence', text: evidence.quote, source: `ваш пост №${evidence.postIndex + 1}` })
  }

  parts.push({
    kind: 'gap',
    text: discussion.kind === 'question'
      ? '[дополните: что именно сработало у меня и в каких условиях]'
      : '[дополните: в каком случае этот вывод у меня не работает]',
  })

  if (profile.questionShare >= 8) {
    parts.push({ kind: 'question', text: informal ? 'А у тебя как это устроено?' : 'А у вас как это устроено?' })
  }

  return { text: parts.map((p) => p.text).join(' '), evidence, parts }
}

/** Остались ли в комментарии незаполненные пропуски. */
export function hasGaps(text) {
  return /\[[^\]]*\]/.test(String(text))
}

/** Достаёт из прошлых постов автора предложение, ближе всего к теме обсуждения. */
export function retrieveEvidence(discussion, profile) {
  const target = new Set(contentStems(discussion.text))
  let best = null
  profile.samples.forEach((sample, postIndex) => {
    for (const s of sentences(sample)) {
      const ws = words(s.text)
      if (ws.length < 6 || ws.length > 26) continue
      const stems = contentStems(s.text)
      if (!stems.length) continue
      const overlap = stems.filter((st) => target.has(st)).length
      if (!overlap) continue
      let score = overlap / Math.sqrt(stems.length)
      // в комментарии полезнее личный опыт и цифры, а не риторический вопрос
      const personal = /(?<![а-яёa-z])(я|мне|меня|мой|моя|мои|у меня)(?![а-яёa-z])/iu.test(s.text)
      if (personal || /\d/.test(s.text)) score *= 1.5
      if (s.text.trim().endsWith('?')) score *= 0.4
      if (/^(меня спрашивают|многие спрашивают)/i.test(s.text.trim())) score *= 0.4
      if (!best || score > best.score) best = { score, quote: s.text.trim(), postIndex }
    }
  })
  return best
}
