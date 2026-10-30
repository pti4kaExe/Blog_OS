import { useCallback, useEffect, useMemo, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import { useRegisterCommands } from '../../lib/commands.jsx'
import {
  apiErrorMessage, isOffline, labelOf, PLATFORMS, plural,
} from '../../lib/format.js'
import {
  ConfirmDialog, EmptyState, ErrorState, InlineError, Loading, Notice, Select, Tag,
} from '../ui.jsx'
import AppShell from '../ui/AppShell.jsx'
import CloudSidebar, { CLOUD_SECTIONS } from './CloudSidebar.jsx'
import LoginScreen from './LoginScreen.jsx'
import ChannelFormModal from './ChannelFormModal.jsx'
import CloudPipeline from './CloudPipeline.jsx'
import CloudRadarView from './CloudRadarView.jsx'
import KnowledgeView from './KnowledgeView.jsx'
import Onboarding from './Onboarding.jsx'
import PostsView from './PostsView.jsx'
import SettingsView from './SettingsView.jsx'

const CHANNEL_KEY = 'blogos.channel.v1'



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

  /* Команды палитры ⌘K: прямой путь к любому экрану и действию.
     Регистрируются всегда — хук нельзя вызывать условно, а список
     сам пустеет, пока сессия не готова. */
  useRegisterCommands('cloud', () => {
    if (sessionState !== 'ready') return []
    const commands = CLOUD_SECTIONS.map((tab) => ({
      id: `cloud:view:${tab.key}`,
      group: 'Экраны',
      title: tab.label,
      disabled: !activeChannel || view === tab.key,
      run: () => setView(tab.key),
    }))
    commands.push({
      id: 'cloud:view:settings',
      group: 'Экраны',
      title: 'Настройки',
      disabled: view === 'settings',
      run: () => setView('settings'),
    })

    for (const channel of channels) {
      if (String(channel.id) === String(activeId)) continue
      commands.push({
        id: `cloud:channel:${channel.id}`,
        group: 'Каналы',
        title: `Перейти в «${channel.name}»`,
        hint: labelOf(PLATFORMS, channel.platform),
        run: () => setActiveId(String(channel.id)),
      })
    }

    commands.push(
      {
        id: 'cloud:channel-new',
        group: 'Действия',
        title: 'Новый канал',
        run: () => openChannelForm(null),
      },
      {
        id: 'cloud:channel-settings',
        group: 'Действия',
        title: 'Настройки канала',
        disabled: !activeChannel,
        run: () => openChannelForm(activeChannel),
      },
      {
        id: 'cloud:account',
        group: 'Действия',
        title: 'Аккаунт',
        run: () => setAccountOpen(true),
      },
      {
        id: 'cloud:logout',
        group: 'Действия',
        title: 'Выйти из аккаунта',
        run: logout,
      },
    )
    return commands
  })

  /* ------------------------------- экраны сессии --------------------------- */

  if (sessionState === 'boot') {
    return (
      <div className="auth-stage">
        <section className="card"><Loading label="Подключаемся к облаку…" /></section>
      </div>
    )
  }

  if (sessionState === 'offline') {
    return (
      <div className="auth-stage">
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
      </div>
    )
  }

  if (sessionState === 'login') {
    return (
      <div className="auth-stage">
        <LoginScreen onLogin={handleLogin} onUseLocal={onUseLocal} />
      </div>
    )
  }

  /* ------------------------------- сессия готова --------------------------- */

  const sectionTitle = view === 'settings'
    ? 'Настройки'
    : (CLOUD_SECTIONS.find((item) => item.key === view) || {}).label

  return (
    <AppShell
      title={activeChannel && view !== 'settings' ? `${activeChannel.name} · ${sectionTitle}` : sectionTitle}
      actions={activeChannel && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => openChannelForm(activeChannel)}>
          Настройки канала
        </button>
      )}
      sidebar={(
        <CloudSidebar
          user={user}
          channels={channels}
          activeId={activeId}
          onChannel={setActiveId}
          view={view}
          onView={setView}
          disabled={!activeChannel}
          onNewChannel={() => openChannelForm(null)}
          onPalette={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
          onLogout={logout}
          onUseLocal={onUseLocal}
        />
      )}
    >
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

      {/* Чеклист живёт на конвейере — это стартовый экран канала. Он
          размонтируется при уходе на другую вкладку и пересчитывается при
          возврате, поэтому выполненный шаг сразу виден выполненным. */}
      {activeChannel && view === 'pipeline' && (
        <Onboarding key={`onboarding-${activeChannel.id}`} channel={activeChannel} onGo={setView} />
      )}

      {activeChannel && view === 'pipeline' && (
        <CloudPipeline key={activeChannel.id} channel={activeChannel} onUseLocal={onUseLocal} />
      )}
      {activeChannel && view === 'archive' && (
        <PostsView key={activeChannel.id} channel={activeChannel} onUseLocal={onUseLocal} />
      )}
      {activeChannel && view === 'radar' && (
        <CloudRadarView key={activeChannel.id} channel={activeChannel} onUseLocal={onUseLocal} />
      )}
      {activeChannel && view === 'knowledge' && (
        <KnowledgeView key={activeChannel.id} channel={activeChannel} onUseLocal={onUseLocal} />
      )}
      {/* Настройки не требуют активного канала: это уровень аккаунта,
          а не конвейера поста. */}
      {view === 'settings' && (
        <SettingsView
          user={user}
          channels={channels}
          activeId={activeId}
          onChannel={setActiveId}
          onUpdated={(updated) => setUser((prev) => ({ ...prev, ...updated }))}
          onDeleted={() => logout()}
          onEditChannel={(channel) => openChannelForm(channel || activeChannel)}
          onNewChannel={() => openChannelForm(null)}
        />
      )}

      <footer className="stage-foot">
        <span className="faint">
          Тексты отправляются на сервер BlogOS ({api.baseUrl}). Внешнему AI-провайдеру —
          только с вашего согласия.
        </span>
      </footer>

      <ChannelFormModal
        open={channelModal.open}
        channel={channelModal.channel}
        busy={channelBusy}
        error={channelError}
        onSubmit={submitChannel}
        onDelete={() => {
          setChannelModal({ open: false, channel: null })
          setDeleteError(null)
          setDeleteOpen(true)
        }}
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
    </AppShell>
  )
}
