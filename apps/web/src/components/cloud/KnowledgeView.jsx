import { useEffect, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import { fmtDateTime, fmtPercent, isOffline, plural } from '../../lib/format.js'
import {
  ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Loading, Metric, Modal,
  Tag, TextInput,
} from '../ui.jsx'
import { Reveal, Stagger } from '../ui/Motion.jsx'
import Accordion from '../ui/Accordion.jsx'

const EMPTY_FORM = { title: '', content: '' }

/**
 * База знаний канала: факты автора, по которым RAG-поиск собирает опору,
 * чтобы AI не выдумывал данных. Поиск — `GET …/knowledge/search` с score
 * и chunk_text.
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
            <p>Факты канала «{channel.name}»: их RAG-поиск подставляет движку, чтобы тот не выдумывал.</p>
          </div>
          <div className="spacer" />
          <span className="faint">{items.length} {plural(items.length, 'факт', 'факта', 'фактов')}</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={openCreate}>+ Факт</button>
        </div>

        {state === 'loading' && <Loading label="Загружаем факты…" />}

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
            <h2>RAG-поиск</h2>
            <p>Косинусное расстояние по векторам фактов: score и найденный фрагмент.</p>
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
            {/* Модель эмбеддингов — идентификатор, не число: раньше она
                попадала в ту же сетку фактов и получала крупную антикву
                стата, из-за чего длинная строка вроде «text-embedding-3-small»
                переламывалась на три строки. Факты остаются фактами,
                идентификатор — подписью рядом с ними. */}
            <div className="metrics metrics-compact" style={{ margin: '14px 0' }}>
              <Metric value={(searchResult.items || []).length} label="найдено фрагментов" />
              <Metric value={searchResult.searched_chunks ?? '—'} label="проверено чанков" />
            </div>
            {searchResult.query_embedding_model && (
              <p className="faint" style={{ marginTop: -6, marginBottom: 14 }}>
                модель эмбеддингов: <code>{searchResult.query_embedding_model}</code>
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
                      <span className="list-item-title">{hit.title || `Факт №${hit.knowledge_id}`}</span>
                      <Tag>score {fmtPercent(hit.score, 0)}</Tag>
                      <div className="spacer" />
                      {hit.chunk_index !== undefined && (
                        <span className="list-item-meta">чанк {hit.chunk_index}</span>
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
            <div className="state-title">Проверьте, что найдёт движок</div>
            <div className="state-text">
              Поиск работает по векторам фактов. Нужен работающий сервер — если модель
              эмбеддингов недоступна, он ответит 503, остальные функции продолжат работать.
            </div>
          </div>
        )}

        {searchResult && (
          <div className="faint" style={{ marginTop: 10 }}>
            Источник ответа — база знаний канала. Слайс на 2–3 лучших фрагмента попадает в контекст
            генерации, поэтому факты должны быть короткими и точными.
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
            <Field label="Факт" hint="Один факт — одна короткая запись: так RAG точнее." htmlFor="knowledge-content">
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
          Факт «{deleteTarget?.title}» и его векторы удалятся — RAG перестанет его находить.
        </p>
        {deleteError && <InlineError error={deleteError} />}
      </ConfirmDialog>
    </div>
  )
}
