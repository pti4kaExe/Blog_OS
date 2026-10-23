import { useCallback, useEffect, useMemo, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import {
  apiErrorMessage, isOffline, labelOf, PLATFORMS, plural,
} from '../../lib/format.js'
import {
  ConfirmDialog, EmptyState, ErrorState, InlineError, Loading, Notice, Select, Tag,
} from '../ui.jsx'
import LoginScreen from './LoginScreen.jsx'
import ChannelFormModal from './ChannelFormModal.jsx'
import CloudPipeline from './CloudPipeline.jsx'
import CloudRadarView from './CloudRadarView.jsx'
import KnowledgeView from './KnowledgeView.jsx'
import UsageView from './UsageView.jsx'

const CHANNEL_KEY = 'blogos.channel.v1'

const CLOUD_TABS = [
  { key: 'pipeline', label: 'Конвейер поста' },
  { key: 'radar', label: 'CommentRadar' },
  { key: 'knowledge', label: 'База знаний' },
  { key: 'usage', label: 'Расходы' },
]

function savedChannelId() {
  try {
    const raw = localStorage.getItem(CHANNEL_KEY)
    return raw || null
  } catch {
    return null
  }
}

/**
 * Облачный режим: сессия, каналы и экраны поверх BlogOS API.
 *
 * Всё, что требует сети, сосредоточено здесь и в дочерних экранах.
 * При недоступном сервере приложение не падает: показывает причину
 * и предлагает локальный режим, который работает без сети.
 */
export default function CloudApp({ onUseLocal }) {
  const [sessionState, setSessionState] = useState('boot') // boot | offline | login | ready
  const [bootError, setBootError] = useState(null)
  const [user, setUser] = useState(null)
  const [channels, setChannels] = useState([])
  const [channelsState, setChannelsState] = useState('idle') // idle | loading | ready | error
  const [channelsError, setChannelsError] = useState(null)
  const [activeId, setActiveId] = useState(savedChannelId)
  const [view, setView] = useState('pipeline')

  const [channelModal, setChannelModal] = useState({ open: false, channel: null })
  const [channelBusy, setChannelBusy] = useState(false)
  const [channelError, setChannelError] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const activeChannel = useMemo(
    () => channels.find((channel) => String(channel.id) === String(activeId)) || null,
    [channels, activeId],
  )

  useEffect(() => {
    try {
      if (activeId) localStorage.setItem(CHANNEL_KEY, String(activeId))
      else localStorage.removeItem(CHANNEL_KEY)
    } catch {
      // без сохранения выбранного канала приложение продолжает работать
    }
  }, [activeId])

  const chooseActive = useCallback((items) => {
    setActiveId((prev) => {
      if (prev && items.some((channel) => String(channel.id) === String(prev))) return prev
      return items.length ? String(items[0].id) : null
    })
  }, [])

  const loadChannels = useCallback(async () => {
    setChannelsState('loading')
    setChannelsError(null)
    try {
      const payload = await api.profiles.list({ limit: 50 })
      const items = itemsOf(payload)
      setChannels(items)
      chooseActive(items)
      setChannelsState('ready')
    } catch (error) {
      if (error.status === 401) {
        api.token.clear()
        setUser(null)
        setSessionState('login')
        return
      }
      setChannelsError(error)
      setChannelsState('error')
    }
  }, [chooseActive])

  const restoreSession = useCallback(async () => {
    setSessionState('boot')
    setBootError(null)
    try {
      const [me, list] = await Promise.all([api.users.me(), api.profiles.list({ limit: 50 })])
      const items = itemsOf(list)
      setUser(me)
      setChannels(items)
      chooseActive(items)
      setChannelsState('ready')
      setSessionState('ready')
    } catch (error) {
      if (error.status === 401) {
        api.token.clear()
        setUser(null)
        setSessionState('login')
        return
      }
      setBootError(error)
      setSessionState('offline')
    }
  }, [chooseActive])

  const probeServer = useCallback(async () => {
    setSessionState('boot')
    setBootError(null)
    const result = await api.probe()
    if (result.reachable) {
      setSessionState('login')
    } else {
      setBootError(result.error)
      setSessionState('offline')
    }
  }, [])

  useEffect(() => {
    let alive = true
    const start = async () => {
      if (!api.token.get()) {
        const result = await api.probe()
        if (!alive) return
        if (result.reachable) setSessionState('login')
        else {
          setBootError(result.error)
          setSessionState('offline')
        }
        return
      }
      if (!alive) return
      restoreSession()
    }
    start()
    return () => { alive = false }
  }, [restoreSession])

  const handleLogin = async (result) => {
    api.token.set(result.token)
    setUser(result.user)
    setSessionState('ready')
    setView('pipeline')
    await loadChannels()
    // После входа уточняем профиль (GET /users/me): счётчик каналов и роль
    try {
      const me = await api.users.me()
      setUser(me)
    } catch (error) {
      if (error.status === 401) {
        api.token.clear()
        setUser(null)
        setSessionState('login')
      }
      // сетевой сбой не отменяет вход: работаем с тем, что уже известно
    }
  }

  const logout = () => {
    api.token.clear()
    setUser(null)
    setChannels([])
    setActiveId(null)
    setChannelsState('idle')
    setView('pipeline')
    setSessionState('login')
  }

  const retryBoot = () => {
    if (api.token.get()) restoreSession()
    else probeServer()
  }

  const submitChannel = async (body) => {
    setChannelBusy(true)
    setChannelError(null)
    try {
      if (channelModal.channel) {
        const updated = await api.profiles.update(channelModal.channel.id, body)
        setChannels((prev) => prev.map((channel) => (
          String(channel.id) === String(updated.id) ? updated : channel
        )))
      } else {
        const created = await api.profiles.create(body)
        setChannels((prev) => [created, ...prev])
        setActiveId(String(created.id))
        setView('pipeline')
      }
      setChannelModal({ open: false, channel: null })
    } catch (error) {
      setChannelError(error)
    } finally {
      setChannelBusy(false)
    }
  }

  const openChannelForm = (channel) => {
    setChannelError(null)
    setChannelModal({ open: true, channel: channel || null })
  }

  const confirmDelete = async () => {
    if (!activeChannel) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.profiles.remove(activeChannel.id)
      const rest = channels.filter((channel) => String(channel.id) !== String(activeChannel.id))
      setChannels(rest)
      setActiveId(rest.length ? String(rest[0].id) : null)
      setDeleteOpen(false)
    } catch (error) {
      setDeleteError(error)
    } finally {
      setDeleteBusy(false)
    }
  }

  /* ------------------------------- экраны сессии --------------------------- */

  if (sessionState === 'boot') {
    return (
      <section className="card">
        <Loading label="Подключаемся к облаку…" />
      </section>
    )
  }

  if (sessionState === 'offline') {
    return (
      <section className="card">
        <ErrorState error={bootError} title="Облачный сервер недоступен" onRetry={retryBoot}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>
            Работать локально
          </button>
        </ErrorState>
        <Notice kind="warn">
          Локальный режим работает без сети: разбор стиля, сборка поста, AntiCringe и CommentRadar
          считаются прямо в браузере. Облачные данные появятся, когда сервер будет доступен.
        </Notice>
        <p className="faint" style={{ marginBottom: 0 }}>
          Проверьте, что API запущен на {api.baseUrl}. Адрес задаётся переменной
          <code> VITE_API_URL</code> при сборке клиента.
        </p>
      </section>
    )
  }

  if (sessionState === 'login') {
    return <LoginScreen onLogin={handleLogin} onUseLocal={onUseLocal} />
  }

  /* ------------------------------- сессия готова --------------------------- */

  const roleLabel = user?.role === 'admin' ? 'администратор' : 'автор'
  const channelsCount = channels.length

  return (
    <>
      <div className="subbar">
        <div className="user-chip">
          <span className="user-avatar" aria-hidden="true">{(user?.name || '?').slice(0, 1).toUpperCase()}</span>
          <span>
            <span className="user-chip-name">{user?.name || 'Автор'}</span>
            <span className="faint"> · {roleLabel} · {channelsCount} {plural(channelsCount, 'канал', 'канала', 'каналов')}</span>
          </span>
        </div>
        <div className="spacer" />

        {channels.length > 0 && (
          <Select
            className="channel-select inp-sm"
            aria-label="Активный канал"
            value={activeId ?? ''}
            onChange={(event) => setActiveId(event.target.value)}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={String(channel.id)}>
                {channel.name} · {labelOf(PLATFORMS, channel.platform)}
              </option>
            ))}
          </Select>
        )}

        <button type="button" className="btn btn-sm" onClick={() => openChannelForm(null)}>
          + Канал
        </button>
        {activeChannel && (
          <>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => openChannelForm(activeChannel)}>
              Изменить
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => { setDeleteError(null); setDeleteOpen(true) }}
            >
              Удалить
            </button>
          </>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Выйти</button>
      </div>

      {channelsError && (
        <div style={{ marginBottom: 14 }}>
          <Notice kind="error">
            {apiErrorMessage(channelsError)}{' '}
            <button type="button" className="btn btn-sm btn-ghost" onClick={loadChannels}>Повторить</button>
            {isOffline(channelsError) && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>Локальный режим</button>
            )}
          </Notice>
        </div>
      )}

      <div className="view-tabs">
        <div className="tabs" role="tablist">
          {CLOUD_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className="tab"
              role="tab"
              aria-selected={view === tab.key}
              onClick={() => setView(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <Tag kind="accent">Облако</Tag>
      </div>

      {channelsState === 'loading' && channels.length === 0 && (
        <section className="card"><Loading label="Загружаем каналы…" /></section>
      )}

      {channelsState === 'error' && channels.length === 0 && (
        <section className="card">
          <ErrorState error={channelsError} onRetry={loadChannels}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>Работать локально</button>
          </ErrorState>
        </section>
      )}

      {channelsState !== 'loading' && channels.length === 0 && !channelsError && (
        <section className="card">
          <EmptyState
            title="Создайте первый канал"
            action={(
              <button type="button" className="btn btn-primary" onClick={() => openChannelForm(null)}>
                Создать канал
              </button>
            )}
          >
            Канал — это площадка с собственным стилем и лимитом AI: Telegram, Instagram или YouTube.
            Всё остальное в облаке привязано к каналу.
          </EmptyState>
        </section>
      )}

      {!activeChannel && channels.length > 0 && (
        <section className="card">
          <EmptyState title="Выберите канал">Активный канал задаёт стиль, черновики и расходы.</EmptyState>
        </section>
      )}

      {activeChannel && view === 'pipeline' && (
        <CloudPipeline key={activeChannel.id} channel={activeChannel} onUseLocal={onUseLocal} />
      )}
      {activeChannel && view === 'radar' && (
        <CloudRadarView key={activeChannel.id} channel={activeChannel} onUseLocal={onUseLocal} />
      )}
      {activeChannel && view === 'knowledge' && (
        <KnowledgeView key={activeChannel.id} channel={activeChannel} onUseLocal={onUseLocal} />
      )}
      {activeChannel && view === 'usage' && (
        <UsageView key={activeChannel.id} channel={activeChannel} onUseLocal={onUseLocal} />
      )}

      <footer style={{ marginTop: 34, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Tag>Облачный режим</Tag>
        <Tag>API: {api.baseUrl}</Tag>
        <span className="faint">
          Тексты отправляются на сервер BlogOS. Внешнему AI-провайдеру — только с вашего согласия.
        </span>
      </footer>

      <ChannelFormModal
        open={channelModal.open}
        channel={channelModal.channel}
        busy={channelBusy}
        error={channelError}
        onSubmit={submitChannel}
        onClose={() => { setChannelModal({ open: false, channel: null }); setChannelError(null) }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить канал?"
        confirmLabel="Удалить канал"
        busy={deleteBusy}
        danger
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteOpen(false); setDeleteError(null) }}
      >
        <p style={{ marginTop: 0 }}>
          Канал «{activeChannel?.name}» удалится вместе со стилем, постами, черновиками, источниками,
          комментариями и базой знаний. Журнал расходов на AI сохранится.
        </p>
        {deleteError && <InlineError error={deleteError} />}
      </ConfirmDialog>
    </>
  )
}
