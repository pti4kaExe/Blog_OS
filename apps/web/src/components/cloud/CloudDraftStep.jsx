import { useEffect, useState } from 'react'
import {
  arcLabel, CLOUD_ARCS, DRAFT_STATUSES, fmtDateTime, hasUnfilledGaps,
} from '../../lib/format.js'
import {
  AiBadge, CopyButton, InlineError, Notice, Select, StatusTag, Tag, TextInput,
} from '../ui.jsx'

const ROLE_LABELS = {
  hook: 'Зацепка',
  context: 'Как было до',
  conflict: 'Проблема',
  insight: 'Что изменилось',
  evidence: 'Доказательство',
  takeaway: 'Вывод',
  cta: 'Вопрос читателю',
}

/**
 * Шаг 3 в облаке. Narrative Engine вернул блоки арки и список добавленного,
 * черновик можно править и сохранять через `PATCH /drafts/{id}`.
 */
export default function CloudDraftStep({
  channel, draft, build, verifiedWithoutAi, saving, saveError, onSave, onStep, onDrafts,
}) {
  const [text, setText] = useState(draft.text || '')
  const [title, setTitle] = useState(draft.title || '')
  const [arc, setArc] = useState(draft.arc || null)
  const [editing, setEditing] = useState(!build)
  const [localError, setLocalError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [busyNext, setBusyNext] = useState(false)

  useEffect(() => {
    setText(draft.text || '')
    setTitle(draft.title || '')
    setArc(draft.arc || null)
  }, [draft.id, draft.updated_at])

  const dirty = text !== (draft.text || '')
    || title !== (draft.title || '')
    || (arc || null) !== (draft.arc || null)

  const save = async () => {
    setLocalError(null)
    const updated = await onSave({
      text,
      title: title.trim() ? title.trim() : null,
      arc: arc || null,
    })
    setSavedAt(new Date())
    return updated
  }

  const saveClick = async () => {
    try {
      await save()
    } catch {
      // ошибка уже показана родителем через saveError
    }
  }

  const goCheck = async () => {
    if (!text.trim()) {
      setLocalError('В черновике нет текста — добавьте хотя бы одно предложение.')
      return
    }
    setLocalError(null)
    setBusyNext(true)
    try {
      if (dirty) await save()
      onStep(4)
    } catch {
      // saveError покажет причину
    } finally {
      setBusyNext(false)
    }
  }

  const addedByEngine = build?.added_by_engine || []
  const gapsLeft = hasUnfilledGaps(text)

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Собранный черновик</h2>
            <p>
              Арка: {arcLabel(build?.arc || draft.arc)}
              {build?.arc_auto ? ' · выбрана автоматически' : ''}
              {' '}· обновлён {fmtDateTime(draft.updated_at)}
            </p>
          </div>
          <div className="spacer" />
          <StatusTag list={DRAFT_STATUSES} value={draft.status} />
          <CopyButton text={text} />
        </div>

        {build && (
          <>
            <h3>Блоки арки</h3>
            <div className="blocks" style={{ marginBottom: 16 }}>
              {(build.blocks || []).map((block, index) => (
                <div className="block" data-role={block.role} key={`${block.role}-${index}`}>
                  <div className="block-label">{ROLE_LABELS[block.role] || block.role}</div>
                  <div className="block-text">{block.text}</div>
                  {block.fragment && (
                    <div className="faint" style={{ marginTop: 2 }}>из заметки: {block.fragment}</div>
                  )}
                </div>
              ))}
              {(build.blocks || []).length === 0 && (
                <div className="faint">Сервер вернул черновик без блоков арки.</div>
              )}
            </div>
          </>
        )}

        {!build && (
          <div style={{ marginBottom: 14 }}>
            <Notice>
              Черновик открыт из списка. Блоки арки показываются только для свежей сборки —
              но текст можно править и дальше проверять как обычно.
            </Notice>
          </div>
        )}

        <div className="card-head" style={{ marginBottom: 8 }}>
          <div><h2 style={{ fontSize: 15 }}>Текст черновика</h2></div>
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Показать через блоки' : 'Править текст'}
          </button>
        </div>

        {editing || !build ? (
          <textarea
            className="ta"
            style={{ minHeight: 280 }}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Текст черновика…"
          />
        ) : (
          <div className="post-text">{text}</div>
        )}

        {gapsLeft && (
          <div style={{ marginTop: 12 }}>
            <Notice kind="warn">
              В тексте есть незаполненные пропуски <code>[дополните: …]</code>. Их нужно заполнить
              своим опытом — с ними публикация и одобрение ответов недоступны.
            </Notice>
          </div>
        )}

        <InlineError error={localError} />
        {saveError && <InlineError error={saveError} />}

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-primary" onClick={goCheck} disabled={busyNext || saving}>
            {busyNext ? 'Сохраняем…' : 'Проверить в AntiCringe →'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={saveClick} disabled={saving || !dirty}>
            {saving ? 'Сохраняем…' : dirty ? 'Сохранить черновик' : 'Сохранено'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onStep(2)} disabled={busyNext}>
            ← Заметки
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDrafts} disabled={busyNext}>
            Мои черновики
          </button>
        </div>
        {savedAt && <p className="faint" style={{ marginBottom: 0, marginTop: 8 }}>Сохранено в {savedAt.toLocaleTimeString('ru-RU')}</p>}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Что сделал движок</h2>
            <p>Ваши формулировки не переписываются — меняется порядок и ритм.</p>
          </div>
        </div>

        <div className="metrics" style={{ marginBottom: 14 }}>
          <div className="metric">
            <div className="metric-val">{build?.notes_used ?? '—'}</div>
            <div className="metric-key">заметок использовано</div>
          </div>
          <div className="metric">
            <div className="metric-val">{build?.notes_dropped ?? '—'}</div>
            <div className="metric-key">потеряно</div>
          </div>
          <div className="metric">
            <div className="metric-val">{(build?.blocks || []).length}</div>
            <div className="metric-key">блоков арки</div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <AiBadge withoutAi={verifiedWithoutAi} />
        </div>

        <h3>Добавлено движком</h3>
        {addedByEngine.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Ничего — черновик собран целиком из ваших строк.
          </p>
        ) : (
          <div className="chips" style={{ marginBottom: 12 }}>
            {addedByEngine.map((item, index) => (
              <Tag key={`${index}-${typeof item === 'string' ? item : JSON.stringify(item)}`}>
                {typeof item === 'string' ? item : item.text || JSON.stringify(item)}
              </Tag>
            ))}
          </div>
        )}

        <hr className="hr" />

        <h3>Название и арка</h3>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="span-2">
            <label className="field">
              <span className="field-label">Название черновика</span>
              <TextInput
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Черновик"
                maxLength={200}
              />
            </label>
          </div>
          <div className="span-2">
            <label className="field">
              <span className="field-label">Сюжетная арка</span>
              <Select value={arc || ''} onChange={(event) => setArc(event.target.value || null)}>
                <option value="">Автоматически</option>
                {CLOUD_ARCS.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </Select>
              <span className="field-hint">Арка сохранится в черновике; для пересборки вернитесь к заметкам.</span>
            </label>
          </div>
        </div>

        <Notice>
          Черновик канала «{channel.name}». Публикация не отправляет пост на площадку — она
          фиксирует факт публикации в архиве BlogOS.
        </Notice>
      </section>
    </div>
  )
}
