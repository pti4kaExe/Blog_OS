import { useCallback, useEffect, useMemo, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import { getAiConsent, useAiConsent } from '../../lib/aiConsent.jsx'
import {
  apiErrorMessage, fmtDateTime, hasUnfilledGaps, isOffline,
  labelOf, plural, RESPONSE_STATUSES, SCAN_STATUSES, SOURCE_TYPES,
} from '../../lib/format.js'
import { matchedCount, rankComments } from '../../lib/rankComments.js'
import {
  ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Loading, Modal, Notice,
  Select, StatusTag, Tag, TextInput, Toggle,
} from '../ui.jsx'
import { PanelReveal, Reveal, Stagger } from '../ui/Motion.jsx'

const PART_LABELS = {
  reference: 'отсылка к посту',
  experience: 'ваш опыт',
  gap: 'заполнить',
  question: 'вопрос',
}

const EMPTY_SOURCE_FORM = { name: '', source_type: 'telegram_channel', source_url: '' }
const EMPTY_MANUAL = { commenter_name: '', text: '' }

/**
 * CommentRadar в облаке.
 *
 * Источники и сканирование живут на сервере, найденные комментарии приходят
 * лентой. Варианты ответа генерируются из четырёх частей, а одобрить ответ
 * можно только после заполнения пропуска `[дополните: …]` — движок не
 * выдумывает факты за автора.
 */
export default function CloudRadarView({ channel, onUseLocal }) {
  const [sources, setSources] = useState([])
  const [sourcesState, setSourcesState] = useState('loading')
  const [sourcesError, setSourcesError] = useState(null)
  const [sourcesKey, setSourcesKey] = useState(0)
  const [selectedSourceId, setSelectedSourceId] = useState(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [sourceForm, setSourceForm] = useState(EMPTY_SOURCE_FORM)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState(null)

  const [togglingId, setTogglingId] = useState(null)
  const [scanningId, setScanningId] = useState(null)
  const [scanInfo, setScanInfo] = useState(null) // {sourceId, kind, message}
  const [deleteSource, setDeleteSource] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const [comments, setComments] = useState([])
  const [commentsState, setCommentsState] = useState('idle')
  const [commentsError, setCommentsError] = useState(null)
  const [commentsKey, setCommentsKey] = useState(0)
  const [selectedCommentId, setSelectedCommentId] = useState(null)

  const [comment, setComment] = useState(null)
  const [commentState, setCommentState] = useState('idle')
  const [commentError, setCommentError] = useState(null)
  const [responses, setResponses] = useState([])
  const [responsesKey, setResponsesKey] = useState(0)
  const [partsById, setPartsById] = useState({})
  const [edits, setEdits] = useState({})
  const [generateBusy, setGenerateBusy] = useState(false)
  const [generateError, setGenerateError] = useState(null)
  const [generateInfo, setGenerateInfo] = useState(null)
  const [responseBusyId, setResponseBusyId] = useState(null)
  const [responseError, setResponseError] = useState(null)

  const [manualOpen, setManualOpen] = useState(false)
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState(null)

  const [useLlm, setUseLlm] = useState(getAiConsent() === 'granted')
  const consent = useAiConsent()

  /* Профиль стиля нужен для ранжирования ленты по темам автора (ТЗ, раздел 4).
     404 — профиль ещё не построен: лента тогда идёт в порядке сервера. */
  const [tov, setTov] = useState(null)

  const selectedSource = useMemo(
    () => sources.find((source) => String(source.id) === String(selectedSourceId)) || null,
    [sources, selectedSourceId],
  )

  useEffect(() => {
    let alive = true
    setTov(null)
    api.tov.get(channel.id)
      .then((payload) => {
        if (!alive) return
        setTov(payload && payload.tov_profile ? payload.tov_profile : payload)
      })
      .catch(() => {
        /* без профиля радар работает, просто без ранжирования */
      })
    return () => { alive = false }
  }, [channel.id])

  /* ------------------------------- источники ------------------------------ */

  useEffect(() => {
    let alive = true
    setSourcesState('loading')
    setSourcesError(null)
    api.sources.list(channel.id, { limit: 100 })
      .then((payload) => {
        if (!alive) return
        const items = itemsOf(payload)
        setSources(items)
        setSelectedSourceId((prev) => {
          if (prev && items.some((source) => String(source.id) === String(prev))) return prev
          return items.length ? String(items[0].id) : null
        })
        setSourcesState('ready')
      })
      .catch((error) => {
        if (!alive) return
        setSourcesError(error)
        setSourcesState('error')
      })
    return () => { alive = false }
  }, [channel.id, sourcesKey])

  const reloadSources = () => setSourcesKey((key) => key + 1)

  const submitSource = async (event) => {
    event.preventDefault()
    if (!sourceForm.name.trim() || !sourceForm.source_url.trim()) {
      setCreateError({ code: 'validation_error', message: 'Укажите название и ссылку на источник.' })
      return
    }
    setCreateBusy(true)
    setCreateError(null)
    try {
      const created = await api.sources.create(channel.id, {
        name: sourceForm.name.trim(),
        source_type: sourceForm.source_type,
        source_url: sourceForm.source_url.trim(),
      })
      setCreateOpen(false)
      setSourceForm(EMPTY_SOURCE_FORM)
      setSourcesKey((key) => key + 1)
      if (created && created.id !== undefined) setSelectedSourceId(String(created.id))
    } catch (error) {
      setCreateError(error)
    } finally {
      setCreateBusy(false)
    }
  }

  const toggleSourceActive = async (source) => {
    setTogglingId(source.id)
    setScanInfo(null)
    try {
      const updated = await api.sources.update(source.id, { is_active: !source.is_active })
      setSources((prev) => prev.map((item) => (
        String(item.id) === String(source.id) ? { ...item, ...updated } : item
      )))
    } catch (error) {
      setScanInfo({ sourceId: source.id, kind: 'error', message: apiErrorMessage(error) })
    } finally {
      setTogglingId(null)
    }
  }

  const scanSource = async (source) => {
    setScanningId(source.id)
    setScanInfo(null)
    try {
      const result = await api.comments.scan(source.id, { limit: 100 })
      setScanInfo({
        sourceId: source.id,
        kind: 'good',
        message: `Сканирование завершено: найдено ${result.found ?? 0}, новых ${result.created ?? 0}, дублей ${result.duplicates ?? 0}.`,
      })
      reloadSources()
      setCommentsKey((key) => key + 1)
    } catch (error) {
      const detail = error.details?.platform ? ` Площадка: ${error.details.platform}.` : ''
      setScanInfo({
        sourceId: source.id,
        kind: error.code === 'rate_limited' ? 'warn' : 'error',
        message: `${apiErrorMessage(error)}${detail}`,
      })
      reloadSources()
    } finally {
      setScanningId(null)
    }
  }

  /**
   * Ручное добавление обсуждения — `POST /sources/{id}/comments`.
   *
   * ТЗ, раздел 7: вручную добавленные помечаются `manual:<номер>`; номер
   * ставит сервер, клиент `external_id` не передаёт. Нужно, когда автор
   * увидел разговор сам, а сканер до него не дошёл или площадка без ключей.
   */
  const submitManual = async (event) => {
    event.preventDefault()
    if (!manualForm.text.trim()) {
      setManualError({ code: 'validation_error', message: 'Вставьте текст обсуждения.' })
      return
    }
    setManualBusy(true)
    setManualError(null)
    try {
      const created = await api.comments.create(selectedSource.id, {
        commenter_name: manualForm.commenter_name.trim() || 'Читатель',
        text: manualForm.text.trim(),
        posted_at: new Date().toISOString(),
      })
      setManualOpen(false)
      setManualForm(EMPTY_MANUAL)
      setCommentsKey((key) => key + 1)
      if (created && created.id !== undefined) setSelectedCommentId(String(created.id))
    } catch (error) {
      setManualError(error)
    } finally {
      setManualBusy(false)
    }
  }

  const confirmDeleteSource = async () => {
    if (!deleteSource) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.sources.remove(deleteSource.id)
      setDeleteSource(null)
      setSelectedSourceId(null)
      setComments([])
      reloadSources()
    } catch (error) {
      setDeleteError(error)
    } finally {
      setDeleteBusy(false)
    }
  }

  /* ------------------------------- комментарии ---------------------------- */

  useEffect(() => {
    if (!selectedSourceId) {
      setComments([])
      setCommentsState('idle')
      return undefined
    }
    let alive = true
    setCommentsState('loading')
    setCommentsError(null)
    setSelectedCommentId(null)
    api.comments.list(selectedSourceId, { limit: 50 })
      .then((payload) => {
        if (!alive) return
        setComments(itemsOf(payload))
        setCommentsState('ready')
      })
      .catch((error) => {
        if (!alive) return
        setCommentsError(error)
        setCommentsState('error')
      })
    return () => { alive = false }
  }, [selectedSourceId, commentsKey])

  /* Лента в порядке релевантности темам автора и свежести — та же функция
     движка, что в локальном режиме. Без профиля порядок остаётся серверным. */
  const ranked = useMemo(
    () => rankComments(comments, tov, selectedSource?.name),
    [comments, tov, selectedSource],
  )
  const ranking = Boolean(tov) && ranked.some((item) => item.matchScore !== null)

  useEffect(() => {
    if (!selectedCommentId) {
      setComment(null)
      setCommentState('idle')
      setResponses([])
      return undefined
    }
    let alive = true
    setCommentState('loading')
    setCommentError(null)
    Promise.all([
      api.comments.get(selectedCommentId),
      api.responses.list(selectedCommentId, { limit: 20 }),
    ])
      .then(([commentPayload, responsesPayload]) => {
        if (!alive) return
        setComment(commentPayload)
        const list = itemsOf(responsesPayload)
        setResponses(list)
        setEdits(Object.fromEntries(
          list.map((item) => [item.id, item.edited_text || item.response_text || '']),
        ))
        setCommentState('ready')
      })
      .catch((error) => {
        if (!alive) return
        setCommentError(error)
        setCommentState('error')
      })
    return () => { alive = false }
  }, [selectedCommentId, responsesKey])

  // смена комментария сбрасывает сообщения прошлого диалога
  useEffect(() => {
    setGenerateInfo(null)
    setGenerateError(null)
    setResponseError(null)
    setPartsById({})
  }, [selectedCommentId])

  /* -------------------------------- ответы -------------------------------- */

  const generateResponses = () => {
    if (!selectedCommentId || !comment) return
    consent.ensure(async (granted) => {
      setGenerateBusy(true)
      setGenerateError(null)
      setGenerateInfo(null)
      try {
        let result
        try {
          result = await api.responses.generate(selectedCommentId, { count: 2, use_llm: granted })
        } catch (error) {
          if (error.code === 'ai_budget_exceeded' && granted) {
            setUseLlm(false)
            setGenerateInfo({ kind: 'warn', message: 'Лимит AI исчерпан — ответы собраны правилами.' })
            result = await api.responses.generate(selectedCommentId, { count: 2, use_llm: false })
          } else {
            throw error
          }
        }
        const partsMap = {}
        for (const item of result.responses || []) {
          if (item.parts) partsMap[item.id] = item.parts
        }
        setPartsById((prev) => ({ ...prev, ...partsMap }))
        setGenerateInfo({
          kind: 'good',
          verifiedWithoutAi: result.verified_without_ai,
          basedOnPostId: result.based_on_post_id,
        })
        setResponsesKey((key) => key + 1)
      } catch (error) {
        setGenerateError(error)
      } finally {
        setGenerateBusy(false)
      }
    })
  }

  const approveResponse = async (response) => {
    const text = edits[response.id] ?? ''
    if (!text.trim() || hasUnfilledGaps(text)) return
    setResponseBusyId(response.id)
    setResponseError(null)
    try {
      // Сервер разрешает цепочку generated → pending_approval → approved.
      let currentStatus = response.status
      if (currentStatus === 'generated') {
        await api.responses.update(response.id, {
          edited_text: text,
          status: 'pending_approval',
        })
        currentStatus = 'pending_approval'
      }
      if (currentStatus !== 'approved' && currentStatus !== 'sent') {
        await api.responses.update(response.id, { edited_text: text, status: 'approved' })
      }
      setResponsesKey((key) => key + 1)
    } catch (error) {
      setResponseError({ id: response.id, error })
    } finally {
      setResponseBusyId(null)
    }
  }

  const saveResponseEdit = async (response) => {
    const text = edits[response.id] ?? ''
    if (!text.trim()) return
    setResponseBusyId(response.id)
    setResponseError(null)
    try {
      await api.responses.update(response.id, { edited_text: text })
      setResponsesKey((key) => key + 1)
    } catch (error) {
      setResponseError({ id: response.id, error })
    } finally {
      setResponseBusyId(null)
    }
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

  /* --------------------------------- вывод -------------------------------- */

  return (
    <>
      {/* Название не объясняет, что это такое: раздел виден в навигации
          первым в своём контексте, но «радар» ничего не говорит человеку,
          который открыл его впервые. Один спокойный абзац — что именно
          он делает и чего не делает (раздел 10: не выдавать демо-данные
          за результат реального поиска). */}
      <div className="stage-head head-row">
        <div>
          <h1>CommentRadar</h1>
          <p className="lead">
            Находит в Telegram, Instagram и YouTube обсуждения по темам вашего канала
            и готовит черновик ответа в вашем стиле — отправка остаётся за вами.
          </p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-sm" onClick={() => { setSourceForm(EMPTY_SOURCE_FORM); setCreateError(null); setCreateOpen(true) }}>
            + Источник
          </button>
        </div>
      </div>

      <p className="faint" style={{ marginTop: -8, marginBottom: 20 }}>
        Источники канала «{channel.name}».
      </p>

      <div className="grid-radar">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Источники</h2>
              <p>Telegram, Instagram, YouTube или ручные источники.</p>
            </div>
            <div className="spacer" />
            {sourcesState === 'ready' && <span className="faint">{sources.length}</span>}
          </div>

          {sourcesState === 'loading' && <Loading label="Загружаем источники…" />}

          {sourcesState === 'error' && (
            <ErrorState error={sourcesError} onRetry={reloadSources}>
              {isOffline(sourcesError) && onUseLocal && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>Работать локально</button>
              )}
            </ErrorState>
          )}

          {sourcesState === 'ready' && sources.length === 0 && (
            <EmptyState
              title="Источников пока нет"
              action={(
                <button type="button" className="btn btn-sm btn-primary" onClick={() => { setSourceForm(EMPTY_SOURCE_FORM); setCreateOpen(true) }}>
                  Добавить источник
                </button>
              )}
            >
              Добавьте канал или чат — CommentRadar найдёт обсуждения, близкие к вашим темам.
            </EmptyState>
          )}

          {sources.length > 0 && (
            <div className="list">
              {sources.map((source) => (
                <div
                  className="list-item list-btn"
                  key={source.id}
                  data-active={String(selectedSourceId) === String(source.id)}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedSourceId(String(source.id))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedSourceId(String(source.id))
                    }
                  }}
                >
                  <div className="list-item-head">
                    <span className="list-item-title">{source.name}</span>
                    <Tag>{labelOf(SOURCE_TYPES, source.source_type)}</Tag>
                    <div className="spacer" />
                    <StatusTag list={SCAN_STATUSES} value={source.last_scan_status} />
                  </div>
                  <div className="list-item-meta nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {source.source_url}
                  </div>
                  <div className="source-state">
                    <Toggle
                      id={`source-active-${source.id}`}
                      checked={Boolean(source.is_active)}
                      onChange={() => toggleSourceActive(source)}
                      disabled={togglingId === source.id}
                      label={source.is_active ? 'Отслеживается' : 'Выключен'}
                    />
                  </div>
                  <div className="scan-box">
                    <div className="scan-line">
                      Последнее сканирование: {fmtDateTime(source.last_scanned_at)}
                    </div>
                    {source.last_scan_error && (
                      <div className="scan-line" style={{ color: 'var(--bad)' }}>
                        Ошибка: {source.last_scan_error}
                      </div>
                    )}
                    {scanInfo && String(scanInfo.sourceId) === String(source.id) && (
                      <div style={{ marginTop: 8 }}>
                        <Notice kind={scanInfo.kind === 'good' ? 'good' : scanInfo.kind === 'warn' ? 'warn' : 'error'}>
                          {scanInfo.message}
                        </Notice>
                      </div>
                    )}
                  </div>
                  <div className="list-item-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={scanningId === source.id || !source.is_active}
                      onClick={(event) => { event.stopPropagation(); scanSource(source) }}
                      title={!source.is_active ? 'Включите источник, чтобы сканировать' : 'Найти новые комментарии'}
                    >
                      {scanningId === source.id ? 'Сканируем…' : 'Сканировать'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={(event) => { event.stopPropagation(); setDeleteError(null); setDeleteSource(source) }}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Лента комментариев</h2>
              <p>
                {!selectedSource && 'Сначала выберите источник слева.'}
                {selectedSource && ranking && (
                  `${matchedCount(ranked)} из ${ranked.length} пересекаются с вашими темами`
                )}
                {selectedSource && !ranking && `Источник: ${selectedSource.name}`}
              </p>
            </div>
            <div className="spacer" />
            {selectedSource && (
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => { setManualError(null); setManualForm(EMPTY_MANUAL); setManualOpen(true) }}
                >
                  + Обсуждение
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCommentsKey((key) => key + 1)}>
                  Обновить
                </button>
              </div>
            )}
          </div>

          {!selectedSource && <EmptyState title="Нет выбранного источника" />}

          {selectedSource && commentsState === 'loading' && <Loading label="Загружаем комментарии…" />}

          {selectedSource && commentsState === 'error' && (
            <ErrorState error={commentsError} onRetry={() => setCommentsKey((key) => key + 1)} />
          )}

          {selectedSource && commentsState === 'ready' && comments.length === 0 && (
            <EmptyState
              title="Комментариев пока нет"
              action={(
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => scanSource(selectedSource)}
                  disabled={scanningId === selectedSource.id || !selectedSource.is_active}
                >
                  {scanningId === selectedSource.id ? 'Сканируем…' : 'Сканировать источник'}
                </button>
              )}
            >
              Запустите сканирование — комментарии появятся здесь. Сканировать чаще, чем раз в
              минуту, нельзя (сервер ответит 429).
            </EmptyState>
          )}

          {selectedSource && ranked.length > 0 && (
            /* Каскад играет при первом входе и при смене источника —
               `replay` перезапускает его сменой ключа. На выбор карточки
               он не повторяется: пользователь уже работает с лентой. */
            <Stagger className="list list-scroll" replay={selectedSource.id}>
              {ranked.map((item, index) => (
                <Reveal
                  as="button"
                  index={index}
                  offset={8}
                  type="button"
                  className="list-item list-btn"
                  key={item.id}
                  data-active={String(selectedCommentId) === String(item.id)}
                  onClick={() => setSelectedCommentId(String(item.id))}
                >
                  <div className="list-item-head">
                    <span className="list-item-title">{item.commenter_name || 'Читатель'}</span>
                    {String(item.external_id || '').startsWith('manual:') && <Tag>вручную</Tag>}
                    <div className="spacer" />
                    {item.matchScore > 0 && <span className="disc-score">{item.matchScore}%</span>}
                    <span className="list-item-meta">{fmtDateTime(item.posted_at || item.created_at)}</span>
                  </div>
                  <div className="list-item-text">{item.text}</div>
                  {/* Причину показываем только у совпавших: «нет пересечений» под
                      каждой карточкой — шум, общий счёт уже стоит в заголовке. */}
                  {item.matchScore > 0 && <div className="disc-why">{item.reason}</div>}
                </Reveal>
              ))}
            </Stagger>
          )}
        </section>
      </div>

      {selectedCommentId && (
        <PanelReveal
          as="section"
          replay={selectedCommentId}
          className="card"
          style={{ marginTop: 16 }}
        >
          <div className="card-head">
            <div>
              <h2>Ответ на комментарий</h2>
              <p>
                {comment?.commenter_name || 'Читатель'}
                {comment?.posted_at ? ` · ${fmtDateTime(comment.posted_at)}` : ''}
                {comment?.responses_count ? ` · ${comment.responses_count} ${plural(comment.responses_count, 'ответ', 'ответа', 'ответов')}` : ''}
              </p>
            </div>
            <div className="spacer" />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedCommentId(null)}>
              Закрыть
            </button>
          </div>

          {commentState === 'loading' && <Loading label="Загружаем комментарий…" />}
          {commentState === 'error' && (
            <ErrorState error={commentError} onRetry={() => setResponsesKey((key) => key + 1)} />
          )}

          {commentState === 'ready' && comment && (
            <>
              <div className="disc" style={{ marginBottom: 14 }}>
                <div className="disc-top">
                  <span className="disc-src">{selectedSource?.name || 'Источник'}</span>
                </div>
                <div className="disc-text" style={{ fontSize: 14 }}>{comment.text}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <Toggle
                  id="radar-use-llm"
                  checked={useLlm}
                  onChange={toggleLlm}
                  disabled={generateBusy}
                  label="AI-слой для ответов"
                  hint="Без AI ответ собирается правилами из ваших постов — факты не выдумываются."
                />
              </div>

              <div className="btn-row" style={{ marginBottom: 14 }}>
                <button type="button" className="btn btn-primary" onClick={generateResponses} disabled={generateBusy}>
                  {generateBusy ? 'Генерируем ответы…' : 'Сгенерировать ответ (4 части)'}
                </button>
                <span className="faint">Движок оставляет пропуск в части «заполнить» — факт вписывает автор.</span>
              </div>

              {generateInfo?.kind === 'warn' && (
                <div style={{ marginBottom: 12 }}><Notice kind="warn">{generateInfo.message}</Notice></div>
              )}
              {generateInfo?.kind === 'good' && (
                <div style={{ marginBottom: 12 }}>
                  <Notice kind="good">
                    Варианты собраны{generateInfo.verifiedWithoutAi ? ' без AI — только правилами' : ''}.
                    {generateInfo.basedOnPostId ? ` Опора — пост №${generateInfo.basedOnPostId}.` : ''}
                  </Notice>
                </div>
              )}
              {generateError && <InlineError error={generateError} />}

              {responses.length === 0 && !generateBusy && (
                <EmptyState title="Ответов пока нет">
                  Нажмите «Сгенерировать ответ» — движок соберёт варианты из четырёх частей.
                </EmptyState>
              )}

              <div className="list">
                {responses.map((response) => {
                  const value = edits[response.id] ?? ''
                  const parts = partsById[response.id] || response.parts || null
                  const approved = response.status === 'approved' || response.status === 'sent'
                  const rejected = response.status === 'rejected'
                  const blocked = hasUnfilledGaps(value)
                  const busy = responseBusyId === response.id
                  return (
                    <div className="list-item" key={response.id}>
                      <div className="list-item-head">
                        <StatusTag list={RESPONSE_STATUSES} value={response.status} />
                        {response.approved_at && (
                          <span className="list-item-meta">одобрен {fmtDateTime(response.approved_at)}</span>
                        )}
                        <div className="spacer" />
                        <span className="list-item-meta">{fmtDateTime(response.created_at)}</span>
                      </div>

                      {parts && (
                        <div className="comment-parts" style={{ marginTop: 8 }}>
                          {['reference', 'experience', 'gap', 'question'].map((kind) => (
                            parts[kind] ? (
                              <div className="cpart" data-kind={kind} key={kind}>
                                <span className="cpart-kind">{PART_LABELS[kind]}</span>
                                <span className="cpart-text">{parts[kind]}</span>
                              </div>
                            ) : null
                          ))}
                        </div>
                      )}

                      <textarea
                        className="ta"
                        style={{ minHeight: 120 }}
                        value={value}
                        onChange={(event) => setEdits((prev) => ({ ...prev, [response.id]: event.target.value }))}
                        disabled={approved || busy}
                      />

                      {blocked && (
                        <div style={{ marginTop: 8 }}>
                          <Notice kind="warn">
                            Заполните пропуск <code>[дополните: …]</code> перед одобрением — иначе ответ
                            останется шаблонным.
                          </Notice>
                        </div>
                      )}

                      {responseError && responseError.id === response.id && (
                        <InlineError error={responseError.error} />
                      )}

                      <div className="list-item-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={approved || rejected || blocked || busy || !value.trim()}
                          onClick={() => approveResponse(response)}
                        >
                          {approved ? 'Одобрен' : rejected ? 'Отклонён' : busy ? 'Одобряем…' : 'Одобрить'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => saveResponseEdit(response)}
                          disabled={busy || approved}
                        >
                          Сохранить правку
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </PanelReveal>
      )}

      <Modal
        open={manualOpen}
        title="Добавить обсуждение вручную"
        onClose={manualBusy ? undefined : () => setManualOpen(false)}
        footer={(
          <div className="btn-row">
            <button type="submit" form="manual-comment-form" className="btn btn-primary" disabled={manualBusy}>
              {manualBusy ? 'Добавляем…' : 'Добавить'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setManualOpen(false)}
              disabled={manualBusy}
            >
              Отмена
            </button>
          </div>
        )}
      >
        <form id="manual-comment-form" onSubmit={submitManual}>
          <Field label="Кто написал" hint="Необязательно. По умолчанию — «Читатель»." htmlFor="manual-author">
            <TextInput
              id="manual-author"
              value={manualForm.commenter_name}
              onChange={(event) => setManualForm((prev) => ({ ...prev, commenter_name: event.target.value }))}
              placeholder="Читатель"
              autoComplete="off"
            />
          </Field>
          <Field label="Текст обсуждения" htmlFor="manual-text">
            <textarea
              id="manual-text"
              className="ta"
              style={{ minHeight: 140, maxWidth: 'none' }}
              value={manualForm.text}
              onChange={(event) => setManualForm((prev) => ({ ...prev, text: event.target.value }))}
              placeholder="Скопируйте сюда комментарий или вопрос, на который хотите ответить…"
            />
          </Field>
          <InlineError error={manualError} />
          <p className="faint" style={{ marginBottom: 0 }}>
            Обсуждение попадёт в источник «{selectedSource?.name}» с пометкой «добавлено вручную»
            и встанет в ленту по совпадению с вашими темами.
          </p>
        </form>
      </Modal>

      <Modal
        open={createOpen}
        title="Новый источник"
        onClose={createBusy ? undefined : () => setCreateOpen(false)}
        footer={(
          <div className="btn-row">
            <button type="submit" form="source-form" className="btn btn-primary" disabled={createBusy}>
              {createBusy ? 'Добавляем…' : 'Добавить источник'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setCreateOpen(false)} disabled={createBusy}>
              Отмена
            </button>
          </div>
        )}
      >
        <form id="source-form" onSubmit={submitSource}>
          <div className="form-grid">
            <Field label="Название" htmlFor="source-name">
              <TextInput
                id="source-name"
                value={sourceForm.name}
                onChange={(event) => setSourceForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Канал про код"
              />
            </Field>
            <Field label="Тип источника" htmlFor="source-type">
              <Select
                id="source-type"
                value={sourceForm.source_type}
                onChange={(event) => setSourceForm((prev) => ({ ...prev, source_type: event.target.value }))}
              >
                {SOURCE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </Select>
            </Field>
            <div className="span-2">
              <Field label="Ссылка" htmlFor="source-url" hint="https://t.me/s/code">
                <TextInput
                  id="source-url"
                  value={sourceForm.source_url}
                  onChange={(event) => setSourceForm((prev) => ({ ...prev, source_url: event.target.value }))}
                  placeholder="https://t.me/s/code"
                />
              </Field>
            </div>
          </div>
          {createError && <InlineError error={createError} />}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteSource)}
        title="Удалить источник?"
        confirmLabel="Удалить источник"
        busy={deleteBusy}
        danger
        onConfirm={confirmDeleteSource}
        onCancel={() => { setDeleteSource(null); setDeleteError(null) }}
      >
        <p style={{ marginTop: 0 }}>
          Источник «{deleteSource?.name}» удалится вместе со всеми найденными комментариями и ответами.
        </p>
        {deleteError && <InlineError error={deleteError} />}
      </ConfirmDialog>

      {consent.modal}
    </>
  )
}
