import { useEffect, useMemo, useState } from 'react'
import api, { itemsOf } from '../../api/client.js'
import {
  fmtCost, fmtDateTime, fmtMoney, fmtPercent, fmtTokens,
  isOffline, labelOf, plural, RUN_STATUSES, TASK_TYPES,
} from '../../lib/format.js'
import {
  Bar, EmptyState, ErrorState, InlineError, Loading, Metric, Notice, Select, StatusTag,
  Tag, TextInput,
} from '../ui.jsx'

const EMPTY_FILTERS = { task_type: '', status: '', from: '', to: '' }

function toIsoStart(date) {
  return date ? `${date}T00:00:00.000Z` : undefined
}

function toIsoEnd(date) {
  return date ? `${date}T23:59:59.999Z` : undefined
}

/**
 * Расходы на AI: виджет лимита канала (80% — предупреждение, 100% — блокировка)
 * и журнал вызовов с фильтрами (`GET /generation-runs`).
 */
export default function UsageView({ channel, onUseLocal }) {
  const [usage, setUsage] = useState(null)
  const [usageState, setUsageState] = useState('loading')
  const [usageError, setUsageError] = useState(null)
  const [usageKey, setUsageKey] = useState(0)

  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [runs, setRuns] = useState([])
  const [runsState, setRunsState] = useState('loading')
  const [runsError, setRunsError] = useState(null)
  const [runsKey, setRunsKey] = useState(0)
  const [cursor, setCursor] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)

  useEffect(() => {
    let alive = true
    setUsageState('loading')
    setUsageError(null)
    api.profiles.usage(channel.id)
      .then((payload) => {
        if (!alive) return
        setUsage(payload)
        setUsageState('ready')
      })
      .catch((error) => {
        if (!alive) return
        setUsageError(error)
        setUsageState('error')
      })
    return () => { alive = false }
  }, [channel.id, usageKey])

  const query = useMemo(() => ({
    author_profile_id: channel.id,
    task_type: filters.task_type || undefined,
    status: filters.status || undefined,
    from: toIsoStart(filters.from),
    to: toIsoEnd(filters.to),
    limit: 50,
  }), [channel.id, filters])

  useEffect(() => {
    let alive = true
    setRunsState(cursor ? 'more' : 'loading')
    setRunsError(null)
    api.service.generationRuns({ ...query, cursor: cursor || undefined })
      .then((payload) => {
        if (!alive) return
        const items = itemsOf(payload)
        setRuns((prev) => (cursor ? [...prev, ...items] : items))
        setNextCursor(payload && payload.next_cursor !== undefined ? payload.next_cursor : null)
        setRunsState('ready')
      })
      .catch((error) => {
        if (!alive) return
        setRunsError(error)
        setRunsState('error')
      })
    return () => { alive = false }
  }, [query, cursor, runsKey])

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setCursor(null)
  }

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS)
    setCursor(null)
  }

  const limit = usage?.monthly_cost_limit
  const spent = usage?.spent ?? 0
  const ratio = usage?.limit_ratio != null
    ? usage.limit_ratio
    : limit ? spent / limit : 0
  const warning = usage?.warning ?? (limit ? ratio >= 0.8 : false)
  const blocked = usage?.blocked ?? (limit ? ratio >= 1 : false)
  const byTask = usage?.by_task || []

  return (
    <div className="grid-2">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Расходы на AI</h2>
            <p>Канал «{channel.name}» · период {usage?.period || '—'}</p>
          </div>
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setUsageKey((key) => key + 1)}>
            Обновить
          </button>
        </div>

        {usageState === 'loading' && <Loading label="Считаем расходы…" />}

        {usageState === 'error' && (
          <ErrorState error={usageError} onRetry={() => setUsageKey((key) => key + 1)}>
            {isOffline(usageError) && onUseLocal && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>Работать локально</button>
            )}
          </ErrorState>
        )}

        {usageState === 'ready' && usage && (
          <>
            <div className={blocked ? 'usage-hero usage-blocked' : warning ? 'usage-hero usage-warning' : 'usage-hero'}>
              <div>
                <div className="usage-num">{fmtMoney(spent)}</div>
                <div className="usage-limit">
                  {limit ? `из ${fmtMoney(limit)} в месяц` : 'лимит не задан'}
                </div>
              </div>
              <div className="usage-bar-wrap">
                <Bar
                  value={limit ? Math.min(100, Math.round(ratio * 100)) : 0}
                  tone={blocked ? 'bad' : warning ? 'warn' : 'good'}
                />
                <div className="usage-flags">
                  {limit ? <Tag kind={blocked ? 'bad' : warning ? 'warn' : 'good'}>{fmtPercent(ratio, 0)} лимита</Tag> : <Tag>без лимита</Tag>}
                  {warning && !blocked && <Tag kind="warn">80% — предупреждение</Tag>}
                  {blocked && <Tag kind="bad">100% — AI заблокирован</Tag>}
                </div>
              </div>
            </div>

            <div className="metrics" style={{ marginTop: 14 }}>
              <Metric value={usage.runs?.total ?? 0} label="вызовов всего" />
              <Metric value={usage.runs?.success ?? 0} label="успешных" />
              <Metric value={usage.runs?.failed ?? 0} label="с ошибкой" />
            </div>

            {blocked && (
              <div style={{ marginTop: 14 }}>
                <Notice kind="error">
                  Лимит исчерпан: новые AI-вызовы не выполняются. Все проверки и сборка
                  работают на правилах — автор без результата не остаётся.
                </Notice>
              </div>
            )}
            {warning && !blocked && (
              <div style={{ marginTop: 14 }}>
                <Notice kind="warn">
                  Израсходовано более 80% месячного лимита. После 100% AI-вызовы
                  переключатся на правила.
                </Notice>
              </div>
            )}

            <hr className="hr" />
            <h3>Разбивка по задачам</h3>
            {byTask.length === 0 ? (
              <p className="faint">В этом месяце вызовов ещё не было.</p>
            ) : (
              <div className="list">
                {byTask.map((row) => (
                  <div className="list-item" key={row.task_type}>
                    <div className="list-item-head">
                      <span className="list-item-title">{labelOf(TASK_TYPES, row.task_type)}</span>
                      <div className="spacer" />
                      <Tag>{fmtCost(row.cost)}</Tag>
                    </div>
                    <div className="list-item-meta">
                      {row.runs} {plural(row.runs, 'вызов', 'вызова', 'вызовов')}
                      {' · '}{fmtTokens(row.tokens)} токенов
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="faint" style={{ marginTop: 14, marginBottom: 0 }}>
              Стоимость считается по прайсу провайдера на сервере. Ключи AI в клиент не попадают.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>История вызовов AI</h2>
            <p>Автор видит только вызовы по своим каналам.</p>
          </div>
          <div className="spacer" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRunsKey((key) => key + 1)}>
            Обновить
          </button>
        </div>

        <div className="filter-row" style={{ marginBottom: 12 }}>
          <label className="field">
            <span className="field-label">Задача</span>
            <Select value={filters.task_type} onChange={(event) => updateFilter('task_type', event.target.value)}>
              <option value="">Все задачи</option>
              {TASK_TYPES.map((task) => (
                <option key={task.value} value={task.value}>{task.label}</option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">Статус</span>
            <Select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
              <option value="">Все статусы</option>
              {RUN_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span className="field-label">С даты</span>
            <TextInput type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">По дату</span>
            <TextInput type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>Сбросить</button>
        </div>

        {runsState === 'loading' && <Loading label="Загружаем журнал…" />}

        {runsState === 'error' && (
          <ErrorState error={runsError} onRetry={() => setRunsKey((key) => key + 1)}>
            {isOffline(runsError) && onUseLocal && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={onUseLocal}>Работать локально</button>
            )}
          </ErrorState>
        )}

        {runsState === 'ready' && runs.length === 0 && (
          <EmptyState title="Вызовов не найдено">
            Измените фильтры или выполните проверку — каждый вызов AI записывается в журнал.
          </EmptyState>
        )}

        {runs.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Задача</th>
                    <th>Модель</th>
                    <th className="num">Токены</th>
                    <th className="num">Стоимость</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td className="nowrap">{fmtDateTime(run.created_at)}</td>
                      <td>{labelOf(TASK_TYPES, run.task_type)}</td>
                      <td>{run.model || '—'}</td>
                      <td className="num">{fmtTokens(run.tokens)}</td>
                      <td className="num">{fmtCost(run.cost)}</td>
                      <td>
                        <StatusTag list={RUN_STATUSES} value={run.status} />
                        {run.error_message && (
                          <div className="faint" style={{ marginTop: 2, color: 'var(--bad)' }}>{run.error_message}</div>
                        )}
                        {run.duration_ms ? <div className="faint">{run.duration_ms} мс</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {nextCursor && (
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setCursor(nextCursor)}
                  disabled={runsState === 'more'}
                >
                  {runsState === 'more' ? 'Загружаем…' : 'Показать ещё'}
                </button>
              </div>
            )}
          </>
        )}

        {runsError && runsState !== 'error' && <InlineError error={runsError} />}

        <p className="faint" style={{ marginTop: 12, marginBottom: 0 }}>
          Каждый AI-вызов — включая неудачный — попадает в журнал: так расходы сходятся
          с историей проверок.
        </p>
      </section>
    </div>
  )
}
