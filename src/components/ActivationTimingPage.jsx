import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

const TOUCH_COLORS = {
  T0: '#f59e0b',
  T1: '#00d4ff',
  T2: '#8b5cf6',
  T3: '#00e5a0',
}

const TOUCH_LABELS = {
  T0: 'In-Transit',
  T1: 'Touch 1',
  T2: 'Touch 2',
  T3: 'Touch 3',
}

// ── Stat pill ─────────────────────────────────────────────────────────────────

function StatPill({ label, value, color, sub, onClick }) {
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${color}22`,
        borderRadius: 8,
        padding: '14px 18px',
        minWidth: 0,
        cursor: clickable ? 'pointer' : 'default',
        transition: clickable ? 'border-color 0.15s, background 0.15s' : undefined,
      }}
      onMouseEnter={e => { if (clickable) { e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.background = `${color}08` } }}
      onMouseLeave={e => { if (clickable) { e.currentTarget.style.borderColor = `${color}22`; e.currentTarget.style.background = 'rgba(255,255,255,0.03)' } }}
    >
      <div style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 26, fontWeight: 700, color, textShadow: `0 0 14px ${color}55` }}>
        {value ?? '—'}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#4a5568', marginTop: 4 }}>{sub}{clickable && <span style={{ color, marginLeft: 6, fontSize: 10 }}>↗</span>}</div>}
    </div>
  )
}

// ── Touch attribution bars ────────────────────────────────────────────────────

function TouchBar({ item, onClick }) {
  const color = TOUCH_COLORS[item.touch] || '#8892a4'
  const clickable = !!onClick && item.count > 0
  return (
    <div
      onClick={clickable ? onClick : undefined}
      style={{ marginBottom: 18, cursor: clickable ? 'pointer' : 'default', borderRadius: 6, padding: '4px 6px', margin: '0 -6px 12px', transition: 'background 0.15s' }}
      onMouseEnter={e => { if (clickable) e.currentTarget.style.background = `${color}0d` }}
      onMouseLeave={e => { if (clickable) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div>
          <span style={{ fontSize: 13, color: '#c4cad4', fontWeight: 600 }}>{item.label}</span>
          <span style={{ fontSize: 11, color: '#4a5568', marginLeft: 8 }}>{item.desc}</span>
        </div>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color, fontWeight: 700 }}>
          {item.count}&nbsp;<span style={{ color: '#4a5568', fontWeight: 400, fontSize: 11 }}>({item.pct}%{item.isConvRate ? ' conv.' : ''})</span>
          {clickable && <span style={{ color, fontSize: 10, marginLeft: 6 }}>↗</span>}
        </span>
      </div>
      <div style={{ height: 10, background: 'rgba(255,255,255,0.05)', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${item.pct}%`,
          background: color,
          borderRadius: 5,
          boxShadow: `0 0 10px ${color}66`,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  )
}

// ── Histogram tooltip ─────────────────────────────────────────────────────────

function HistoTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,10,20,0.95)',
      border: '1px solid rgba(0,212,255,0.2)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <div style={{ color: '#00d4ff', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#e2e8f0' }}>{payload[0].value} customers</div>
    </div>
  )
}

// ── Customer table ────────────────────────────────────────────────────────────

