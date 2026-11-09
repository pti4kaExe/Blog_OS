/**
 * BlogOS — скелетоны.
 *
 * Вместо спиннера показываем форму того, что грузится: страница не
 * прыгает при появлении данных, и ожидание читается короче, чем есть.
 *
 * Блик идёт на transform — свойство композитора, кадр не пересобирается.
 * При prefers-reduced-motion блик выключается, остаётся статичная плашка.
 */

export function Skeleton({ width = '100%', height = '1rem', radius, className = '', style }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius || 'var(--r-xs)', ...style }}
    />
  )
}

/**
 * Несколько строк текста. Последняя короче — так абзац выглядит абзацем,
 * а не блоком.
 */
export function SkeletonText({ lines = 3, width = '100%', gap = 'var(--sp-2)' }) {
  return (
    <span className="skeleton-text" style={{ width, gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          height="0.8em"
          width={i === lines - 1 ? '62%' : '100%'}
        />
      ))}
    </span>
  )
}

/** Заготовка карточки: заголовок, пара строк, подпись. */
export function SkeletonCard({ lines = 2 }) {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <Skeleton width="42%" height="1.1rem" radius="var(--r-xs)" />
      <SkeletonText lines={lines} />
      <Skeleton width="28%" height="0.7rem" />
    </div>
  )
}

/**
 * Заготовка списка: те же `.list` и `.list-item`, что у настоящего.
 *
 * Ширины строк чуть разные — ровная стопка одинаковых плашек читается
 * как узор, а не как будущий список. Строк по умолчанию три: столько
 * обычно видно до того, как придётся прокручивать.
 */
export function SkeletonList({ rows = 3, lines = 1 }) {
  const widths = ['54%', '38%', '46%', '42%', '50%']
  return (
    <div className="list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="list-item" key={i}>
          <div className="list-item-head">
            <Skeleton width={widths[i % widths.length]} height="0.9rem" />
            <span className="spacer" />
            <Skeleton width="76px" height="0.7rem" />
          </div>
          {/* Строк текста может не быть вовсе: в базе знаний список —
              это одни заголовки, тело скрыто до раскрытия. */}
          {lines > 0 && <SkeletonText lines={lines} />}
        </div>
      ))}
    </div>
  )
}

/**
 * Обёртка для области, которая грузится. Держит роль и живой регион,
 * чтобы скринридер сообщил о загрузке и о её окончании.
 */
export function SkeletonRegion({ loading, label = 'Загружаем…', children, fallback }) {
  if (!loading) return children
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {fallback}
    </div>
  )
}

export default Skeleton
