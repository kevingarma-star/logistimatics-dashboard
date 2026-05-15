import { useState } from 'react'
import SurveyDrillModal from './SurveyDrillModal'

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

function StatPill({ label, value, color, onClick }) {
  return (
    <div
      onClick={onClick}
      title={onClick ? `Click to view all responses` : undefined}
      style={{
        flex: 1,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${color}22`,
        borderRadius: 8,
        padding: '12px 16px',
        minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        transition: onClick ? 'border-color 0.15s, background 0.15s' : undefined,
      }}
      onMouseEnter={onClick ? e => {
        e.currentTarget.style.borderColor = `${color}55`
        e.currentTarget.style.background = `${color}08`
      } : undefined}
      onMouseLeave={onClick ? e => {
        e.currentTarget.style.borderColor = `${color}22`
        e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
      } : undefined}
    >
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
  const [showDrill, setShowDrill] = useState(false)

  if (!surveySummary?.has_survey_data) return <AwaitingData />

  const s = surveySummary

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <StatPill label="Surveys Sent"  value={s.surveys_sent}        color="#00d4ff"
          onClick={surveyResponses?.length > 0 ? () => setShowDrill(true) : undefined}
        />
        <StatPill label="Responses"     value={s.total_responses}     color="#00e5a0"
          onClick={surveyResponses?.length > 0 ? () => setShowDrill(true) : undefined}
        />
        <StatPill label="Response Rate" value={`${s.response_rate}%`} color="#8b5cf6"
          onClick={surveyResponses?.length > 0 ? () => setShowDrill(true) : undefined}
        />
      </div>

      {/* Reason breakdown */}
      <div style={{ fontSize: 11, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 14 }}>
        Responses by Reason
      </div>
      {s.breakdown.map(item => (
        <BarRow key={item.reason} item={item} />
      ))}

      {showDrill && (
        <SurveyDrillModal
          responses={surveyResponses}
          onClose={() => setShowDrill(false)}
        />
      )}
    </div>
  )
}
