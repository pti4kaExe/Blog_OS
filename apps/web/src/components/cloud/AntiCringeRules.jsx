import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { apiErrorMessage, plural } from '../../lib/format.js'
import {
  Field, FormSection, InlineError, Notice, Tag, TextInput,
} from '../ui.jsx'

const MAX_RULES = 50

/**
 * Правила AntiCringe — блок из ТЗ, которого не хватало: автор сам задаёт
 * слова и обороты, которые проверка обязана отметить.
 *
 * Почему это отдельная функция, а не «ещё одно поле в профиле стиля»:
 * стоп-слова — это не описание голоса, а редакторское решение «так у меня
 * не пишут». Profile стиля строится из прошлых постов и может их не увидеть,
 * а правило должно срабатывать сразу и работать без AI.
 *
 * Хранение: `tov_profiles.stop_words` (массив строк), запись — `PUT /tov`
 * полной заменой профиля, как требует контракт.
 */
export default function AntiCringeRules({ channel, onSaved }) {
  const [tov, setTov] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | empty | error
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [notice, setNotice] = useState(null)

  const profileId = channel?.id

  const load = useCallback(async () => {
    if (!profileId) {
      setState('empty')
      return
    }
    setState('loading')
    setError(null)
    try {
      const payload = await api.tov.get(profileId)
      setTov(payload && payload.tov_profile ? payload.tov_profile : payload)
      setState('ready')
    } catch (loadError) {
      if (loadError.status === 404) {
        setState('empty')
        return
      }
      setError(loadError)
      setState('error')
    }
  }, [profileId])

  useEffect(() => {
    let alive = true
    if (!profileId) {
      setState('empty')
      return () => { alive = false }
    }
    setState('loading')
    api.tov.get(profileId)
      .then((payload) => {
        if (!alive) return
        setTov(payload && payload.tov_profile ? payload.tov_profile : payload)
        setState('ready')
      })
      .catch((loadError) => {
        if (!alive) return
        if (loadError.status === 404) {
          setState('empty')
          return
        }
        setError(loadError)
        setState('error')
      })
    return () => { alive = false }
  }, [profileId, savedAt])

  if (!profileId) {
    return (
      <FormSection title="Правила AntiCringe" hint="Слова и обороты, которые проверка должна отмечать.">
        <p className="faint">Сначала выберите канал — правила привязаны к его профилю стиля.</p>
      </FormSection>
    )
  }

  if (state === 'loading') {
    return (
      <FormSection title="Правила AntiCringe" hint="Слова и обороты, которые проверка должна отмечать.">
        <p className="faint">Загружаем правила…</p>
      </FormSection>
    )
  }

  if (state === 'empty') {
    return (
      <FormSection title="Правила AntiCringe" hint="Слова и обороты, которые проверка должна отмечать.">
        <Notice kind="warn">
          У канала ещё нет профиля стиля. Разберите 2–3 своих поста на шаге «Стиль» — и здесь
          появится список правил. Это не блокирует работу: проверка на клише и логику работает
          и без профиля.
        </Notice>
      </FormSection>
    )
  }

  if (state === 'error') {
    return (
      <FormSection title="Правила AntiCringe" hint="Слова и обороты, которые проверка должна отмечать.">
        <InlineError error={error} />
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-sm" onClick={load}>Повторить</button>
        </div>
      </FormSection>
    )
  }

  const rules = Array.isArray(tov?.stop_words) ? tov.stop_words : []

  const addRule = () => {
    const value = draft.trim()
    if (!value) return
    if (rules.some((rule) => rule.toLowerCase() === value.toLowerCase())) {
      setNotice('Такое правило уже есть.')
      setDraft('')
      return
    }
    if (rules.length >= MAX_RULES) {
      setNotice(`Больше ${MAX_RULES} правил не поддерживается: проще объединить похожие.`)
      return
    }
    setTov({ ...tov, stop_words: [...rules, value] })
    setDraft('')
    setNotice(null)
    setSavedAt(null)
  }

  const removeRule = (rule) => {
    setTov({ ...tov, stop_words: rules.filter((item) => item !== rule) })
    setNotice(null)
    setSavedAt(null)
  }

  const save = async () => {
    setBusy(true)
    setNotice(null)
    try {
      // PUT /tov — полная замена профиля, поэтому переносим остальные поля как есть.
      const saved = await api.tov.put(profileId, {
        tone: tov?.tone ?? 'ты',
        slang: Array.isArray(tov?.slang) ? tov.slang : [],
        stop_words: rules,
        favorite_phrases: Array.isArray(tov?.favorite_phrases) ? tov.favorite_phrases : [],
        metrics: tov?.metrics ?? null,
      })
      setTov(saved && saved.tov_profile ? saved.tov_profile : saved)
      setSavedAt(new Date())
      if (onSaved) onSaved(saved)
    } catch (saveError) {
      setError(saveError)
      setNotice(apiErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  const dirty = Boolean(savedAt === null || draft.trim())

  return (
    <FormSection
      title="Правила AntiCringe"
      hint="Слова и обороты, которые проверка обязана отметить. Работают всегда — даже без AI."
    >
      <div className="tags" style={{ marginBottom: 12 }}>
        {rules.length === 0 && <span className="faint">Пока нет правил: проверка работает по общим спискам.</span>}
        {rules.map((rule) => (
          <Tag key={rule}>
            {rule}{' '}
            <button
              type="button"
              className="link"
              onClick={() => removeRule(rule)}
              title={`Убрать правило «${rule}»`}
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
            >
              ×
            </button>
          </Tag>
        ))}
      </div>

      <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
        <Field label="Добавить правило" htmlFor="anticringe-rule" hint="Слово или короткий оборот, например «синергия»">
          <TextInput
            id="anticringe-rule"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addRule()
              }
            }}
            placeholder="например, «в современном мире»"
          />
        </Field>
        <button type="button" className="btn btn-sm" onClick={addRule} disabled={!draft.trim()}>
          Добавить
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={save} disabled={busy || !dirty}>
          {busy ? 'Сохраняем…' : 'Сохранить правила'}
        </button>
      </div>

      <p className="faint" style={{ marginTop: 10, marginBottom: 0 }}>
        {rules.length} {plural(rules.length, 'правило', 'правила', 'правил')} · применяются при
        следующей проверке черновика; на AI-расходы не влияют.
        {savedAt ? ` Сохранено в ${savedAt.toLocaleTimeString('ru-RU')}.` : ''}
      </p>

      {notice && <Notice kind="warn">{notice}</Notice>}
      {error && state === 'ready' && <InlineError error={error} />}
    </FormSection>
  )
}
