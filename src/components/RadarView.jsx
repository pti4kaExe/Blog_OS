import { useEffect, useMemo, useState } from 'react'
import { draftComment, hasGaps, rankDiscussions } from '../engine/radar.js'
import { lint } from '../engine/anticringe.js'
import { DEMO_DISCUSSIONS } from '../engine/demoData.js'
import { CopyButton, Notice, ScoreRing, Tag } from './ui.jsx'

const PART_LABELS = {
  opener: 'вход',
  evidence: 'ваш опыт',
  gap: 'заполнить',
  question: 'вопрос',
}

/**
 * CommentRadar. Находит в ленте обсуждения, близкие к темам автора,
 * и готовит основу комментария из его же прошлых постов.
 * Публикует всегда человек — черновик нужно дополнить.
 */
export default function RadarView({ profile, approved, setApproved }) {
  const ranked = useMemo(() => rankDiscussions(DEMO_DISCUSSIONS, profile), [profile])
  const [selectedId, setSelectedId] = useState(null)
  const [comment, setComment] = useState('')

  const selected = ranked.find((d) => d.id === selectedId) || null
  const draft = useMemo(
    () => (selected && profile ? draftComment(selected, profile) : null),
    [selected, profile],
  )

  useEffect(() => {
    setComment(draft ? draft.text : '')
  }, [draft])

  const report = useMemo(
    () => (comment.trim().split(/\s+/).length >= 5 ? lint(comment, profile) : null),
    [comment, profile],
  )

  const approve = () => {
    if (!selected) return
    setApproved([
      { id: `${selected.id}-${Date.now()}`, discussionId: selected.id, source: selected.source, text: comment },
      ...approved,
    ])
    setSelectedId(null)
    setComment('')
  }

  if (!profile) {
    return (
      <section className="card">
        <div className="card-head">
          <div>
            <h2>CommentRadar</h2>
            <p>Сначала нужен профиль стиля — он определяет и темы, и голос комментария.</p>
          </div>
        </div>
        <div className="empty">Перейдите в «Конвейер» → шаг «Стиль».</div>
      </section>
    )
  }

  return (
    <>
      <div className="card-head" style={{ marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>CommentRadar</h1>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            Обсуждения отсортированы по совпадению с вашими темами. Черновик собирается из ваших прошлых постов.
          </p>
        </div>
        <div className="spacer" />
        <Tag kind="demo">лента — демо-данные</Tag>
      </div>

      <div className="grid-radar">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Лента обсуждений</h2>
              <p>{ranked.filter((d) => d.matchScore > 0).length} из {ranked.length} пересекаются с вашими темами</p>
            </div>
          </div>

          <div className="disc-list">
            {ranked.map((d) => {
              const done = approved.some((a) => a.discussionId === d.id)
              return (
                <button
                  type="button"
                  className="disc"
                  key={d.id}
                  aria-pressed={selectedId === d.id}
                  onClick={() => setSelectedId(selectedId === d.id ? null : d.id)}
                >
                  <div className="disc-top">
                    <span className="disc-src">{d.source} · {d.author} · {d.hoursAgo} ч назад</span>
                    <span className="disc-score">{d.matchScore}%</span>
                  </div>
                  <div className="disc-text">{d.text}</div>
                  <div className="disc-why">{d.reason}</div>
                  {done && <div className="disc-done">✓ комментарий одобрен</div>}
                </button>
              )
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Черновик комментария</h2>
              <p>Основа из ваших постов. Факты за вас движок не выдумывает.</p>
            </div>
          </div>

          {!selected ? (
            <div className="empty">Выберите обсуждение слева.</div>
          ) : (
            <>
              <div className="comment-parts">
                {draft.parts.map((p, i) => (
                  <div className="cpart" data-kind={p.kind} key={i}>
                    <span className="cpart-kind">{PART_LABELS[p.kind]}</span>
                    <span className="cpart-text">
                      {p.text}
                      {p.source && <span className="faint"> — {p.source}</span>}
                    </span>
                  </div>
                ))}
              </div>

              <textarea
                className="ta"
                style={{ minHeight: 150 }}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />

              {hasGaps(comment) && (
                <div style={{ marginTop: 12 }}>
                  <Notice kind="warn">
                    В черновике остался пропуск в квадратных скобках. Заполните его своим примером — иначе
                    комментарий будет шаблонным.
                  </Notice>
                </div>
              )}

              {report && !report.empty && (
                <div className="score-wrap" style={{ marginTop: 16 }}>
                  <ScoreRing score={report.score} tone={report.score >= 85 ? 'good' : report.score >= 70 ? 'ok' : 'warn'} />
                  <div>
                    <div className="grade" data-tone={report.score >= 85 ? 'good' : report.score >= 70 ? 'ok' : 'warn'}>
                      AntiCringe: {report.grade.label}
                    </div>
                    <div className="faint">
                      {report.issues.length === 0
                        ? 'Комментарий чистый'
                        : report.issues.map((i) => i.title).join(', ')}
                    </div>
                  </div>
                </div>
              )}

              <div className="btn-row" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={approve}
                  disabled={hasGaps(comment) || comment.trim().length < 20}
                >
                  Одобрить комментарий
                </button>
                <CopyButton text={comment} />
              </div>
            </>
          )}

          {approved.length > 0 && (
            <>
              <h3 style={{ marginTop: 22 }}>Одобрено вами ({approved.length})</h3>
              <div className="approved-list">
                {approved.map((a) => (
                  <div className="approved" key={a.id}>
                    <div className="faint" style={{ marginBottom: 4 }}>{a.source}</div>
                    {a.text}
                    <div className="btn-row" style={{ marginTop: 8 }}>
                      <CopyButton text={a.text} label="Скопировать" />
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setApproved(approved.filter((x) => x.id !== a.id))}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </>
  )
}
