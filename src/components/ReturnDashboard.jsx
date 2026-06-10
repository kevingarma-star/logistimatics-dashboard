import { useState, useEffect, useMemo, Fragment } from 'react'
import KPICard from './KPICard'
import ReturnTrendChart from './ReturnTrendChart'
import ReturnSkuChart from './ReturnSkuChart'
import ReturnReasonCharts from './ReturnReasonCharts'
import { REASON_CONFIG } from '../lib/returnReasons'

function formatMonth(m) {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function getWeekMonday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay()
  const offset = (day + 6) % 7
  const mon = new Date(d)
  mon.setUTCDate(d.getUTCDate() - offset)
  return mon.toISOString().slice(0, 10)
}

function formatWeekLabel(monStr) {
  const d = new Date(monStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function SortIcon({ col, sortBy, sortDir }) {
  if (sortBy !== col) return <span style={{ color: '#4a5568', marginLeft: 4 }}>↕</span>
  return <span style={{ color: '#00d4ff', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
}

export default function ReturnDashboard() {
  const [data, setData]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [noData, setNoData]           = useState(false)
  const [expandedRow, setExpandedRow] = useState(null)
  const [sortBy, setSortBy]           = useState('return_date')
  const [sortDir, setSortDir]         = useState('desc')

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}return_data.json`)
      .then(r => {
        if (r.status === 404) { setNoData(true); setLoading(false); return null }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { if (d) { setData(d); setLoading(false) } })
      .catch(() => { setNoData(true); setLoading(false) })
  }, [])

  const returns = useMemo(() => data?.returns_list || [], [data])

  // ── KPI derivations ──────────────────────────────────────────────────────
  const withReason = useMemo(
    () => returns.filter(r => r.reason_summary && !r.is_undeliverable).length,
    [returns],
  )
  const thisMonth      = new Date().toISOString().slice(0, 7)
  const thisMonthCount = useMemo(
    () => (data?.returns_by_month || []).find(m => m.month === thisMonth)?.count ?? 0,
    [data, thisMonth],
  )
  const avgDaysToReturn = useMemo(() => {
    const valid = returns.filter(r => !r.is_undeliverable && r.ship_date && r.return_date)
    if (!valid.length) return null
    const total = valid.reduce((sum, r) => {
      const ship = new Date(r.ship_date   + 'T12:00:00Z')
      const ret  = new Date(r.return_date + 'T12:00:00Z')
      return sum + Math.max(0, (ret - ship) / 86400000)
    }, 0)
    return Math.round((total / valid.length) * 10) / 10
  }, [returns])

  // ── Trend chart data ─────────────────────────────────────────────────────
  const weeklyChartData = useMemo(() => {
    const map = {}
    returns.forEach(r => {
      if (!r.return_date) return
      const mon = getWeekMonday(r.return_date)
      map[mon] = (map[mon] || 0) + 1
    })
    return Object.keys(map).sort().map(mon => ({
      week: formatWeekLabel(mon),
      count: map[mon],
    }))
  }, [returns])

  const monthlyChartData = useMemo(
    () => (data?.returns_by_month || []).map(m => ({
      month: formatMonth(m.month),
      count: m.count,
    })),
    [data],
  )

  // ── Product / SKU breakdown ──────────────────────────────────────────────
  const skuChartData = useMemo(() => {
    const map = {}
    returns.forEach(r => {
      if (r.is_undeliverable || !r.device_type) return
      map[r.device_type] = (map[r.device_type] || 0) + 1
    })
    return Object.entries(map)
      .map(([device, count]) => ({ device, count }))
      .sort((a, b) => b.count - a.count)
  }, [returns])

  // ── Reason charts data ───────────────────────────────────────────────────
  const reasonTopData = useMemo(() => {
    const map = {}
    returns.forEach(r => {
      if (!r.reason_category || r.is_undeliverable) return
      map[r.reason_category] = (map[r.reason_category] || 0) + 1
    })
    return Object.entries(map)
      .map(([key, count]) => ({
        key,
        label: REASON_CONFIG.find(rc => rc.key === key)?.label || key,
        count,
      }))
      .sort((a, b) => b.count - a.count)
  }, [returns])

  const reasonByMonthData = useMemo(() => {
    const months = [...new Set(
      returns
        .filter(r => r.return_date && r.reason_category && !r.is_undeliverable)
        .map(r => r.return_date.slice(0, 7)),
    )].sort()
    return months.map(month => {
      const entry = { month: formatMonth(month) }
      returns
        .filter(r => r.return_date?.startsWith(month) && r.reason_category && !r.is_undeliverable)
        .forEach(r => { entry[r.reason_category] = (entry[r.reason_category] || 0) + 1 })
      return entry
    })
  }, [returns])

  const reasonByProductData = useMemo(() => {
    const devices = [...new Set(
      returns.filter(r => r.device_type && !r.is_undeliverable).map(r => r.device_type),
    )].sort()
    return devices.map(device => {
      const entry = { device }
      returns
        .filter(r => r.device_type === device && r.reason_category && !r.is_undeliverable)
        .forEach(r => { entry[r.reason_category] = (entry[r.reason_category] || 0) + 1 })
      return entry
    })
  }, [returns])

  // ── Sorted table rows ────────────────────────────────────────────────────
  const sorted = useMemo(() => [...returns].sort((a, b) => {
    let va = a[sortBy] || ''
    let vb = b[sortBy] || ''
    if (sortDir === 'desc') [va, vb] = [vb, va]
    return va < vb ? -1 : va > vb ? 1 : 0
  }), [returns, sortBy, sortDir])

  const toggleSort = col => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  // ── Loading / empty states ───────────────────────────────────────────────
  if (loading) return (
    <div className="state-center" style={{ minHeight: 200 }}>
      <div className="spinner" />
    </div>
  )

  if (noData || !data) return (
    <div className="panel" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 320, gap: 16,
    }}>
      <div style={{ fontSize: 40 }}>↩</div>
      <div className="panel-title" style={{ fontSize: 18 }}>Return Dashboard</div>
      <div className="panel-sub" style={{ textAlign: 'center', maxWidth: 440 }}>
        No return data yet. Run{' '}
        <code style={{
          background: 'rgba(0,212,255,0.08)', padding: '2px 7px',
          borderRadius: 4, fontSize: 12, color: '#00d4ff',
        }}>
          python generate_return_data.py
        </code>
        {' '}to populate returns from Supabase + Intercom.
      </div>
    </div>
  )

  const generatedAt = data.generated_at
    ? new Date(data.generated_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    <div>

      {/* ── KPIs ── */}
      <div style={{
        fontSize: 10, color: '#4a5568', textTransform: 'uppercase',
        letterSpacing: '0.8px', marginBottom: 10,
      }}>
        Return Overview
      </div>
      <div className="kpi-grid">
        <KPICard
          label="Total Returns"
          value={data.total_returns}
          icon="↩"
          accent="red"
          sub="All returned devices"
        />
        <KPICard
          label="Reason Found"
          value={withReason}
          icon="💬"
          accent="green"
          sub={`${data.total_returns ? Math.round(withReason / data.total_returns * 100) : 0}% have Intercom summary`}
        />
        <KPICard
          label="Undeliverable"
          value={data.undeliverable_count}
          icon="⚠"
          accent="amber"
          sub="No Intercom conversation found"
        />
        <KPICard
          label="This Month"
          value={thisMonthCount}
          icon="📅"
          accent="cyan"
          sub={new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        />
        <KPICard
          label="Avg Days to Return"
          value={avgDaysToReturn ?? 0}
          icon="⏱"
          accent="purple"
          suffix=" days"
          sub="Ship date → return date"
        />
      </div>

      {/* ── Period trend chart ── */}
      <ReturnTrendChart weeklyData={weeklyChartData} monthlyData={monthlyChartData} />

      {/* ── Product breakdown ── */}
      <ReturnSkuChart data={skuChartData} />

      {/* ── Reason analysis ── */}
      <ReturnReasonCharts
        topData={reasonTopData}
        byMonthData={reasonByMonthData}
        byProductData={reasonByProductData}
      />

      {/* ── Returns table ── */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-title">All Returns</div>
        <div className="panel-sub">
          {returns.length} returned device{returns.length !== 1 ? 's' : ''} · Click a row to expand the return reason
        </div>

        {returns.length === 0 ? (
          <div style={{ color: '#4a5568', fontSize: 13, paddingTop: 24, textAlign: 'center' }}>
            No returns on record
          </div>
        ) : (
          <div className="cohort-table-wrap" style={{ marginTop: 16 }}>
            <table className="cohort-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('return_date')}>
                    Return Date <SortIcon col="return_date" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('customer_name')}>
                    Customer <SortIcon col="customer_name" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th>Device</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('ship_date')}>
                    Shipped <SortIcon col="ship_date" sortBy={sortBy} sortDir={sortDir} />
                  </th>
                  <th>Status</th>
                  <th>Return Reason</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const isExpanded = expandedRow === i
                  const hasReason  = r.reason_summary && !r.is_undeliverable
                  return (
                    <Fragment key={r.order_number || r.email || i}>
                      <tr
                        onClick={() => setExpandedRow(isExpanded ? null : i)}
                        style={{
                          cursor: 'pointer',
                          background: isExpanded ? 'rgba(0,212,255,0.05)' : undefined,
                        }}
                        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(0,212,255,0.03)' }}
                        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = isExpanded ? 'rgba(0,212,255,0.05)' : 'transparent' }}
                      >
                        <td>
                          <span className="mono" style={{ color: '#00d4ff', fontSize: 12 }}>
                            {r.return_date || '—'}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, color: '#f0f4ff', fontSize: 13 }}>
                            {r.customer_name || '—'}
                          </div>
                          <div style={{ fontSize: 11, color: '#4a5568' }}>{r.email}</div>
                        </td>
                        <td>
                          <span style={{ fontSize: 12, color: '#8892a4' }}>{r.device_type || '—'}</span>
                          {r.serial && (
                            <div className="mono" style={{ fontSize: 10, color: '#4a5568' }}>{r.serial}</div>
                          )}
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: 12, color: '#8892a4' }}>
                            {r.ship_date || '—'}
                          </span>
                        </td>
                        <td>
                          {r.is_undeliverable
                            ? <span className="badge badge-amber">No Conversation</span>
                            : <span className="badge badge-green">Summarised</span>
                          }
                        </td>
                        <td style={{ maxWidth: 260 }}>
                          {hasReason ? (
                            <span style={{
                              fontSize: 12, color: '#8892a4',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}>
                              {r.reason_summary}
                            </span>
                          ) : (
                            <span style={{ color: '#4a5568', fontSize: 12 }}>—</span>
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr style={{ background: 'rgba(0,212,255,0.04)' }}>
                          <td colSpan={6} style={{ padding: '10px 16px 16px' }}>
                            <div style={{ fontSize: 12, color: '#8892a4', marginBottom: 10, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                              {r.order_number && (
                                <span>
                                  <span style={{ color: '#4a5568' }}>Order: </span>
                                  <span className="mono" style={{ color: '#00d4ff' }}>{r.order_number}</span>
                                </span>
                              )}
                              {r.conversation_id && (
                                <span>
                                  <span style={{ color: '#4a5568' }}>Conversation ID: </span>
                                  <span className="mono" style={{ color: '#8b5cf6', fontSize: 11 }}>{r.conversation_id}</span>
                                </span>
                              )}
                              {r.reason_category && (
                                <span>
                                  <span style={{ color: '#4a5568' }}>Category: </span>
                                  <span style={{ color: '#ffa502', fontSize: 11 }}>
                                    {REASON_CONFIG.find(rc => rc.key === r.reason_category)?.label || r.reason_category}
                                  </span>
                                </span>
                              )}
                            </div>
                            {r.reason_summary ? (
                              <div style={{
                                background: 'rgba(0,0,0,0.3)',
                                border: '1px solid rgba(255,255,255,0.07)',
                                borderRadius: 8,
                                padding: '10px 14px',
                                fontSize: 13,
                                color: '#c8d0dc',
                                lineHeight: 1.65,
                              }}>
                                {r.reason_summary}
                              </div>
                            ) : (
                              <div style={{ color: '#4a5568', fontSize: 12 }}>
                                No return reason available — no Intercom conversation found for this customer.
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer metadata */}
      {generatedAt && (
        <div style={{ marginTop: 12, fontSize: 11, color: '#4a5568', textAlign: 'right' }}>
          Data generated {generatedAt} · Run{' '}
          <code style={{ background: 'rgba(0,0,0,0.2)', padding: '1px 5px', borderRadius: 3 }}>
            python generate_return_data.py
          </code>{' '}
          to refresh
        </div>
      )}

    </div>
  )
}
