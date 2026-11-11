import { Component } from 'react'

/**
 * Предохранитель рендера: любое исключение в дереве компонентов иначе даёт
 * пустой белый экран без объяснения. Показываем причину и два выхода —
 * перезагрузить или продолжить без сервера (локальный режим работает офлайн).
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Ошибку не скрываем: она нужна разработчику, но показываем её коротко.
    console.error('Ошибка интерфейса:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="auth-stage">
        <section className="card">
          <div className="state-block" role="alert">
            <div className="state-icon" aria-hidden="true">!</div>
            <h2>Интерфейс упал, но данные целы</h2>
            <p>
              Что-то сломалось при отрисовке экрана. Работа сохраняется на сервере
              или в браузере — перезагрузка вернёт вас туда же.
            </p>
            <p className="faint">
              {String(this.state.error?.message || this.state.error || 'неизвестная ошибка')}
            </p>
            <div className="btn-row" style={{ justifyContent: 'center' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => window.location.reload()}
              >
                Перезагрузить
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => window.location.assign(window.location.pathname)}
              >
                На главную
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  }
}
