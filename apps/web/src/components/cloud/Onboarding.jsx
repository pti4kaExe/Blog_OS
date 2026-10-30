import { useEffect, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
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
 * что продукт умеет, и чего не хватает именно ему. До этого новый автор
 * попадал на шаг 1 конвейера и не знал, что в облаке есть ещё архив,
 * база знаний и CommentRadar.
 *
 * Чеклист считается по реальным данным канала (четыре запроса), держится,
 * пока не выполнены все шаги, и закрывается навсегда для этого канала —
 * выбор лежит в браузере, отдельного поля в базе для него нет.
 */
export default function Onboarding({ channel, onGo }) {
  const [state, setState] = useState('loading')
  const [done, setDone] = useState({ tov: false, draft: false, source: false, knowledge: false })
  const [hidden, setHidden] = useState(() => dismissedChannels().includes(String(channel.id)))

  useEffect(() => {
    if (hidden) return undefined
    let alive = true
    setState('loading')
    Promise.allSettled([
      api.tov.get(channel.id),
      api.drafts.list(channel.id, { limit: 1 }),
      api.sources.list(channel.id, { limit: 1 }),
      api.knowledge.list(channel.id, { limit: 1 }),
    ]).then(([tov, drafts, sources, knowledge]) => {
      if (!alive) return
      setDone({
        tov: tov.status === 'fulfilled' && Boolean(tov.value),
        draft: drafts.status === 'fulfilled' && itemsOf(drafts.value).length > 0,
        source: sources.status === 'fulfilled' && itemsOf(sources.value).length > 0,
        knowledge: knowledge.status === 'fulfilled' && itemsOf(knowledge.value).length > 0,
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
      key: 'tov',
      title: 'Разобрать свой стиль',
      text: 'Вставьте 2–3 своих поста — система построит карточку Tone of Voice. Без неё остальные шаги работают вслепую.',
      action: 'Перейти к стилю',
      go: () => onGo('pipeline'),
    },
    {
      key: 'draft',
      title: 'Собрать первый черновик',
      text: 'Накидайте сырые мысли по строке — Narrative Engine расставит их по сюжетной арке и проверит текст.',
      action: 'Перейти к заметкам',
      go: () => onGo('pipeline'),
    },
    {
      key: 'knowledge',
      title: 'Добавить факты о себе',
      text: 'Цифры, опыт, стек. Движок опирается на них вместо того, чтобы выдумывать — и оставляет пропуск там, где факта нет.',
      action: 'Открыть базу знаний',
      go: () => onGo('knowledge'),
    },
    {
      key: 'source',
      title: 'Подключить источник обсуждений',
      text: 'CommentRadar найдёт разговоры по вашим темам и соберёт черновик комментария в вашем голосе.',
      action: 'Открыть CommentRadar',
      go: () => onGo('radar'),
    },
  ]

  const completed = steps.filter((step) => done[step.key]).length
  if (hidden || state === 'loading' || completed === steps.length) return null

  return (
    <section className="card onboarding">
      <div className="card-head">
        <div>
          <h2>С чего начать</h2>
          <p>Канал «{channel.name}» готов на {completed} из {steps.length} шагов.</p>
        </div>
        <div className="spacer" />
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
              {!done[step.key] && (
                <button type="button" className="btn btn-sm" onClick={step.go}>{step.action}</button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