function SortTh({ col, label, sortKey, asc, onToggle }) {
  return (
    <th
      onClick={() => onToggle(col)}
      style={{
        textAlign: 'left', padding: '6px 10px 10px', cursor: 'pointer',
        color: sortKey === col ? '#00d4ff' : '#4a5568',
        fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px',
        userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      {label} {sortKey === col ? (asc ? '↑' : '↓') : ''}
    </th>
  )
}

function CustomerTable({ customers }) {
  const [sortKey, setSortKey] = useState('days_to_activate')
  const [asc, setAsc]         = useState(true)
  const [touchFilter, setTouchFilter] = useState('all')

  const filtered = customers
    .filter(c => {
      if (touchFilter === 'all') return true
      if (touchFilter === 'T0') return c.in_transit_sent === true
      return c.activated_after_touch === touchFilter
    })
    .sort((a, b) => {
      const va = a[sortKey] ?? (sortKey === 'days_to_activate' ? Infinity : '')
      const vb = b[sortKey] ?? (sortKey === 'days_to_activate' ? Infinity : '')
      if (va < vb) return asc ? -1 : 1
      if (va > vb) return asc ? 1 : -1
      return 0
    })

  const toggleSort = key => {
    if (sortKey === key) setAsc(p => !p)
    else { setSortKey(key); setAsc(true) }
  }

  return (
    <div>
      {/* Touch filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {['all', 'T0', 'T1', 'T2', 'T3'].map(t => (
          <button
            key={t}
            onClick={() => setTouchFilter(t)}
            style={{
              padding: '4px 12px', fontSize: 11, borderRadius: 6,
              background: touchFilter === t ? `${TOUCH_COLORS[t] || '#00d4ff'}22` : 'transparent',
              border: touchFilter === t
                ? `1px solid ${TOUCH_COLORS[t] || '#00d4ff'}`
                : '1px solid rgba(255,255,255,0.08)',
              color: touchFilter === t ? (TOUCH_COLORS[t] || '#00d4ff') : '#8892a4',
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            }}
          >
            {t === 'all' ? 'All' : TOUCH_LABELS[t]}
          </button>
        ))}
        <span style={{ fontSize: 11, color: '#4a5568', alignSelf: 'center', marginLeft: 4 }}>
          {filtered.length} customers
        </span>
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 420 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: '#0d1117', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <th style={{ textAlign: 'left', padding: '6px 10px 10px', color: '#4a5568', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</th>
              <th style={{ textAlign: 'left', padding: '6px 10px 10px', color: '#f59e0b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>In-Transit</th>
              <SortTh col="sent_date"        label="Touch 1"  sortKey={sortKey} asc={asc} onToggle={toggleSort} />
              <th style={{ textAlign: 'left', padding: '6px 10px 10px', color: '#4a5568', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Touch 2</th>
              <th style={{ textAlign: 'left', padding: '6px 10px 10px', color: '#4a5568', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Touch 3</th>
              <SortTh col="activation_date"  label="Activated" sortKey={sortKey} asc={asc} onToggle={toggleSort} />
              <SortTh col="days_to_activate" label="Days"      sortKey={sortKey} asc={asc} onToggle={toggleSort} />
              <th style={{ textAlign: 'left', padding: '6px 10px 10px', color: '#4a5568', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last Touch</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((c, i) => {
              const touchColor = TOUCH_COLORS[c.activated_after_touch] || '#8892a4'
              return (
                <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '7px 10px', color: '#8892a4', fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.email}
                  </td>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: c.in_transit_date ? '#f59e0b' : undefined }}>
                    {c.in_transit_date?.slice(5) || <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 10px', color: '#4a5568', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                    {c.sent_date?.slice(5) ?? '—'}
                  </td>
                  <td style={{ padding: '7px 10px', color: '#4a5568', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                    {c.fu_date?.slice(5) || <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 10px', color: '#4a5568', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                    {c.fu2_date?.slice(5) || <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 10px', color: '#c4cad4', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                    {c.activation_date?.slice(5) ?? '—'}
                  </td>
                  <td style={{ padding: '7px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700,
                    color: c.days_to_activate >= 0 && c.days_to_activate <= 7 ? '#00e5a0'
                      : c.days_to_activate >= 0 && c.days_to_activate <= 21 ? '#00d4ff'
                      : c.days_to_activate >= 0 ? '#f97316'
                      : '#4a5568'
                  }}>
                    {c.days_to_activate != null && c.days_to_activate >= 0 ? `${c.days_to_activate}d` : '—'}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    {c.activated_after_touch ? (
                      <span style={{
                        display: 'inline-block',
                        background: `${touchColor}18`, border: `1px solid ${touchColor}44`,
                        borderRadius: 4, padding: '2px 8px',
                        fontSize: 11, color: touchColor, fontWeight: 600,
                      }}>
                        {TOUCH_LABELS[c.activated_after_touch]}
                      </span>
                    ) : <span style={{ color: 'rgba(255,255,255,0.15)' }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <div style={{ fontSize: 11, color: '#4a5568', marginTop: 8, textAlign: 'center' }}>
            Showing 200 of {filtered.length} rows
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ActivationTimingPage({ rawData, onDrill }) {
  const timing    = rawData?.activation_timing
  const allCustomers = rawData?.customers ?? []
  // All activated: T1+ activated + T0-only activated (matches dashboard total)
  const customers = [
    ...allCustomers.filter(c => c.status === 'Activated'),
    ...(timing?.t0_only_activated ?? []),
  ]
  // Post-outreach subset (T1+ with known days_to_activate) for avg/median/histogram drill-downs.
  const timedCustomers = customers.filter(c => c.days_to_activate != null && c.days_to_activate >= 0)

  const drill = (title, subtitle, list) => onDrill?.(title, subtitle, list)

  if (!timing || timing.total_activated === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 12, padding: '48px 24px',
        background: 'rgba(0,212,255,0.03)',
        borderRadius: 10, border: '1px dashed rgba(0,212,255,0.18)',
      }}>
        <div style={{ fontSize: 32 }}>⏱</div>
        <div style={{ color: '#00d4ff', fontWeight: 600, fontSize: 15 }}>No activation timing data yet</div>
        <div style={{ color: '#8892a4', fontSize: 12, textAlign: 'center', maxWidth: 420, lineHeight: 1.7 }}>
          Activation dates come from the <strong style={{ color: '#c4cad4' }}>Subscription Assigned At</strong> column
          in the Shopify Google Sheet. Run{' '}
          <code style={{ background: 'rgba(0,212,255,0.1)', padding: '1px 6px', borderRadius: 3, fontSize: 11, color: '#00d4ff' }}>
            python generate_data.py
          </code>{' '}
          to pull the latest data.
        </div>
      </div>
    )
  }

  const histoMax = Math.max(...(timing.days_distribution ?? []).map(d => d.count), 1)
  const histoData = timing.days_distribution ?? []

  const BUCKET_FILTERS = {
    '≤ 3d':   c => c.days_to_activate <= 3,
    '4–7d':   c => c.days_to_activate >= 4  && c.days_to_activate <= 7,
    '8–14d':  c => c.days_to_activate >= 8  && c.days_to_activate <= 14,
    '15–21d': c => c.days_to_activate >= 15 && c.days_to_activate <= 21,
    '22–30d': c => c.days_to_activate >= 22 && c.days_to_activate <= 30,
    '31–45d': c => c.days_to_activate >= 31 && c.days_to_activate <= 45,
    '46+d':   c => c.days_to_activate >= 46,
  }

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 28, flexWrap: 'wrap' }}>
        <StatPill
          label="Total Activated"
          value={timing.total_activated}
          color="#00d4ff"
          sub={timing.timed_count != null ? `${timing.timed_count} with post-outreach timing` : undefined}
          onClick={() => drill(
            'Activated Customers',
            'All activated customers',
            customers
          )}
        />
        <StatPill
          label="Avg Days to Activate"
          value={timing.avg_days_to_activate != null ? `${timing.avg_days_to_activate}d` : null}
          color="#00e5a0"
          sub="post-outreach activations only"
          onClick={() => drill(
            'Activated — by Days to Activate',
            `Avg ${timing.avg_days_to_activate}d · Median ${timing.median_days_to_activate}d`,
            [...timedCustomers].sort((a, b) => a.days_to_activate - b.days_to_activate)
          )}
        />
        <StatPill
          label="Median Days"
          value={timing.median_days_to_activate != null ? `${timing.median_days_to_activate}d` : null}
          color="#8b5cf6"
          sub="50th percentile"
          onClick={() => drill(
            'Activated — by Days to Activate',
            `Avg ${timing.avg_days_to_activate}d · Median ${timing.median_days_to_activate}d`,
            [...timedCustomers].sort((a, b) => a.days_to_activate - b.days_to_activate)
          )}
        />
      </div>

      {/* Two-column: touch attribution + histogram */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, marginBottom: 24 }}>

        {/* Touch attribution */}
        <div className="panel" style={{ minWidth: 0 }}>
          <div className="panel-title">Touch Attribution</div>
          <div className="panel-sub">Which email preceded activation?</div>
          <div style={{ marginTop: 20 }}>
            {(timing.by_touch ?? []).map(item => (
              <TouchBar
                key={item.touch}
                item={item}
                onClick={() => drill(
                  item.label,
                  item.desc,
                  customers.filter(c => c.activated_after_touch === item.touch)
                )}
              />
            ))}
          </div>
          <div style={{
            marginTop: 18, padding: '10px 14px',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 6, fontSize: 11, color: '#4a5568', lineHeight: 1.7,
          }}>
            "After Touch N" means the customer received that email as part of the outreach sequence —
            not necessarily that it caused activation. Touch 1 = no follow-up was ever sent.
          </div>
        </div>

        {/* Days histogram */}
        <div className="panel" style={{ minWidth: 0 }}>
          <div className="panel-title">Days to Activate</div>
          <div className="panel-sub">Distribution from Touch 1 to activation date</div>
          <div style={{ marginTop: 16, height: 220, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={histoData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fill: '#4a5568', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#4a5568', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<HistoTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Bar
                  dataKey="count"
                  radius={[4, 4, 0, 0]}
                  style={{ cursor: 'pointer' }}
                  onClick={entry => {
                    const fn = BUCKET_FILTERS[entry.bucket]
                    if (!fn) return
                    drill(
                      `Activated in ${entry.bucket}`,
                      `Customers who activated within this window`,
                      timedCustomers.filter(fn)
                    )
                  }}
                >
                  {histoData.map((entry, i) => {
                    const pct = entry.count / histoMax
                    const color = pct > 0.6 ? '#00d4ff' : pct > 0.3 ? '#8b5cf6' : '#4a5568'
                    return <Cell key={i} fill={color} />
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
            {[
              { label: '≤ 7 days', color: '#00d4ff', desc: 'Fast activators' },
              { label: '8–21 days', color: '#8b5cf6', desc: 'Mid-range' },
              { label: '22+ days', color: '#4a5568', desc: 'Slow / touch-driven' },
            ].map(l => (
              <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8892a4' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
                <strong style={{ color: l.color }}>{l.label}</strong> — {l.desc}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Customer detail table */}
      <div className="panel">
        <div className="panel-title">Activated Customers — Timing Detail</div>
        <div className="panel-sub">All activated customers · days shown for post-outreach activations only · sortable</div>
        <div style={{ marginTop: 16 }}>
          {customers.length === 0 ? (
            <div style={{ color: '#4a5568', fontSize: 13 }}>No activated customers found.</div>
          ) : (
            <CustomerTable customers={customers} />
          )}
        </div>
      </div>
    </div>
  )
}
