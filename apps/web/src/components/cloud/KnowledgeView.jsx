import { useEffect, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import {
  clamp, fmtDateTime, fmtPercent, isOffline, plural,
} from '../../lib/format.js'
import {
  ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Metric, Modal,
  Tag, TextInput,
} from '../ui.jsx'
import { SkeletonList, SkeletonRegion } from '../ui/Skeleton.jsx'
import { Reveal, Stagger } from '../ui/Motion.jsx'
import Accordion from '../ui/Accordion.jsx'

const EMPTY_FORM = { title: '', content: '' }

/**
 * База знаний канала: факты автора, на которые опирается движок, чтобы не
 * выдумывать данные. Поиск по смыслу — `GET …/knowledge/search`; в
 * интерфейсе его результаты названы отрывками и процентом совпадения,
 * потому что автор работает с фактами, а не с векторами.
 */
export default function KnowledgeView({ channel, onUseLocal }) {
  const [items, setItems] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const [openIds, setOpenIds] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [searchResult, setSearchResult] = useState(null)
  const [searchTouched, setSearchTouched] = useState(false)

  useEffect(() => {
    let alive = true
    setState('loading')
    setError(null)
    api.knowledge.list(channel.id, { limit: 100 })
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
  }, [channel.id, reloadKey])

  const reload = () => setReloadKey((key) => key + 1)

  const toggleOpen = (id) => setOpenIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (item) => {
    setEditing(item)
    setForm({ title: item.title || '', content: item.content || '' })
    setFormError(null)
    setFormOpen(true)
  }

  const submitForm = async (event) => {
    event.preventDefault()
    if (!form.title.trim() || !form.content.trim()) {
      setFormError({ code: 'validation_error', message: 'Заполните заголовок и текст факта.' })
      return
    }
    setFormBusy(true)
    setFormError(null)
    try {
      if (editing) {
        await api.knowledge.update(editing.id, { title: form.title.trim(), content: form.content.trim() })
      } else {
        await api.knowledge.create(channel.id, { title: form.title.trim(), content: form.content.trim() })
      }
      setFormOpen(false)
      setEditing(null)
      reload()
    } catch (submitError) {
      setFormError(submitError)
    } finally {
      setFormBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.knowledge.remove(deleteTarget.id)
      setDeleteTarget(null)
      reload()
    } catch (removeError) {
      setDeleteError(removeError)
    } finally {
      setDeleteBusy(false)
    }
  }

  const search = async (event) => {
    event.preventDefault()
    if (!query.trim()) {
      setSearchError({ code: 'validation_error', message: 'Введите запрос — например «сколько лет в аналитике».' })
      return
    }
    setSearchBusy(true)
    setSearchError(null)
    setSearchTouched(true)
    try {
      const result = await api.knowledge.search(channel.id, { q: query.trim(), limit: 5 })
      setSearchResult(result)
    } catch (runError) {
      setSearchResult(null)
      setSearchError(runError)
    } finally {
      setSearchBusy(false)
    }
  }

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>База знаний</h2>
            <p>Факты канала «{channel.name}». Движок опирается на них, чтобы не выдумывать за вас.</p>
          </div>
          <div className="spacer" />
          <span className="faint">{items.length} {plural(items.length, 'факт', 'факта', 'фактов')}</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={openCreate}>+ Факт</button>
        </div>

        {state === 'loading' && (
          <SkeletonRegion loading label="Загружаем факты…" fallback={<SkeletonList rows={4} lines={0} />} />
        )}

        {state === 'error' && (
          <ErrorState error={error} onRetry={reload}>
            {isOffline(error) && onUseLocal && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>Работать локально</button>
            )}
          </ErrorState>
        )}

        {state === 'ready' && items.length === 0 && (
          <EmptyState
            title="Фактов пока нет"
            action={<button type="button" className="btn btn-sm" onClick={openCreate}>Добавить первый факт</button>}
          >
            «Работаю в продуктовой аналитике с 2019 года», «веду канал с 2023 года» —
            такие факты делают ответы точными.
          </EmptyState>
        )}

        {/* Аккордеон, не список открытых карточек: заголовок крупнее и
            виден весь список фактов сразу, тело читаешь только у того
            факта, который сейчас интересен. */}
        {state === 'ready' && items.length > 0 && (
          <Stagger className="accordion-list list-scroll" replay={reloadKey}>
            {items.map((item) => (
              <Reveal key={item.id}>
                <Accordion
                  title={item.title}
                  meta={fmtDateTime(item.updated_at || item.created_at)}
                  open={openIds.has(item.id)}
                  onToggle={() => toggleOpen(item.id)}
                  actions={(
                    <>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => openEdit(item)}>Изменить</button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => { setDeleteError(null); setDeleteTarget(item) }}
                      >
                        Удалить
                      </button>
                    </>
                  )}
                >
                  {item.content}
                </Accordion>
              </Reveal>
            ))}
          </Stagger>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Что найдёт движок</h2>
            <p>Спросите так, как спросил бы читатель, — и увидите, на какие ваши факты
              обопрётся ответ.</p>
          </div>
        </div>

        <form onSubmit={search}>
          <div className="filter-row">
            <label className="field" style={{ flex: '1 1 220px' }}>
              <span className="field-label">Запрос</span>
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="сколько лет в аналитике"
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={searchBusy}>
              {searchBusy ? 'Ищем…' : 'Найти'}
            </button>
          </div>
        </form>

        <InlineError error={searchError} />

        {searchResult && (
          <>
            {/* Название модели — идентификатор, не число: в сетке статов
                оно получало крупную антикву и переламывалось на три
                строки. Автору оно нужно разве что при разборе сбоя,
                поэтому ушло в тихую подпись. */}
            <div className="metrics metrics-compact" style={{ margin: '14px 0' }}>
              <Metric value={(searchResult.items || []).length} label="подходящих отрывков" />
              <Metric value={searchResult.searched_chunks ?? '—'} label="отрывков просмотрено" />
            </div>
            {searchResult.query_embedding_model && (
              <p className="faint" style={{ marginTop: -6, marginBottom: 14 }}>
                модель поиска: <code>{searchResult.query_embedding_model}</code>
              </p>
            )}

            {(searchResult.items || []).length === 0 ? (
              <EmptyState title="Ничего не найдено">
                Попробуйте сформулировать запрос иначе или добавьте факт в базу знаний.
              </EmptyState>
            ) : (
              <div className="list">
                {searchResult.items.map((hit) => (
                  <div className="list-item" key={`${hit.knowledge_id}-${hit.chunk_index ?? 0}`}>
                    <div className="list-item-head">
                      <span className="list-item-title">{hit.title || 'Факт без заголовка'}</span>
                      {/* Сервер отдаёт косинусную близость в диапазоне −1…1
                          (`1 - (embedding <=> vector)`). Отрицательное значение
                          означает «смысл противоположный» — для автора это
                          просто ноль совпадения, а не «минус один процент». */}
                      <Tag>совпадение {fmtPercent(clamp(hit.score, 0, 1), 0)}</Tag>
                      <div className="spacer" />
                      {hit.chunk_index !== undefined && (
                        <span className="list-item-meta">отрывок {hit.chunk_index + 1}</span>
                      )}
                    </div>
                    <div className="list-item-text">{hit.chunk_text}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Один блок объяснения, а не два подряд: до поиска — что и как
            проверить, после — что это значит для генерации. Раньше здесь
            стояли оба сразу и читались одним сплошным текстом. */}
        {!searchResult && !searchTouched && (
          <div className="state" style={{ marginTop: 14 }}>
            <div className="state-icon" aria-hidden="true">·</div>
            <div className="state-title">Проверьте себя перед сборкой поста</div>
            <div className="state-text">
              Спросите то, о чём вас обычно спрашивают читатели. Если движок ничего не найдёт,
              значит факта в базе нет — и в тексте на его месте останется пропуск.
            </div>
          </div>
        )}

        {searchResult && (
          <div className="faint" style={{ marginTop: 10 }}>
            В пост и в ответы попадут два-три самых подходящих отрывка. Поэтому факты лучше
            держать короткими и точными: длинный рассказ движок возьмёт кусками.
          </div>
        )}
      </section>

      <Modal
        open={formOpen}
        title={editing ? 'Изменить факт' : 'Новый факт'}
        onClose={formBusy ? undefined : () => setFormOpen(false)}
        footer={(
          <div className="btn-row">
            <button type="submit" form="knowledge-form" className="btn btn-primary" disabled={formBusy}>
              {formBusy ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить факт'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)} disabled={formBusy}>
              Отмена
            </button>
          </div>
        )}
      >
        <form id="knowledge-form" onSubmit={submitForm}>
          <Field label="Заголовок" htmlFor="knowledge-title">
            <TextInput
              id="knowledge-title"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Обо мне"
              maxLength={200}
            />
          </Field>
          <div style={{ marginTop: 12 }}>
            <Field label="Факт" hint="Один факт — одна короткая запись: так движок точнее находит нужное." htmlFor="knowledge-content">
              <textarea
                id="knowledge-content"
                className="ta"
                style={{ minHeight: 140 }}
                value={form.content}
                onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
                placeholder="Работаю в продуктовой аналитике с 2019 года"
              />
            </Field>
          </div>
          {formError && <InlineError error={formError} />}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить факт?"
        confirmLabel="Удалить"
        busy={deleteBusy}
        danger
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteTarget(null); setDeleteError(null) }}
      >
        <p style={{ marginTop: 0 }}>
          Факт «{deleteTarget?.title}» удалится, и движок перестанет его находить.
        </p>
        {deleteError && <InlineError error={deleteError} />}
      </ConfirmDialog>
    </div>
  )
}
