import { Icon } from './Icon.jsx'

/** Логотип и название в шапке боковой панели. */
export function SideBrand({ subtitle }) {
  return (
    <div className="side-brand">
      <img className="brand-mark" src="/brand-mark.svg" alt="" aria-hidden="true" width="30" height="30" />
      <span className="side-brand-text">
        <span className="side-brand-name">BlogOS</span>
        {subtitle && <span className="side-brand-sub">{subtitle}</span>}
      </span>
    </div>
  )
}

/** Заголовок группы пунктов. */
export function SideGroup({ label, children }) {
  return (
    <div className="side-group">
      {label && <div className="side-group-label">{label}</div>}
      <nav className="side-list">{children}</nav>
    </div>
  )
}

/**
 * Пункт навигации.
 *
 * Активный помечается подсветкой и полосой света у левого края — в тёмной
 * теме это читается быстрее, чем смена цвета текста.
 */
export function SideItem({ icon, label, badge, active, disabled, onClick, title }) {
  return (
    <button
      type="button"
      className="side-item"
      data-active={Boolean(active)}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-current={active ? 'page' : undefined}
    >
      {icon && <Icon as={icon} size="md" />}
      <span className="side-item-label">{label}</span>
      {badge !== undefined && badge !== null && badge !== '' && (
        <span className="side-item-badge">{badge}</span>
      )}
    </button>
  )
}

/** Нижний блок панели: прижимается к низу. */
export function SideFoot({ children }) {
  return <div className="side-foot">{children}</div>
}
