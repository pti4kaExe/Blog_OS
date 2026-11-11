/**
 * Согласие на передачу текста внешнему AI-провайдеру (docs/DECISIONS.md, № 28).
 *
 * Хранится только на клиенте: в схеме БД поля для согласия нет. Если автор
 * отказался, все AI-запросы уходят с `use_llm: false` — движок работает на
 * правилах, и результат помечается `verified_without_ai: true`.
 */
import { useState } from 'react'
import { Modal } from '../components/ui.jsx'

export const CONSENT_KEY = 'blogos.ai.consent.v1'

export function getAiConsent() {
  try {
    const value = localStorage.getItem(CONSENT_KEY)
    return value === 'granted' || value === 'declined' ? value : null
  } catch {
    return null
  }
}

export function setAiConsent(granted) {
  try {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'declined')
  } catch {
    // приватный режим — решение живёт до перезагрузки
  }
}

export function useAiConsent() {
  const [decision, setDecision] = useState(getAiConsent)
  const [pending, setPending] = useState(null)

  /**
   * Выполняет действие с флагом согласия. Первый AI-вызов показывает
   * модальное подтверждение; отказ продолжает действие с `use_llm: false`.
   */
  const ensure = (action) => {
    const current = decision || getAiConsent()
    if (current) {
      action(current === 'granted')
      return
    }
    setPending({ run: action })
  }

  /**
   * Спрашивает согласие принудительно, если оно ещё не выдано.
   * Нужно, когда автор сам включает AI-слой после отказа.
   */
  const ask = (action) => {
    const current = decision || getAiConsent()
    if (current === 'granted') {
      action(true)
      return
    }
    setPending({ run: action })
  }

  const resolve = (granted) => {
    setAiConsent(granted)
    setDecision(granted ? 'granted' : 'declined')
    const action = pending
    setPending(null)
    if (action) action.run(granted)
  }

  const cancel = () => setPending(null)

  return {
    decision,
    granted: decision === 'granted',
    ensure,
    ask,
    resolve,
    cancel,
    open: Boolean(pending),
    modal: <AiConsentModal open={Boolean(pending)} onResolve={resolve} onCancel={cancel} />,
  }
}

/**
 * Окно согласия.
 *
 * Оба решения продолжают начатое действие, и только третья кнопка его
 * отменяет. Раньше отмена была единственным, что делали Esc и крестик, —
 * причём молча: человек нажимал «Собрать черновик», закрывал окно и
 * оставался перед прежним экраном без единого слова о том, что сборка
 * не запущена. Теперь выход назван словами и стоит в ряду с остальными,
 * а строка под кнопками говорит, что делает закрытие.
 */
function AiConsentModal({ open, onResolve, onCancel }) {
  return (
    <Modal
      open={open}
      title="Передать текст внешнему AI?"
      onClose={onCancel}
      footer={(
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => onResolve(true)}>
            Разрешить AI-слой
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onResolve(false)}>
            Только правила, без AI
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Не сейчас
          </button>
        </div>
      )}
    >
      <p style={{ marginTop: 0 }}>
        Для второго слоя проверки модель получает текст вашего поста. Это необязательно:
        без согласия всё считается правиловым движком — бесплатно и без передачи данных.
      </p>
      <ul className="consent-list">
        <li>Провайдер AI получает текст только этого запроса.</li>
        <li>Отказ не мешает работе: результат будет помечен «проверено без AI».</li>
        <li>Решение можно изменить переключателем AI на любом шаге.</li>
      </ul>
      <p className="field-hint" style={{ marginBottom: 0 }}>
        Любая из первых двух кнопок продолжает начатое действие. «Не сейчас»,
        Esc и крестик отменяют его — ничего не отправится и не соберётся.
      </p>
    </Modal>
  )
}
