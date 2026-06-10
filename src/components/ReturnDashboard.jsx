import { useState, useEffect, Fragment } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import KPICard from './KPICard'

function formatMonth(m) {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

const MonthTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,10,20,0.95)',
      border: '1px solid rgba(255,71,87,0.25)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
    }}>
      <div style={{ color: '#8892a4', marginBottom: 6 }}>{label}</div>
      <div style={{ color: '#ff4757', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
        {payload[0].value} return{payload[0].value !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

function SortIcon({ col, sortBy, sortDir }) {
  if (sortBy !== col) return <span style={{ color: '#4a5568', marginLeft: 4 }}>↕</span>
  return <span style={{ color: '#00d4ff', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
}

export default function ReturnDashboard() {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [noData, setNoData]       = useState(false)
  const [expandedRow, setExpandedRow] = useState(null)
  const [sortBy, setSortBy]       = useState('return_date')
  const [sortDir, setSortDir]     = useState('desc')

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

  const returns    = data.returns_list || []
  const withReason = returns.filter(r => r.reason_summary && !r.is_undeliverable).length
  const thisMonth  = new Date().toISOString().slice(0, 7)
  const thisMonthCount = (data.returns_by_month || []).find(m => m.month === thisMonth)?.count ?? 0
  const chartData  = (data.returns_by_month || []).map(m => ({
    month: formatMonth(m.month),
    count: m.count,
  }))

  const sorted = [...returns].sort((a, b) => {
    let va = a[sortBy] || ''
    let vb = b[sortBy] || ''
    if (sortDir === 'desc') [va, vb] = [vb, va]
    return va < vb ? -1 : va > vb ? 1 : 0
  })

  const toggleSort = col => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

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
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
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
      </div>

      {/* ── Monthly trend ── */}
      {chartData.length > 0 && (
        <div className="panel" style={{ marginTop: 24 }}>
          <div className="panel-title">Returns by Month</div>
          <div className="panel-sub">Devices returned per calendar month · SmartLabel excluded</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="month"
                tick={{ fill: '#8892a4', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#8892a4', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<MonthTooltip />} cursor={{ fill: 'rgba(255,71,87,0.05)' }} />
              <Bar
                dataKey="count"
                name="Returns"
                fill="#ff4757"
                fillOpacity={0.8}
                radius={[4, 4, 0, 0]}
                maxBarSize={52}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

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
                    <Fragment key={r.order_number || i}>
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
                              <span>
                                <span style={{ color: '#4a5568' }}>Order: </span>
                                <span className="mono" style={{ color: '#00d4ff' }}>{r.order_number}</span>
                              </span>
                              {r.conversation_id && (
                                <span>
                                  <span style={{ color: '#4a5568' }}>Conversation ID: </span>
                                  <span className="mono" style={{ color: '#8b5cf6', fontSize: 11 }}>{r.conversation_id}</span>
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
