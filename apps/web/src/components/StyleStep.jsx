import { useState } from 'react'
import { buildStyleProfile } from '../engine/styleProfile.js'
import { DEMO_AUTHOR } from '../engine/demoData.js'
import { Notice } from './ui.jsx'
import TovCard from './TovCard.jsx'
import { ResultReveal } from './ui/Motion.jsx'

/**
 * Шаг 1. Профиль авторского стиля.
 * Система разбирает собственные посты автора и строит из них Tone of Voice,
 * на который дальше опираются Narrative Engine, AntiCringe и CommentRadar.
 */
export default function StyleStep({ samples, setSamples, profile, setProfile, onNext }) {
  const [error, setError] = useState('')

  const setSample = (i, value) => {
    const next = samples.slice()
    next[i] = value
    setSamples(next)
  }

  const analyze = () => {
    const built = buildStyleProfile(samples)
    if (!built) {
      setError('Мало материала. Нужно минимум 180 символов — один-два своих поста целиком.')
      setProfile(null)
      return
    }
    setError('')
    setProfile(built)
  }

  const loadDemo = () => {
    setSamples(DEMO_AUTHOR.samples.slice())
    setProfile(buildStyleProfile(DEMO_AUTHOR.samples))
    setError('')
  }

  const reset = () => {
    setSamples(['', '', ''])
    setProfile(null)
    setError('')
  }

  const chars = samples.join('').trim().length

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Ваши прошлые посты</h2>
            <p>2–3 текста, которые вы считаете «своими по голосу». Они остаются в браузере.</p>
          </div>
        </div>

        {samples.map((value, i) => (
          <div className="sample-row" key={i}>
            <div className="sample-n">{i + 1}</div>
            <textarea
              className="ta"
              value={value}
              onChange={(e) => setSample(i, e.target.value)}
              placeholder={i === 0 ? 'Вставьте сюда свой пост целиком…' : 'Ещё один пост (необязательно)'}
            />
          </div>
        ))}

        {error && <Notice kind="warn">{error}</Notice>}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-primary" onClick={analyze} disabled={chars < 30}>
            Разобрать стиль
          </button>
          <button type="button" className="btn btn-ghost" onClick={loadDemo}>
            Взять демо-автора
          </button>
          {(chars > 0 || profile) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
              Очистить
            </button>
          )}
          <span className="faint">{chars} символов</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Профиль Tone of Voice</h2>
            <p>То, что система будет защищать в ваших текстах.</p>
          </div>
        </div>

        {!profile ? (
          <div className="empty">
            Профиль появится после разбора.
            <br />
            Без него проверка стиля работать не будет.
          </div>
        ) : (
          <ResultReveal replay={profile}>
            <TovCard profile={profile} />

            <button type="button" className="btn btn-primary" onClick={onNext}>
              Дальше: заметки →
            </button>
          </ResultReveal>
        )}
      </section>
    </div>
  )
}
