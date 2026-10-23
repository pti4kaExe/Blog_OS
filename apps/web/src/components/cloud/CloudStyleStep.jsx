import { useState } from 'react'
import { DEMO_AUTHOR } from '../../engine/demoData.js'
import { getAiConsent, useAiConsent } from '../../lib/aiConsent.jsx'
import {
  analysisSummary, tovMetricRows, tovTags,
} from '../../lib/tov.js'
import { fmtDateTime, isOffline, plural } from '../../lib/format.js'
import {
  AiBadge, ErrorState, InlineError, Metric, Notice, Tag, Toggle,
} from '../ui.jsx'

const MIN_CHARS = 180

/**
 * Шаг 1 в облаке. Профиль стиля строится сервером:
 * `POST /author-profiles/{id}/tov/analyze`; правиловый слой работает всегда,
 * AI — только с согласия автора. Отказ ⇒ `use_llm: false` и
 * индикатор «проверено без AI».
 */
export default function CloudStyleStep({
  channel, tov, tovState, tovError, analysis, verifiedWithoutAi,
  onRetry, onAnalyze, onNext, onUseLocal,
}) {
  const [samples, setSamples] = useState(['', '', ''])
  const [useLlm, setUseLlm] = useState(getAiConsent() === 'granted')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const consent = useAiConsent()

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
  const metricRows = tovMetricRows(tov)
  const tags = tovTags(tov)
  const slang = Array.isArray(tov?.slang) ? tov.slang : []
  const stopWords = Array.isArray(tov?.stop_words) ? tov.stop_words : []
  const favoritePhrases = Array.isArray(tov?.favorite_phrases) ? tov.favorite_phrases : []

  return (
    <div className="grid-2">
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
          <span className="faint">
            {chars} из {MIN_CHARS} символов · {filled.length} {plural(filled.length, 'пост', 'поста', 'постов')}
          </span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Профиль Tone of Voice</h2>
            <p>То, что система будет защищать в ваших текстах.</p>
          </div>
          <div className="spacer" />
          {tovState === 'ready' && (
            <span className="faint">обновлён {fmtDateTime(tov?.analyzed_at || tov?.updated_at)}</span>
          )}
        </div>

        {tovState === 'loading' && <div className="loading"><span className="spinner" aria-hidden="true" /><span>Загружаем профиль…</span></div>}

        {tovState === 'error' && (
          <ErrorState error={tovError} onRetry={onRetry}>
            {isOffline(tovError) && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>
                Работать локально
              </button>
            )}
          </ErrorState>
        )}

        {tovState !== 'loading' && !tov && tovState !== 'error' && (
          <div className="state">
            <div className="state-icon" aria-hidden="true">·</div>
            <div className="state-title">Профиль ещё не построен</div>
            <div className="state-text">
              Вставьте 2–3 своих поста и нажмите «Разобрать стиль». Профиль понадобится
              для сборки черновика и проверки Tone of Voice.
            </div>
          </div>
        )}

        {tov && (
          <>
            {analysis && (
              <p className="faint" style={{ marginTop: 0 }}>
                Разобрано: {analysisSummary(analysis)}
                {analysis.source && analysis.source.includes('llm') ? ' · AI дополнял карточку' : ' · только правила'}
              </p>
            )}

            <div className="metrics" style={{ marginBottom: 14 }}>
              {metricRows.slice(0, 6).map((row) => (
                <Metric key={row.key} value={row.value} label={row.label} />
              ))}
              {metricRows.length === 0 && (
                <>
                  <Metric value={tov.tone || '—'} label="обращение" />
                  <Metric value={slang.length} label="сленговых слов" />
                  <Metric value={stopWords.length} label="стоп-слов" />
                  <Metric value={favoritePhrases.length} label="фирменных фраз" />
                </>
              )}
            </div>

            <h3>Тон и лексика</h3>
            <div className="tags" style={{ marginBottom: 12 }}>
              {tov.tone && <Tag kind="accent">обращение: {tov.tone}</Tag>}
              {slang.map((word) => <Tag key={`slang-${word}`}>{word}</Tag>)}
              {favoritePhrases.map((phrase) => <Tag key={`phrase-${phrase}`}>{phrase}</Tag>)}
            </div>

            {stopWords.length > 0 && (
              <>
                <h3>Стоп-слова</h3>
                <div className="tags" style={{ marginBottom: 12 }}>
                  {stopWords.map((word) => <Tag key={`stop-${word}`} kind="warn">{word}</Tag>)}
                </div>
              </>
            )}

            {tags.topics.length > 0 && (
              <>
                <h3>Ваши темы</h3>
                <div className="tags" style={{ marginBottom: 12 }}>
                  {tags.topics.map((topic) => <Tag key={topic} kind="accent">{topic}</Tag>)}
                </div>
              </>
            )}

            {tags.phrases.length > 0 && (
              <>
                <h3>Фирменные фразы</h3>
                <div className="tags" style={{ marginBottom: 12 }}>
                  {tags.phrases.map((phrase) => <Tag key={phrase}>{phrase}</Tag>)}
                </div>
              </>
            )}

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
          </>
        )}
      </section>

      {consent.modal}
    </div>
  )
}
