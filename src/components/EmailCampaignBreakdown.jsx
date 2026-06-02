const TOUCHES = [
  {
    key:     'T0',
    label:   'Touch 1',
    sublabel: 'In-Transit',
    color:   '#f59e0b',
    dim:     'rgba(245,158,11,0.12)',
    border:  'rgba(245,158,11,0.25)',
    icon:    '📦',
  },
  {
    key:     'T1',
    label:   'Touch 2',
    sublabel: 'Features Showcase',
    color:   '#00d4ff',
    dim:     'rgba(0,212,255,0.12)',
    border:  'rgba(0,212,255,0.25)',
    icon:    '📡',
  },
  {
    key:     'T2',
    label:   'Touch 3',
    sublabel: 'Social Proof',
    color:   '#8b5cf6',
    dim:     'rgba(139,92,246,0.12)',
    border:  'rgba(139,92,246,0.25)',
    icon:    '📩',
  },
  {
    key:     'T3',
    label:   'Touch 4',
    sublabel: 'Friction Removal',
    color:   '#00e5a0',
    dim:     'rgba(0,229,160,0.12)',
    border:  'rgba(0,229,160,0.25)',
    icon:    '✉️',
  },
  {
    key:     'RE',
    label:   'Re-engagement',
    sublabel: '',
    color:   '#ff6b6b',
    dim:     'rgba(255,107,107,0.12)',
    border:  'rgba(255,107,107,0.25)',
    icon:    '🔄',
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

function formatDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function EmailCampaignBreakdown({ customers, summary, onDrill, inTransitCustomers = [], reengagementCustomers = [] }) {
  if (!customers?.length) return null

  const inTransitStartDate = inTransitCustomers.length
    ? formatDate(inTransitCustomers.map(c => c.sent_date).filter(Boolean).sort()[0])
    : null

  const total = customers.length
  const t2Sent = customers.filter(c => c.fu_sent).length
  const t3Sent = customers.filter(c => c.fu2_sent).length

  // T0 counts: exclusive in-transit (never got T1) + T1-recipients who activated
  // before T1 was sent (attributed T0 by generate_data.py but live in customers[]).
  // This makes the campaign card total equal the true activated count.
  const customerEmails = new Set(customers.map(c => c.email))
  const t0InMainList  = customers.filter(c => c.activated_after_touch === 'T0')
  const t0ExclSent    = summary?.in_transit_exclusive_sent      ?? summary?.in_transit_sent      ?? 0
  const t0ExclActiv   = summary?.in_transit_exclusive_activated ?? summary?.in_transit_activated ?? 0
  const t0Sent        = t0ExclSent
  const t0Activated   = t0ExclActiv + t0InMainList.length

  // Exclusive in-transit customers: those who never received T1.
  // Used for drill-ins so the modal count matches the card number.
  const exclusiveInTransitCustomers = inTransitCustomers.filter(c => !customerEmails.has(c.email))

  // RE counts come from summary totals — re-engagement recipients predate the email program
  // and are not in the customers array
  const reSent      = summary?.reengagement_sent      ?? 0
  const reActivated = summary?.reengagement_activated ?? 0

  const sentByTouch = { T0: t0Sent, T1: total, T2: t2Sent, T3: t3Sent, RE: reSent }

  const activatedByTouch = {
    T0: t0Activated,
    T1: customers.filter(c => c.activated_after_touch === 'T1').length,
    T2: customers.filter(c => c.activated_after_touch === 'T2').length,
    T3: customers.filter(c => c.fu2_sent && c.status === 'Activated').length,
    RE: reActivated,
  }

  const drill = (label, subtitle, filterFn) => {
    if (!onDrill) return undefined
    return () => onDrill(label, subtitle, customers.filter(filterFn))
  }

  const drillFrom = (pool) => (label, subtitle, filterFn) => {
    if (!onDrill) return undefined
    return () => onDrill(label, subtitle, pool.filter(filterFn))
  }
  // Sent drill uses all in-transit recipients; activated drill uses exclusive pool
  // so the count matches the card number (which shows exclusive activated only).
  const drillItSent = drillFrom(inTransitCustomers)
  const drillIt     = drillFrom(exclusiveInTransitCustomers)
  const drillRe     = drillFrom(reengagementCustomers)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
      {TOUCHES.map(t => {
        const sent      = sentByTouch[t.key]
        const activated = activatedByTouch[t.key]

        const sentFilter =
          t.key === 'T1' ? () => true :
          t.key === 'T2' ? c => c.fu_sent :
                           c => c.fu2_sent  // T3
        const drillSent =
          t.key === 'T0' ? drillItSent(`${t.label} — All Sent`, 'All customers who received the in-transit email', () => true) :
          t.key === 'RE' ? drillRe(`${t.label} — All Sent`, 'All legacy customers who received the re-engagement email', () => true) :
          drill(`${t.label} — All Sent`, `All customers who received the ${t.label.toLowerCase()}`, sentFilter)

        const drillActivated =
          t.key === 'T0' ? (() => {
            if (!onDrill) return undefined
            const pool = [
              ...exclusiveInTransitCustomers.filter(c => c.status === 'Activated'),
              ...t0InMainList,
            ]
            return () => onDrill(`Activated via ${t.label}`, 'Activated before or without Touch 2 (includes T1-recipients who activated before T1 was sent)', pool)
          })() :
          t.key === 'RE' ? drillRe(`Activated via ${t.label}`, 'Legacy customers who activated after the re-engagement email', c => c.status === 'Activated') :
          drill(
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
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.color }}>{t.label}</div>
                {t.sublabel && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>{t.sublabel}</div>}
              </div>
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
            {t.key === 'T0' && inTransitStartDate && (
              <div style={{ padding: '0 10px 10px', fontSize: 11, color: 'rgba(245,158,11,0.7)' }}>
                Campaign started {inTransitStartDate}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
