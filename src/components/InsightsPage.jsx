import { useState } from 'react'

const DEFAULT_FOCUS_OPTIONS = [
  { key: null,      label: 'All Insights',       icon: '✦' },
  { key: 'funnel',  label: 'Funnel Drop-off',    icon: '📉' },
  { key: 'email',   label: 'Email Health',        icon: '📬' },
  { key: 'cohorts', label: 'Cohort Performance',  icon: '📅' },
  { key: 'survey',  label: 'Survey Signals',      icon: '🗳' },
]

const SENTIMENT_STYLE = {
  positive: { color: '#00e5a0', border: 'rgba(0,229,160,0.22)' },
  neutral:  { color: '#00d4ff', border: 'rgba(0,212,255,0.22)' },
  negative: { color: '#ff4757', border: 'rgba(255,71,87,0.22)'  },
}

const PRIORITY_STYLE = {
  high:   { color: '#ff4757', bg: 'rgba(255,71,87,0.1)',   border: 'rgba(255,71,87,0.3)',   label: 'HIGH' },
  medium: { color: '#ffb700', bg: 'rgba(255,183,0,0.1)',   border: 'rgba(255,183,0,0.3)',   label: 'MED'  },
  low:    { color: '#00d4ff', bg: 'rgba(0,212,255,0.08)',  border: 'rgba(0,212,255,0.22)',  label: 'LOW'  },
}

