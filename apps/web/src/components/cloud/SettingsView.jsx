import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { getAiConsent, setAiConsent } from '../../lib/aiConsent.jsx'
import { fmtDateTime, fmtMoney, fmtPercent, labelOf, PLATFORMS, plural } from '../../lib/format.js'
import { hidePetFor, petHiddenUntil, showPet } from '../../lib/petSignals.js'
import {
  petCookies, petSoundEnabled, petWanderEnabled, setPetSound, setPetWander, subscribePetPrefs,
} from '../../lib/petPrefs.js'
import {
  Bar, Field, FormSection, InlineError, Notice, Tag, TextInput, Toggle,
} from '../ui.jsx'
import { Reveal, Stagger } from '../ui/Motion.jsx'
import ThemeSwitch from '../ui/ThemeSwitch.jsx'
import AntiCringeRules from './AntiCringeRules.jsx'

const CONFIRM_WORD = 'УДАЛИТЬ'

/**
 * Настройки аккаунта — один экран вместо модалки на кнопке в углу.
 *
 * Пять смысловых блоков: кто я, как выглядит интерфейс, как работает AI,
 * сколько я трачу, какие у меня каналы. Каждый — реальная настройка
 * с реальным эффектом; ничего декоративного здесь нет (раздел 02 прямо
 * запрещает имитацию несуществующей функции).
 *
 * Удаление отделено и вынесено вниз — так его нельзя задеть случайно.
 */
