import { useEffect, useState } from 'react'
import { PLATFORMS, PLATFORM_HINTS } from '../../lib/format.js'
import { Field, InlineError, Modal, Select, TextInput } from '../ui.jsx'

const EMPTY = {
  name: '',
  platform: 'telegram',
  description: '',
  topics: '',
  min: '800',
  max: '2500',
  limit: '500',
}

function fromChannel(channel) {
  if (!channel) return { ...EMPTY }
  const settings = channel.content_settings || {}
  const target = settings.target_length || {}
  return {
    name: channel.name || '',
    platform: channel.platform || 'telegram',
    description: channel.description || '',
    topics: Array.isArray(settings.topics) ? settings.topics.join(', ') : '',
    min: target.min !== undefined && target.min !== null ? String(target.min) : '',
    max: target.max !== undefined && target.max !== null ? String(target.max) : '',
    limit: channel.monthly_cost_limit !== null && channel.monthly_cost_limit !== undefined
      ? String(channel.monthly_cost_limit)
      : '',
  }
}

/**
 * Создание и редактирование канала (author_profile).
 * Одна площадка — один канал: платформа, описание, темы, целевая длина и лимит AI.
 */
export default function ChannelFormModal({ open, channel, busy, error, onSubmit, onClose }) {
  const [form, setForm] = useState(() => fromChannel(channel))
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (open) {
      setForm(fromChannel(channel))
      setLocalError('')
    }
  }, [open, channel])

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const submit = (event) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setLocalError('Укажите название канала.')
      return
    }
    const min = form.min === '' ? null : Number(form.min)
    const max = form.max === '' ? null : Number(form.max)
    if (min !== null && (!Number.isFinite(min) || min < 0)) {
      setLocalError('Минимальная длина должна быть неотрицательным числом.')
      return
    }
    if (max !== null && (!Number.isFinite(max) || max < 0)) {
      setLocalError('Максимальная длина должна быть неотрицательным числом.')
      return
    }
    if (min !== null && max !== null && min > max) {
      setLocalError('Минимальная длина не может быть больше максимальной.')
      return
    }
    const limit = form.limit === '' ? null : Number(form.limit)
    if (limit !== null && (!Number.isFinite(limit) || limit < 0)) {
      setLocalError('Лимит расходов — неотрицательное число.')
      return
    }
    const topics = form.topics
      .split(',')
      .map((topic) => topic.trim())
      .filter(Boolean)

    setLocalError('')
    onSubmit({
      name: form.name.trim(),
      platform: form.platform,
      description: form.description.trim() || null,
      content_settings: {
        topics,
        language: 'ru',
        ...(min !== null || max !== null ? { target_length: { min, max } } : {}),
      },
      monthly_cost_limit: limit,
    })
  }

  return (
    <Modal
      open={open}
      title={channel ? 'Изменить канал' : 'Новый канал'}
      onClose={busy ? undefined : onClose}
      footer={(
        <div className="btn-row">
          <button type="submit" form="channel-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Сохраняем…' : channel ? 'Сохранить' : 'Создать канал'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Отмена</button>
        </div>
      )}
    >
      <form id="channel-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Название канала" htmlFor="channel-name">
            <TextInput
              id="channel-name"
              value={form.name}
              onChange={set('name')}
              placeholder="Заметки разработчика"
              maxLength={120}
            />
          </Field>
          <Field label="Площадка" hint={PLATFORM_HINTS[form.platform]} htmlFor="channel-platform">
            <Select id="channel-platform" value={form.platform} onChange={set('platform')}>
              {PLATFORMS.map((platform) => (
                <option key={platform.value} value={platform.value}>{platform.label}</option>
              ))}
            </Select>
          </Field>
          <div className="span-2">
            <Field label="Описание" hint="О чём канал — подсказка для Narrative Engine." htmlFor="channel-description">
              <textarea
                id="channel-description"
                className="ta"
                style={{ minHeight: 78 }}
                value={form.description}
                onChange={set('description')}
                placeholder="Пишу о разработке и учёбе без мотивационного шума"
              />
            </Field>
          </div>
          <div className="span-2">
            <Field label="Темы" hint="Через запятую: код, учёба, карьера." htmlFor="channel-topics">
              <TextInput
                id="channel-topics"
                value={form.topics}
                onChange={set('topics')}
                placeholder="код, учёба, карьера"
              />
            </Field>
          </div>
          <Field label="Целевая длина, от" htmlFor="channel-min">
            <TextInput id="channel-min" inputMode="numeric" value={form.min} onChange={set('min')} placeholder="800" />
          </Field>
          <Field label="Целевая длина, до" htmlFor="channel-max">
            <TextInput id="channel-max" inputMode="numeric" value={form.max} onChange={set('max')} placeholder="2500" />
          </Field>
          <Field label="Лимит AI в месяц, ₽" hint="Пусто — без лимита. 80% — предупреждение, 100% — только правила." htmlFor="channel-limit">
            <TextInput id="channel-limit" inputMode="decimal" value={form.limit} onChange={set('limit')} placeholder="500" />
          </Field>
        </div>

        {localError && <InlineError error={{ message: localError, code: 'validation_error' }} />}
        {error && <InlineError error={error} />}
      </form>
    </Modal>
  )
}
