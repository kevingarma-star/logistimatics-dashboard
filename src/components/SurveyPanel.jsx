const REASON_COLORS = {
  serial:       '#f25a54',
  website:      '#f97316',
  time:         '#8b5cf6',
  subscription: '#3b82f6',
}

const REASON_ICONS = {
  serial:       '🔍',
  website:      '💻',
  time:         '⏰',
  subscription: '💳',
}

function StatPill({ label, value, color }) {
  return (
    <div style={{
      flex: 1,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${color}22`,
      borderRadius: 8,
      padding: '12px 16px',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 700, color, textShadow: `0 0 14px ${color}55` }}>
        {value}
      </div>
    </div>
  )
}

function BarRow({ item }) {
  const color = REASON_COLORS[item.reason] || '#8892a4'
  const icon  = REASON_ICONS[item.reason]  || '❓'
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: '#c4cad4' }}>
          {icon}&nbsp;&nbsp;{item.label}
        </span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color, fontWeight: 600 }}>
          {item.count} &nbsp;<span style={{ color: '#4a5568', fontWeight: 400 }}>({item.pct}%)</span>
        </span>
      </div>
      <div style={{ height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${item.pct}%`,
          background: color,
          borderRadius: 4,
          boxShadow: `0 0 8px ${color}66`,
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

function AwaitingData() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 10, padding: '28px 20px',
      background: 'rgba(139,92,246,0.04)',
      borderRadius: 8, border: '1px dashed rgba(139,92,246,0.25)',
    }}>
      <div style={{ fontSize: 26 }}>📋</div>
      <div style={{ color: '#c4b5fd', fontWeight: 600, fontSize: 14 }}>Survey not sent yet</div>
      <div style={{ color: '#8892a4', fontSize: 12, textAlign: 'center', maxWidth: 360, lineHeight: 1.7 }}>
        Deploy the Apps Script tracker, paste the URL into{' '}
        <code style={{ background: 'rgba(139,92,246,0.15)', padding: '1px 6px', borderRadius: 3, fontSize: 10, color: '#c4b5fd' }}>
          config.json
        </code>
        {', '}then run <code style={{ background: 'rgba(139,92,246,0.15)', padding: '1px 6px', borderRadius: 3, fontSize: 10, color: '#c4b5fd' }}>/logistimatics-survey</code> to send the first batch.
      </div>
    </div>
  )
}

export default function SurveyPanel({ surveySummary, surveyResponses }) {
  if (!surveySummary?.has_survey_data) return <AwaitingData />

  const s       = surveySummary
  const recent  = surveyResponses?.slice(0, 10) ?? []

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <StatPill label="Surveys Sent"     value={s.surveys_sent}    color="#00d4ff" />
        <StatPill label="Responses"        value={s.total_responses} color="#00e5a0" />
        <StatPill label="Response Rate"    value={`${s.response_rate}%`} color="#8b5cf6" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Reason breakdown */}
        <div>
          <div style={{ fontSize: 11, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 14 }}>
            Responses by Reason
          </div>
          {s.breakdown.map(item => (
            <BarRow key={item.reason} item={item} />
          ))}
        </div>

        {/* Recent responses table */}
        <div>
          <div style={{ fontSize: 11, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 14 }}>
            Recent Responses
          </div>
          {recent.length === 0 ? (
            <div style={{ color: '#4a5568', fontSize: 13 }}>No responses yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Date', 'Customer', 'Reason'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px 8px', color: '#4a5568', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => {
                  const color = REASON_COLORS[r.reason] || '#8892a4'
                  const icon  = REASON_ICONS[r.reason]  || '❓'
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '7px 8px', color: '#4a5568', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                        {r.date.slice(5)}
                      </td>
                      <td style={{ padding: '7px 8px', color: '#c4cad4', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.name || r.email.split('@')[0]}
                      </td>
                      <td style={{ padding: '7px 8px' }}>
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
          )}
        </div>

      </div>
    </div>
  )
}
