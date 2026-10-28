import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { apiErrorMessage } from '../../lib/format.js'
import { InlineError, Loading, Notice } from '../ui.jsx'
import ProgressRail from '../ui/ProgressRail.jsx'
import StepTransition from '../ui/StepTransition.jsx'
import CloudStyleStep from './CloudStyleStep.jsx'
import CloudNotesStep from './CloudNotesStep.jsx'
import CloudDraftStep from './CloudDraftStep.jsx'
import CloudCheckStep from './CloudCheckStep.jsx'

const STEPS = [
  { n: 1, label: 'Стиль', hint: 'Разобрать посты канала' },
  { n: 2, label: 'Заметки', hint: 'Собрать черновик' },
  { n: 3, label: 'Черновик', hint: 'Блоки арки и правка' },
  { n: 4, label: 'Проверка', hint: 'AntiCringe и публикация' },
]

/**
 * Облачный конвейер: те же четыре шага, но профиль стиля, черновики и отчёты
 * живут на сервере. Локальный режим при этом остаётся полностью рабочим.
 */
export default function CloudPipeline({ channel, onUseLocal }) {
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1)

  /* Все переходы идут через это: сторона перехода запоминается, чтобы
     вход и выход шли по одному пути. */
  const goStep = (n) => {
    setDirection(n >= step ? 1 : -1)
    setStep(n)
  }

  const [tov, setTov] = useState(null)
  const [tovState, setTovState] = useState('loading') // loading | ready | empty | error
  const [tovError, setTovError] = useState(null)
  const [tovReloadKey, setTovReloadKey] = useState(0)
  const [tovAnalysis, setTovAnalysis] = useState(null)
  const [tovVerified, setTovVerified] = useState(null)

  const [mode, setMode] = useState('notes')
  const [notes, setNotes] = useState('')
  const [arc, setArc] = useState(null)
  const [draft, setDraft] = useState(null)
  const [build, setBuild] = useState(null)
  const [generateVerified, setGenerateVerified] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [loadingDraftId, setLoadingDraftId] = useState(null)
  const [loadDraftError, setLoadDraftError] = useState(null)
  const [draftsRefreshKey, setDraftsRefreshKey] = useState(0)

  const reloadTov = useCallback(() => setTovReloadKey((key) => key + 1), [])

  useEffect(() => {
    let alive = true
    setTovState('loading')
    setTovError(null)
    setTov(null)
    setTovAnalysis(null)
    setTovVerified(null)
    api.tov.get(channel.id)
      .then((payload) => {
        if (!alive) return
        setTov(payload && payload.tov_profile ? payload.tov_profile : payload)
        setTovState('ready')
      })
      .catch((error) => {
        if (!alive) return
        if (error.status === 404) {
          setTov(null)
          setTovState('empty')
          return
        }
        setTovError(error)
        setTovState('error')
      })
    return () => { alive = false }
  }, [channel.id, tovReloadKey])

  const analyzeStyle = async (body) => {
    const result = await api.tov.analyze(channel.id, body)
    setTov(result.tov_profile || null)
    setTovState('ready')
    setTovAnalysis(result.analysis || null)
    setTovVerified(result.verified_without_ai)
    setTovError(null)
    return result
  }

  const generateDraft = async (body) => {
    setGenerating(true)
    setGenerateError(null)
    try {
      const result = await api.drafts.generate(channel.id, body)
      setDraft(result.draft)
      setBuild(result.build || null)
      setGenerateVerified(result.verified_without_ai)
      setNotes(body.source_notes || '')
      setArc(body.arc || (result.build && result.build.arc) || null)
      setSaveError(null)
      goStep(3)
      return true
    } catch (error) {
      setGenerateError(error)
      return false
    } finally {
      setGenerating(false)
    }
  }

  const saveDraft = async (patch) => {
    if (!draft) return null
    setSaving(true)
    setSaveError(null)
    try {
      const updated = await api.drafts.update(draft.id, patch)
      setDraft(updated)
      return updated
    } catch (error) {
      setSaveError(error)
      throw error
    } finally {
      setSaving(false)
    }
  }

  const openDraft = async (draftId) => {
    setLoadingDraftId(draftId)
    setLoadDraftError(null)
    try {
      const loaded = await api.drafts.get(draftId)
      setDraft(loaded)
      setBuild(null)
      setGenerateVerified(null)
      setGenerateError(null)
      setSaveError(null)
      if (loaded.source_notes) setNotes(loaded.source_notes)
      if (loaded.arc) setArc(loaded.arc)
      goStep(3)
    } catch (error) {
      setLoadDraftError(error)
    } finally {
      setLoadingDraftId(null)
    }
  }

  const stepState = (n) => {
    if (n === step) return 'active'
    if (n < step) return 'done'
    return 'idle'
  }

  const stepAvailable = (n) => {
    if (n === 1) return true
    if (n === 2) return tovState === 'ready' && Boolean(tov)
    if (n === 3) return Boolean(draft)
    if (n === 4) return Boolean(draft)
    return false
  }

  if (tovState === 'loading' && step === 1) {
    return (
      <section className="card">
        <Loading label={`Загружаем профиль стиля канала «${channel.name}»…`} />
      </section>
    )
  }

  return (
    <>
      <header className="stage-head">
        <p className="lead">
          Профиль стиля, черновики и история проверок сохраняются на сервере для канала
          «{channel.name}». Все четыре шага работают через API; локальный режим остаётся
          в переключателе.
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
        <CloudStyleStep
          channel={channel}
          tov={tov}
          tovState={tovState}
          tovError={tovError}
          analysis={tovAnalysis}
          verifiedWithoutAi={tovVerified}
          onRetry={reloadTov}
          onAnalyze={analyzeStyle}
          onNext={() => goStep(2)}
          onUseLocal={onUseLocal}
        />
      )}

      {step === 2 && (
        <CloudNotesStep
          channel={channel}
          mode={mode}
          setMode={setMode}
          notes={notes}
          setNotes={setNotes}
          arc={arc}
          setArc={setArc}
          generating={generating}
          generateError={generateError}
          onGenerate={generateDraft}
          onOpenDraft={openDraft}
          loadingDraftId={loadingDraftId}
          loadDraftError={loadDraftError}
          draftsRefreshKey={draftsRefreshKey}
          setDraftsRefreshKey={setDraftsRefreshKey}
          onUseLocal={onUseLocal}
        />
      )}

      {step === 3 && draft && (
        <CloudDraftStep
          channel={channel}
          draft={draft}
          build={build}
          verifiedWithoutAi={generateVerified}
          saving={saving}
          saveError={saveError}
          onSave={saveDraft}
          onStep={goStep}
          onDrafts={() => { setDraftsRefreshKey((key) => key + 1); goStep(2) }}
        />
      )}

      {step === 4 && draft && (
        <CloudCheckStep
          channel={channel}
          tov={tov}
          draft={draft}
          setDraft={setDraft}
          onBack={() => goStep(3)}
          onUseLocal={onUseLocal}
          onPublished={() => setDraftsRefreshKey((key) => key + 1)}
        />
      )}
      </StepTransition>

      {generateError && step !== 2 && (
        <div style={{ marginTop: 14 }}>
          <Notice kind="error">{apiErrorMessage(generateError)}</Notice>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setGenerateError(null)}>
              Скрыть
            </button>
          </div>
        </div>
      )}

      {loadDraftError && (
        <div style={{ marginTop: 14 }}><InlineError error={loadDraftError} /></div>
      )}
    </>
  )
}
