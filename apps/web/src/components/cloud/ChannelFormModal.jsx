import { useEffect, useState } from 'react'
import { PLATFORMS, PLATFORM_HINTS } from '../../lib/format.js'
import {
  Field, FormSection, InlineError, Modal, RangeField, Select, TextInput,
} from '../ui.jsx'
import StepTransition from '../ui/StepTransition.jsx'

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

function validate(form) {
  if (!form.name.trim()) return 'Укажите название канала.'
  const min = form.min === '' ? null : Number(form.min)
  const max = form.max === '' ? null : Number(form.max)
  if (min !== null && (!Number.isFinite(min) || min < 0)) return 'Минимальная длина должна быть неотрицательным числом.'
  if (max !== null && (!Number.isFinite(max) || max < 0)) return 'Максимальная длина должна быть неотрицательным числом.'
  if (min !== null && max !== null && min > max) return 'Минимальная длина не может быть больше максимальной.'
  const limit = form.limit === '' ? null : Number(form.limit)
  if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return 'Лимит расходов — неотрицательное число.'
  return null
}

function toPayload(form) {
  const min = form.min === '' ? null : Number(form.min)
  const max = form.max === '' ? null : Number(form.max)
  const limit = form.limit === '' ? null : Number(form.limit)
  const topics = form.topics.split(',').map((topic) => topic.trim()).filter(Boolean)
  return {
    name: form.name.trim(),
    platform: form.platform,
    description: form.description.trim() || null,
    content_settings: {
      topics,
      language: 'ru',
      ...(min !== null || max !== null ? { target_length: { min, max } } : {}),
    },
    monthly_cost_limit: limit,
  }
}

/**
 * Создание и редактирование канала (author_profile).
 *
 * Два разных сценария — не один экран с режимом. Новый канал человек ещё
 * не представляет себе: ему нужен вопрос за вопросом, с местом подумать
 * над каждым. Существующий канал он уже знает весь целиком: ему нужно
 * видеть все поля сразу и поправить одно, не проходя мастер заново.
 * Поэтому создание — визард, а редактирование — сгруппированная форма.
 */
export default function ChannelFormModal({ open, channel, busy, error, onSubmit, onDelete, onClose }) {
  if (channel) {
    return (
      <EditChannelModal
        open={open} channel={channel} busy={busy} error={error}
        onSubmit={onSubmit} onDelete={onDelete} onClose={onClose}
      />
    )
  }
  return <CreateChannelWizard open={open} busy={busy} error={error} onSubmit={onSubmit} onClose={onClose} />
}

/* ══════════════════════════════════ редактирование ═══════════════════════ */

