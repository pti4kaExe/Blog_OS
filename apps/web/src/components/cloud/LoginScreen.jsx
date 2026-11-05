import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api/client.js'
import { apiErrorMessage, isOffline } from '../../lib/format.js'
import { Field, InlineError, Loading, Notice, Tag, TextInput } from '../ui.jsx'
import VoiceMark from '../ui/VoiceMark.jsx'
import { Reveal, Stagger } from '../ui/Motion.jsx'

/**
 * Экран входа в облачный режим. Три способа, по убыванию удобства:
 *
 *  1. Приложение открыто как Telegram Mini App — `initData` проверяется подписью.
 *  2. Обычный браузер: «Войти через Telegram» → сайт получает одноразовый код →
 *     человек нажимает Start в боте → сайт опрашивает статус и получает JWT.
 *     Это работает на публичном сайте без Telegram внутри страницы.
 *  3. Dev-вход (`telegram_id` + имя) — только если сервер отдал `dev_auth: true`.
 *     Нужен для локальной проверки; на проде выключен.
 *
 * Доступные способы приходят из `GET /health`: `telegram_auth`, `dev_auth`.
 */
export default function LoginScreen({ onLogin, onUseLocal }) {
  const [telegramId, setTelegramId] = useState('200600')
  const [name, setName] = useState('Демо-автор')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [telegramAuto, setTelegramAuto] = useState('idle') // idle | trying | failed
  const autoStarted = useRef(false)

  // Возможности сервера: пока не ответил — показываем dev-форму (локальная разработка).
  const [capabilities, setCapabilities] = useState(null)
  const [botState, setBotState] = useState('idle') // idle | waiting | expired
  const [botLink, setBotLink] = useState(null) // {code, bot_url, expires_at}
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [copied, setCopied] = useState(false)
  const pollTimer = useRef(null)
  const deadlineRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    api.health(8000)
      .then((result) => { if (!cancelled) setCapabilities(result) })
      .catch(() => { if (!cancelled) setCapabilities({ telegram_auth: false, dev_auth: true }) })
    return () => { cancelled = true }
  }, [])

  // Автоматический вход внутри Telegram.
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

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current)
      pollTimer.current = null
    }
  }, [])

  useEffect(() => stopPolling, [stopPolling])

  const startBotLogin = async () => {
    setError(null)
    setBusy(true)
    try {
      const link = await api.auth.startTelegramLogin()
      setBotLink(link)
      setBotState('waiting')
      deadlineRef.current = new Date(link.expires_at).getTime()
      setSecondsLeft(Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000)))
      window.open(link.bot_url, '_blank', 'noopener,noreferrer')
      beginPolling(link.code)
    } catch (startError) {
      setError(startError)
      setBusy(false)
    }
  }

  const beginPolling = (code) => {
    stopPolling()
    pollTimer.current = setInterval(async () => {
      const left = Math.round((deadlineRef.current - Date.now()) / 1000)
      setSecondsLeft(Math.max(0, left))
      if (left <= 0) {
        stopPolling()
        setBotState('expired')
        setBusy(false)
        return
      }
      try {
        const result = await api.auth.telegramLoginStatus(code)
        if (result.status === 'confirmed' && result.token) {
          stopPolling()
          await onLogin({ token: result.token, user: result.user, expires_at: result.expires_at })
        } else if (result.status === 'expired') {
          stopPolling()
          setBotState('expired')
          setBusy(false)
        }
      } catch (pollError) {
        // Сетевой сбой не прерывает ожидание: человек мог ещё не нажать Start.
        if (!isOffline(pollError)) {
          stopPolling()
          setError(pollError)
          setBusy(false)
        }
      }
    }, 2000)
  }

  const cancelBotLogin = () => {
    stopPolling()
    setBotState('idle')
    setBotLink(null)
    setBusy(false)
    setSecondsLeft(0)
  }

  const copyLink = async () => {
    if (!botLink) return
    try {
      await navigator.clipboard.writeText(botLink.bot_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError({ code: 'clipboard_unavailable', message: 'Не удалось скопировать — выделите ссылку вручную' })
    }
  }

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

  const botAvailable = capabilities?.telegram_auth === true
  const devAvailable = capabilities?.dev_auth !== false
  const botUsername = capabilities?.telegram_bot_username ?? ''

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
              Открытая сессия продолжает работать.
            </Notice>
          </div>
        )}

        {botAvailable && botState !== 'waiting' && (
          <div style={{ marginBottom: 18 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={startBotLogin}
              disabled={busy}
              style={{ width: '100%' }}
            >
              {busy ? 'Готовим ссылку…' : 'Войти через Telegram'}
            </button>
            <p className="faint" style={{ marginTop: 8 }}>
              Откроется чат с ботом{botUsername ? ` @${botUsername}` : ''} — нажмите в нём «Start»,
              и вход завершится на сайте автоматически.
            </p>
            {botState === 'expired' && (
              <p className="faint" style={{ marginTop: 4 }}>
                Ссылка устарела — нажмите кнопку ещё раз.
              </p>
            )}
          </div>
        )}

        {botState === 'waiting' && botLink && (
          <div style={{ marginBottom: 18 }}>
            <Notice kind="warn">
              Ждём подтверждения в Telegram: осталось {secondsLeft} с. Откройте бота и нажмите
              «Start».
            </Notice>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <a className="btn btn-primary" href={botLink.bot_url} target="_blank" rel="noreferrer">
                Открыть бота
              </a>
              <button type="button" className="btn btn-ghost" onClick={copyLink}>
                {copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={cancelBotLogin}>
                Отменить
              </button>
            </div>
          </div>
        )}

        {devAvailable && (
          <>
            <p className="faint" style={{ margin: '18px 0 10px' }}>или dev-вход</p>
            <form onSubmit={submit}>
              <div className="form-grid">
                <Field
                  label="Ваш ID в Telegram"
                  hint="Демо-вход для разработки. На проде он выключен — используйте вход через бота."
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
                <button type="submit" className="btn btn-primary" disabled={busy || botState === 'waiting'}>
                  {busy ? 'Входим…' : 'Войти без бота'}
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
          </>
        )}

        {!devAvailable && (
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-ghost" onClick={onUseLocal}>
              Работать локально
            </button>
          </div>
        )}
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
          Внутри Telegram вход произойдёт автоматически: страницу можно открыть как Mini App.
        </div>
      </section>
      </div>
    </>
  )
}
