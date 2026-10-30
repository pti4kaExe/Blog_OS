import { useEffect, useState } from 'react'
import draftVersions from '../../api/draftVersions.js'
import { useRegisterCommands } from '../../lib/commands.jsx'
import {
  arcLabel, CLOUD_ARCS, contentLimit, defaultContentType, DRAFT_STATUSES,
  fmtDateTime, hasUnfilledGaps,
} from '../../lib/format.js'
import {
  AiBadge, CharCounter, CopyButton, DownloadButton, InlineError, Notice, Select,
  StatusTag, Tag, TextInput,
} from '../ui.jsx'
import { Reveal, Stagger } from '../ui/Motion.jsx'
import DraftVersions from './DraftVersions.jsx'

/* Подпись модификатора в подсказках: на Mac ⌘, на остальных Ctrl. */
const MOD = typeof navigator !== 'undefined'
  && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '')
  ? '⌘'
  : 'Ctrl'

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
  /* Черновик ещё не знает своего типа контента — он появится при публикации.
     До тех пор ориентируемся на тип по умолчанию для площадки канала. */
  const platformLimit = contentLimit(defaultContentType(channel.platform))

  const [text, setText] = useState(draft.text || '')
  const [title, setTitle] = useState(draft.title || '')
  const [arc, setArc] = useState(draft.arc || null)
  const [editing, setEditing] = useState(!build)
  const [localError, setLocalError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [busyNext, setBusyNext] = useState(false)
  const [versionsKey, setVersionsKey] = useState(0)

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
    /* Снимок прежнего текста до записи нового: на сервере это будет делать
       сам `PATCH /drafts/{id}`, пока делает клиент. Сбой истории не должен
       мешать сохранению — поэтому отдельный try. */
    try {
      if (draft.text && draft.text !== text) {
        await draftVersions.create(draft.id, {
          text: draft.text,
          title: draft.title,
          origin: draft.origin === 'narrative_engine' && !savedAt ? 'narrative_engine' : 'author',
        })
        setVersionsKey((key) => key + 1)
      }
    } catch {
      /* история версий необязательна для сохранения черновика */
    }
    const updated = await onSave({
      text,
      title: title.trim() ? title.trim() : null,
      arc: arc || null,
    })
    setSavedAt(new Date())
    return updated
  }

  /* Возврат версии: текст подменяется и тут же уходит в `PATCH /drafts/{id}`,
     чтобы на сервере лежало то же, что видит автор. */
  const restoreVersion = async (result) => {
    setText(result.text)
    await onSave({
      text: result.text,
      title: title.trim() ? title.trim() : null,
      arc: arc || null,
    })
    setSavedAt(new Date())
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

  /* Те же два действия в палитре ⌘K — иначе про сочетания можно только
     догадаться: подсказка в `title` на тач-экранах не появляется. */
  useRegisterCommands('cloud-draft', () => [
    {
      id: 'draft:save',
      group: 'Черновик',
      title: 'Сохранить черновик',
      hint: `${MOD}+S`,
      disabled: !dirty || saving,
      run: saveClick,
    },
    {
      id: 'draft:check',
      group: 'Черновик',
      title: 'Проверить в AntiCringe',
      hint: `${MOD}+Enter`,
      disabled: busyNext || saving,
      run: goCheck,
    },
  ])

  /* Горячие клавиши редактора: ⌘S сохраняет, ⌘Enter отправляет на проверку.
     Это рефлекс из любого текстового редактора, и без перехвата ⌘S браузер
     предлагает сохранить страницу — то есть делает заведомо не то. */
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      if (key === 's' || key === 'ы') {
        event.preventDefault()
        if (dirty && !saving) saveClick()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (!busyNext && !saving) goCheck()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
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
          <DownloadButton text={text} filename={draft.title || 'Черновик BlogOS'} />
        </div>

        {build && (
          <>
            <h3>Блоки арки</h3>
            {/* Структура раскрывается вслед за готовым результатом: роли
                фрагментов показывают композицию поста, но каскад ограничен,
                чтобы не задерживать чтение (раздел 08). */}
            <Stagger className="blocks" style={{ marginBottom: 16 }} replay={build.id || build.text}>
              {(build.blocks || []).map((block, index) => (
                <Reveal className="block" data-role={block.role} index={index} offset={8} key={`${block.role}-${index}`}>
                  <div className="block-label">{ROLE_LABELS[block.role] || block.role}</div>
                  <div className="block-text">{block.text}</div>
                  {block.fragment && (
                    <div className="faint" style={{ marginTop: 2 }}>из заметки: {block.fragment}</div>
                  )}
                </Reveal>
              ))}
              {(build.blocks || []).length === 0 && (
                <div className="faint">Сервер вернул черновик без блоков арки.</div>
              )}
            </Stagger>
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
          {/* Лимит площадки виден прямо в редакторе: сервер откажет на 422,
              и узнавать об этом после публикации — поздно. */}
          <CharCounter value={text} limit={platformLimit} />
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
          <button
            type="button"
            className="btn btn-primary"
            onClick={goCheck}
            disabled={busyNext || saving}
            title={`Проверить — ${MOD}+Enter`}
          >
            {busyNext ? 'Сохраняем…' : 'Проверить в AntiCringe →'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={saveClick}
            disabled={saving || !dirty}
            title={`Сохранить — ${MOD}+S`}
          >
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

    {/* История — под обеими колонками: в правой она сжималась до
        нечитаемой ширины, а строки версий длинные. */}
    <DraftVersions draft={draft} refreshKey={versionsKey} onRestore={restoreVersion} />
    </>
  )
}
