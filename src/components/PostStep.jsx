import { ARCS } from '../engine/narrative.js'
import { CopyButton, Notice, Tag } from './ui.jsx'

/**
 * Шаг 3. Результат Narrative Engine: пост, разложенный по сюжетной арке.
 * Видно, из каких заметок собран каждый блок и что именно добавил движок.
 */
export default function PostStep({ post, arcKey, onRebuild, onCheck, onBack }) {
  if (!post || !post.ok) {
    return (
      <section className="card">
        <div className="empty">Пост ещё не собран. Вернитесь на шаг «Заметки».</div>
      </section>
    )
  }

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Собранный пост</h2>
            <p>Арка: {post.arc.label} · использовано {post.coverage.used} из {post.coverage.total} заметок</p>
          </div>
          <div className="spacer" />
          <CopyButton text={post.text} />
        </div>

        <div className="faint" style={{ marginBottom: 2 }}>О чём пост</div>
        <h3 className="post-title">{post.title}</h3>

        <div className="blocks">
          {post.blocks.map((b, i) => (
            <div className="block" data-role={b.role} key={`${b.role}-${i}`}>
              <div className="block-label">{b.label}</div>
              <div className="block-text">{b.text}</div>
            </div>
          ))}
        </div>

        <div className="btn-row" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-primary" onClick={onCheck}>
            Проверить в AntiCringe →
          </button>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            ← Править заметки
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Что сделал движок</h2>
            <p>Ваши формулировки не переписываются — меняется только порядок и ритм.</p>
          </div>
        </div>

        <h3>Пересобрать другой аркой</h3>
        <div className="arc-picker" style={{ marginBottom: 16 }}>
          {Object.values(ARCS).map((arc) => (
            <button
              key={arc.key}
              type="button"
              className="arc-opt"
              aria-pressed={(arcKey || post.arc.key) === arc.key}
              onClick={() => onRebuild(arc.key)}
            >
              <b>{arc.label}</b>
              <span>{arc.hint}</span>
            </button>
          ))}
        </div>

        <h3>Добавлено движком</h3>
        {post.additions.length === 0 ? (
          <p className="faint">Ничего — пост собран целиком из ваших строк.</p>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {post.additions.map((a, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <Tag>{a.type}</Tag>{' '}
                <span className="muted" style={{ fontSize: 13 }}>{a.text}</span>
              </div>
            ))}
          </div>
        )}

        <Notice>
          Эмодзи, метафоры и факты движок не придумывает. Если в ваших постах обычно есть
          эмодзи, AntiCringe отдельно скажет об этом на следующем шаге.
        </Notice>
      </section>
    </div>
  )
}
