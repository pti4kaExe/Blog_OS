import {
  Suspense, lazy, useCallback, useEffect, useRef, useState,
} from 'react'
import api from '../../api/client.js'
import { useRegisterCommands } from '../../lib/commands.jsx'
import { apiErrorMessage } from '../../lib/format.js'
import { emitPetSignal } from '../../lib/petSignals.js'
import { scrollNodeIntoView } from '../../lib/scroll.js'
import { EmptyState, InlineError, Loading, Notice } from '../ui.jsx'
import ProgressRail from '../ui/ProgressRail.jsx'
import StepTransition from '../ui/StepTransition.jsx'

const CloudStyleStep = lazy(() => import('./CloudStyleStep.jsx'))
const CloudNotesStep = lazy(() => import('./CloudNotesStep.jsx'))
const CloudDraftStep = lazy(() => import('./CloudDraftStep.jsx'))
const CloudCheckStep = lazy(() => import('./CloudCheckStep.jsx'))

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
export default function CloudPipeline({ channel, onUseLocal, requestedStep, onStepTaken }) {
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
  const [stopWordsRestored, setStopWordsRestored] = useState(0)

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

  /**
   * Разбор стиля по текстам канала.
   *
   * `POST /tov/analyze` перезаписывает профиль целиком и ставит
   * `stop_words: []` — ручные правила автора при повторном разборе
   * пропадали бы. Пока сервер их не сохраняет, возвращаем их сами
   * отдельным `PUT` и говорим об этом автору.
   */
  const analyzeStyle = async (body) => {
    const keptStopWords = Array.isArray(tov?.stop_words) ? tov.stop_words : []
    const result = await api.tov.analyze(channel.id, body)
    let profile = result.tov_profile || null

    const lostStopWords = keptStopWords.length > 0
      && (!profile || !Array.isArray(profile.stop_words) || profile.stop_words.length === 0)

    if (lostStopWords && profile) {
      try {
        profile = await api.tov.put(channel.id, {
          tone: profile.tone,
          slang: Array.isArray(profile.slang) ? profile.slang : [],
          stop_words: keptStopWords,
          favorite_phrases: Array.isArray(profile.favorite_phrases) ? profile.favorite_phrases : [],
          metrics: profile.metrics ?? null,
        })
      } catch {
        /* вернуть не вышло — профиль всё равно построен, скажем об этом ниже */
      }
    }

    setTov(profile)
    setTovState('ready')
    setTovAnalysis(result.analysis || null)
    setTovVerified(result.verified_without_ai)
    setTovError(null)
    setStopWordsRestored(lostStopWords ? keptStopWords.length : 0)
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
      // Питомец узнаёт о готовом черновике через сигнал, а не догадывается.
      emitPetSignal('draft-ready', { draftId: result.draft?.id ?? null })
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
      emitPetSignal('draft-ready', { draftId: loaded.id ?? draftId })
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

  const styleReady = tovState === 'ready' && Boolean(tov)

  /* Питомец-помощник живёт в CloudApp: сообщаем ему, что известно о канале.
     Сигнал уходит при каждом изменении профиля и черновика — так фразы и
     действия питомца опираются на реальное состояние, а не на догадки. */
  useEffect(() => {
    emitPetSignal('pipeline-state', {
      tovReady: styleReady,
      hasDraft: Boolean(draft),
      draftId: draft?.id ?? null,
    })
  }, [styleReady, draft])

  /* Второй шаг открыт всегда: без профиля стиля он показывает объяснение,
     а не молчаливый отказ в навигации. Шаги 3–4 по-прежнему требуют
     готовый черновик — там показывать нечего, пока его нет. */
  const stepAvailable = (n) => {
    if (n === 1) return true
    if (n === 2) return true
    if (n === 3) return Boolean(draft)
    if (n === 4) return Boolean(draft)
    return false
  }

  /* Шаг, запрошенный снаружи, — из чеклиста «С чего начать».
     Номер шага живёт здесь и наружу не выходит, поэтому чеклист не
     переключает его сам, а просит: «открой второй». Если шаг ещё
     недоступен (нет черновика), открываем первый — там и начинается
     то, чего не хватает. Второй шаг доступен всегда: без профиля стиля
     он сам объясняет, чего не хватает, и уводит на первый.

     Заодно подводим экран к полосе шагов: чеклист стоит выше, и без
     этого нажатие выглядело бы так же, как раньше, — будто ничего
     не произошло. */
  const railRef = useRef(null)

  useEffect(() => {
    if (!requestedStep) return
    goStep(stepAvailable(requestedStep) ? requestedStep : 1)
    onStepTaken?.()

    scrollNodeIntoView(railRef.current)
  }, [requestedStep])

  /* Шаги конвейера в палитре ⌘K: прямой переход на нужный шаг,
     минуя клики по полосе прогресса. */
  useRegisterCommands('cloud-pipeline', () => STEPS.map((item) => ({
    id: `pipeline:step:${item.n}`,
    group: 'Шаги',
    title: `Шаг ${item.n} · ${item.label}`,
    hint: item.hint,
    disabled: !stepAvailable(item.n) || step === item.n,
    run: () => goStep(item.n),
  })))

  if (tovState === 'loading' && step === 1) {
    return (
      <section className="card">
        <Loading label={`Загружаем профиль стиля канала «${channel.name}»…`} />
      </section>
    )
  }

  return (
    <>
      {/* Обёртка только ради ссылки на узел: ProgressRail — обычная
          функция, ref ей не передать, а заводить forwardRef ради одной
          прокрутки в компоненте, который делят два режима, незачем. */}
      <div ref={railRef}>
        <ProgressRail
          steps={STEPS}
          current={step}
          available={stepAvailable}
          onGo={goStep}
        />
      </div>

      <Suspense fallback={<section className="card"><Loading label="Готовим шаг…" /></section>}>
        <StepTransition step={step} direction={direction}>
        {step === 1 && (
          <CloudStyleStep
            channel={channel}
            tov={tov}
            tovState={tovState}
            tovError={tovError}
            analysis={tovAnalysis}
            verifiedWithoutAi={tovVerified}
            stopWordsRestored={stopWordsRestored}
            onRetry={reloadTov}
            onAnalyze={analyzeStyle}
            onTovSaved={(saved) => { setTov(saved); setTovState('ready') }}
            onNext={() => goStep(2)}
            onUseLocal={onUseLocal}
          />
        )}

      {step === 2 && (styleReady ? (
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
      ) : (
        <section className="card">
          <EmptyState
            title="Сначала разберите стиль"
            action={(
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn btn-primary" onClick={() => goStep(1)}>
                  Перейти к шагу 1
                </button>
                {tovState === 'error' && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={reloadTov}>
                    Повторить загрузку
                  </button>
                )}
              </div>
            )}
          >
            <p className="mb-0">
              Без профиля Tone of Voice движок соберёт усреднённый текст: он не будет
              знать ваших интонаций, любимых оборотов и запрещённых слов. Профиль
              строится на шаге 1 — по постам канала или по 2–3 текстам, вставленным
              вручную.
            </p>
            {tovState === 'loading' && (
              <p className="faint mt-3 mb-0">
                Профиль ещё загружается — если он уже готов, этот шаг откроется сам.
              </p>
            )}
            {tovState === 'error' && <InlineError error={tovError} />}
          </EmptyState>
        </section>
      ))}

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
          onTovUpdated={(payload) => setTov(payload && payload.tov_profile ? payload.tov_profile : payload)}
        />
      )}
        </StepTransition>
      </Suspense>

      {generateError && step !== 2 && (
        <div className="mt-4">
          <Notice kind="error">{apiErrorMessage(generateError)}</Notice>
          <div className="btn-row mt-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setGenerateError(null)}>
              Скрыть
            </button>
          </div>
        </div>
      )}

      {loadDraftError && (
        <div className="mt-4"><InlineError error={loadDraftError} /></div>
      )}
    </>
  )
}
