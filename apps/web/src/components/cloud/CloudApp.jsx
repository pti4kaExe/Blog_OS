import {
  Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState,
} from 'react'
import { Plus, ShieldCheck } from 'lucide-react'
import api, { itemsOf } from '../../api/client.js'
import { useRegisterCommands } from '../../lib/commands.jsx'
import {
  apiErrorMessage, isOffline, labelOf, PLATFORMS, plural,
} from '../../lib/format.js'
import {
  ConfirmDialog, EmptyState, ErrorState, InlineError, Loading, Notice, Select, Tag,
} from '../ui.jsx'
import AppShell from '../ui/AppShell.jsx'
import { Icon } from '../ui/Icon.jsx'
import CloudSidebar, { CLOUD_SECTIONS } from './CloudSidebar.jsx'
import LoginScreen from './LoginScreen.jsx'
import Onboarding from './Onboarding.jsx'
import PetCompanion from './PetCompanion.jsx'

const ChannelFormModal = lazy(() => import('./ChannelFormModal.jsx'))
const CloudPipeline = lazy(() => import('./CloudPipeline.jsx'))
const CloudRadarView = lazy(() => import('./CloudRadarView.jsx'))
const KnowledgeView = lazy(() => import('./KnowledgeView.jsx'))
const PostsView = lazy(() => import('./PostsView.jsx'))
const SettingsView = lazy(() => import('./SettingsView.jsx'))

const CHANNEL_KEY = 'blogos.channel.v1'

/**
 * Ожидание пробуждения бесплатного хостинга.
 *
 * Render free засыпает после ~15 минут простоя, а первый запрос после паузы
 * занимает 30–60 секунд. Проверять доступность одним коротким запросом нельзя:
 * новый посетитель видел «сервер недоступен», хотя сервер просто просыпался.
 * Поэтому проверяем повторно, пока не истечёт этот срок, и показываем прогресс.
 */
