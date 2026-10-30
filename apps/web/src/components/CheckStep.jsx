import { useMemo, useState } from 'react'
import { CATEGORIES, applyFixes, isFixable, lint, scoreText } from '../engine/anticringe.js'
import { Bar, CharCounter, CopyButton, DownloadButton, Notice, ScoreRing, plural } from './ui.jsx'
import { AnimatePresence } from 'motion/react'
import { Reveal, Stagger } from './ui/Motion.jsx'

/* Локальный режим не знает про каналы и площадки, поэтому ориентир —
   Telegram: первая и пока единственная площадка целевой версии (ТЗ, раздел 3). */
const TELEGRAM_POST_LIMIT = 4096

/**
 * Шаг 4. AntiCringe: отчёт по черновику и применение правок.
 * Проверка пересчитывается на каждое изменение текста, поэтому прогресс виден сразу.
 */
export default function CheckStep({ text, setText, profile, baseline, setBaseline, onBack }) {
  const [hidden, setHidden] = useState(() => new Set())
  const [active, setActive] = useState(null)
  const [editing, setEditing] = useState(false)

  const report = useMemo(() => lint(text, profile), [text, profile])

  const visible = useMemo(
    () => report.issues.filter((i) => !hidden.has(i.id)),
    [report.issues, hidden],
  )

  const live = useMemo(() => {
    if (report.empty) return { score: null, categoryScores: {} }
    return scoreText(visible, report.metrics.words)
  }, [visible, report])

  const fixable = visible.filter(isFixable)

  const applyAll = () => {
    const result = applyFixes(text, fixable)
    if (baseline === null) setBaseline(report.score)
    setText(result.text)
    setActive(null)
  }

  const applyOne = (issue) => {
    const result = applyFixes(text, [issue])
    if (baseline === null) setBaseline(report.score)
    setText(result.text)
    setActive(null)
  }

  const hide = (issue) => {
    const next = new Set(hidden)
    next.add(issue.id)
    setHidden(next)
    if (active === issue.id) setActive(null)
  }

  const restoreHidden = () => setHidden(new Set())

  if (report.empty) {
    return (
      <section className="card">
        <div className="empty">Нет текста для проверки. Соберите пост или вставьте черновик на шаге «Заметки».</div>
      </section>
    )
  }

  const improved = baseline !== null && live.score !== null && live.score > baseline

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Итог проверки</h2>
            <p>{report.metrics.words} слов · {report.metrics.sentences} предложений · читаемость {report.metrics.readability}</p>
          </div>
        </div>

        <div className="score-wrap" style={{ marginBottom: 18 }}>
          <ScoreRing score={live.score} tone={toneFor(live.score)} />
          <div>
            <div className="grade" data-tone={toneFor(live.score)}>{gradeLabel(live.score)}</div>
            <div className="faint">
              {visible.length === 0
                ? 'Замечаний нет'
                : `${visible.length} ${plural(visible.length, 'замечание', 'замечания', 'замечаний')}`
                  + (fixable.length ? `, ${fixable.length} правятся автоматически` : ', автоправок нет')}
            </div>
            {improved && (
              <div className="improve" style={{ marginTop: 6 }}>
                <span className="muted">Было {baseline}</span>
                <b>→ {live.score}</b>
              </div>
            )}
          </div>

          <div className="cats">
            {Object.entries(CATEGORIES).map(([key, meta]) => {
              const value = live.categoryScores[key]?.score ?? 100
              return (
                <div className="cat" key={key} title={meta.hint}>
                  <span className="cat-name">{meta.label}</span>
                  <Bar value={value} tone={toneFor(value)} />
                  <span className="cat-num">{value}</span>
                </div>
              )
            })}
          </div>
        </div>

        {report.notes.map((n, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <Notice kind={n.kind === 'info' ? 'warn' : undefined}>{n.text}</Notice>
          </div>
        ))}

        <div className="card-head" style={{ marginTop: 18, marginBottom: 10 }}>
          <div>
            <h2 style={{ fontSize: 15 }}>Текст с пометками</h2>
          </div>
          <div className="spacer" />
          <div className="btn-row">
            {/* Лимит Telegram — та же подсказка, что в облачном режиме:
                привычка не должна зависеть от выбранного режима. */}
            <CharCounter value={text} limit={TELEGRAM_POST_LIMIT} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Готово' : 'Править вручную'}
            </button>
            <CopyButton text={text} />
            <DownloadButton text={text} filename="Пост BlogOS" />
          </div>
        </div>

        {editing ? (
          <textarea
            className="ta"
            style={{ minHeight: 280 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <div className="marked">
            {renderMarked(text, visible, active, setActive)}
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-primary" onClick={applyAll} disabled={!fixable.length}>
            Применить безопасные правки ({fixable.length})
          </button>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            ← Назад
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Замечания</h2>
            <p>Нажмите на замечание, чтобы найти его в тексте.</p>
          </div>
          <div className="spacer" />
          {hidden.size > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={restoreHidden}>
              Вернуть скрытые ({hidden.size})
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            Чисто. Текст прошёл все четыре проверки.
          </div>
        ) : (
          <Stagger className="issue-list">
            <AnimatePresence initial={false}>
            {visible.map((issue, index) => (
              <Reveal
                layout
                index={index}
                offset={8}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
                key={issue.id}
                className="issue"
                data-sev={issue.severity}
                data-active={active === issue.id}
                onClick={() => setActive(active === issue.id ? null : issue.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setActive(active === issue.id ? null : issue.id)
                  }
                }}
              >
                <div className="issue-top">
                  <span className="issue-title">{issue.title}</span>
                  <span className="issue-cat">{CATEGORIES[issue.category]?.label}</span>
                  {issue.quote && <span className="issue-quote">{issue.quote}</span>}
                </div>
                <div className="issue-msg">{issue.message}</div>
                {isFixable(issue) && (
                  <div className="issue-fix">
                    {issue.fix === '' ? 'Автоправка: убрать' : `Автоправка: заменить на «${issue.fix}»`}
                  </div>
                )}
                <div className="issue-actions">
                  {isFixable(issue) && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={(e) => { e.stopPropagation(); applyOne(issue) }}
                    >
                      Применить
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={(e) => { e.stopPropagation(); hide(issue) }}
                  >
                    Скрыть
                  </button>
                </div>
              </Reveal>
            ))}
            </AnimatePresence>
          </Stagger>
        )}

        {report.tovDeltas.length > 0 && (
          <>
            <h3 style={{ marginTop: 20 }}>Сравнение с вашим стилем</h3>
            <div className="deltas">
              {report.tovDeltas.map((d) => (
                <div className="delta" key={d.key}>
                  <span className="delta-name">{d.label}</span>
                  <span className="delta-nums">{d.author} → {d.draft}</span>
                  <span className="delta-flag" data-dir={d.direction}>{d.direction}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

/** Текст с подсветкой найденных мест. */
function renderMarked(text, issues, active, setActive) {
  const ranged = issues
    .filter((i) => i.start !== null && i.end !== null)
    .slice()
    .sort((a, b) => a.start - b.start)

  const out = []
  let cursor = 0
  ranged.forEach((issue, n) => {
    if (issue.start < cursor) return
    if (issue.start > cursor) out.push(text.slice(cursor, issue.start))
    out.push(
      <mark
        key={`${issue.id}-${n}`}
        data-sev={issue.severity}
        data-active={active === issue.id}
        title={issue.message}
        onClick={() => setActive(active === issue.id ? null : issue.id)}
      >
        {text.slice(issue.start, issue.end)}
      </mark>,
    )
    cursor = issue.end
  })
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

function toneFor(score) {
  if (score === null) return 'ok'
  if (score >= 85) return 'good'
  if (score >= 70) return 'ok'
  if (score >= 50) return 'warn'
  return 'bad'
}

function gradeLabel(score) {
  if (score >= 85) return 'Можно публиковать'
  if (score >= 70) return 'Почти готово'
  if (score >= 50) return 'Нужна правка'
  return 'Переписать'
}
