import { useCallback, useEffect, useState } from 'react'
import draftVersions, { draftVersionsAreMocked } from '../../api/draftVersions.js'
import { fmtDateTime, plural } from '../../lib/format.js'
import {
  ConfirmDialog, EmptyState, ErrorState, InlineError, Loading, Modal, Notice, Tag,
} from '../ui.jsx'

const ORIGIN_LABELS = {
  author: 'правка автора',
  narrative_engine: 'сборка движком',
  autofix: 'автоправки AntiCringe',
}

/**
 * История версий черновика.
 *
 * Стандарт пишущих инструментов: текст правится много раз, и возможность
 * вернуться к позавчерашней формулировке — то, чего ждут от редактора.
 * Здесь это особенно нужно: автоправки AntiCringe меняют текст пачкой,
 * и без истории отменить их можно только руками.
 *
 * Серверного метода пока нет — данные идут из мок-слоя через фасад
 * `api/draftVersions.js`. Контракт описан в отчёте.
 */
export default function DraftVersions({ draft, refreshKey = 0, onRestore }) {
  const [items, setItems] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [preview, setPreview] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreError, setRestoreError] = useState(null)

  const load = useCallback(() => setReloadKey((key) => key + 1), [])

  useEffect(() => {
    let alive = true
    setState('loading')
    setError(null)
    draftVersions.list(draft.id, { limit: 20 })
      .then((payload) => {
        if (!alive) return
        setItems(Array.isArray(payload?.items) ? payload.items : [])
        setState('ready')
      })
      .catch((listError) => {
        if (!alive) return
        setError(listError)
        setState('error')
      })
    return () => { alive = false }
  }, [draft.id, refreshKey, reloadKey])

  const confirmRestore = async () => {
    if (!restoreTarget) return
    setRestoreBusy(true)
    setRestoreError(null)
    try {
      /* Текущий текст сначала становится версией — возврат обратим. */
      await draftVersions.create(draft.id, { text: draft.text, title: draft.title, origin: 'author' })
      const result = await draftVersions.restore(restoreTarget.id)
      await onRestore(result)
      setRestoreTarget(null)
      load()
    } catch (error_) {
      setRestoreError(error_)
    } finally {
      setRestoreBusy(false)
    }
  }

  const current = String(draft.text || '')

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <div>
          <h2>История версий</h2>
          <p>Каждое сохранение и каждая пачка автоправок остаются здесь.</p>
        </div>
        <div className="spacer" />
        {draftVersionsAreMocked && <Tag kind="demo">на моках</Tag>}
      </div>

      {state === 'loading' && <Loading label="Загружаем историю…" />}

      {state === 'error' && <ErrorState error={error} onRetry={load} />}

      {state === 'ready' && items.length === 0 && (
        <EmptyState title="Версий пока нет">
          Сохраните черновик или примените автоправки — предыдущий текст
          останется здесь, и к нему можно будет вернуться.
        </EmptyState>
      )}

      {state === 'ready' && items.length > 0 && (
        <div className="list">
          {items.map((version) => {
            const diff = version.chars - current.length
            const isCurrent = version.text === current
            return (
              <div className="list-item" key={version.id}>
                <div className="list-item-head">
                  <span className="list-item-title">Версия {version.version}</span>
                  <Tag>{ORIGIN_LABELS[version.origin] || version.origin}</Tag>
                  {isCurrent && <Tag kind="good">совпадает с текущим</Tag>}
                  <div className="spacer" />
                  <span className="list-item-meta">{fmtDateTime(version.created_at)}</span>
                </div>
                <div className="list-item-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setPreview(version)}>
                    Посмотреть
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={isCurrent}
                    onClick={() => { setRestoreError(null); setRestoreTarget(version) }}
                  >
                    Вернуть этот текст
                  </button>
                  <div className="spacer" />
                  <span className="faint">
                    {version.chars.toLocaleString('ru-RU')} символов
                    {diff !== 0 && ` · ${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString('ru-RU')} к текущему`}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {restoreError && <InlineError error={restoreError} />}

      <Modal
        open={Boolean(preview)}
        wide
        title={preview ? `Версия ${preview.version} · ${fmtDateTime(preview.created_at)}` : ''}
        onClose={() => setPreview(null)}
        footer={(
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={preview?.text === current}
              onClick={() => { setRestoreTarget(preview); setPreview(null) }}
            >
              Вернуть этот текст
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPreview(null)}>Закрыть</button>
            <div className="spacer" />
            <span className="faint">{(preview?.chars ?? 0).toLocaleString('ru-RU')} символов</span>
          </div>
        )}
      >
        <div className="post-text">{preview?.text}</div>
      </Modal>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        title={`Вернуть версию ${restoreTarget?.version ?? ''}?`}
        confirmLabel="Вернуть"
        busy={restoreBusy}
        onConfirm={confirmRestore}
        onCancel={() => { setRestoreTarget(null); setRestoreError(null) }}
      >
        <p style={{ marginTop: 0 }}>
          Текущий текст черновика не пропадёт — перед заменой он сам станет
          версией, и к нему можно будет вернуться так же.
        </p>
        {restoreError && <InlineError error={restoreError} />}
      </ConfirmDialog>

      {draftVersionsAreMocked && (
        <Notice>
          История версий работает на моках: она живёт в этом браузере и не уедет
          на другое устройство. Когда появятся методы <code>/drafts/{'{id}'}/versions</code>,
          экран не изменится — переключается одним флагом.
        </Notice>
      )}
    </section>
  )
}