const WAKE_BUDGET_MS = 80000
const WAKE_STEP_MS = 3000
const WAKE_PROBE_MS = 12000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
  const [sessionState, setSessionState] = useState('boot') // boot | waking | offline | login | ready
  const [bootError, setBootError] = useState(null)
  const [wakingSeconds, setWakingSeconds] = useState(0)
  const [user, setUser] = useState(null)
  const [channels, setChannels] = useState([])
  const [channelsState, setChannelsState] = useState('idle') // idle | loading | ready | error
  const [channelsError, setChannelsError] = useState(null)
  const [activeId, setActiveId] = useState(savedChannelId)
  const [view, setView] = useState('pipeline')
  /* Шаг конвейера, который попросил открыть чеклист «С чего начать».
     Сам номер живёт в CloudPipeline — сюда поднята только просьба. */
  const [requestedStep, setRequestedStep] = useState(null)

  const [channelModal, setChannelModal] = useState({ open: false, channel: null })
  const [channelBusy, setChannelBusy] = useState(false)
  const [channelError, setChannelError] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // Канал, который собираемся удалить: в модалке может быть открыт НЕ активный канал.
  const [deleteTarget, setDeleteTarget] = useState(null)
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

  /**
   * Ждёт, пока сервер проснётся, повторяя проверку в пределах бюджета.
   * Возвращает true, если сервер ответил.
   */
  const waitForServer = useCallback(async (alive) => {
    const startedAt = Date.now()
    let lastError = null
    while (Date.now() - startedAt < WAKE_BUDGET_MS) {
      setWakingSeconds(Math.round((Date.now() - startedAt) / 1000))
      const result = await api.probe(WAKE_PROBE_MS)
      if (!alive()) return { reachable: false, error: lastError }
      if (result.reachable) return { reachable: true, error: null }
      lastError = result.error
      await sleep(WAKE_STEP_MS)
    }
    return { reachable: false, error: lastError }
  }, [])

  /**
   * Старт приложения: проверка сервера с ожиданием пробуждения, затем сессия.
   *
   * Так новый посетитель не видит ложное «сервер недоступен»: бесплатный
   * хостинг просыпается до минуты, и всё это время показывается прогресс.
   */
  const boot = useCallback(async (aliveRef) => {
    setSessionState('waking')
    setBootError(null)
    setWakingSeconds(0)
    const probe = await waitForServer(() => aliveRef.current)
    if (!aliveRef.current) return
    if (!probe.reachable) {
      setBootError(probe.error)
      setSessionState('offline')
      return
    }
    if (api.token.get()) {
      await restoreSession()
      return
    }
    setSessionState('login')
  }, [restoreSession, waitForServer])

  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  useEffect(() => {
    boot(aliveRef)
  }, [boot])

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
    boot(aliveRef)
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
    // Удаляем именно цель подтверждения, а не случайно активный канал.
    const target = deleteTarget
    if (!target) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.profiles.remove(target.id)
      const rest = channels.filter((channel) => String(channel.id) !== String(target.id))
      setChannels(rest)
      setActiveId(rest.length ? String(rest[0].id) : null)
      setDeleteOpen(false)
      setDeleteTarget(null)
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
    /* «Аккаунт» — второе имя того же экрана. Слово из головы автора
       («где поменять имя?») не совпадает с названием раздела, а палитра
       ищет по названию: без этой строки поиск по «аккаунт» не находит
       ничего. */
    commands.push({
      id: 'cloud:account',
      group: 'Экраны',
      title: 'Аккаунт',
      hint: 'профиль, расходы, удаление',
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

  if (sessionState === 'waking') {
    return (
      <div className="auth-stage">
        <section className="card">
          <Loading
            label={
              wakingSeconds < 3
                ? 'Подключаемся к облаку…'
                : `Сервер просыпается после простоя — ${wakingSeconds} с. Обычно это занимает до минуты.`
            }
          />
          <p className="faint" style={{ marginTop: 12 }}>
            Бесплатный тариф засыпает без обращений и включается при первом запросе. Страница
            дождётся ответа сама — закрывать её не нужно.
          </p>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>
              Работать локально
            </button>
          </div>
        </section>
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
        <p className="faint mb-0">
          Сервер проверен по адресу {api.baseUrl}. Бесплатный тариф засыпает без обращений и
          просыпается до минуты: нажмите «Повторить» — страница снова подождёт ответа.
          Адрес API задаётся переменной <code>VITE_API_URL</code> при сборке клиента.
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
        <div className="mb-4">
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
        <section className="card first-channel-card">
          <div className="first-channel-pet" aria-hidden="true">
            <img src={`${import.meta.env.BASE_URL}blogos-pet-cat.png`} alt="" loading="eager" decoding="async" />
            {/* Ноутбук — CSS-композиция вокруг существующего образа питомца:
                отдельной иллюстрации в проекте нет, стоковые картинки не берём. */}
            <span className="first-channel-laptop" />
          </div>
          <div className="first-channel-copy">
            <span className="first-channel-kicker">первый шаг</span>
            <h1>Создайте первый канал и получите черновик</h1>
            <p>
              Канал — это площадка с собственным стилем и лимитом AI: Telegram, Instagram или YouTube.
              После создания BlogOS откроет короткий чеклист: подключить пример голоса, разобрать стиль
              и собрать первый пост из заметок.
            </p>
            <button type="button" className="btn btn-primary first-channel-cta" onClick={() => openChannelForm(null)}>
              <Icon as={Plus} size="sm" />
              <span>Создать канал</span>
            </button>
          </div>
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
        <Onboarding
          key={`onboarding-${activeChannel.id}`}
          channel={activeChannel}
          onGo={(nextView, step) => {
            setView(nextView)
            if (step) setRequestedStep(step)
          }}
        />
      )}

      <Suspense fallback={<section className="card"><Loading label="Загружаем экран…" /></section>}>
        {activeChannel && view === 'pipeline' && (
          <CloudPipeline
            key={activeChannel.id}
            channel={activeChannel}
            onUseLocal={onUseLocal}
            requestedStep={requestedStep}
            onStepTaken={() => setRequestedStep(null)}
          />
        )}
        {activeChannel && view === 'archive' && (
          <PostsView
            key={activeChannel.id}
            channel={activeChannel}
            onUseLocal={onUseLocal}
            onAnalyzeArchive={() => { setView('pipeline'); setRequestedStep(1) }}
          />
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
      </Suspense>

      <footer className="stage-foot">
        <Icon as={ShieldCheck} size="sm" />
        <span className="faint">
          Тексты отправляются на сервер BlogOS ({api.baseUrl}). Внешнему AI-провайдеру —
          только с вашего согласия.
        </span>
      </footer>

      {/* Питомец-помощник: плавающий блок внизу справа. Состояние берёт из
          контекста (канал, стиль, черновик) и сигналов конвейера. */}
      <PetCompanion
        hasChannels={channels.length > 0}
        channel={activeChannel}
        view={view}
        onCreateChannel={() => openChannelForm(null)}
        onView={setView}
        onStep={(step) => { setView('pipeline'); setRequestedStep(step) }}
      />

      {channelModal.open && (
        <Suspense fallback={null}>
          <ChannelFormModal
            open={channelModal.open}
            channel={channelModal.channel}
            busy={channelBusy}
            error={channelError}
            onSubmit={submitChannel}
            onDelete={() => {
              // Запоминаем канал из модалки: подтверждение должно удалять его, а не активный.
              setDeleteTarget(channelModal.channel)
              setChannelModal({ open: false, channel: null })
              setDeleteError(null)
              setDeleteOpen(true)
            }}
            onClose={() => { setChannelModal({ open: false, channel: null }); setChannelError(null) }}
          />
        </Suspense>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить канал?"
        confirmLabel="Удалить канал"
        busy={deleteBusy}
        danger
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteOpen(false); setDeleteError(null); setDeleteTarget(null) }}
      >
        <p className="mt-0">
          Канал «{deleteTarget?.name}» удалится вместе со стилем, постами, черновиками, источниками,
          комментариями и базой знаний. Журнал расходов на AI сохранится.
        </p>
        {deleteError && <InlineError error={deleteError} />}
      </ConfirmDialog>
    </AppShell>
  )
}
