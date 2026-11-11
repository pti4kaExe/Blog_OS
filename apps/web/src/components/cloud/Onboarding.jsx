import { useEffect, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import { plural } from '../../lib/format.js'
import { Icon } from '../ui/Icon.jsx'
import { Check } from 'lucide-react'

const DISMISS_KEY = 'blogos.onboarding.v1'

function dismissedChannels() {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Чеклист первого запуска.
 *
 * Пустые экраны — самая результативная точка онбординга: человек видит,
 * что продукт умеет, и чего не хватает именно ему. Здесь только линейный
 * путь «канал → стиль → первый черновик»: остальные разделы (архив,
 * база знаний, CommentRadar) открываются из навигации, а не конкурируют
 * с первым запуском за внимание.
 *
 * Чеклист считается по реальным данным канала (три запроса), держится,
 * пока не выполнены все шаги, и закрывается навсегда для этого канала —
 * выбор лежит в браузере, отдельного поля в базе для него нет.
 */
export default function Onboarding({ channel, onGo }) {
  const [state, setState] = useState('loading')
  const [done, setDone] = useState({ channel: false, tov: false, draft: false })
  const [hidden, setHidden] = useState(() => dismissedChannels().includes(String(channel.id)))
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (hidden) return undefined
    let alive = true
    setState('loading')
    Promise.allSettled([
      api.posts.list(channel.id, { limit: 1 }),
      api.tov.get(channel.id),
      api.drafts.list(channel.id, { limit: 1 }),
    ]).then(([posts, tov, drafts]) => {
      if (!alive) return
      const styleReady = tov.status === 'fulfilled' && Boolean(tov.value)
      setDone({
        /* Первый шаг закрывается любым из двух входов в разбор: импортом
           постов по ссылке или текстами, вставленными руками. Иначе автор,
           который выбрал второй путь, навсегда видел бы «1 из 3». */
        channel: styleReady
          || (posts.status === 'fulfilled' && itemsOf(posts.value).length > 0),
        tov: styleReady,
        draft: drafts.status === 'fulfilled' && itemsOf(drafts.value).length > 0,
      })
      setState('ready')
    })
    return () => { alive = false }
  }, [channel.id, hidden])

  const dismiss = () => {
    setHidden(true)
    try {
      const list = new Set(dismissedChannels())
      list.add(String(channel.id))
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...list]))
    } catch {
      /* приватный режим: чеклист вернётся после перезагрузки, это не поломка */
    }
  }

  const steps = [
    {
      key: 'channel',
      title: 'Подключить канал',
      text: 'Вставьте ссылку на свой Telegram-канал — BlogOS загрузит посты и возьмёт их за образец вашего голоса. Или вставьте 2–3 текста вручную на этом же шаге.',
      action: 'Перейти к шагу 1',
      go: () => onGo('pipeline', 1),
    },
    {
      key: 'tov',
      title: 'Разобрать стиль',
      text: 'По постам канала или по 2–3 своим текстам система соберёт профиль Tone of Voice. Без него черновик получится усреднённым.',
      action: 'Перейти к разбору стиля',
      go: () => onGo('pipeline', 1),
    },
    {
      key: 'draft',
      title: 'Собрать первый черновик',
      text: 'Накидайте сырые мысли по строке — Narrative Engine расставит их по сюжетной арке и проверит текст.',
      action: 'Перейти к заметкам',
      go: () => onGo('pipeline', 2),
    },
  ]

  const completed = steps.filter((step) => done[step.key]).length
  if (hidden || state === 'loading' || completed === steps.length) return null

  /* Пока не сделано ничего, чеклист — главное на экране: человек только
     что завёл канал и не знает, с чего начинать. Как только первый шаг
     пройден, он превращается в строку прогресса и уступает место работе:
     карточка занимала 522 точки над конвейером на каждом его шаге, и
     поле ввода заметок начиналось ниже сгиба. Развернуть можно в любой
     момент, скрыть навсегда — как и раньше. */
  const open = expanded || completed === 0

  if (!open) {
    return (
      <section className="card onboarding onboarding-compact">
        <div className="onboarding-line">
          <span className="onboarding-title">С чего начать</span>
          <span className="faint">
            {completed} {plural(completed, 'шаг', 'шага', 'шагов')} из {steps.length}
          </span>
          <span className="onboarding-bar" aria-hidden="true">
            <i style={{ width: `${(completed / steps.length) * 100}%` }} />
          </span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded(true)}>
            Развернуть
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={dismiss}>
            Скрыть
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="card onboarding">
      <div className="card-head">
        <div>
          <h2>С чего начать</h2>
          <p>
            Канал «{channel.name}»: пройдено {completed} {plural(completed, 'шаг', 'шага', 'шагов')} из {steps.length}.
          </p>
        </div>
        <div className="spacer" />
        {completed > 0 && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded(false)}>
            Свернуть
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={dismiss}>
          Скрыть
        </button>
      </div>

      <ol className="checklist">
        {steps.map((step) => (
          <li className="checklist-item" key={step.key} data-done={done[step.key]}>
            <span className="checklist-mark" aria-hidden="true">
              {done[step.key] ? <Icon as={Check} size="sm" /> : null}
            </span>
            <div className="checklist-body">
              <div className="checklist-title">{step.title}</div>
              <div className="checklist-text">{step.text}</div>
              {/* Кнопка остаётся и у выполненного шага: к своему стилю или
                  черновику возвращаются и после того, как галочка получена. */}
              <button type="button" className="btn btn-sm" onClick={step.go}>
                {done[step.key] ? 'Открыть снова' : step.action}
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
