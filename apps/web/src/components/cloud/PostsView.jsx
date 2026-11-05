import { useEffect, useMemo, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import {
  contentLimit, contentTypesFor, CONTENT_TYPES, defaultContentType,
  fmtDateTime, isOffline, labelOf, PLATFORMS, plural,
} from '../../lib/format.js'
import {
  CharCounter, ConfirmDialog, EmptyState, ErrorState, Field, InlineError, Loading,
  Modal, Notice, Select, Tag, TextInput,
} from '../ui.jsx'
import { Reveal, Stagger } from '../ui/Motion.jsx'

/** `2026-10-28T09:10:00Z` → `2026-10-28T09:10` для `<input type="datetime-local">`. */
function toLocalInput(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function emptyForm(platform) {
  return {
    content_type: defaultContentType(platform),
    text: '',
    external_url: '',
    published_at: '',
  }
}

/**
 * Архив опубликованных постов канала.
 *
 * ТЗ, раздел 3: «Архив опубликованных постов и их импорт с площадок» —
 * чтобы профиль стиля строился по реальной истории публикаций, а не только
 * по трём текстам, вставленным руками. API существовал целиком
 * (`/author-profiles/{id}/posts`, 6 методов), в интерфейсе не было ничего.
 *
 * Дедупликация импорта — на сервере, по паре `(author_id, external_id)`.
 */
export default function PostsView({ channel, onUseLocal, onAnalyzeArchive }) {
  const types = useMemo(() => contentTypesFor(channel.platform), [channel.platform])

  const [items, setItems] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [cursor, setCursor] = useState(null)
  const [moreBusy, setMoreBusy] = useState(false)

  const [typeFilter, setTypeFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(() => emptyForm(channel.platform))
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState(null)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importForm, setImportForm] = useState({ source_url: '', limit: 50 })
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState(null)
  const [importResult, setImportResult] = useState(null)

  useEffect(() => {
    let alive = true
    setState('loading')
    setError(null)
    api.posts.list(channel.id, {
      content_type: typeFilter || undefined,
      from: from || undefined,
      to: to || undefined,
      limit: 20,
    })
      .then((payload) => {
        if (!alive) return
        setItems(itemsOf(payload))
        setCursor(payload && payload.next_cursor ? payload.next_cursor : null)
        setState('ready')
      })
      .catch((listError) => {
        if (!alive) return
        setError(listError)
        setState('error')
      })
    return () => { alive = false }
  }, [channel.id, typeFilter, from, to, reloadKey])

  const reload = () => setReloadKey((key) => key + 1)

  const loadMore = async () => {
    if (!cursor) return
    setMoreBusy(true)
    try {
      const payload = await api.posts.list(channel.id, {
        content_type: typeFilter || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 20,
        cursor,
      })
      setItems((prev) => [...prev, ...itemsOf(payload)])
      setCursor(payload && payload.next_cursor ? payload.next_cursor : null)
    } catch (moreError) {
      setError(moreError)
    } finally {
      setMoreBusy(false)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm(channel.platform))
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (post) => {
    setEditing(post)
    setForm({
      content_type: post.content_type || defaultContentType(channel.platform),
      text: post.text || '',
      external_url: post.external_url || '',
      published_at: toLocalInput(post.published_at),
    })
    setFormError(null)
    setFormOpen(true)
  }

  const limit = contentLimit(form.content_type)
  const tooLong = Boolean(limit) && form.text.length > limit

  const submitForm = async (event) => {
    event.preventDefault()
    if (!form.text.trim()) {
      setFormError({ code: 'validation_error', message: 'Вставьте текст поста.' })
      return
    }
    if (tooLong) {
      setFormError({
        code: 'unprocessable',
        message: `Текст длиннее лимита площадки: ${limit} символов. Сейчас ${form.text.length}.`,
      })
      return
    }
    setFormBusy(true)
    setFormError(null)
    const body = {
      content_type: form.content_type,
      text: form.text.trim(),
      external_url: form.external_url.trim() || null,
      published_at: form.published_at ? new Date(form.published_at).toISOString() : null,
    }
    try {
      if (editing) {
        await api.posts.update(channel.id, editing.id, body)
      } else {
        await api.posts.create(channel.id, body)
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
      await api.posts.remove(channel.id, deleteTarget.id)
      setDeleteTarget(null)
      reload()
    } catch (removeError) {
      setDeleteError(removeError)
    } finally {
      setDeleteBusy(false)
    }
  }

  const runImport = async (event) => {
    event.preventDefault()
    if (!importForm.source_url.trim()) {
      setImportError({ code: 'validation_error', message: 'Укажите ссылку на канал или профиль.' })
      return
    }
    setImportBusy(true)
    setImportError(null)
    setImportResult(null)
    try {
      const result = await api.posts.import(channel.id, {
        platform: channel.platform,
        source_url: importForm.source_url.trim(),
        limit: Number(importForm.limit) || 50,
      })
      setImportResult(result)
      reload()
    } catch (error_) {
      setImportError(error_)
    } finally {
      setImportBusy(false)
    }
  }

  const resetFilters = () => {
    setTypeFilter('')
    setFrom('')
    setTo('')
  }

  const filtered = typeFilter || from || to

  return (
    <>
      <header className="stage-head">
        <div className="head-row">
          <div>
            <h1>Архив постов</h1>
            <p className="lead">
              Опубликованные тексты канала «{channel.name}». Профиль стиля можно построить
              прямо по архиву — это точнее, чем по трём текстам, вставленным руками.
            </p>
          </div>
          <div className="spacer" />
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => { setImportResult(null); setImportError(null); setImportOpen(true) }}>
              Импорт с площадки
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={openCreate}>
              + Пост
            </button>
          </div>
        </div>
      </header>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Публикации</h2>
            <p>Отсортированы от свежих к старым.</p>
          </div>
          <div className="spacer" />
          <span className="faint">
            {items.length} {plural(items.length, 'пост', 'поста', 'постов')}
            {cursor ? ' и ещё есть' : ''}
          </span>
        </div>

        <div className="filter-row">
          <Field label="Тип" htmlFor="posts-type">
            <Select
              id="posts-type"
              className="inp-sm"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">Все типы</option>
              {types.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="С даты" htmlFor="posts-from">
            <TextInput
              id="posts-from"
              className="inp-sm"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="По дату" htmlFor="posts-to">
            <TextInput
              id="posts-to"
              className="inp-sm"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          {filtered && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={resetFilters}>Сбросить</button>
          )}
        </div>

        {state === 'loading' && <Loading label="Загружаем архив…" />}

        {state === 'error' && (
          <ErrorState error={error} onRetry={reload}>
            {isOffline(error) && onUseLocal && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>
                Работать локально
              </button>
            )}
          </ErrorState>
        )}

        {state === 'ready' && items.length === 0 && (
          <EmptyState
            title={filtered ? 'Под фильтр ничего не попало' : 'Архив пуст'}
            action={filtered ? (
              <button type="button" className="btn btn-sm" onClick={resetFilters}>Сбросить фильтры</button>
            ) : (
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>Добавить пост</button>
                <button type="button" className="btn btn-sm" onClick={() => setImportOpen(true)}>Импорт с площадки</button>
              </div>
            )}
          >
            {filtered
              ? 'Попробуйте другой тип контента или более широкий диапазон дат.'
              : 'Вставьте пару своих публикаций руками или импортируйте их с площадки — архив станет материалом для профиля стиля.'}
          </EmptyState>
        )}

        {items.length > 0 && (
          <>
            <Stagger className="list" replay={reloadKey}>
              {items.map((post) => {
                const text = post.text || ''
                const preview = text.length > 260 ? `${text.slice(0, 260)}…` : text
                return (
                  <Reveal className="list-item" key={post.id}>
                    <div className="list-item-head">
                      <span className="list-item-title">
                        {labelOf(CONTENT_TYPES, post.content_type)}
                      </span>
                      {post.external_id && <Tag>из импорта</Tag>}
                      <div className="spacer" />
                      <span className="list-item-meta">
                        {post.published_at ? fmtDateTime(post.published_at) : `добавлен ${fmtDateTime(post.created_at)}`}
                      </span>
                    </div>
                    <div className="list-item-text">{preview}</div>
                    <div className="list-item-actions">
                      <button type="button" className="btn btn-sm" onClick={() => openEdit(post)}>Изменить</button>
                      {post.external_url && (
                        <a
                          className="btn btn-sm btn-ghost"
                          href={post.external_url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Открыть на площадке
                        </a>
                      )}
                      <div className="spacer" />
                      <span className="faint">{text.length.toLocaleString('ru-RU')} символов</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => { setDeleteError(null); setDeleteTarget(post) }}
                      >
                        Удалить
                      </button>
                    </div>
                  </Reveal>
                )
              })}
            </Stagger>

            {cursor && (
              <div className="btn-row" style={{ marginTop: 12, justifyContent: 'center' }}>
                <button type="button" className="btn btn-sm" onClick={loadMore} disabled={moreBusy}>
                  {moreBusy ? 'Загружаем…' : 'Показать ещё'}
                </button>
              </div>
            )}

            {onAnalyzeArchive && (
              <Notice>
                В архиве есть материал — профиль стиля можно построить по нему.{' '}
                <button type="button" className="btn btn-sm btn-ghost" onClick={onAnalyzeArchive}>
                  Разобрать стиль по архиву
                </button>
              </Notice>
            )}
          </>
        )}
      </section>

      {/* ------------------------------ форма поста --------------------------- */}

      <Modal
        open={formOpen}
        wide
        title={editing ? 'Изменить пост' : 'Добавить пост в архив'}
        onClose={formBusy ? undefined : () => setFormOpen(false)}
        footer={(
          <div className="btn-row">
            <button type="submit" form="post-form" className="btn btn-primary" disabled={formBusy}>
              {formBusy ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setFormOpen(false)} disabled={formBusy}>
              Отмена
            </button>
            <div className="spacer" />
            <CharCounter value={form.text} limit={limit} />
          </div>
        )}
      >
        <form id="post-form" onSubmit={submitForm}>
          <div className="form-grid">
            <Field label="Тип контента" hint={`Площадка канала: ${labelOf(PLATFORMS, channel.platform)}`} htmlFor="post-type">
              <Select
                id="post-type"
                value={form.content_type}
                onChange={(event) => setForm((prev) => ({ ...prev, content_type: event.target.value }))}
              >
                {types.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label} · до {type.limit.toLocaleString('ru-RU')} символов
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Дата публикации" hint="Необязательно. Нужна для сортировки архива." htmlFor="post-date">
              <TextInput
                id="post-date"
                type="datetime-local"
                value={form.published_at}
                onChange={(event) => setForm((prev) => ({ ...prev, published_at: event.target.value }))}
              />
            </Field>
            <div className="span-2">
              <Field label="Ссылка на публикацию" hint="Необязательно. Например https://t.me/channel/123" htmlFor="post-url">
                <TextInput
                  id="post-url"
                  value={form.external_url}
                  onChange={(event) => setForm((prev) => ({ ...prev, external_url: event.target.value }))}
                  placeholder="https://t.me/…"
                />
              </Field>
            </div>
          </div>

          <Field label="Текст публикации" htmlFor="post-text">
            <textarea
              id="post-text"
              className="ta ta-tall"
              value={form.text}
              onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
              placeholder="Вставьте текст опубликованного поста целиком…"
            />
          </Field>

          {tooLong && (
            <Notice kind="warn">
              Текст длиннее лимита площадки на {(form.text.length - limit).toLocaleString('ru-RU')} символов.
              Сервер такой пост не примет.
            </Notice>
          )}

          <InlineError error={formError} />
        </form>
      </Modal>

      {/* -------------------------------- импорт ------------------------------ */}

      <Modal
        open={importOpen}
        title={`Импорт с площадки · ${labelOf(PLATFORMS, channel.platform)}`}
        onClose={importBusy ? undefined : () => setImportOpen(false)}
        footer={(
          <div className="btn-row">
            <button type="submit" form="import-form" className="btn btn-primary" disabled={importBusy}>
              {importBusy ? 'Импортируем…' : 'Импортировать'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(false)} disabled={importBusy}>
              Закрыть
            </button>
          </div>
        )}
      >
        <form id="import-form" onSubmit={runImport}>
          <Field
            label="Ссылка на канал или профиль"
            hint="Площадка берётся из канала. Уже импортированные посты пропускаются."
            htmlFor="import-url"
          >
            <TextInput
              id="import-url"
              value={importForm.source_url}
              onChange={(event) => setImportForm((prev) => ({ ...prev, source_url: event.target.value }))}
              placeholder="https://t.me/s/channel"
            />
          </Field>
          <Field label="Сколько публикаций забрать" hint="От 1 до 200." htmlFor="import-limit">
            <TextInput
              id="import-limit"
              type="number"
              min="1"
              max="200"
              value={importForm.limit}
              onChange={(event) => setImportForm((prev) => ({ ...prev, limit: event.target.value }))}
            />
          </Field>

          <InlineError error={importError} />

          {importResult && (
            <Notice kind="good">
              Проверено {importResult.checked ?? 0}, добавлено {importResult.imported ?? 0},
              пропущено дублей {importResult.skipped_duplicates ?? 0}
              {importResult.skipped_invalid ? `, не подошли ${importResult.skipped_invalid}` : ''}.
            </Notice>
          )}

          <p className="faint" style={{ marginBottom: 0 }}>
            Если площадка не настроена ключами, сервер ответит «Площадка не настроена» —
            остальные функции при этом работают, посты можно добавить руками.
          </p>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Удалить пост из архива?"
        confirmLabel="Удалить"
        busy={deleteBusy}
        danger
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteTarget(null); setDeleteError(null) }}
      >
        <p style={{ marginTop: 0 }}>
          Пост удалится из архива вместе со своими векторами. Черновик, опубликованный
          из этого поста, останется — у него просто пропадёт ссылка на публикацию.
        </p>
        {deleteError && <InlineError error={deleteError} />}
      </ConfirmDialog>
    </>
  )
}
