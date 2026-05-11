import { useMemo, useState } from 'react'

const STATUS_STYLE = {
  Activated: { color: '#00e5a0', bg: 'rgba(0,229,160,0.12)' },
  Pending:   { color: '#ffb700', bg: 'rgba(255,183,0,0.12)'  },
  Returned:  { color: '#ff4757', bg: 'rgba(255,71,87,0.12)'  },
}

function StatCard({ label, value, color, sub, active, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        background: active ? `${color}18` : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? color + '55' : color + '22'}`,
        borderRadius: 10,
        padding: '16px 18px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 28, fontWeight: 700, color, textShadow: `0 0 16px ${color}60` }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#4a5568', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function TouchBadge({ level, date }) {
  const style = level === 2
    ? { bg: 'rgba(139,92,246,0.15)', color: '#c4b5fd', border: 'rgba(139,92,246,0.3)' }
    : { bg: 'rgba(0,212,255,0.1)',   color: '#7dd3fc', border: 'rgba(0,212,255,0.25)' }
  return (
    <span style={{
      background: style.bg, color: style.color,
      border: `1px solid ${style.border}`,
      borderRadius: 4, padding: '2px 7px',
      fontFamily: 'JetBrains Mono, monospace', fontSize: 10, whiteSpace: 'nowrap',
    }}>
      T{level} {date ? date.slice(5) : ''}
    </span>
  )
}

const FILTER_OPTIONS = [
  { key: 'all',     label: 'All'      },
  { key: 't2only',  label: 'T2 only'  },
  { key: 't2t3',    label: 'T2 + T3'  },
  { key: 'none',    label: 'No touch' },
]

const COLS = [
  { key: 'email',      label: 'Email',    sortable: true  },
  { key: 'status',     label: 'Status',   sortable: true  },
  { key: 'sent_date',  label: 'Sent',     sortable: true  },
  { key: 'days_since', label: 'Days',     sortable: true  },
  { key: 'fu2_date',   label: 'T2 Date',  sortable: true  },
  { key: 'fu3_date',   label: 'T3 Date',  sortable: true  },
]

export default function FollowupsPage({ customers = [] }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('sent_date')
  const [sortDir, setSortDir] = useState('desc')

  const t2Count   = useMemo(() => customers.filter(c => c.fu2_sent).length, [customers])
  const t3Count   = useMemo(() => customers.filter(c => c.fu3_sent).length, [customers])
  const t2OnlyCount = useMemo(() => customers.filter(c => c.fu2_sent && !c.fu3_sent).length, [customers])
  const noneCount = useMemo(() => customers.filter(c => !c.fu_sent).length, [customers])

  const filtered = useMemo(() => {
    let rows = customers
    if (filter === 't2only') rows = rows.filter(c => c.fu2_sent && !c.fu3_sent)
    else if (filter === 't2t3')  rows = rows.filter(c => c.fu2_sent && c.fu3_sent)
    else if (filter === 'none')  rows = rows.filter(c => !c.fu_sent)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(c =>
        c.email.includes(q) ||
        c.serials?.toLowerCase().includes(q) ||
        c.status?.toLowerCase().includes(q)
      )
    }
    return rows
  }, [customers, filter, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [filtered, sortKey, sortDir])

  const toggleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const exportCSV = () => {
    const header = 'Email,Status,Sent Date,Days Since,Serials,T2 Sent,T2 Date,T3 Sent,T3 Date'
    const rows = sorted.map(c =>
      [c.email, c.status, c.sent_date, c.days_since, c.serials,
       c.fu2_sent ? 'Yes' : 'No', c.fu2_date || '',
       c.fu3_sent ? 'Yes' : 'No', c.fu3_date || ''].join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'followup-touches.csv'
    a.click()
  }

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
        <StatCard label="Touch 2 Sent"  value={t2Count}     color="#8b5cf6" sub={`${t2OnlyCount} received T2 only`}          active={filter === 't2only'} onClick={() => setFilter(f => f === 't2only' ? 'all' : 't2only')} />
        <StatCard label="Touch 3 Sent"  value={t3Count}     color="#00d4ff" sub="All also received T2"                        active={filter === 't2t3'}  onClick={() => setFilter(f => f === 't2t3'  ? 'all' : 't2t3')}  />
        <StatCard label="No Follow-up"  value={noneCount}   color="#4a5568" sub="Never received a follow-up"                  active={filter === 'none'}  onClick={() => setFilter(f => f === 'none'  ? 'all' : 'none')}  />
      </div>

      {/* Filter pills + search + export */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTER_OPTIONS.map(o => (
          <button
            key={o.key}
            onClick={() => setFilter(o.key)}
            style={{
              padding: '5px 14px', fontSize: 11, borderRadius: 6,
              background: filter === o.key ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.04)',
              border: filter === o.key ? '1px solid rgba(0,212,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
              color: filter === o.key ? '#00d4ff' : '#8892a4',
              cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            }}
          >
            {o.label}
          </button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search email, serial, status…"
          style={{
            flex: 1, minWidth: 200, padding: '6px 12px', fontSize: 12,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(0,212,255,0.2)',
            borderRadius: 6, color: '#f0f4ff', outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: '#4a5568', fontFamily: 'JetBrains Mono, monospace' }}>
          {sorted.length} / {customers.length}
        </span>
        <button
          onClick={exportCSV}
          style={{
            padding: '6px 14px', fontSize: 11, fontWeight: 600,
            background: 'rgba(0,229,160,0.1)', color: '#00e5a0',
            border: '1px solid rgba(0,229,160,0.3)', borderRadius: 6, cursor: 'pointer',
          }}
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {COLS.map(col => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && toggleSort(col.key)}
                  style={{
                    padding: '10px 10px', textAlign: 'left',
                    color: sortKey === col.key ? '#00d4ff' : '#8892a4',
                    fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                    letterSpacing: '0.6px', whiteSpace: 'nowrap',
                    cursor: col.sortable ? 'pointer' : 'default',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    userSelect: 'none',
                    background: 'rgba(6,6,15,0.6)',
                    position: 'sticky', top: 0, zIndex: 1,
                  }}
                >
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
              <th style={{
                padding: '10px 10px', textAlign: 'left',
                color: '#8892a4', fontWeight: 600, fontSize: 10,
                textTransform: 'uppercase', letterSpacing: '0.6px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(6,6,15,0.6)', position: 'sticky', top: 0, zIndex: 1,
              }}>
                Touches
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: '40px 10px', textAlign: 'center', color: '#4a5568' }}>
                  No customers match
                </td>
              </tr>
            )}
            {sorted.map((c, i) => {
              const st = STATUS_STYLE[c.status] || STATUS_STYLE.Pending
              return (
                <tr
                  key={c.email + i}
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '9px 10px', color: '#c4cee0', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.email}
                  </td>
                  <td style={{ padding: '9px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, color: st.color, background: st.bg }}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ padding: '9px 10px', color: '#8892a4', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                    {c.sent_date}
                  </td>
                  <td style={{ padding: '9px 10px', color: '#8892a4', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
                    {c.days_since}d
                  </td>
                  <td style={{ padding: '9px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: c.fu2_date ? '#c4b5fd' : '#4a5568', whiteSpace: 'nowrap' }}>
                    {c.fu2_date || '—'}
                  </td>
                  <td style={{ padding: '9px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: c.fu3_date ? '#7dd3fc' : '#4a5568', whiteSpace: 'nowrap' }}>
                    {c.fu3_date || '—'}
                  </td>
                  <td style={{ padding: '9px 10px' }}>
                    {!c.fu_sent ? (
                      <span style={{ color: '#4a5568' }}>—</span>
                    ) : (
                      <span style={{ display: 'flex', gap: 4 }}>
                        {c.fu2_sent && <TouchBadge level={2} date={c.fu2_date} />}
                        {c.fu3_sent && <TouchBadge level={3} date={c.fu3_date} />}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
