import { useEffect, useMemo, useState } from 'react'
import { REASON_CONFIG } from '../lib/returnReasons'

const REASON_BY_KEY = Object.fromEntries(REASON_CONFIG.map(r => [r.key, r]))

function daysToReturn(r) {
  if (!r.ship_date || !r.return_date) return null
  const ship = new Date(r.ship_date + 'T12:00:00Z')
  const ret  = new Date(r.return_date + 'T12:00:00Z')
  return Math.max(0, Math.round((ret - ship) / 86400000))
}

const COLS = [
  { key: 'customer_name', label: 'Customer',    sortable: true  },
  { key: 'device_type',   label: 'Device',      sortable: true  },
  { key: 'order_number',  label: 'Order #',     sortable: true  },
  { key: 'return_date',   label: 'Returned',    sortable: true  },
  { key: 'days',          label: 'Days',        sortable: true  },
  { key: 'status',        label: 'Status',      sortable: false },
  { key: 'reason_cat',    label: 'Category',    sortable: false },
  { key: 'reason_summary',label: 'Reason',      sortable: false },
]

export default function ReturnDrillModal({ title, subtitle, rows, onClose }) {
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState('return_date')
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

  const enriched = useMemo(() =>
    (rows || []).map(r => ({ ...r, days: daysToReturn(r) }))
  , [rows])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return enriched
    return enriched.filter(r =>
      (r.customer_name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (r.order_number || '').toLowerCase().includes(q) ||
      (r.device_type || '').toLowerCase().includes(q) ||
      (r.serial || '').toLowerCase().includes(q)
    )
  }, [enriched, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (av === null || av === undefined) av = sortDir === 'asc' ? '\uffff' : ''
      if (bv === null || bv === undefined) bv = sortDir === 'asc' ? '\uffff' : ''
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [filtered, sortKey, sortDir])

  const toggleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const exportCSV = () => {
    const header = 'Customer Name,Email,Device,Serial,Order #,Return Date,Ship Date,Days to Return,Status,Reason Category,Reason Summary'
    const csvRows = sorted.map(r => {
      const cat = REASON_BY_KEY[r.reason_category]?.label || r.reason_category || ''
      const status = r.is_undeliverable ? 'No Conversation' : 'Summarised'
      const summary = (r.reason_summary || '').replace(/"/g, '""')
      return [
        r.customer_name || '', r.email || '', r.device_type || '', r.serial || '',
        r.order_number || '', r.return_date || '', r.ship_date || '',
        r.days ?? '', status, cat, `"${summary}"`,
      ].join(',')
    })
    const blob = new Blob([[header, ...csvRows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/\s+/g, '_').toLowerCase()}_returns.csv`
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
        width: 'min(860px, 96vw)',
        background: 'linear-gradient(180deg, #0d0d1f 0%, #080814 100%)',
        border: '1px solid rgba(255,71,87,0.15)',
        borderRight: 'none',
        boxShadow: '-24px 0 80px rgba(0,0,0,0.6)',
        zIndex: 101,
        display: 'flex', flexDirection: 'column',
        animation: 'slideIn 0.25s cubic-bezier(0.16,1,0.3,1)',
      }}>

        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid rgba(255,71,87,0.1)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f4ff', marginBottom: 4 }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontSize: 12, color: '#8892a4' }}>{subtitle}</div>
            )}
            <div style={{ fontSize: 11, color: '#ff4757', marginTop: 6, fontFamily: 'JetBrains Mono, monospace' }}>
              {sorted.length} of {rows?.length ?? 0} return{rows?.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button onClick={exportCSV} style={{
              padding: '6px 12px', fontSize: 11, fontWeight: 600,
              background: 'rgba(255,71,87,0.1)', color: '#ff4757',
              border: '1px solid rgba(255,71,87,0.3)', borderRadius: 6,
              cursor: 'pointer', letterSpacing: '0.4px', fontFamily: 'Inter, sans-serif',
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
            placeholder="Search by customer, email, order #, device, serial…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '8px 12px', fontSize: 12,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,71,87,0.2)',
              borderRadius: 6, color: '#f0f4ff',
              outline: 'none', fontFamily: 'Inter, sans-serif',
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
                    onClick={() => col.sortable && toggleSort(col.key)}
                    style={{
                      padding: '10px 8px', textAlign: 'left',
                      color: sortKey === col.key ? '#ff4757' : '#8892a4',
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
                  <td colSpan={COLS.length} style={{ padding: '32px 8px', textAlign: 'center', color: '#4a5568' }}>
                    No returns match your search
                  </td>
                </tr>
              )}
              {sorted.map((r, i) => {
                const rc = REASON_BY_KEY[r.reason_category]
                return (
                  <tr
                    key={r.order_number || r.email + i}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Customer */}
                    <td style={{ padding: '9px 8px', maxWidth: 180 }}>
                      <div style={{ color: '#c4cee0', fontWeight: 500, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.customer_name || '—'}
                      </div>
                      <div style={{ color: '#4a5568', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.email}
                      </div>
                    </td>

                    {/* Device */}
                    <td style={{ padding: '9px 8px', maxWidth: 140 }}>
                      <div style={{ color: '#8892a4', fontSize: 12 }}>{r.device_type || '—'}</div>
                      {r.serial && (
                        <div style={{ color: '#4a5568', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>{r.serial}</div>
                      )}
                    </td>

                    {/* Order # */}
                    <td style={{ padding: '9px 8px', fontFamily: 'JetBrains Mono, monospace', color: '#00d4ff', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {r.order_number || '—'}
                    </td>

                    {/* Return Date */}
                    <td style={{ padding: '9px 8px', fontFamily: 'JetBrains Mono, monospace', color: '#8892a4', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {r.return_date || '—'}
                    </td>

                    {/* Days */}
                    <td style={{ padding: '9px 8px', fontFamily: 'JetBrains Mono, monospace', color: '#8892a4', fontSize: 11, textAlign: 'center' }}>
                      {r.days !== null ? `${r.days}d` : '—'}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}>
                      {r.is_undeliverable ? (
                        <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, color: '#ffb700', background: 'rgba(255,183,0,0.12)' }}>
                          No Conv.
                        </span>
                      ) : (
                        <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, color: '#00e5a0', background: 'rgba(0,229,160,0.12)' }}>
                          Summarised
                        </span>
                      )}
                    </td>

                    {/* Reason Category */}
                    <td style={{ padding: '9px 8px', whiteSpace: 'nowrap' }}>
                      {rc ? (
                        <span style={{ padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600, color: rc.color, background: `${rc.color}1a` }}>
                          {rc.label}
                        </span>
                      ) : (
                        <span style={{ color: '#4a5568' }}>—</span>
                      )}
                    </td>

                    {/* Reason Summary */}
                    <td
                      title={r.reason_summary || ''}
                      style={{ padding: '9px 8px', maxWidth: 220, color: '#8892a4', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {r.reason_summary || <span style={{ color: '#4a5568' }}>—</span>}
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