export default function InsightsPage({
  insights, loading, error, generatedAt, onGenerate,
  focusOptions = DEFAULT_FOCUS_OPTIONS,
  title = 'AI Campaign Insights',
  subtitle = 'Powered by Claude Sonnet · Structured analysis of live campaign data',
  loadingTitle = 'Analyzing campaign data…',
  loadingSubtitle = 'Claude Sonnet is reviewing your activation metrics, email performance, cohort data, and survey signals.',
}) {
  const [selectedFocus, setSelectedFocus] = useState(null)

  const handleFocusClick = (key) => {
    setSelectedFocus(key)
    onGenerate(key)
  }

  const healthColor = insights
    ? insights.health_score >= 70 ? '#00e5a0'
      : insights.health_score >= 40 ? '#ffb700'
      : '#ff4757'
    : '#8892a4'

  const healthRgb = healthColor === '#00e5a0' ? '0,229,160'
    : healthColor === '#ffb700' ? '255,183,0'
    : '255,71,87'

  return (
    <div style={{ paddingBottom: 48 }}>

      {/* Page header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 20, gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f0f4ff', marginBottom: 4 }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: '#8892a4' }}>
            {subtitle}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {generatedAt && (
            <span style={{ fontSize: 11, color: '#4a5568', fontFamily: 'JetBrains Mono, monospace' }}>
              {generatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            onClick={() => onGenerate(selectedFocus)}
            disabled={loading}
            style={{
              padding: '8px 18px', fontSize: 12, fontWeight: 600,
              background: loading ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)',
              border: '1px solid rgba(139,92,246,0.35)',
              borderRadius: 8, color: loading ? '#6d5aac' : '#c4b5fd',
              cursor: loading ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: 'Inter, sans-serif', transition: 'all 0.15s',
            }}
          >
            <span style={{ display: 'inline-block', animation: loading ? 'spin 0.8s linear infinite' : 'none' }}>
              ↻
            </span>
            {loading ? 'Generating…' : 'Refresh Insights'}
          </button>
        </div>
      </div>

      {/* Focus pills */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28,
        paddingBottom: 20,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <span style={{ fontSize: 11, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.6px', alignSelf: 'center', marginRight: 4 }}>
          Focus
        </span>
        {focusOptions.map(opt => {
          const isActive = selectedFocus === opt.key
          return (
            <button
              key={String(opt.key)}
              onClick={() => handleFocusClick(opt.key)}
              disabled={loading}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: isActive ? 600 : 400,
                background: isActive ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.03)',
                border: isActive ? '1px solid rgba(0,212,255,0.4)' : '1px solid rgba(255,255,255,0.08)',
                borderRadius: 20,
                color: isActive ? '#00d4ff' : '#8892a4',
                cursor: loading ? 'default' : 'pointer',
                fontFamily: 'Inter, sans-serif',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 5,
                opacity: loading ? 0.5 : 1,
              }}
              onMouseEnter={e => { if (!loading && !isActive) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'; e.currentTarget.style.color = '#c4cee0' } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#8892a4' } }}
            >
              <span>{opt.icon}</span>
              {opt.label}
            </button>
          )
        })}
        {selectedFocus && (
          <span style={{ fontSize: 11, color: '#4a5568', alignSelf: 'center', marginLeft: 4 }}>
            · Claude will go deeper on <span style={{ color: '#00d4ff' }}>{focusOptions.find(o => o.key === selectedFocus)?.label}</span>
          </span>
        )}
      </div>

      {/* Loading state (first load only) */}
      {loading && !insights && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: 380, gap: 20,
        }}>
          <div style={{
            width: 56, height: 56,
            border: '3px solid rgba(139,92,246,0.12)',
            borderTopColor: '#8b5cf6',
            borderRadius: '50%',
            animation: 'spin 0.9s linear infinite',
          }} />
          <div style={{ color: '#8892a4', fontSize: 14, fontWeight: 500 }}>{loadingTitle}</div>
          <div style={{ color: '#4a5568', fontSize: 12, maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
            {loadingSubtitle}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{
          background: 'rgba(255,71,87,0.06)',
          border: '1px solid rgba(255,71,87,0.25)',
          borderRadius: 12,
          padding: '22px 26px',
          marginBottom: 24,
        }}>
          <div style={{ color: '#ff4757', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
            Failed to generate insights
          </div>
          <div style={{ color: '#ff8a95', fontSize: 13, lineHeight: 1.6 }}>{error}</div>
          <button
            onClick={onGenerate}
            style={{
              marginTop: 14, padding: '7px 16px', fontSize: 12,
              background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)',
              borderRadius: 6, color: '#ff4757', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
            }}
          >
            Try again
          </button>
        </div>
      )}

      {/* Insights content */}
      {insights && (
        <>
          {/* Campaign health score */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid rgba(${healthRgb},0.25)`,
            borderRadius: 16,
            padding: '28px 32px',
            marginBottom: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 32,
          }}>
            {/* Score ring */}
            <div style={{
              width: 92, height: 92, borderRadius: '50%',
              border: `3px solid ${healthColor}`,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              background: `rgba(${healthRgb},0.07)`,
              boxShadow: `0 0 28px rgba(${healthRgb},0.22)`,
            }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 30, fontWeight: 700, color: healthColor, lineHeight: 1,
              }}>
                {insights.health_score}
              </div>
              <div style={{
                fontSize: 9, color: healthColor, opacity: 0.65,
                letterSpacing: '0.5px', textTransform: 'uppercase', marginTop: 3,
              }}>
                /100
              </div>
            </div>

            {/* Summary text */}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#f0f4ff' }}>
                  Campaign Health
                </span>
                <span style={{
                  padding: '3px 12px', borderRadius: 20,
                  fontSize: 12, fontWeight: 600,
                  color: healthColor,
                  background: `rgba(${healthRgb},0.12)`,
                  border: `1px solid rgba(${healthRgb},0.3)`,
                }}>
                  {insights.health_label}
                </span>
              </div>
              <div style={{ fontSize: 14, color: '#c4cee0', lineHeight: 1.75 }}>
                {insights.summary}
              </div>
            </div>
          </div>

          {/* Analysis sections grid */}
          {insights.sections?.length > 0 && (
            <>
              <div style={{
                fontSize: 10, color: '#4a5568',
                textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14,
              }}>
                Detailed Analysis
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
                marginBottom: 32,
              }}>
                {insights.sections.map(section => {
                  const st = SENTIMENT_STYLE[section.sentiment] || SENTIMENT_STYLE.neutral
                  return (
                    <div key={section.id} style={{
                      background: 'rgba(255,255,255,0.025)',
                      border: `1px solid ${st.border}`,
                      borderRadius: 12,
                      padding: '20px 22px',
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'border-color 0.2s, transform 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
                    >
                      {/* Accent top bar */}
                      <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                        background: `linear-gradient(90deg, transparent, ${st.color}, transparent)`,
                        opacity: 0.55,
                      }} />

                      {/* Title + metric */}
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'flex-start', gap: 12, marginBottom: 12,
                      }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4ff', lineHeight: 1.4 }}>
                          {section.title}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{
                            fontFamily: 'JetBrains Mono, monospace',
                            fontSize: 22, fontWeight: 700, color: st.color, lineHeight: 1,
                          }}>
                            {section.metric}
                          </div>
                          <div style={{
                            fontSize: 10, color: '#8892a4', marginTop: 3,
                            textTransform: 'uppercase', letterSpacing: '0.4px',
                          }}>
                            {section.metric_label}
                          </div>
                        </div>
                      </div>

                      <div style={{ fontSize: 13, color: '#8892a4', lineHeight: 1.7 }}>
                        {section.content}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Recommendations */}
          {insights.recommendations?.length > 0 && (
            <>
              <div style={{
                fontSize: 10, color: '#4a5568',
                textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 14,
              }}>
                Recommendations
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {insights.recommendations.map((rec, i) => {
                  const pr = PRIORITY_STYLE[rec.priority] || PRIORITY_STYLE.medium
                  return (
                    <div key={i} style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 10,
                      padding: '16px 20px',
                      display: 'flex',
                      gap: 16,
                      alignItems: 'flex-start',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.035)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                    >
                      {/* Priority badge */}
                      <div style={{
                        padding: '3px 9px', borderRadius: 4,
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
                        color: pr.color, background: pr.bg, border: `1px solid ${pr.border}`,
                        flexShrink: 0, marginTop: 2,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        {pr.label}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#f0f4ff', marginBottom: 5 }}>
                          {rec.title}
                        </div>
                        <div style={{ fontSize: 13, color: '#8892a4', lineHeight: 1.7 }}>
                          {rec.detail}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* Footer */}
          <div style={{
            marginTop: 32, paddingTop: 16,
            borderTop: '1px solid rgba(255,255,255,0.05)',
            fontSize: 11, color: '#4a5568',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>Generated by Claude Sonnet · Every metric sourced from live campaign data</span>
            {generatedAt && (
              <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {generatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                {generatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
