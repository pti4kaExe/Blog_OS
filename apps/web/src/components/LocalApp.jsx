import { useEffect, useMemo, useState } from 'react'
import StyleStep from './StyleStep.jsx'
import NotesStep from './NotesStep.jsx'
import PostStep from './PostStep.jsx'
import CheckStep from './CheckStep.jsx'
import RadarView from './RadarView.jsx'
import { buildPost } from '../engine/narrative.js'
import { Tag } from './ui.jsx'
import ProgressRail from './ui/ProgressRail.jsx'
import StepTransition from './ui/StepTransition.jsx'

/** Состояние прототипа: тот же ключ, что и до появления облачного режима. */
const STORAGE_KEY = 'blogos.state.v1'

const STEPS = [
  { n: 1, label: 'Стиль', hint: 'Разобрать свои посты' },
  { n: 2, label: 'Заметки', hint: 'Сырые мысли или черновик' },
  { n: 3, label: 'Пост', hint: 'Сборка по сюжетной арке' },
  { n: 4, label: 'Проверка', hint: 'AntiCringe перед публикацией' },
]

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Локальный режим BlogOS — исходный прототип без сети.
 * Все четыре шага и CommentRadar считаются движками в браузере,
 * данные живут в localStorage (`blogos.state.v1`). Этот режим нельзя ломать:
 * он остаётся демонстрацией, когда API недоступен.
 */
export default function LocalApp() {
  const saved = useMemo(loadState, [])

  const [view, setView] = useState('pipeline')
  const [step, setStep] = useState(saved?.profile ? 2 : 1)
  const [direction, setDirection] = useState(1)

  /* Любой переход между шагами идёт через это: запоминаем сторону,
     чтобы вход и выход шли по одному пути. */
  const goStep = (n) => {
    setDirection(n >= step ? 1 : -1)
    setStep(n)
  }
  const [samples, setSamples] = useState(saved?.samples || ['', '', ''])
  const [profile, setProfile] = useState(saved?.profile || null)
  const [mode, setMode] = useState(saved?.mode || 'notes')
  const [notes, setNotes] = useState(saved?.notes || '')
  const [rawDraft, setRawDraft] = useState(saved?.rawDraft || '')
  const [arcKey, setArcKey] = useState(saved?.arcKey || null)
  const [post, setPost] = useState(null)
  const [draft, setDraft] = useState(saved?.draft || '')
  const [baseline, setBaseline] = useState(null)
  const [approved, setApproved] = useState(saved?.approved || [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        samples, profile, mode, notes, rawDraft, arcKey, draft, approved,
      }))
    } catch {
      // приватный режим браузера — просто не сохраняем
    }
  }, [samples, profile, mode, notes, rawDraft, arcKey, draft, approved])

  // профиль сбросили — сбрасываем и зависящие от него шаги
  useEffect(() => {
    if (!profile && step > 1) goStep(1)
  }, [profile, step])

  const buildFromNotes = (key) => {
    const result = buildPost(notes, profile, key || undefined)
    if (!result.ok) return
    setPost(result)
    setArcKey(key || null)
    setDraft(result.text)
    setBaseline(null)
    goStep(3)
  }

  const rebuild = (key) => {
    const result = buildPost(notes, profile, key)
    if (!result.ok) return
    setPost(result)
    setArcKey(key)
    setDraft(result.text)
    setBaseline(null)
  }

  const checkRawDraft = () => {
    setPost(null)
    setDraft(rawDraft)
    setBaseline(null)
    goStep(4)
  }

  const stepState = (n) => {
    if (n === step) return 'active'
    if (n < step) return 'done'
    return 'idle'
  }

  const stepAvailable = (n) => {
    if (n === 1) return true
    if (!profile) return false
    if (n === 2) return true
    if (n === 3) return Boolean(post)
    if (n === 4) return draft.trim().length > 0
    return false
  }

  return (
    <>
      <div className="view-tabs">
        <div className="tabs" role="tablist">
          <button
            type="button" className="tab" role="tab"
            aria-selected={view === 'pipeline'} onClick={() => setView('pipeline')}
          >
            Конвейер поста
          </button>
          <button
            type="button" className="tab" role="tab"
            aria-selected={view === 'radar'} onClick={() => setView('radar')}
          >
            CommentRadar
            {approved.length > 0 && <span className="dot" />}
          </button>
        </div>
        <div className="spacer" />
        <Tag>Локальный режим · без сети</Tag>
      </div>

      {view === 'pipeline' ? (
        <>
          <header className="stage-head">
            <h1>Пост в вашем голосе — и проверка до публикации</h1>
            <p className="lead">
            Один конвейер вместо трёх инструментов: система разбирает ваш стиль по прошлым постам,
            собирает из сырых заметок связную историю и проверяет текст на клише, логические
              ошибки и отклонения от вашего Tone of Voice. Всё считается локально в браузере.
            </p>
          </header>

          <ProgressRail
            steps={STEPS}
            current={step}
            available={stepAvailable}
            onGo={goStep}
          />

          <StepTransition step={step} direction={direction}>
          {step === 1 && (
            <StyleStep
              samples={samples}
              setSamples={setSamples}
              profile={profile}
              setProfile={setProfile}
              onNext={() => goStep(2)}
            />
          )}

          {step === 2 && (
            <NotesStep
              mode={mode}
              setMode={setMode}
              notes={notes}
              setNotes={setNotes}
              rawDraft={rawDraft}
              setRawDraft={setRawDraft}
              arcKey={arcKey}
              setArcKey={setArcKey}
              onBuild={buildFromNotes}
              onCheckDraft={checkRawDraft}
            />
          )}

          {step === 3 && (
            <PostStep
              post={post}
              arcKey={arcKey}
              onRebuild={rebuild}
              onCheck={() => goStep(4)}
              onBack={() => goStep(2)}
            />
          )}

          {step === 4 && (
            <CheckStep
              text={draft}
              setText={setDraft}
              profile={profile}
              baseline={baseline}
              setBaseline={setBaseline}
              onBack={() => goStep(post ? 3 : 2)}
            />
          )}
          </StepTransition>
        </>
      ) : (
        <RadarView profile={profile} approved={approved} setApproved={setApproved} />
      )}

      <footer className="stage-foot">
        <Tag>MVP-прототип</Tag>
        <Tag>без внешних API</Tag>
        <Tag kind="demo">лента CommentRadar — демо-данные</Tag>
        <span className="faint">Ваши тексты никуда не отправляются и хранятся только в этом браузере.</span>
      </footer>
    </>
  )
}