function EditChannelModal({ open, channel, busy, error, onSubmit, onDelete, onClose }) {
  const [form, setForm] = useState(() => fromChannel(channel))
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (open) { setForm(fromChannel(channel)); setLocalError('') }
  }, [open, channel])

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))

  const submit = (event) => {
    event.preventDefault()
    const problem = validate(form)
    if (problem) { setLocalError(problem); return }
    setLocalError('')
    onSubmit(toPayload(form))
  }

  return (
    <Modal
      open={open}
      title="Изменить канал"
      onClose={busy ? undefined : onClose}
      footer={(
        <div className="btn-row">
          <button type="submit" form="channel-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Отмена</button>
        </div>
      )}
    >
      <form id="channel-form" onSubmit={submit}>
        <FormSection title="Канал" hint="Название и площадка, где публикуется пост.">
          <div className="form-grid">
            <Field label="Название канала" htmlFor="channel-name">
              <TextInput id="channel-name" value={form.name} onChange={set('name')} placeholder="Заметки разработчика" maxLength={120} />
            </Field>
            <Field label="Площадка" hint={PLATFORM_HINTS[form.platform]} htmlFor="channel-platform">
              <Select id="channel-platform" value={form.platform} onChange={set('platform')}>
                {PLATFORMS.map((platform) => <option key={platform.value} value={platform.value}>{platform.label}</option>)}
              </Select>
            </Field>
          </div>
        </FormSection>

        <FormSection title="Контент" hint="О чём канал и какой длины обычно посты — подсказка для Narrative Engine.">
          <Field label="Описание" hint="Коротко, своими словами." htmlFor="channel-description">
            <textarea
              id="channel-description" className="ta" style={{ minHeight: 78 }}
              value={form.description} onChange={set('description')}
              placeholder="Пишу о разработке и учёбе без мотивационного шума"
            />
          </Field>
          <div style={{ marginTop: 16 }}>
            <Field label="Темы" hint="Через запятую: код, учёба, карьера." htmlFor="channel-topics">
              <TextInput id="channel-topics" value={form.topics} onChange={set('topics')} placeholder="код, учёба, карьера" />
            </Field>
          </div>
          <div style={{ marginTop: 16 }}>
            <RangeField
              id="channel-length" label="Целевая длина поста" unit="симв."
              from={form.min} to={form.max}
              onFrom={set('min')} onTo={set('max')}
            />
          </div>
        </FormSection>

        <FormSection title="Лимит AI" hint="Пусто — без лимита. 80% — предупреждение, 100% — только правила.">
          <Field label="В месяц, ₽" htmlFor="channel-limit">
            <TextInput id="channel-limit" inputMode="decimal" value={form.limit} onChange={set('limit')} placeholder="500" />
          </Field>
        </FormSection>

        {localError && <InlineError error={{ message: localError, code: 'validation_error' }} />}
        {error && <InlineError error={error} />}
      </form>

      {channel && onDelete && (
        <div className="danger-zone">
          <h3>Удаление канала</h3>
          <p className="faint" style={{ marginTop: 0 }}>
            Канал удалится вместе со стилем, постами, черновиками, источниками,
            комментариями и базой знаний. Журнал расходов на AI сохранится.
          </p>
          <button type="button" className="btn btn-sm btn-danger" onClick={onDelete} disabled={busy}>
            Удалить канал
          </button>
        </div>
      )}
    </Modal>
  )
}

/* ══════════════════════════════════════ создание ══════════════════════════ */

const STEPS = ['name', 'content', 'length', 'limit']

