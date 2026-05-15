import { useEffect, useMemo, useState } from 'react'

const REASON_COLORS = {
  time:       '#8b5cf6',
  need:       '#3b82f6',
  activation: '#f97316',
  ready:      '#10b981',
}

const REASON_ICONS = {
  time:       '⏰',
  need:       '🤷',
  activation: '🖥️',
  ready:      '🚫',
}

export default function SurveyDrillModal({ responses, onClose }) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return (responses || []).filter(r =>
      !q ||
      r.email?.toLowerCase().includes(q) ||
      r.name?.toLowerCase().includes(q) ||
      r.reason_label?.toLowerCase().includes(q)
    )
  }, [responses, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
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
    const header = 'Date,Name,Email,Reason'
    const rows = sorted.map(r =>
      [r.date, r.name || '', r.email, r.reason_label || r.reason].join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'survey_responses.csv'
    a.click()
  }

  const COLS = [
    { key: 'date',         label: 'Date'   },
    { key: 'name',         label: 'Name'   },
    { key: 'email',        label: 'Email'  },
    { key: 'reason_label', label: 'Reason' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(6,6,15,0.7)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
          animation: 'fadeIn 0.2s ease',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(640px, 95vw)',
        background: 'linear-gradient(180deg, #0d0d1f 0%, #080814 100%)',
        border: '1px solid rgba(139,92,246,0.2)',
        borderRight: 'none',
        boxShadow: '-24px 0 80px rgba(0,0,0,0.6)',
        zIndex: 101,
        display: 'flex', flexDirection: 'column',
        animation: 'slideIn 0.25s cubic-bezier(0.16,1,0.3,1)',
      }}>

        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(139,92,246,0.15)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f4ff', marginBottom: 4 }}>
              Survey Responses
            </div>
            <div style={{ fontSize: 12, color: '#8892a4' }}>
              Why aren't customers activating?
            </div>
            <div style={{ fontSize: 11, color: '#8b5cf6', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>
              {sorted.length} of {responses?.length ?? 0} responses
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button onClick={exportCSV} style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600,
              background: 'rgba(139,92,246,0.1)', color: '#8b5cf6',
              border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6,
              cursor: 'pointer', letterSpacing: '0.4px',
            }}>
              Export CSV
            </button>
            <button onClick={onClose} style={{
              width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, cursor: 'pointer', color: '#8892a4', fontSize: 18, lineHeight: 1,
            }}>×</button>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, or reason…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px', fontSize: 12,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(139,92,246,0.25)',
              borderRadius: 6, color: '#f0f4ff',
              outline: 'none',
            }}
          />
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    style={{
                      padding: '10px 8px', textAlign: 'left',
                      color: sortKey === col.key ? '#8b5cf6' : '#8892a4',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                      letterSpacing: '0.6px', whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      userSelect: 'none',
                    }}
                  >
                    {col.label}
                    {sortKey === col.key && (
                      <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: '32px 8px', textAlign: 'center', color: '#4a5568' }}>
                    No responses match your search
                  </td>
                </tr>
              )}
              {sorted.map((r, i) => {
                const color = REASON_COLORS[r.reason] || '#8892a4'
                const icon  = REASON_ICONS[r.reason]  || '❓'
                return (
                  <tr
                    key={r.email + i}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '9px 8px', color: '#8892a4', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                      {r.date}
                    </td>
                    <td style={{ padding: '9px 8px', color: '#c4cee0', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name || '—'}
                    </td>
                    <td style={{ padding: '9px 8px', color: '#c4cee0', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.email}
                    </td>
                    <td style={{ padding: '9px 8px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: `${color}18`, border: `1px solid ${color}44`,
                        borderRadius: 4, padding: '2px 7px',
                        fontSize: 11, color,
                      }}>
                        {icon} {r.reason_label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
