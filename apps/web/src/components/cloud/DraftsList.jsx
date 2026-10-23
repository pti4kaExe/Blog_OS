import { useEffect, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import { apiErrorMessage, DRAFT_STATUSES, fmtDateTime, plural } from '../../lib/format.js'
import {
  ConfirmDialog, EmptyState, ErrorState, InlineError, Loading, StatusTag, Tag,
} from '../ui.jsx'

const FILTERS = [
  { value: '', label: 'Все' },
  ...DRAFT_STATUSES.map((status) => ({ value: status.value, label: status.label })),
]

/**
 * Список черновиков канала с фильтром по статусу.
 * Нужен, чтобы вернуться к работе, продолжить правку или опубликовать черновик.
 */
export default function DraftsList({
  channel, refreshKey = 0, onOpenDraft, loadingDraftId, onChanged, onUseLocal,
}) {
  const [status, setStatus] = useState('')
  const [items, setItems] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    let alive = true
    setState('loading')
    setError(null)
    api.drafts.list(channel.id, { status: status || undefined, limit: 20 })
      .then((payload) => {
        if (!alive) return
        setItems(itemsOf(payload))
        setState('ready')
      })
      .catch((listError) => {
        if (!alive) return
        setError(listError)
        setState('error')
      })
    return () => { alive = false }
  }, [channel.id, status, refreshKey, reloadKey])

  const reload = () => setReloadKey((key) => key + 1)

  const remove = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.drafts.remove(deleteTarget.id)
      setDeleteTarget(null)
      reload()
      onChanged?.()
    } catch (removeError) {
      setDeleteError(removeError)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h2>Мои черновики</h2>
          <p>Черновики канала «{channel.name}»: продолжить правку или посмотреть проверки.</p>
        </div>
        <div className="spacer" />
        <span className="faint">
          {items.length} {plural(items.length, 'черновик', 'черновика', 'черновиков')}
        </span>
      </div>

      <div className="tabs" role="tablist" style={{ marginBottom: 12, width: 'fit-content', maxWidth: '100%', overflowX: 'auto' }}>
        {FILTERS.map((filter) => (
          <button
            key={filter.value || 'all'}
            type="button"
            className="tab"
            role="tab"
            aria-selected={status === filter.value}
            onClick={() => setStatus(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {state === 'loading' && <Loading label="Загружаем черновики…" />}

      {state === 'error' && (
        <ErrorState error={error} onRetry={reload}>
          {onUseLocal && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>Работать локально</button>
          )}
        </ErrorState>
      )}

      {state === 'ready' && items.length === 0 && (
        <EmptyState title="Черновиков пока нет">
          Соберите первый черновик из заметок на шаге «Заметки» — он появится здесь.
        </EmptyState>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="list">
          {items.map((draft) => {
            const text = draft.text || ''
            const preview = text.length > 220 ? `${text.slice(0, 220)}…` : text
            return (
              <div className="list-item" key={draft.id}>
                <div className="list-item-head">
                  <span className="list-item-title">{draft.title || 'Без названия'}</span>
                  <StatusTag list={DRAFT_STATUSES} value={draft.status} />
                  {draft.origin === 'narrative_engine' && <Tag kind="accent">собран движком</Tag>}
                  {draft.arc && <Tag>{draft.arc}</Tag>}
                  <div className="spacer" />
                  <span className="list-item-meta">обновлён {fmtDateTime(draft.updated_at)}</span>
                </div>
                {preview && <div className="list-item-text">{preview}</div>}
                <div className="list-item-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={loadingDraftId === draft.id}
                    onClick={() => onOpenDraft(draft.id)}
                  >
                    {loadingDraftId === draft.id ? 'Открываем…' : 'Открыть'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => { setDeleteError(null); setDeleteTarget(draft) }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {deleteError && <InlineError error={deleteError} />}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить черновик?"
        confirmLabel="Удалить"
        busy={deleteBusy}
        danger
        onConfirm={remove}
        onCancel={() => { setDeleteTarget(null); setDeleteError(null) }}
      >
        <p style={{ marginTop: 0 }}>
          Черновик «{deleteTarget?.title || 'Без названия'}» и все его отчёты AntiCringe удалятся
          без возможности восстановления.
        </p>
        {deleteError && <InlineError error={deleteError} />}
      </ConfirmDialog>
    </section>
  )
}
