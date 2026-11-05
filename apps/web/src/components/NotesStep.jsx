import { useState } from 'react'
import { ARCS, buildPost, splitFragments, suggestArc } from '../engine/narrative.js'
import { Notice, plural } from './ui.jsx'
import { useArcPick } from './ui/Motion.jsx'

const DEMO_NOTES = `полгода назад я не понимал, зачем вообще веду канал
писал, когда было настроение, посты выходили раз в три недели
подписчики почти не приходили, за квартал набралось 40 человек
меня раздражало, что я вроде пишу, а отдачи ноль
потом я сел и выписал все темы, которые мне интересны, получилось семь штук
дальше начал планировать: одна тема — один пост, две публикации в неделю
за первый месяц по новой схеме пришло 300 подписчиков
регулярность оказалась важнее гениальности каждого отдельного текста`

/**
 * Шаг 2. Вход в конвейер: сырые заметки или уже готовый черновик.
 * Из заметок пост собирает Narrative Engine, готовый черновик идёт сразу в проверку.
 */
export default function NotesStep({
  mode, setMode, notes, setNotes, rawDraft, setRawDraft, arcKey, setArcKey, onBuild, onCheckDraft,
}) {
  const [error, setError] = useState('')

  const pick = useArcPick()
  const fragments = splitFragments(notes)
  const auto = fragments.length >= 2 ? suggestArc(fragments) : null

  const build = () => {
    const result = buildPost(notes, null, arcKey || undefined)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    setError('')
    onBuild(arcKey || auto)
  }

  const checkDraft = () => {
    if (rawDraft.trim().split(/\s+/).length < 10) {
      setError('Слишком короткий черновик — нужно хотя бы одно-два предложения.')
      return
    }
    setError('')
    onCheckDraft()
  }

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>{mode === 'notes' ? 'Сырые заметки' : 'Готовый черновик'}</h2>
            <p>
              {mode === 'notes'
                ? 'По одной мысли в строке. Без структуры — её соберёт движок.'
                : 'Текст уйдёт сразу в AntiCringe, минуя сборку.'}
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

        {mode === 'notes' ? (
          <>
            <textarea
              className="ta"
              style={{ minHeight: 260 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={'что произошло\nчто не получалось\nчто я поменял\nчто вышло в итоге'}
            />
            {error && <div style={{ marginTop: 12 }}><Notice kind="warn">{error}</Notice></div>}
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-primary" onClick={build} disabled={fragments.length < 2}>
                Собрать пост
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setNotes(DEMO_NOTES)}>
                Пример заметок
              </button>
              <span className="faint">
                {fragments.length} {plural(fragments.length, 'фрагмент', 'фрагмента', 'фрагментов')}
              </span>
            </div>
          </>
        ) : (
          <>
            <textarea
              className="ta"
              style={{ minHeight: 260 }}
              value={rawDraft}
              onChange={(e) => setRawDraft(e.target.value)}
              placeholder="Вставьте готовый текст поста…"
            />
            {error && <div style={{ marginTop: 12 }}><Notice kind="warn">{error}</Notice></div>}
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button type="button" className="btn btn-primary" onClick={checkDraft}>
                Проверить в AntiCringe
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Сюжетная арка</h2>
            <p>Порядок, в котором движок расставит ваши мысли.</p>
          </div>
        </div>

        {mode === 'draft' ? (
          <div className="empty">Для готового черновика арка не нужна — он идёт сразу в проверку.</div>
        ) : (
          <>
            <div className="arc-picker">
              <button
                type="button"
                className="arc-opt"
                aria-pressed={!arcKey}
                onClick={() => setArcKey(null)}
              >
                {pick(!arcKey)}
                <b>Автоматически{auto ? ` · ${ARCS[auto].label}` : ''}</b>
                <span>Движок сам смотрит, чего в заметках больше: истории, проблемы или мнения.</span>
              </button>
              {Object.values(ARCS).map((arc) => (
                <button
                  key={arc.key}
                  type="button"
                  className="arc-opt"
                  aria-pressed={arcKey === arc.key}
                  onClick={() => setArcKey(arc.key)}
                >
                  {pick(arcKey === arc.key)}
                  <b>{arc.label}</b>
                  <span>{arc.hint}</span>
                </button>
              ))}
            </div>

            {fragments.length >= 2 && (
              <p className="faint" style={{ marginTop: 14, marginBottom: 0 }}>
                Ни один фрагмент не потеряется: всё, что не попало в слоты арки, движок добавит в основной блок.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
