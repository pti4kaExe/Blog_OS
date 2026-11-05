import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { Field, InlineError, Modal, Notice, Select, TagInput } from '../ui.jsx'

const TONES = [
  { value: 'ты', label: 'На «ты»' },
  { value: 'вы', label: 'На «вы»' },
  { value: 'смешанное', label: 'Смешанное' },
]

function toForm(tov) {
  return {
    tone: tov && TONES.some((item) => item.value === tov.tone) ? tov.tone : 'смешанное',
    slang: Array.isArray(tov?.slang) ? tov.slang : [],
    stop_words: Array.isArray(tov?.stop_words) ? tov.stop_words : [],
    favorite_phrases: Array.isArray(tov?.favorite_phrases) ? tov.favorite_phrases : [],
  }
}

/**
 * Ручная правка профиля голоса — `PUT /author-profiles/{id}/tov`.
 *
 * Разбор по постам даёт цифры (ритм, читаемость, темы), но решает за автора,
 * как он звучит. У Writer и Jasper это разделено: голос считается по текстам,
 * а правила — обращение, свои словечки, запрещённые слова — автор задаёт сам.
 * Здесь так же: метрики остаются от разбора, редактируется только то, что
 * автор знает про себя лучше движка.
 *
 * `PUT` заменяет профиль целиком, поэтому `metrics` отправляются обратно
 * без изменений — иначе разбор по постам потеряется.
 */
export default function TovEditor({ open, channel, tov, onClose, onSaved }) {
  const [form, setForm] = useState(() => toForm(tov))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      setForm(toForm(tov))
      setError(null)
    }
  }, [open, tov])

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await api.tov.put(channel.id, {
        tone: form.tone,
        slang: form.slang,
        stop_words: form.stop_words,
        favorite_phrases: form.favorite_phrases,
        metrics: tov && tov.metrics ? tov.metrics : null,
      })
      onSaved(saved)
      onClose()
    } catch (saveError) {
      setError(saveError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      wide
      title="Правила вашего голоса"
      onClose={busy ? undefined : onClose}
      footer={(
        <div className="btn-row">
          <button type="submit" form="tov-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <div className="spacer" />
          <span className="faint">Метрики разбора сохранятся как есть</span>
        </div>
      )}
    >
      <form id="tov-form" onSubmit={submit}>
        <Field
          label="Обращение к читателю"
          hint="AntiCringe считает отклонением от голоса обращение, которого здесь нет."
          htmlFor="tov-tone"
        >
          <Select id="tov-tone" value={form.tone} onChange={(event) => set('tone', event.target.value)}>
            {TONES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </Select>
        </Field>

        <Field
          label="Ваши словечки"
          hint="Жаргон и слова, которые для вас норма. Enter или запятая — добавить."
          htmlFor="tov-slang"
        >
          <TagInput
            id="tov-slang"
            value={form.slang}
            onChange={(value) => set('slang', value)}
            placeholder="например: залипать"
          />
        </Field>

        <Field
          label="Фирменные фразы"
          hint="То, чем вы начинаете или заканчиваете посты."
          htmlFor="tov-phrases"
        >
          <TagInput
            id="tov-phrases"
            value={form.favorite_phrases}
            onChange={(value) => set('favorite_phrases', value)}
            placeholder="например: по делу"
          />
        </Field>

        <Field
          label="Стоп-слова"
          hint="Слова, которых в ваших текстах быть не должно."
          htmlFor="tov-stop"
        >
          <TagInput
            id="tov-stop"
            tone="warn"
            value={form.stop_words}
            onChange={(value) => set('stop_words', value)}
            placeholder="например: синергия"
          />
        </Field>

        <Notice>
          Обращение действует сразу: проверка AntiCringe сверяет текст именно с ним.
          Фирменные фразы уходят в подсказку стиля при генерации ответов. Словечки
          и стоп-слова пока только хранятся в профиле канала — отдельной проверкой
          они станут, когда движок начнёт их читать (раздел «Контракт API» в отчёте).
        </Notice>

        <InlineError error={error} />
      </form>
    </Modal>
  )
}
