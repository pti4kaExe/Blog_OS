import { useCallback, useEffect, useMemo, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import { CATEGORIES, applyFixes, isFixable, lint as engineLint } from '../../engine/anticringe.js'
import { getAiConsent, useAiConsent } from '../../lib/aiConsent.jsx'
import { engineProfileFromTov } from '../../lib/tov.js'
import {
  apiErrorMessage, arcLabel, DRAFT_STATUSES, fmtDateTime, hasUnfilledGaps,
  isOffline, LINT_ENGINE_LABELS, plural, unfilledGaps,
} from '../../lib/format.js'
import {
  AiBadge, CopyButton, ErrorState, InlineError, Loading, Modal, Notice, ScoreRing,
  StatusTag, Tag, Toggle,
} from '../ui.jsx'

const CATEGORY_ORDER = ['cliche', 'logic', 'tov', 'clarity']
const SEV_ORDER = { high: 0, med: 1, medium: 1, low: 2 }

/* ------------------------------ нормализация ------------------------------ */

function issueKey(issue, index) {
  if (issue.id) return String(issue.id)
  return `${issue.start ?? 'g'}-${issue.end ?? 'g'}-${issue.quote || index}`
}

function categoryOf(issue) {
  return issue.category || issue.type || 'clarity'
}

function severityOf(issue) {
  return issue.severity === 'medium' ? 'med' : issue.severity || 'med'
}

function issueTitle(issue) {
  return issue.title || CATEGORIES[categoryOf(issue)]?.label || 'Замечание'
}

function issueMessage(issue) {
  return issue.explanation || issue.message || ''
}

function issueSuggestion(issue) {
  if (issue.suggestion) return issue.suggestion
  if (typeof issue.fix === 'string' && issue.fix) return `Заменить на «${issue.fix}»`
  return ''
}

function countGroups(issues) {
  const groups = { cliche: 0, logic: 0, tov: 0, clarity: 0 }
  for (const issue of issues) {
    const key = categoryOf(issue)
    if (groups[key] === undefined) groups[key] = 0
    groups[key] += 1
  }
  return groups
}

function verdictFor(score) {
  if (score === null || score === undefined) return ''
  if (score >= 75) return 'Можно публиковать'
  if (score >= 40) return 'Требует правок'
  return 'Переписать'
}

function toneFor(score) {
  if (score === null || score === undefined) return 'ok'
  if (score >= 75) return 'good'
  if (score >= 40) return 'warn'
  return 'bad'
}

function normalizeReport(payload) {
  const report = payload?.lint_report || payload
  if (!report) return null
  return {
    report,
    groups: payload?.groups || countGroups(report.issues || []),
    verdict: payload?.verdict || verdictFor(report.score),
    verifiedWithoutAi: payload?.verified_without_ai !== undefined
      ? payload.verified_without_ai
      : report.engine === 'rules',
    aiSkippedReason: payload?.ai_skipped_reason || null,
  }
}

/**
 * Шаг 4 в облаке. Отчёт AntiCringe приходит с сервера (`POST /drafts/{id}/lint`),
 * правки применяются локально движком, затем черновик сохраняется (PATCH)
 * и проверка повторяется. История отчётов — `GET /drafts/{id}/lint-reports`.
 * Здесь же публикация: `POST /drafts/{id}/publish`.
 */
export default function CloudCheckStep({
  channel, tov, draft, setDraft, onBack, onUseLocal, onPublished,
}) {
  const [text, setText] = useState(draft.text || '')
  const [report, setReport] = useState(null)
  const [lintError, setLintError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [lintBusy, setLintBusy] = useState(false)
  const [useLlm, setUseLlm] = useState(getAiConsent() === 'granted')
  const [activeIssue, setActiveIssue] = useState(null)
  const [hidden, setHidden] = useState(() => new Set())

  const [history, setHistory] = useState([])
  const [historyState, setHistoryState] = useState('loading')
  const [historyError, setHistoryError] = useState(null)
  const [historyDetail, setHistoryDetail] = useState(null)

  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState(null)
  const [publishResult, setPublishResult] = useState(null)

  const consent = useAiConsent()
  const profile = useMemo(() => engineProfileFromTov(tov), [tov])

  // локальный движок: источник автоправок и сравнения с профилем стиля
  const localReport = useMemo(
    () => (text.trim() ? engineLint(text, profile) : null),
    [text, profile],
  )

  const fixIndex = useMemo(() => {
    const index = new Map()
    if (!localReport || localReport.empty) return index
    for (const issue of localReport.issues) {
      if (!isFixable(issue)) continue
      index.set(`${issue.start}:${issue.end}`, issue)
      if (issue.quote) index.set(`q:${issue.quote}`, issue)
    }
    return index
  }, [localReport])

  const findLocalFix = useCallback((issue) => {
    if (issue.start !== null && issue.start !== undefined) {
      const byRange = fixIndex.get(`${issue.start}:${issue.end}`)
      if (byRange) return byRange
    }
    if (issue.quote) return fixIndex.get(`q:${issue.quote}`) || null
    return null
  }, [fixIndex])

  const loadHistory = useCallback(async () => {
    setHistoryState('loading')
    setHistoryError(null)
    try {
      const payload = await api.lint.reports(draft.id, { limit: 20 })
      setHistory(itemsOf(payload))
      setHistoryState('ready')
    } catch (error) {
      setHistoryError(error)
      setHistoryState('error')
    }
  }, [draft.id])

  useEffect(() => {
    setText(draft.text || '')
    setReport(normalizeReport(draft.latest_lint_report ? { lint_report: draft.latest_lint_report } : null))
    setActiveIssue(null)
    setHidden(new Set())
    setPublishResult(null)
    setPublishError(null)
  }, [draft.id])

  useEffect(() => {
    setText(draft.text || '')
  }, [draft.updated_at, draft.text])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  /* ------------------------------- проверка ------------------------------- */

  const saveAndLint = useCallback(async (nextText, { llm = useLlm } = {}) => {
    setLintBusy(true)
    setLintError(null)
    setNotice(null)
    if (nextText !== text) setText(nextText)
    let patched = false
    try {
      const patch = { text: nextText }
      if (draft.status === 'draft') patch.status = 'on_check'
      const updated = await api.drafts.update(draft.id, patch)
      patched = true
      setDraft(updated)
      let result
      try {
        result = await api.lint.run(draft.id, { use_llm: llm })
      } catch (lintRunError) {
        if (lintRunError.code === 'ai_budget_exceeded' && llm) {
          setUseLlm(false)
          setNotice('Лимит расходов на AI исчерпан — проверка повторена правилами. Текст проверен полностью, без AI.')
          result = await api.lint.run(draft.id, { use_llm: false })
        } else {
          throw lintRunError
        }
      }
      setReport(normalizeReport(result))
      await loadHistory()
    } catch (error) {
      // если PATCH не прошёл — возвращаем текст, который точно сохранён на сервере
      if (!patched) setText(draft.text || '')
      setLintError(error)
    } finally {
      setLintBusy(false)
    }
  }, [draft.id, draft.status, draft.text, loadHistory, setDraft, text, useLlm])

  const runLint = () => {
    if (!text.trim()) {
      setLintError({ code: 'validation_error', message: 'В черновике нет текста — проверять нечего.' })
      return
    }
    consent.ensure(async (granted) => {
      await saveAndLint(text, { llm: granted })
    })
  }

  const applyFix = async (issue) => {
    if (lintBusy) return
    const local = findLocalFix(issue)
    if (!local) return
    const result = applyFixes(text, [local])
    if (result.text === text) return
    setActiveIssue(null)
    await saveAndLint(result.text)
  }

  const applyAllFixes = async () => {
    if (lintBusy) return
    const matched = visibleIssues.map(findLocalFix).filter(Boolean)
    if (!matched.length) return
    const result = applyFixes(text, matched)
    if (result.text === text) return
    await saveAndLint(result.text)
  }

  const toggleLlm = (value) => {
    if (!value) {
      setUseLlm(false)
      return
    }
    if (getAiConsent() === 'granted') {
      setUseLlm(true)
      return
    }
    consent.ask((granted) => setUseLlm(granted))
  }

  /* ------------------------------ публикация ------------------------------ */

  const doPublish = async () => {
    let current = draft
    if (text !== (draft.text || '')) {
      current = await api.drafts.update(draft.id, { text })
      setDraft(current)
      setText(current.text || '')
    }
    // Статус идёт по цепочке draft → on_check → ready: перескочить нельзя (422).
    if (current.status === 'draft') {
      current = await api.drafts.update(draft.id, { status: 'on_check' })
      setDraft(current)
    }
    if (current.status !== 'ready') {
      current = await api.drafts.update(draft.id, { status: 'ready' })
      setDraft(current)
    }
    return api.drafts.publish(draft.id, {})
  }

  const publish = async () => {
    setPublishing(true)
    setPublishError(null)
    setPublishResult(null)
    try {
      const result = await doPublish()
      setDraft(result.draft)
      setPublishResult(result)
      onPublished?.()
    } catch (error) {
      // статус мог уйти вперёд — пробуем один раз привести черновик в ready
      if (error.status === 422 && error.details?.reason === 'not_ready') {
        try {
          const current = await api.drafts.update(draft.id, { status: 'ready' })
          setDraft(current)
          const result = await api.drafts.publish(draft.id, {})
          setDraft(result.draft)
          setPublishResult(result)
          onPublished?.()
        } catch (retryError) {
          setPublishError(retryError)
        }
      } else {
        setPublishError(error)
      }
    } finally {
      setPublishing(false)
    }
  }

  /* -------------------------------- вывод --------------------------------- */

  if (!text.trim() && !report) {
    return (
      <section className="card">
        <div className="state">
          <div className="state-icon" aria-hidden="true">·</div>
          <div className="state-title">Нет текста для проверки</div>
          <div className="state-text">Вернитесь на шаг «Черновик» и добавьте текст.</div>
          <div className="state-action">
            <button type="button" className="btn btn-sm" onClick={onBack}>← К черновику</button>
          </div>
        </div>
      </section>
    )
  }

  const issues = report?.report?.issues || []
  const allVisible = issues
    .filter((issue, index) => !hidden.has(issueKey(issue, index)))
    .slice()
    .sort((a, b) => (SEV_ORDER[severityOf(a)] ?? 3) - (SEV_ORDER[severityOf(b)] ?? 3))
  const visibleIssues = allVisible
  const groups = report?.groups || countGroups(issues)
  const score = report?.report?.score ?? null
  const fixableCount = visibleIssues.filter((issue) => findLocalFix(issue)).length
  const deltas = localReport?.tovDeltas || []
  const gaps = unfilledGaps(text)
  const published = draft.status === 'published'
  const publishedPostId = draft.published_post_id
  const publishedLink = publishResult?.post?.external_url

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Итог проверки</h2>
            <p>
              {report
                ? `Отчёт №${report.report.id} · ${fmtDateTime(report.report.created_at)} · ${LINT_ENGINE_LABELS[report.report.engine] || report.report.engine}`
                : 'Проверка ещё не запускалась в этой сессии'}
            </p>
          </div>
          <div className="spacer" />
          <AiBadge withoutAi={report?.verifiedWithoutAi} />
        </div>

        {!report && (
          <div className="state" style={{ marginBottom: 16 }}>
            <div className="state-title">Запустите AntiCringe</div>
            <div className="state-text">
              Правиловый слой работает всегда и бесплатно. AI — второй слой: его можно
              отключить переключателем ниже.
            </div>
          </div>
        )}

        {report && (
          <>
            <div className="score-wrap" style={{ marginBottom: 16 }}>
              <ScoreRing score={score ?? 0} tone={toneFor(score)} />
              <div>
                <div className="grade" data-tone={toneFor(score)}>{report.verdict || verdictFor(score)}</div>
                <div className="faint">
                  {issues.length === 0
                    ? 'Замечаний нет'
                    : `${issues.length} ${plural(issues.length, 'замечание', 'замечания', 'замечаний')}`
                      + (fixableCount ? `, ${fixableCount} с автоправкой` : ', автоправок нет')}
                </div>
                {report.report.engine && (
                  <div className="faint">движок: {LINT_ENGINE_LABELS[report.report.engine] || report.report.engine}</div>
                )}
              </div>
              <div className="cats">
                {CATEGORY_ORDER.map((key) => (
                  <div className="cat" key={key} title={CATEGORIES[key]?.hint}>
                    <span className="cat-name">{CATEGORIES[key]?.label || key}</span>
                    <span className="cat-num" style={{ gridColumn: '2 / 4', textAlign: 'left' }}>
                      {groups[key] ?? 0} {plural(groups[key] ?? 0, 'замечание', 'замечания', 'замечаний')}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {report.aiSkippedReason && (
              <div style={{ marginBottom: 10 }}>
                <Notice kind="warn">
                  AI-слой не выполнялся ({report.aiSkippedReason === 'budget_exceeded' ? 'лимит расходов исчерпан' : report.aiSkippedReason}).
                  Правиловый слой проверил текст полностью.
                </Notice>
              </div>
            )}
          </>
        )}

        {notice && <div style={{ marginBottom: 10 }}><Notice kind="warn">{notice}</Notice></div>}
        <InlineError error={lintError} />

        <div style={{ margin: '14px 0' }}>
          <Toggle
            id="lint-use-llm"
            checked={useLlm}
            onChange={toggleLlm}
            disabled={lintBusy}
            label="AI-слой проверки"
            hint="Правила работают всегда. AI добавляет замечания, которые видит модель; текст уходит провайдеру."
          />
        </div>

        <div className="btn-row" style={{ marginBottom: 16 }}>
          <button type="button" className="btn btn-primary" onClick={runLint} disabled={lintBusy}>
            {lintBusy ? 'Проверяем…' : report ? 'Проверить снова' : 'Проверить в AntiCringe'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={applyAllFixes}
            disabled={lintBusy || !fixableCount}
          >
            Применить автоправки ({fixableCount})
          </button>
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={lintBusy}>← К черновику</button>
        </div>

        <div className="card-head" style={{ marginBottom: 8 }}>
          <div><h2 style={{ fontSize: 15 }}>Текст с пометками</h2></div>
          <div className="spacer" />
          <CopyButton text={text} />
        </div>

        {report ? (
          <div className="marked">
            {renderMarked(text, visibleIssues, activeIssue, setActiveIssue, hidden)}
          </div>
        ) : (
          <div className="post-text">{text}</div>
        )}

        {gaps.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Notice kind="warn">
              Незаполненные пропуски: {gaps.join(', ')}. Публикация будет заблокирована,
              пока автор не заполнит их своим опытом.
            </Notice>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Замечания по группам</h2>
            <p>Нажмите на замечание, чтобы найти его в тексте.</p>
          </div>
          <div className="spacer" />
          {hidden.size > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHidden(new Set())}>
              Вернуть скрытые ({hidden.size})
            </button>
          )}
        </div>

        {visibleIssues.length === 0 ? (
          <div className="state">
            <div className="state-icon" aria-hidden="true">✓</div>
            <div className="state-title">{report ? 'Чисто' : 'Отчёт появится после проверки'}</div>
            <div className="state-text">
              {report
                ? 'Текст прошёл все четыре группы проверок. Можно публиковать.'
                : 'Нажмите «Проверить в AntiCringe» — отчёт появится здесь.'}
            </div>
          </div>
        ) : (
          CATEGORY_ORDER.map((category) => {
            const groupIssues = visibleIssues.filter((issue) => categoryOf(issue) === category)
            if (!groupIssues.length) return null
            return (
              <div className="issue-section" key={category}>
                <h3>
                  {CATEGORIES[category]?.label || category}
                  <span className="faint">({groupIssues.length})</span>
                </h3>
                <div className="issue-list">
                  {groupIssues.map((issue, index) => {
                    const key = issueKey(issue, index)
                    const fixable = Boolean(findLocalFix(issue))
                    const suggestion = issueSuggestion(issue)
                    return (
                      <div
                        className="issue"
                        key={key}
                        data-sev={severityOf(issue)}
                        data-active={activeIssue === key}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveIssue(activeIssue === key ? null : key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setActiveIssue(activeIssue === key ? null : key)
                          }
                        }}
                      >
                        <div className="issue-top">
                          <span className="issue-title">{issueTitle(issue)}</span>
                          <span className="issue-cat">{CATEGORIES[category]?.label}</span>
                          {issue.quote && <span className="issue-quote">{issue.quote}</span>}
                        </div>
                        <div className="issue-msg">{issueMessage(issue)}</div>
                        {suggestion && <div className="issue-fix">{suggestion}</div>}
                        <div className="issue-actions">
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={lintBusy || !fixable}
                            title={fixable ? 'Правка применится к тексту и проверка повторится' : 'Автоправки нет — поправьте вручную'}
                            onClick={(event) => { event.stopPropagation(); applyFix(issue) }}
                          >
                            {fixable ? 'Применить' : 'Вручную'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={(event) => {
                              event.stopPropagation()
                              const next = new Set(hidden)
                              next.add(key)
                              setHidden(next)
                              if (activeIssue === key) setActiveIssue(null)
                            }}
                          >
                            Скрыть
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}

        <hr className="hr" />

        <h3>История проверок</h3>
        {historyState === 'loading' && <Loading label="Загружаем историю…" />}
        {historyState === 'error' && (
          <ErrorState error={historyError} onRetry={loadHistory}>
            {isOffline(historyError) && onUseLocal && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>Работать локально</button>
            )}
          </ErrorState>
        )}
        {historyState === 'ready' && history.length === 0 && (
          <p className="faint">Отчётов пока нет — проверка создаст первый.</p>
        )}
        {historyState === 'ready' && history.length > 0 && (
          <div className="list list-scroll">
            {history.map((item) => (
              <div className="list-item" key={item.id}>
                <div className="list-item-head">
                  <Tag kind={toneFor(item.score)}>{item.score}</Tag>
                  <span className="list-item-title">{verdictFor(item.score)}</span>
                  <div className="spacer" />
                  <span className="list-item-meta">{fmtDateTime(item.created_at)}</span>
                </div>
                <div className="list-item-meta">
                  {LINT_ENGINE_LABELS[item.engine] || item.engine}
                  {' · '}
                  {(item.issues || []).length} {plural((item.issues || []).length, 'замечание', 'замечания', 'замечаний')}
                </div>
                <div className="list-item-actions">
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHistoryDetail(item)}>
                    Открыть отчёт
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <hr className="hr" />

        <h3>Сравнение с профилем стиля</h3>
        {deltas.length > 0 ? (
          <div className="deltas">
            {deltas.map((delta) => (
              <div className="delta" key={delta.key}>
                <span className="delta-name">{delta.label}</span>
                <span className="delta-nums">{delta.author} → {delta.draft}</span>
                <span className="delta-flag" data-dir={delta.direction}>{delta.direction}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="faint">
            Профиль стиля не загружен — сравнивать не с чем. Постройте его на шаге «Стиль».
          </p>
        )}

        <hr className="hr" />

        <h3>Публикация</h3>
        <div style={{ marginBottom: 10 }}>
          <StatusTag list={DRAFT_STATUSES} value={draft.status} />
          {draft.arc && <span className="faint"> · арка: {arcLabel(draft.arc)}</span>}
        </div>

        {published && !publishResult ? (
          <Notice kind="good">
            Черновик уже опубликован{publishedPostId ? ` — пост №${publishedPostId} в архиве BlogOS` : ''}.
          </Notice>
        ) : publishResult ? (
          <Notice kind="good">
            Пост опубликован. Черновик переведён в статус «Опубликован».
            {publishedLink ? (
              <> <a href={publishedLink} target="_blank" rel="noreferrer">Открыть пост</a></>
            ) : (
              <> Ссылка на площадку не создаётся: BlogOS фиксирует публикацию в архиве (пост №{publishResult.post?.id}).</>
            )}
          </Notice>
        ) : (
          <>
            <p className="faint" style={{ marginTop: 0 }}>
              Публикация не отправляет пост на площадку — она фиксирует факт в архиве BlogOS.
              Нужен статус «Готов к публикации» и отсутствие пропусков <code>[дополните: …]</code>.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={publish}
              disabled={publishing || hasUnfilledGaps(text)}
            >
              {publishing ? 'Публикуем…' : 'Опубликовать пост'}
            </button>
            {hasUnfilledGaps(text) && (
              <p className="faint" style={{ marginBottom: 0 }}>
                Кнопка заблокирована: сначала заполните пропуски в тексте.
              </p>
            )}
          </>
        )}

        {publishError && (
          <div style={{ marginTop: 10 }}>
            <Notice kind="error">{apiErrorMessage(publishError)}</Notice>
            {publishError.details?.reason === 'unfilled_gaps' && gaps.length > 0 && (
              <p className="faint" style={{ marginBottom: 0 }}>Пропуски: {gaps.join(', ')}</p>
            )}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <Notice>
            Отчёт неизменяем: повторная проверка создаёт новую запись в истории.
            Канал: «{channel.name}».
          </Notice>
        </div>
      </section>

      <Modal
        open={Boolean(historyDetail)}
        title={historyDetail ? `Отчёт №${historyDetail.id} · оценка ${historyDetail.score}` : 'Отчёт'}
        onClose={() => setHistoryDetail(null)}
        wide
      >
        {historyDetail && (
          <>
            <p className="faint" style={{ marginTop: 0 }}>
              {fmtDateTime(historyDetail.created_at)} · {LINT_ENGINE_LABELS[historyDetail.engine] || historyDetail.engine}
              {' · '}{verdictFor(historyDetail.score)}
            </p>
            {(historyDetail.issues || []).length === 0 ? (
              <div className="state"><div className="state-title">Замечаний в отчёте нет</div></div>
            ) : (
              <div className="issue-list">
                {(historyDetail.issues || []).map((issue, index) => (
                  <div className="issue" data-sev={severityOf(issue)} key={issueKey(issue, index)}>
                    <div className="issue-top">
                      <span className="issue-title">{issueTitle(issue)}</span>
                      <span className="issue-cat">{CATEGORIES[categoryOf(issue)]?.label}</span>
                      {issue.quote && <span className="issue-quote">{issue.quote}</span>}
                    </div>
                    <div className="issue-msg">{issueMessage(issue)}</div>
                    {issueSuggestion(issue) && <div className="issue-fix">{issueSuggestion(issue)}</div>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>

      {consent.modal}
    </div>
  )
}

/** Текст с подсветкой найденных мест. */
function renderMarked(text, issues, active, setActive, hidden) {
  const ranged = issues
    .filter((issue, index) => (
      issue.start !== null
      && issue.start !== undefined
      && issue.end !== null
      && issue.end !== undefined
      && !hidden.has(issueKey(issue, index))
    ))
    .slice()
    .sort((a, b) => a.start - b.start)

  const out = []
  let cursor = 0
  ranged.forEach((issue, number) => {
    if (issue.start < cursor) return
    if (issue.start > cursor) out.push(text.slice(cursor, issue.start))
    out.push(
      <mark
        key={`${issueKey(issue, number)}-${number}`}
        data-sev={severityOf(issue)}
        data-active={active === issueKey(issue, number)}
        title={issueMessage(issue)}
        onClick={() => setActive(active === issueKey(issue, number) ? null : issueKey(issue, number))}
      >
        {text.slice(issue.start, issue.end)}
      </mark>,
    )
    cursor = issue.end
  })
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}
