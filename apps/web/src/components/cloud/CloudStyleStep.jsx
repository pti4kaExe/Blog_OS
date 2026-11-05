import { useEffect, useState } from 'react'
import { DEMO_AUTHOR } from '../../engine/demoData.js'
import { getAiConsent, useAiConsent } from '../../lib/aiConsent.jsx'
import { analysisSummary } from '../../lib/tov.js'
import { fmtDateTime, isOffline, plural } from '../../lib/format.js'
import {
  AiBadge, ErrorState, InlineError, Notice, Toggle,
} from '../ui.jsx'
import TovCard from '../TovCard.jsx'
import TovEditor from './TovEditor.jsx'
import { ResultReveal } from '../ui/Motion.jsx'
import VoiceMark from '../ui/VoiceMark.jsx'

const MIN_CHARS = 180

/**
 * Шаг 1 в облаке. Профиль стиля строится сервером:
 * `POST /author-profiles/{id}/tov/analyze`; правиловый слой работает всегда,
 * AI — только с согласия автора. Отказ ⇒ `use_llm: false` и
 * индикатор «проверено без AI».
 *
 * Ввод и результат не делят экран колонками. Три текстареи слева и карточка
 * профиля справа почти никогда не совпадают по высоте — либо ввод торчит
 * длинным столбцом над коротким результатом, либо наоборот. Вместо этого
 * экран последователен: сначала во всю ширину — ввод, после разбора —
 * во всю ширину результат. Вернуться к текстам можно в любой момент —
 * это не шаг назад, а свёрнутая форма, которую можно снова развернуть.
 */