export default function SettingsView({
  user, channels, activeId, onChannel, onUpdated, onDeleted, onEditChannel, onNewChannel,
}) {
  const [name, setName] = useState(user?.name || '')
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(false)

  const [consent, setConsent] = useState(getAiConsent)

  /* «Не сейчас» у питомца: настройка живёт в localStorage, поэтому читаем
     её при открытии экрана и позволяем вернуть помощника обратно. */
  const [petHidden, setPetHidden] = useState(() => petHiddenUntil() > Date.now())

  const restorePet = () => {
    showPet()
    setPetHidden(false)
    // Питомец в CloudApp слушает это событие и сразу появляется.
    window.dispatchEvent(new Event('blogos:pet-restored'))
  }

  const hidePet = () => {
    hidePetFor()
    setPetHidden(true)
  }

  /* Игрушечные настройки питомца: звук, прогулки и счётчик печенек. */
  const [petSound, setPetSoundState] = useState(petSoundEnabled)
  const [petWander, setPetWanderState] = useState(petWanderEnabled)
  const [cookieCount, setCookieCount] = useState(petCookies)

  useEffect(() => subscribePetPrefs(() => {
    setPetSoundState(petSoundEnabled())
    setPetWanderState(petWanderEnabled())
    setCookieCount(petCookies())
  }), [])

  const [usage, setUsage] = useState(null)
  const [usageState, setUsageState] = useState('idle')

  const [dangerOpen, setDangerOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const activeChannel = channels.find((item) => String(item.id) === String(activeId)) || null

  useEffect(() => { setName(user?.name || '') }, [user])

  /* Расходы — компактная сводка, не журнал вызовов: список фильтров
     и постраничная таблица были отдельным разделом, который обычный
     автор открывал почти никогда. Здесь остаётся то, что нужно знать
     за одну секунду — потратил/лимит — и ссылка дальше, если мало. */
  useEffect(() => {
    const channel = channels.find((item) => String(item.id) === String(activeId))
    if (!channel) { setUsage(null); setUsageState('idle'); return undefined }
    let alive = true
    setUsageState('loading')
    api.profiles.usage(channel.id)
      .then((payload) => { if (alive) { setUsage(payload); setUsageState('ready') } })
      .catch(() => { if (alive) setUsageState('error') })
    return () => { alive = false }
  }, [channels, activeId])

  const dirty = name.trim() !== (user?.name || '').trim()

  const saveName = async (event) => {
    event.preventDefault()
    if (!name.trim()) {
      setSaveError({ code: 'validation_error', message: 'Имя не может быть пустым.' })
      return
    }
    setSaveBusy(true)
    setSaveError(null)
    try {
      const updated = await api.users.updateMe({ name: name.trim() })
      onUpdated(updated)
      setSaved(true)
    } catch (error) {
      setSaveError(error)
    } finally {
      setSaveBusy(false)
    }
  }

  const resetAiConsent = () => {
    try { localStorage.removeItem('blogos.ai.consent.v1') } catch { /* приватный режим */ }
    setConsent(null)
  }

  const removeAccount = async () => {
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await api.users.deleteMe()
      onDeleted()
    } catch (error) {
      setDeleteError(error)
      setDeleteBusy(false)
    }
  }

  const roleLabel = user?.role === 'admin' ? 'администратор' : 'автор'

  const limit = usage?.monthly_cost_limit
  const spent = usage?.spent ?? 0
  const ratio = usage?.limit_ratio != null ? usage.limit_ratio : limit ? spent / limit : 0
  const blocked = usage?.blocked ?? (limit ? ratio >= 1 : false)
  const warning = usage?.warning ?? (limit ? ratio >= 0.8 : false)

  return (
    <div className="stage-narrow">
      <Stagger>
        <Reveal as="div" className="stage-head">
          <h1>Настройки</h1>
          <p className="lead">Аккаунт, оформление, AI и каналы — всё, что относится к вам, а не к одному посту.</p>
        </Reveal>

        <Reveal>
          <section className="card">
            <FormSection title="Профиль" hint="Так вас называет интерфейс.">
              <form onSubmit={saveName}>
                <div className="form-grid">
                  <Field label="Имя автора" htmlFor="settings-name">
                    <TextInput
                      id="settings-name"
                      value={name}
                      onChange={(event) => { setName(event.target.value); setSaved(false) }}
                      maxLength={120}
                      autoComplete="off"
                    />
                  </Field>
                  <div className="field">
                    <span className="field-label">&nbsp;</span>
                    <div className="btn-row">
                      <button type="submit" className="btn btn-sm btn-primary" disabled={saveBusy || !dirty}>
                        {saveBusy ? 'Сохраняем…' : 'Сохранить'}
                      </button>
                      {saved && !dirty && <span className="faint">Сохранено</span>}
                    </div>
                  </div>
                </div>
                <InlineError error={saveError} />
              </form>

              <dl className="deflist mt-5">
                <div><dt>Роль</dt><dd>{roleLabel}</dd></div>
                <div><dt>Вход</dt><dd>Telegram, номер {user?.telegram_id ?? '—'}</dd></div>
                <div><dt>Каналов</dt><dd>{channels.length} {plural(channels.length, 'канал', 'канала', 'каналов')}</dd></div>
                <div><dt>В сервисе с</dt><dd>{fmtDateTime(user?.created_at)}</dd></div>
              </dl>
              <p className="faint mb-0">
                Роль выдаётся вручную при развёртывании — метода назначения в сервисе нет намеренно.
              </p>
            </FormSection>
          </section>
        </Reveal>

        <Reveal>
          <section className="card">
            <FormSection title="Оформление" hint="Применяется сразу и на весь интерфейс, обоих режимов.">
              <ThemeSwitch />
            </FormSection>
          </section>
        </Reveal>

        <Reveal>
          <section className="card">
            <FormSection
              title="Питомец-помощник"
              hint="Подсказывает следующий шаг и предлагает действия. Его можно вернуть, если скрыли."
            >
              <div className="btn-row" style={{ alignItems: 'center', gap: 12 }}>
                {petHidden ? (
                  <>
                    <Tag kind="warn">Скрыт на 24 часа</Tag>
                    <button type="button" className="btn btn-sm btn-primary" onClick={restorePet}>
                      Вернуть питомца
                    </button>
                  </>
                ) : (
                  <>
                    <Tag kind="accent">Помогает</Tag>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={hidePet}>
                      Скрыть на 24 часа
                    </button>
                  </>
                )}
              </div>
              <div className="mt-4" style={{ display: 'grid', gap: 10 }}>
                <Toggle
                  id="pet-sound"
                  checked={petSound}
                  onChange={(value) => { setPetSound(value); setPetSoundState(value) }}
                  label="Звук"
                  hint="Короткий писк при клике и арпеджио после публикации"
                />
                <Toggle
                  id="pet-wander"
                  checked={petWander}
                  onChange={(value) => { setPetWander(value); setPetWanderState(value) }}
                  label="Гулять по экрану"
                  hint="Раз в 20–40 секунд переходит на 30–80 px в случайную сторону"
                />
                <p className="faint" style={{ margin: 0 }}>Печенек съедено: {cookieCount}</p>
              </div>
              <p className="faint" style={{ marginTop: 12, marginBottom: 0 }}>
                Питомец живёт внизу справа на экранах облачного режима. «Не сейчас» скрывает его
                на сутки, после чего он возвращается сам.
              </p>
            </FormSection>
          </section>
        </Reveal>

        <Reveal>
          <section className="card">
            <FormSection
              title="AI и приватность"
              hint="Решение действует на каждый новый запрос к AI-слою — в разборе стиля, сборке черновика, проверке и CommentRadar."
            >
              <div className="btn-row" style={{ alignItems: 'center', gap: 12 }}>
                {consent === 'granted' && <Tag kind="accent">AI разрешён</Tag>}
                {consent === 'declined' && <Tag>Только правила</Tag>}
                {!consent && <Tag kind="warn">Ещё не выбрано</Tag>}
                <button type="button" className="btn btn-sm btn-ghost" onClick={resetAiConsent} disabled={!consent}>
                  Спросить заново
                </button>
              </div>
              <p className="faint mt-3 mb-0">
                Без согласия всё считается правиловым движком — бесплатно, без передачи текста
                провайдеру. Решение хранится в этом браузере и не синхронизируется между устройствами.
              </p>
            </FormSection>
          </section>
        </Reveal>

        <Reveal>
          <section className="card">
            <AntiCringeRules channel={activeChannel} />
          </section>
        </Reveal>

        <Reveal>
          <section className="card">
            <FormSection title="Расходы на AI" hint="Текущий канал за этот месяц.">
              {usageState === 'loading' && <p className="faint">Считаем…</p>}
              {usageState === 'idle' && <p className="faint">Выберите канал, чтобы увидеть расходы.</p>}
              {usageState === 'error' && <p className="faint">Не удалось загрузить — сервер недоступен.</p>}
              {usageState === 'ready' && usage && (
                <div className={blocked ? 'usage-hero usage-blocked' : warning ? 'usage-hero usage-warning' : 'usage-hero'}>
                  <div>
                    <div className="usage-num">{fmtMoney(spent)}</div>
                    <div className="usage-limit">
                      {limit ? `из ${fmtMoney(limit)} в месяц` : 'лимит не задан'}
                      {onEditChannel && (
                        <>
                          {' · '}
                          <button type="button" className="linkish" onClick={() => onEditChannel(activeChannel)}>
                            {limit ? 'изменить' : 'задать лимит'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="usage-bar-wrap">
                    <Bar value={limit ? Math.min(100, Math.round(ratio * 100)) : 0} tone={blocked ? 'bad' : warning ? 'warn' : 'good'} />
                    <div className="usage-flags">
                      {limit ? <Tag kind={blocked ? 'bad' : warning ? 'warn' : 'good'}>{fmtPercent(ratio, 0)} лимита</Tag> : <Tag>без лимита</Tag>}
                    </div>
                  </div>
                </div>
              )}
            </FormSection>
          </section>
        </Reveal>

        <Reveal>
          <section className="card">
            <FormSection title="Каналы" hint="Площадка с собственным стилем, черновиками и лимитом AI.">
              {channels.length === 0 ? (
                <p className="faint">Каналов пока нет.</p>
              ) : (
                <div className="list">
                  {channels.map((channel) => (
                    <div className="list-item" key={channel.id} data-active={String(channel.id) === String(activeId)}>
                      <div className="list-item-head">
                        <span className="list-item-title">{channel.name}</span>
                        <Tag>{labelOf(PLATFORMS, channel.platform)}</Tag>
                        <div className="spacer" />
                        {String(channel.id) !== String(activeId) && (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChannel(String(channel.id))}>
                            Сделать активным
                          </button>
                        )}
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onEditChannel(channel)}>
                          Настроить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="btn-row mt-4">
                <button type="button" className="btn btn-sm" onClick={onNewChannel}>+ Новый канал</button>
              </div>
            </FormSection>
          </section>
        </Reveal>

        <Reveal>
          <section className="card">
            <div className="danger-zone" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
              <h3>Удаление аккаунта</h3>
              <p className="faint mt-0">
                Вместе с аккаунтом удалятся все каналы, профили стиля, посты, черновики,
                отчёты проверок, источники и база знаний. Журнал расходов на AI сохранится
                без привязки к вам. Восстановить нельзя.
              </p>

              {!dangerOpen ? (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setDangerOpen(true)}>
                  Удалить аккаунт
                </button>
              ) : (
                <>
                  <Field label={`Впишите ${CONFIRM_WORD}, чтобы подтвердить`} htmlFor="settings-confirm">
                    <TextInput
                      id="settings-confirm" value={confirmText}
                      onChange={(event) => setConfirmText(event.target.value)}
                      placeholder={CONFIRM_WORD} autoComplete="off"
                    />
                  </Field>
                  <div className="danger-actions mt-3">
                    <button
                      type="button" className="btn btn-sm btn-danger"
                      disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD || deleteBusy}
                      onClick={removeAccount}
                    >
                      {deleteBusy ? 'Удаляем…' : 'Удалить аккаунт навсегда'}
                    </button>
                    <button
                      type="button" className="btn btn-sm btn-ghost"
                      onClick={() => { setDangerOpen(false); setConfirmText(''); setDeleteError(null) }}
                      disabled={deleteBusy}
                    >
                      Передумал
                    </button>
                  </div>
                  {deleteError && <InlineError error={deleteError} />}
                  {!deleteError && (
                    <Notice kind="warn">
                      После удаления вы вернётесь на экран входа. Локальный режим и данные
                      в браузере это не затронет.
                    </Notice>
                  )}
                </>
              )}
            </div>
          </section>
        </Reveal>
      </Stagger>
    </div>
  )
}
