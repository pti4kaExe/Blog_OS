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
      setError({ message: 'telegram_id должен быть положительным числом', code: 'validation_error' })
      return
    }
    if (!name.trim()) {
      setError({ message: 'Укажите имя автора', code: 'validation_error' })
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
            <h2>Вход в облачный режим</h2>
            <p>Аккаунт создаётся при первом входе — отдельной регистрации нет.</p>
          </div>
        </div>

        {telegramAuto === 'failed' && (
          <div style={{ marginBottom: 14 }}>
            <Notice kind="warn">
              Автоматический вход через Telegram не удался — {apiErrorMessage(error)}.
              Открытая сессия продолжает работать. Можно войти dev-методом.
            </Notice>
          </div>
        )}

        <form onSubmit={submit}>
          <div className="form-grid">
            <Field
              label="Ваш ID в Telegram"
              hint="Это dev-вход для разработки. Внутри Telegram вход происходит сам, без этой формы. Для демо подойдёт 200600."
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
            <Field label="Имя автора" hint="Так вас будет называть интерфейс." htmlFor="login-name">
              <TextInput
                id="login-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Демо-автор"
                autoComplete="off"
              />
            </Field>
          </div>

          <InlineError error={error} />

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Входим…' : 'Войти'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onUseLocal}>
              Работать локально
            </button>
          </div>

          {error && isOffline(error) && (
            <p className="faint" style={{ marginTop: 10 }}>
              Облачный сервер не отвечает. Локальный режим работает без сети — все четыре шага и
              CommentRadar считаются в браузере.
            </p>
          )}
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Что даёт облако</h2>
            <p>Локальный режим остаётся доступен в любой момент — переключатель в шапке.</p>
          </div>
        </div>
        <ul className="consent-list" style={{ marginTop: 0 }}>
          <li>Профиль стиля и черновики сохраняются на сервере, а не только в браузере.</li>
          <li>История проверок AntiCringe, сравнение с профилем стиля и публикация в архив.</li>
          <li>CommentRadar сканирует реальные площадки: Telegram, Instagram, YouTube.</li>
          <li>База знаний с RAG-поиском и журнал расходов на AI.</li>
        </ul>
        <div className="tags" style={{ marginTop: 14 }}>
          <Tag>JWT в localStorage</Tag>
          <Tag>русский интерфейс</Tag>
          <Tag>без ключей в клиенте</Tag>
        </div>
        <div className="notice" style={{ marginTop: 14 }}>
          Внутри Telegram вход произойдёт автоматически. Вне Telegram сервер должен быть запущен
          с <code>DEV_AUTH=1</code>.
        </div>
      </section>
      </div>
    </>
  )
}
