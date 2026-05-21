const TOUCHES = [
  {
    key:     'T0',
    label:   'In-Transit',
    sublabel: 'In-Transit',
    color:   '#f59e0b',
    dim:     'rgba(245,158,11,0.12)',
    border:  'rgba(245,158,11,0.25)',
    icon:    '📦',
  },
  {
    key:     'T1',
    label:   'Initial Outreach',
    sublabel: 'Initial Outreach',
    color:   '#00d4ff',
    dim:     'rgba(0,212,255,0.12)',
    border:  'rgba(0,212,255,0.25)',
    icon:    '📡',
  },
  {
    key:     'T2',
    label:   '1st Follow-up',
    sublabel: '1st Follow-up',
    color:   '#8b5cf6',
    dim:     'rgba(139,92,246,0.12)',
    border:  'rgba(139,92,246,0.25)',
    icon:    '📩',
  },
  {
    key:     'T3',
    label:   '2nd Follow-up',
    sublabel: '2nd Follow-up',
    color:   '#00e5a0',
    dim:     'rgba(0,229,160,0.12)',
    border:  'rgba(0,229,160,0.25)',
    icon:    '✉️',
  },
]

function pct(num, den) {
  if (!den) return '—'
  return (num / den * 100).toFixed(1) + '%'
}

function Stat({ label, value, color, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        cursor: onClick ? 'pointer' : 'default',
        padding: '8px 10px',
        borderRadius: 6,
        background: onClick ? 'rgba(255,255,255,0.03)' : 'transparent',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
      title={onClick ? 'Click to drill down' : undefined}
    >
      <span style={{ fontSize: 11, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 700, color: color || '#f0f4ff', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.2 }}>
        {value}
      </span>
    </div>
  )
}

export default function EmailCampaignBreakdown({ customers, summary, onDrill }) {
  if (!customers?.length) return null

  const total = customers.length
  const t2Sent = customers.filter(c => c.fu_sent).length
  const t3Sent = customers.filter(c => c.fu2_sent).length

  // T0 counts come from summary totals — in-transit recipients exist before T1 is sent,
  // so most won't appear in the customers array (which is built from T1 recipients)
  const t0Sent      = summary?.in_transit_sent      ?? 0
  const t0Activated = summary?.in_transit_activated ?? 0

  const sentByTouch = { T0: t0Sent, T1: total, T2: t2Sent, T3: t3Sent }

  const activatedByTouch = {
    T0: t0Activated,
    T1: customers.filter(c => c.activated_after_touch === 'T1').length,
    T2: customers.filter(c => c.activated_after_touch === 'T2').length,
    // generate_data.py doesn't set activated_after_touch for T3; derive from fu2_sent + status
    T3: customers.filter(c => c.fu2_sent && c.status === 'Activated').length,
  }

  const drill = (label, subtitle, filterFn) => {
    if (!onDrill) return undefined
    return () => onDrill(label, subtitle, customers.filter(filterFn))
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      {TOUCHES.map(t => {
        const sent      = sentByTouch[t.key]
        const activated = activatedByTouch[t.key]

        const sentFilter =
          t.key === 'T0' ? c => c.in_transit_sent :
          t.key === 'T1' ? () => true :
          t.key === 'T2' ? c => c.fu_sent :
                           c => c.fu2_sent
        const drillSent = drill(
          `${t.label} — All Sent`,
          `All customers who received the ${t.label.toLowerCase()}`,
          sentFilter,
        )
        const drillActivated = drill(
          `Activated via ${t.label}`,
          `Customers who activated after receiving the ${t.label.toLowerCase()}`,
          t.key === 'T3'
            ? c => c.fu2_sent && c.status === 'Activated'
            : c => c.activated_after_touch === t.key,
        )

        return (
          <div
            key={t.key}
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {/* Card header */}
            <div style={{
              background: t.dim,
              borderBottom: `1px solid ${t.border}`,
              padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ fontSize: 18 }}>{t.icon}</span>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.color }}>{t.label}</div>
              <div style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: t.color, fontWeight: 600 }}>
                {pct(activated, sent)} conv.
              </div>
            </div>

            {/* Stats */}
            <div style={{ padding: '4px 6px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              <Stat
                label="Sent"
                value={sent.toLocaleString()}
                color={t.color}
                onClick={drillSent}
              />
              <Stat
                label="Activated"
                value={activated.toLocaleString()}
                color="#00e5a0"
                onClick={drillActivated}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