export default function CloudStyleStep({
  channel, tov, tovState, tovError, analysis, verifiedWithoutAi, stopWordsRestored,
  onRetry, onAnalyze, onTovSaved, onNext, onUseLocal,
}) {
  const [samples, setSamples] = useState(['', '', ''])
  const [useLlm, setUseLlm] = useState(getAiConsent() === 'granted')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [showInput, setShowInput] = useState(!tov)
  const consent = useAiConsent()

  /* Профиль мог прийти из уже сохранённого состояния (перезагрузка
     страницы) — тогда сразу открываем результат, а не пустой ввод. */
  useEffect(() => {
    if (tov && tovState === 'ready') setShowInput(false)
  }, [tov, tovState])

  const setSample = (index, value) => {
    const next = samples.slice()
    next[index] = value
    setSamples(next)
  }

  const chars = samples.join('').trim().length
  const filled = samples.filter((sample) => sample.trim().length > 0)

  const loadDemo = () => {
    setSamples(DEMO_AUTHOR.samples.slice())
    setError(null)
  }

  const reset = () => {
    setSamples(['', '', ''])
    setError(null)
  }

  const toggleLlm = (value) => {
    if (!value) {
      setUseLlm(false)
      return
    }
    if (getAiConsent() === 'granted') {
      setUseLlm(true)
      return
    }
    consent.ask((granted) => setUseLlm(granted))
  }

  const analyze = () => {
    if (chars < MIN_CHARS) {
      setError({
        code: 'validation_error',
        message: `Мало материала: ${chars} из ${MIN_CHARS} символов. Нужны 2–3 своих поста целиком.`,
      })
      return
    }
    consent.ensure(async (granted) => {
      setBusy(true)
      setError(null)
      try {
        await onAnalyze({
          texts: filled.map((sample) => sample.trim()),
          use_archive: false,
          use_llm: granted,
        })
        setError(null)
        setShowInput(false)
      } catch (analyzeError) {
        setError(analyzeError)
        if (analyzeError.code === 'ai_budget_exceeded') setUseLlm(false)
      } finally {
        setBusy(false)
      }
    })
  }

  const rulesOnly = verifiedWithoutAi !== null && verifiedWithoutAi !== undefined
    ? verifiedWithoutAi
    : (tov && 'generation_run_id' in tov ? tov.generation_run_id === null : null)
  const slang = Array.isArray(tov?.slang) ? tov.slang : []
  const stopWords = Array.isArray(tov?.stop_words) ? tov.stop_words : []
  const favoritePhrases = Array.isArray(tov?.favorite_phrases) ? tov.favorite_phrases : []

  /* Пока профиля нет, выбора вообще не стоит — показываем ввод. */
  const inputVisible = showInput || !tov

  return (
    <div className="stage-narrow">
      {inputVisible && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Ваши прошлые посты</h2>
              <p>2–3 текста, которые вы считаете «своими по голосу». Они сохраняются в вашем канале.</p>
            </div>
            {tov && <AiBadge withoutAi={rulesOnly} />}
          </div>

          {samples.map((value, index) => (
            <div className="sample-row" key={index}>
              <div className="sample-n">{index + 1}</div>
              <textarea
                className="ta"
                value={value}
                onChange={(event) => setSample(index, event.target.value)}
                placeholder={index === 0 ? 'Вставьте сюда свой пост целиком…' : 'Ещё один пост (необязательно)'}
              />
            </div>
          ))}

          <InlineError error={error} />

          <div style={{ margin: '14px 0 0' }}>
            <Toggle
              id="style-use-llm"
              checked={useLlm}
              onChange={toggleLlm}
              label="Дополнить профиль AI-анализом"
              hint="Модель получит тексты постов. Без согласия профиль строится правилами — так же точно, но без AI."
            />
          </div>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-primary" onClick={analyze} disabled={busy}>
              {busy ? 'Разбираем…' : 'Разобрать стиль'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={loadDemo} disabled={busy}>
              Взять демо-автора
            </button>
            {(chars > 0 || tov) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
                Очистить
              </button>
            )}
            {tov && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowInput(false)} disabled={busy}>
                К профилю
              </button>
            )}
            <span className="faint">
              {chars} из {MIN_CHARS} символов · {filled.length} {plural(filled.length, 'пост', 'поста', 'постов')}
            </span>
          </div>
        </section>
      )}

      {tovState === 'loading' && (
        <section className="card">
          <div className="loading"><span className="spinner" aria-hidden="true" /><span>Загружаем профиль…</span></div>
        </section>
      )}

      {tovState === 'error' && (
        <section className="card">
          <ErrorState error={tovError} onRetry={onRetry}>
            {isOffline(tovError) && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>
                Работать локально
              </button>
            )}
          </ErrorState>
        </section>
      )}

      {!inputVisible && tov && (
        <ResultReveal replay={tov.analyzed_at || tov.updated_at || 'tov'}>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Профиль Tone of Voice</h2>
                <p>То, что система будет защищать в ваших текстах.</p>
                {tovState === 'ready' && (
                  <p className="faint" style={{ marginTop: 4, marginBottom: 0 }}>
                    обновлён {fmtDateTime(tov?.analyzed_at || tov?.updated_at)}
                  </p>
                )}
              </div>
              <div className="spacer" />
              <button type="button" className="btn btn-sm" onClick={() => setEditorOpen(true)}>
                Править правила
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowInput(true)}>
                Разобрать заново
              </button>
            </div>

            {stopWordsRestored > 0 && (
              <Notice kind="warn">
                Разбор стиля перезаписывает профиль целиком — ваши стоп-слова
                ({stopWordsRestored}) вернулись на место автоматически. Проверьте список
                в «Править правила».
              </Notice>
            )}

            {analysis && (
              <p className="faint" style={{ marginTop: 0 }}>
                Разобрано: {analysisSummary(analysis)}
                {analysis.source && analysis.source.includes('llm') ? ' · AI дополнял карточку' : ' · только правила'}
              </p>
            )}

            <TovCard
              profile={tov}
              tone={tov.tone}
              slang={slang}
              stopWords={stopWords}
              phrases={favoritePhrases}
            />

            {rulesOnly && (
              <Notice>
                Профиль собран без AI — правилами. Это полный результат: метрики и тон
                считаются по тексту, модель только дополняет формулировки.
              </Notice>
            )}

            <div className="btn-row" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={onNext}>
                Дальше: заметки →
              </button>
            </div>
          </section>
        </ResultReveal>
      )}

      {!inputVisible && !tov && tovState !== 'loading' && tovState !== 'error' && (
        <section className="card">
          <div className="state state-illustrated">
            <VoiceMark size="spot" />
            <div className="state-title">Профиль ещё не построен</div>
            <div className="state-text">
              Вставьте 2–3 своих поста и нажмите «Разобрать стиль». Профиль понадобится
              для сборки черновика и проверки Tone of Voice.
            </div>
          </div>
        </section>
      )}

      <TovEditor
        open={editorOpen}
        channel={channel}
        tov={tov}
        onClose={() => setEditorOpen(false)}
        onSaved={onTovSaved}
      />

      {consent.modal}
    </div>
  )
}