function CreateChannelWizard({ open, busy, error, onSubmit, onClose }) {
  const [form, setForm] = useState(() => ({ ...EMPTY }))
  const [stepIndex, setStepIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (open) { setForm({ ...EMPTY }); setStepIndex(0); setDirection(1); setLocalError('') }
  }, [open])

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))
  const last = stepIndex === STEPS.length - 1
  const step = STEPS[stepIndex]

  const stepProblem = () => {
    if (step === 'name' && !form.name.trim()) return 'Как назовём канал?'
    if (step === 'length') {
      const min = form.min === '' ? null : Number(form.min)
      const max = form.max === '' ? null : Number(form.max)
      if (min !== null && (!Number.isFinite(min) || min < 0)) return 'Минимальная длина должна быть неотрицательным числом.'
      if (max !== null && (!Number.isFinite(max) || max < 0)) return 'Максимальная длина должна быть неотрицательным числом.'
      if (min !== null && max !== null && min > max) return 'Минимальная длина не может быть больше максимальной.'
    }
    if (step === 'limit') {
      const limit = form.limit === '' ? null : Number(form.limit)
      if (limit !== null && (!Number.isFinite(limit) || limit < 0)) return 'Лимит расходов — неотрицательное число.'
    }
    return null
  }

  const goNext = () => {
    const problem = stepProblem()
    if (problem) { setLocalError(problem); return }
    setLocalError('')
    if (last) {
      const final = validate(form)
      if (final) { setLocalError(final); return }
      onSubmit(toPayload(form))
      return
    }
    setDirection(1)
    setStepIndex((i) => i + 1)
  }

  const goBack = () => {
    setLocalError('')
    if (stepIndex === 0) { onClose(); return }
    setDirection(-1)
    setStepIndex((i) => i - 1)
  }

  /* Enter продвигает визард — это диалог из одного вопроса за раз,
     и клавиатурный сценарий должен быть таким же быстрым, как клик. */
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
      event.preventDefault()
      goNext()
    }
  }

  return (
    <Modal
      open={open}
      title="Новый канал"
      onClose={busy ? undefined : onClose}
      footer={(
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={goNext} disabled={busy}>
            {busy ? 'Создаём…' : last ? 'Создать канал' : 'Дальше →'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={goBack} disabled={busy}>
            {stepIndex === 0 ? 'Отмена' : '← Назад'}
          </button>
          {step === 'limit' && !last && null}
        </div>
      )}
    >
      {/* Точки прогресса: тихая подпись места в сценарии, не ещё одна
          панель навигации — визард короткий, четыре шага видно целиком. */}
      <div className="wizard-dots" role="presentation" aria-hidden="true">
        {STEPS.map((key, i) => (
          <span key={key} className="wizard-dot" data-state={i === stepIndex ? 'active' : i < stepIndex ? 'done' : 'idle'} />
        ))}
      </div>

      <div onKeyDown={onKeyDown}>
        <StepTransition step={step} direction={direction}>
          {step === 'name' && (
            <div className="wizard-step">
              <h2 className="wizard-question">Как называется канал?</h2>
              <p className="wizard-hint">Так он будет выглядеть в списке каналов и в архиве постов.</p>
              <div className="wizard-field">
                <TextInput
                  autoFocus value={form.name} onChange={set('name')}
                  placeholder="Заметки разработчика" maxLength={120}
                  className="wizard-input"
                />
              </div>
              <div className="wizard-field" style={{ marginTop: 16 }}>
                <Field label="Площадка" hint={PLATFORM_HINTS[form.platform]} htmlFor="wizard-platform">
                  <Select id="wizard-platform" value={form.platform} onChange={set('platform')}>
                    {PLATFORMS.map((platform) => <option key={platform.value} value={platform.value}>{platform.label}</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          )}

          {step === 'content' && (
            <div className="wizard-step">
              <h2 className="wizard-question">О чём вы пишете?</h2>
              <p className="wizard-hint">Коротко — это подскажет Narrative Engine, о чём собирать посты.</p>
              <div className="wizard-field">
                <textarea
                  className="ta wizard-textarea" autoFocus
                  value={form.description} onChange={set('description')}
                  placeholder="Пишу о разработке и учёбе без мотивационного шума"
                />
              </div>
              <div className="wizard-field" style={{ marginTop: 16 }}>
                <Field label="Темы" hint="Через запятую: код, учёба, карьера." htmlFor="wizard-topics">
                  <TextInput id="wizard-topics" value={form.topics} onChange={set('topics')} placeholder="код, учёба, карьера" />
                </Field>
              </div>
            </div>
          )}

          {step === 'length' && (
            <div className="wizard-step">
              <h2 className="wizard-question">Какой длины обычно посты?</h2>
              <p className="wizard-hint">Диапазон в символах — Narrative Engine будет держаться его при сборке.</p>
              <div className="wizard-field">
                <RangeField
                  id="wizard-length" label="Целевая длина" unit="симв."
                  from={form.min} to={form.max}
                  onFrom={set('min')} onTo={set('max')}
                />
              </div>
            </div>
          )}

          {step === 'limit' && (
            <div className="wizard-step">
              <h2 className="wizard-question">Ограничить расходы на AI?</h2>
              <p className="wizard-hint">
                Необязательно. Пусто — без лимита. 80% — предупреждение, 100% — проверки
                и сборка продолжат работать на правилах, без AI.
              </p>
              <div className="wizard-field">
                <Field label="В месяц, ₽" htmlFor="wizard-limit">
                  <TextInput
                    id="wizard-limit" inputMode="decimal" autoFocus
                    value={form.limit} onChange={set('limit')} placeholder="500"
                  />
                </Field>
              </div>
            </div>
          )}
        </StepTransition>
      </div>

      {localError && <InlineError error={{ message: localError, code: 'validation_error' }} />}
      {error && <InlineError error={error} />}
    </Modal>
  )
}
