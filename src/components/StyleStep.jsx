import { useState } from 'react'
import { buildStyleProfile } from '../engine/styleProfile.js'
import { DEMO_AUTHOR } from '../engine/demoData.js'
import { Metric, Notice, Tag } from './ui.jsx'

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
          <>
            <p style={{ marginTop: 0 }}>
              <strong>Как вы пишете:</strong> {profile.summary}
            </p>

            <div className="metrics" style={{ marginBottom: 14 }}>
              <Metric value={profile.avgSentenceLen} label="слов в предложении" />
              <Metric value={profile.firstPersonPer100Words} label="«я» на 100 слов" />
              <Metric value={`${profile.questionShare}%`} label="вопросов" />
              <Metric value={profile.address} label="обращение" />
              <Metric value={profile.emojiPer100Words} label="эмодзи /100 слов" />
              <Metric value={profile.readability} label="читаемость" />
            </div>

            <h3>Ваши темы</h3>
            <div className="tags" style={{ marginBottom: 14 }}>
              {profile.topTerms.slice(0, 10).map((t) => (
                <Tag key={t.stem} kind="accent">{t.label}</Tag>
              ))}
            </div>

            {profile.signaturePhrases.length > 0 && (
              <>
                <h3>Частые связки</h3>
                <div className="tags" style={{ marginBottom: 14 }}>
                  {profile.signaturePhrases.map((p) => <Tag key={p}>{p}</Tag>)}
                </div>
              </>
            )}

            <p className="faint" style={{ marginBottom: 14 }}>
              Разобрано постов: {profile.stats.posts} · слов: {profile.stats.words} · начало поста обычно — {profile.openingStyle}
            </p>

            <button type="button" className="btn btn-primary" onClick={onNext}>
              Дальше: заметки →
            </button>
          </>
        )}
      </section>
    </div>
  )
}
