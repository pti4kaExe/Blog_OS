import { useEffect, useRef, useState } from 'react'
import api from '../../api/client.js'
import { apiErrorMessage, isOffline } from '../../lib/format.js'
import { Field, InlineError, Loading, Notice, Tag, TextInput } from '../ui.jsx'
import VoiceMark from '../ui/VoiceMark.jsx'
import { Reveal, Stagger } from '../ui/Motion.jsx'

/**
 * Экран входа в облачный режим.
 *
 * Если приложение открыто внутри Telegram, `window.Telegram.WebApp.initData`
 * есть на старте — вход выполняется автоматически через `POST /auth/telegram`.
 * Без Telegram остаётся dev-форма (`telegram_id`, имя): на сервере она работает
 * при `DEV_AUTH=1` (docs/DECISIONS.md, № 12).
 */
export default function LoginScreen({ onLogin, onUseLocal }) {
  const [telegramId, setTelegramId] = useState('200600')
  const [name, setName] = useState('Демо-автор')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [telegramAuto, setTelegramAuto] = useState('idle') // idle | trying | failed
  const autoStarted = useRef(false)

  useEffect(() => {
    const initData = window.Telegram?.WebApp?.initData
    if (!initData || autoStarted.current) return
    autoStarted.current = true
    setTelegramAuto('trying')
    setBusy(true)
    api.auth.telegram({ initData })
      .then((result) => onLogin(result))
      .catch((authError) => {
        setTelegramAuto('failed')
        setError(authError)
        setBusy(false)
      })
  }, [onLogin])

  const submit = async (event) => {
    event.preventDefault()
    const id = Number(telegramId)
    if (!Number.isFinite(id) || id <= 0) {
      setError({ message: 'Номер в Telegram — это целое положительное число.', code: 'validation_error' })
      return
    }
    if (!name.trim()) {
      setError({ message: 'Напишите, как вас называть.', code: 'validation_error' })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await api.auth.telegram({ telegram_id: id, name: name.trim() })
      await onLogin(result)
    } catch (authError) {
      setError(authError)
      setBusy(false)
    }
  }

  if (telegramAuto === 'trying') {
    return (
      <section className="card">
        <Loading label="Входим через Telegram…" />
      </section>
    )
  }

  return (
    <>
      {/* Бренд-зона — единственное место, где движение работает на
          впечатление, а не на действие. Она живёт до входа и не отодвигает
          форму: продукт начинается сразу под ней. */}
      <Stagger className="brand-zone">
        <Reveal offset={14}>
          <VoiceMark size="hero" />
        </Reveal>
        <Reveal className="brand-zone-text" offset={14}>
          <h1 className="brand-zone-title">BlogOS</h1>
          <p className="brand-zone-lead">
            Пост в вашем голосе — собранный из сырых заметок и проверенный до публикации.
          </p>
        </Reveal>
      </Stagger>

      <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Вход</h2>
            <p>Аккаунт создаётся при первом входе — отдельной регистрации нет.</p>
          </div>
        </div>

        {telegramAuto === 'failed' && (
          <div className="mb-4">
            <Notice kind="warn">
              Автоматический вход через Telegram не удался — {apiErrorMessage(error)}.
              Открытая сессия продолжает работать. Можно войти по форме ниже.
            </Notice>
          </div>
        )}

        <form onSubmit={submit}>
          <div className="form-grid">
            {/* Имя первым: это единственное поле, которое человек
                действительно про себя заполняет. Номер — служебный, и
                стоит вторым. */}
            <Field label="Как вас называть" hint="Так к вам будет обращаться интерфейс." htmlFor="login-name">
              <TextInput
                id="login-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Демо-автор"
                autoComplete="off"
              />
            </Field>
            <Field
              label="Номер в Telegram"
              hint="Отличает вас от других авторов. Для демонстрации подойдёт 200600."
              htmlFor="login-telegram-id"
            >
              <TextInput
                id="login-telegram-id"
                inputMode="numeric"
                value={telegramId}
                onChange={(event) => setTelegramId(event.target.value)}
                placeholder="200600"
                autoComplete="off"
              />
            </Field>
          </div>

          <InlineError error={error} />

          <div className="btn-row mt-4">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Входим…' : 'Войти'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onUseLocal}>
              Работать локально
            </button>
          </div>

          {error && isOffline(error) && (
            <p className="faint mt-3">
              Облачный сервер не отвечает. Локальный режим работает без сети — все четыре шага и
              CommentRadar считаются в браузере.
            </p>
          )}

          {/* Служебное — под складку. Эта форма нужна только вне
              Telegram: внутри него вход происходит сам. Объяснение
              важно тому, кто разворачивает проект, и мешает тому,
              кто просто хочет войти. */}
          <details className="login-tech">
            <summary>Почему здесь форма, а не кнопка Telegram</summary>
            <p>
              Внутри Telegram приложение узнаёт автора само и входит без единого вопроса.
              В обычном браузере этого способа нет, поэтому остаётся форма: она создаёт
              или находит автора по имени и номеру.
            </p>
            <p>
              Сервер должен быть запущен с включённым входом по форме
              (<code>DEV_AUTH=1</code>) — на рабочем сервере этот способ отключают.
            </p>
          </details>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Что даёт облако</h2>
            <p>
            Локальный режим доступен в любой момент: сейчас — кнопкой «Работать локально»
            слева, после входа — внизу боковой панели.
          </p>
          </div>
        </div>
        <ul className="consent-list mt-0">
          <li>Профиль стиля, черновики и архив живут на сервере, а не в одном этом браузере.</li>
          <li>История проверок: видно, как текст менялся от правки к правке.</li>
          <li>CommentRadar следит за Telegram, Instagram и YouTube и приносит обсуждения по вашим темам.</li>
          <li>Факты о вас, на которые опирается движок, чтобы не выдумывать цифры за вас.</li>
        </ul>
        <div className="tags mt-4">
          <Tag>русский интерфейс</Tag>
          <Tag>AI — только с вашего согласия</Tag>
          <Tag>ключи остаются на сервере</Tag>
        </div>
      </section>
      </div>
    </>
  )
}
