import { useEffect, useMemo, useState } from 'react'

const STATUS_STYLE = {
  Activated: { color: '#00e5a0', bg: 'rgba(0,229,160,0.12)', label: 'Activated' },
  Pending:   { color: '#ffb700', bg: 'rgba(255,183,0,0.12)',  label: 'Pending'   },
  Returned:  { color: '#ff4757', bg: 'rgba(255,71,87,0.12)',  label: 'Returned'  },
}

const COLS = [
  { key: 'email',          label: 'Email',       sortable: true  },
  { key: 'status',         label: 'Status',      sortable: true  },
  { key: 'sent_date',      label: 'Sent',        sortable: true  },
  { key: 'days_since',     label: 'Days',        sortable: true  },
  { key: 'serials',        label: 'Serial(s)',   sortable: false },
  { key: 'fu_sent',        label: 'Follow-up',   sortable: true  },
  { key: 'sg_delivered',   label: 'Delivered',   sortable: true, sgOnly: true },
  { key: 'sg_opened',      label: 'Opened',      sortable: true, sgOnly: true },
  { key: 'sg_clicked',     label: 'Clicked',     sortable: true, sgOnly: true },
  { key: 'sg_bounced',     label: 'Bounced',     sortable: true, sgOnly: true },
  { key: 'sg_last_event',  label: 'Tracked',     sortable: true, sgOnly: true },
]

function SgBool({ val }) {
  if (val === null || val === undefined) return <span style={{ color: '#4a5568' }}>—</span>
  return val
    ? <span style={{ color: '#00e5a0', fontWeight: 600 }}>✓</span>
    : <span style={{ color: '#4a5568' }}>✗</span>
}

export default function DrillDownModal({ title, subtitle, customers, onClose, showSgCols = false }) {
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState('sent_date')
  const [sortDir, setSortDir]   = useState('desc')

  // Close on ESC
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return (customers || []).filter(c =>
      !q ||
      c.email.includes(q) ||
      c.serials?.toLowerCase().includes(q) ||
      c.status?.toLowerCase().includes(q)
    )
  }, [customers, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'boolean') av = av ? 1 : 0
      if (typeof bv === 'boolean') bv = bv ? 1 : 0
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
    const header = 'Email,Status,Sent Date,Days Since,Serials,Follow-up Sent,Follow-up Date'
    const rows = sorted.map(c =>
      [c.email, c.status, c.sent_date, c.days_since, c.serials, c.fu_sent ? 'Yes' : 'No', c.fu_date || ''].join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/\s+/g, '_').toLowerCase()}.csv`
    a.click()
  }

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
        width: 'min(780px, 95vw)',
        background: 'linear-gradient(180deg, #0d0d1f 0%, #080814 100%)',
        border: '1px solid rgba(0,212,255,0.15)',
        borderRight: 'none',
        boxShadow: '-24px 0 80px rgba(0,0,0,0.6)',
        zIndex: 101,
        display: 'flex', flexDirection: 'column',
        animation: 'slideIn 0.25s cubic-bezier(0.16,1,0.3,1)',
      }}>

        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(0,212,255,0.1)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f4ff', marginBottom: 4 }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 12, color: '#8892a4' }}>{subtitle}</div>
            )}
            <div style={{ fontSize: 11, color: '#00d4ff', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>
              {sorted.length} of {customers?.length ?? 0} customers
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button onClick={exportCSV} style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600,
              background: 'rgba(0,229,160,0.1)', color: '#00e5a0',
              border: '1px solid rgba(0,229,160,0.3)', borderRadius: 6,
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
            placeholder="Search by email, serial, or status…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px', fontSize: 12,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(0,212,255,0.2)',
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
                {COLS.filter(col => !col.sgOnly || showSgCols).map(col => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && toggleSort(col.key)}
                    style={{
                      padding: '10px 8px', textAlign: 'left',
                      color: sortKey === col.key ? '#00d4ff' : '#8892a4',
                      fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                      letterSpacing: '0.6px', whiteSpace: 'nowrap',
                      cursor: col.sortable ? 'pointer' : 'default',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      userSelect: 'none',
                    }}
                  >
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '32px 8px', textAlign: 'center', color: '#4a5568' }}>
                    No customers match your search
                  </td>
                </tr>
              )}
              {sorted.map((c, i) => {
                const st = STATUS_STYLE[c.status] || STATUS_STYLE.Pending
                return (
                  <tr
                    key={c.email + i}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '9px 8px', color: '#c4cee0', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.email}
                    </td>
                    <td style={{ padding: '9px 8px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        color: st.color, background: st.bg,
                      }}>
                        {c.status}
                      </span>
                    </td>
                    <td style={{ padding: '9px 8px', color: '#8892a4', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                      {c.sent_date}
                    </td>
                    <td style={{ padding: '9px 8px', color: '#8892a4', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
                      {c.days_since}d
                    </td>
                    <td style={{ padding: '9px 8px', color: '#c4cee0', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.serials || '—'}
                    </td>
                    <td style={{ padding: '9px 8px' }}>
                      {c.fu_sent ? (
                        <span style={{ color: '#8b5cf6', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                          ✓ {c.fu_date || ''}
                        </span>
                      ) : (
                        <span style={{ color: '#4a5568' }}>—</span>
                      )}
                    </td>
                    {showSgCols && <>
                      <td style={{ padding: '9px 8px', textAlign: 'center' }}><SgBool val={c.sg_delivered} /></td>
                      <td style={{ padding: '9px 8px', textAlign: 'center' }}>
                        {c.sg_opened
                          ? <span style={{ color: '#00d4ff', fontWeight: 600 }}>✓ {c.sg_opens_count > 1 ? `×${c.sg_opens_count}` : ''}</span>
                          : <SgBool val={c.sg_opened} />}
                      </td>
                      <td style={{ padding: '9px 8px', textAlign: 'center' }}>
                        {c.sg_clicked
                          ? <span style={{ color: '#8b5cf6', fontWeight: 600 }}>✓ {c.sg_clicks_count > 1 ? `×${c.sg_clicks_count}` : ''}</span>
                          : <SgBool val={c.sg_clicked} />}
                      </td>
                      <td style={{ padding: '9px 8px', textAlign: 'center' }}><SgBool val={c.sg_bounced} /></td>
                      <td style={{ padding: '9px 8px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#8892a4', whiteSpace: 'nowrap' }}>
                        {c.sg_last_event || <span style={{ color: '#4a5568' }}>—</span>}
                      </td>
                    </>}
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
