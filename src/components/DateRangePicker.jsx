import { useState, useRef, useEffect } from 'react'

const PRESETS = [
  { label: 'All Time',    days: null },
  { label: 'Last 7d',     days: 7 },
  { label: 'Last 30d',    days: 30 },
  { label: 'Last 60d',    days: 60 },
]

function toISO(d) {
  return d.toISOString().slice(0, 10)
}

function parseDate(str) {
  // Parse YYYY-MM-DD without timezone shift
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmt(str) {
  if (!str) return ''
  const d = parseDate(str)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DateRangePicker({ minDate, maxDate, start, end, onChange }) {
  const [open, setOpen] = useState(false)
  const [localStart, setLocalStart] = useState(start || minDate || '')
  const [localEnd,   setLocalEnd]   = useState(end   || maxDate || '')
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Keep local state in sync when parent resets
  useEffect(() => { setLocalStart(start || minDate || '') }, [start, minDate])
  useEffect(() => { setLocalEnd(end     || maxDate || '') }, [end,   maxDate])

  function applyPreset(days) {
    if (days === null) {
      setLocalStart(minDate || '')
      setLocalEnd(maxDate   || '')
      onChange(minDate || null, maxDate || null)
    } else {
      const endD  = maxDate ? parseDate(maxDate) : new Date()
      const startD = new Date(endD)
      startD.setDate(startD.getDate() - days + 1)
      const s = toISO(startD)
      const e = toISO(endD)
      setLocalStart(s)
      setLocalEnd(e)
      onChange(s, e)
    }
    setOpen(false)
  }

  function apply() {
    onChange(localStart || null, localEnd || null)
    setOpen(false)
  }

  function reset() {
    setLocalStart(minDate || '')
    setLocalEnd(maxDate   || '')
    onChange(minDate || null, maxDate || null)
    setOpen(false)
  }

  const isAllTime = (!start || start === minDate) && (!end || end === maxDate)
  const rangeLabel = isAllTime
    ? 'All Time'
    : `${fmt(start || minDate)} – ${fmt(end || maxDate)}`

  return (
    <div ref={ref} style={{ position: 'relative', userSelect: 'none' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: open ? 'rgba(0,212,255,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${open ? 'rgba(0,212,255,0.4)' : 'rgba(0,212,255,0.15)'}`,
          borderRadius: 8,
          padding: '8px 14px',
          color: '#f0f4ff',
          cursor: 'pointer',
          fontSize: 13,
          fontFamily: 'Inter, sans-serif',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 14 }}>📅</span>
        <span style={{ color: isAllTime ? '#8892a4' : '#00d4ff' }}>{rangeLabel}</span>
        <span style={{ color: '#4a5568', fontSize: 10, marginLeft: 2 }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          zIndex: 100,
          background: '#0e0e1a',
          border: '1px solid rgba(0,212,255,0.2)',
          borderRadius: 12,
          padding: 20,
          minWidth: 300,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,212,255,0.05)',
        }}>
          {/* Preset buttons */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 8 }}>
              Quick Select
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.days)}
                  style={{
                    background: 'rgba(0,212,255,0.07)',
                    border: '1px solid rgba(0,212,255,0.18)',
                    borderRadius: 6,
                    padding: '5px 12px',
                    color: '#00d4ff',
                    fontSize: 12,
                    cursor: 'pointer',
                    fontFamily: 'Inter, sans-serif',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.target.style.background = 'rgba(0,212,255,0.15)'}
                  onMouseLeave={e => e.target.style.background = 'rgba(0,212,255,0.07)'}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: 16 }} />

          {/* Custom range inputs */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
              Custom Range
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#8892a4', marginBottom: 4 }}>From</div>
                <input
                  type="date"
                  value={localStart}
                  min={minDate}
                  max={localEnd || maxDate}
                  onChange={e => setLocalStart(e.target.value)}
                  style={dateInputStyle}
                />
              </div>
              <div style={{ color: '#4a5568', marginTop: 16, fontSize: 14 }}>→</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#8892a4', marginBottom: 4 }}>To</div>
                <input
                  type="date"
                  value={localEnd}
                  min={localStart || minDate}
                  max={maxDate}
                  onChange={e => setLocalEnd(e.target.value)}
                  style={dateInputStyle}
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={reset} style={btnSecondary}>Reset</button>
            <button
              onClick={apply}
              disabled={!localStart || !localEnd}
              style={{
                ...btnPrimary,
                opacity: (!localStart || !localEnd) ? 0.4 : 1,
                cursor: (!localStart || !localEnd) ? 'not-allowed' : 'pointer',
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const dateInputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(0,212,255,0.18)',
  borderRadius: 6,
  padding: '7px 10px',
  color: '#f0f4ff',
  fontSize: 12,
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
  colorScheme: 'dark',
}

const btnSecondary = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '7px 14px',
  color: '#8892a4',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
}

const btnPrimary = {
  background: 'rgba(0,212,255,0.15)',
  border: '1px solid rgba(0,212,255,0.35)',
  borderRadius: 6,
  padding: '7px 16px',
  color: '#00d4ff',
  fontSize: 12,
  fontFamily: 'Inter, sans-serif',
  fontWeight: 600,
}
