import { useState } from 'react'
import { splitFragments } from '../../engine/narrative.js'
import { useAiConsent } from '../../lib/aiConsent.jsx'
import { CLOUD_ARCS, plural } from '../../lib/format.js'
import { InlineError, Notice } from '../ui.jsx'
import DraftsList from './DraftsList.jsx'

const DEMO_NOTES = `полгода назад я не понимал, зачем вообще веду канал
писал, когда было настроение, посты выходили раз в три недели
подписчиков почти не приходили, за квартал набралось 40 человек
меня раздражало, что я вроде пишу, а отдачи ноль
потом я сел и выписал все темы, которые мне интересны, получилось семь штук
дальше начал планировать: одна тема — один пост, две публикации в неделю
за первый месяц по новой схеме пришло 300 подписчиков
регулярность оказалась важнее гениальности каждого отдельного текста`

/**
 * Шаг 2 в облаке: сырые заметки (или готовый черновик) и сюжетная арка.
 * Сборка — `POST /author-profiles/{id}/drafts/generate`; результат приходит
 * с блоками арки и списком того, что добавил движок.
 */
export default function CloudNotesStep({
  channel, mode, setMode, notes, setNotes, arc, setArc,
  generating, generateError, onGenerate, onOpenDraft, loadingDraftId,
  draftsRefreshKey, setDraftsRefreshKey, onUseLocal,
}) {
  const [localError, setLocalError] = useState(null)
  const consent = useAiConsent()

  const fragments = splitFragments(notes)

  const build = () => {
    if (fragments.length < 2) {
      setLocalError({ code: 'validation_error', message: 'Нужны хотя бы две заметки — по одной мысли в строке.' })
      return
    }
    setLocalError(null)
    consent.ensure(async (granted) => {
      await onGenerate({
        source_notes: notes,
        arc: arc || null,
        mode,
        use_llm: granted,
      })
    })
  }

  return (
    <>
      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>{mode === 'notes' ? 'Сырые заметки' : 'Готовый черновик'}</h2>
              <p>
                {mode === 'notes'
                  ? 'По одной мысли в строке. Без структуры — её соберёт Narrative Engine на сервере.'
                  : 'Текст уйдёт как есть, шаг сборки пропускается. Арку выбрать всё равно можно.'}
              </p>
            </div>
            <div className="spacer" />
            <div className="tabs">
              <button type="button" className="tab" aria-selected={mode === 'notes'} onClick={() => setMode('notes')}>
                Заметки
              </button>
              <button type="button" className="tab" aria-selected={mode === 'draft'} onClick={() => setMode('draft')}>
                Черновик
              </button>
            </div>
          </div>

          <textarea
            className="ta"
            style={{ minHeight: 260 }}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={mode === 'notes'
              ? 'что произошло\nчто не получалось\nчто я поменял\nчто вышло в итоге'
              : 'Вставьте готовый текст поста…'}
          />

          <InlineError error={localError} />
          {generateError && <InlineError error={generateError} />}

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={build}
              disabled={generating || fragments.length < 2}
            >
              {generating ? 'Собираем черновик…' : mode === 'notes' ? 'Собрать черновик' : 'Сохранить как черновик'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { setNotes(DEMO_NOTES); setLocalError(null) }}
              disabled={generating}
            >
              Пример заметок
            </button>
            <span className="faint">
              {fragments.length} {plural(fragments.length, 'фрагмент', 'фрагмента', 'фрагментов')} · сохраняется на сервере
            </span>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>Сюжетная арка</h2>
              <p>Порядок, в котором Narrative Engine расставит ваши мысли.</p>
            </div>
          </div>

          <div className="arc-picker">
            <button
              type="button"
              className="arc-opt"
              aria-pressed={!arc}
              onClick={() => setArc(null)}
            >
              <b>Автоматически</b>
              <span>Сервер сам смотрит, чего в заметках больше: истории, проблемы или мнения.</span>
            </button>
            {CLOUD_ARCS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="arc-opt"
                aria-pressed={arc === item.key}
                onClick={() => setArc(item.key)}
              >
                <b>{item.label}</b>
                <span>{item.hint}</span>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <Notice>
              Черновик появится на шаге «Черновик»: там будут блоки арки, пометки
              «добавлено движком» и возможность сохранить правки через PATCH.
            </Notice>
          </div>

          {notes.trim().length === 0 && (
            <p className="faint" style={{ marginBottom: 0 }}>
              Канал: «{channel.name}». Стиль уже разобран — сборка подстроится под него.
            </p>
          )}
        </section>
      </div>

      <DraftsList
        channel={channel}
        refreshKey={draftsRefreshKey}
        onOpenDraft={onOpenDraft}
        loadingDraftId={loadingDraftId}
        onChanged={() => setDraftsRefreshKey((key) => key + 1)}
        onUseLocal={onUseLocal}
      />

      {consent.modal}
    </>
  )
}
