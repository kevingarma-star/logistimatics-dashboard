import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Area,
} from 'recharts'

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,10,20,0.95)',
      border: '1px solid rgba(0,212,255,0.2)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      minWidth: 180,
    }}>
      <div style={{ color: '#8892a4', marginBottom: 8, fontWeight: 600 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{
          display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4,
        }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: '#f0f4ff' }}>
            {p.name.includes('Rate') || p.name.includes('%')
              ? `${p.value}%`
              : p.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}

const CustomLegend = ({ payload }) => (
  <div style={{ display: 'flex', gap: 20, justifyContent: 'flex-end', paddingRight: 8, marginTop: -4 }}>
    {payload.map(p => (
      <div key={p.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8892a4' }}>
        <div style={{ width: 8, height: 8, borderRadius: 2, background: p.color }} />
        {p.value}
      </div>
    ))}
  </div>
)

function SgKPI({ label, value, color, suffix = '' }) {
  return (
    <div style={{
      flex: 1,
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${color}22`,
      borderRadius: 8,
      padding: '14px 16px',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 24,
        fontWeight: 700,
        color,
        textShadow: `0 0 16px ${color}60`,
      }}>
        {value}{suffix}
      </div>
    </div>
  )
}

// Empty state shown before first tagged send
function AwaitingData() {
  return (
    <div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '32px 20px',
        background: 'rgba(139,92,246,0.04)',
        borderRadius: 8,
        border: '1px dashed rgba(139,92,246,0.25)',
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 28 }}>📊</div>
        <div style={{ color: '#c4b5fd', fontWeight: 600, fontSize: 14 }}>
          Campaign tracking enabled
        </div>
        <div style={{ color: '#8892a4', fontSize: 12, textAlign: 'center', maxWidth: 380, lineHeight: 1.7 }}>
          Open rate, click rate, and delivery stats for activation emails will appear here
          after the next campaign run. Category tags have been added to all future sends.
        </div>
        <div style={{
          display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center',
        }}>
          {['activation-email', 'followup-email'].map(tag => (
            <span key={tag} style={{
              background: 'rgba(139,92,246,0.15)',
              border: '1px solid rgba(139,92,246,0.3)',
              borderRadius: 4,
              padding: '3px 10px',
              fontSize: 11,
              color: '#c4b5fd',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <div style={{
        padding: '10px 14px',
        background: 'rgba(0,212,255,0.04)',
        border: '1px solid rgba(0,212,255,0.12)',
        borderRadius: 6,
        fontSize: 11,
        color: '#8892a4',
        lineHeight: 1.6,
      }}>
        <span style={{ color: '#00d4ff', fontWeight: 600 }}>How it works — </span>
        SendGrid's{' '}
        <code style={{ background: 'rgba(0,212,255,0.1)', padding: '1px 5px', borderRadius: 3, color: '#7dd3fc', fontSize: 10 }}>
          /v3/categories/stats
        </code>{' '}
        API returns per-category engagement broken down by date. Future sends tagged
        with <code style={{ background: 'rgba(0,212,255,0.1)', padding: '1px 5px', borderRadius: 3, color: '#7dd3fc', fontSize: 10 }}>activation-email</code> or{' '}
        <code style={{ background: 'rgba(0,212,255,0.1)', padding: '1px 5px', borderRadius: 3, color: '#7dd3fc', fontSize: 10 }}>followup-email</code> will appear here automatically.
      </div>
    </div>
  )
}

export default function SendGridPanel({ sgStats, sgSummary }) {
  const hasCampaignData = sgSummary?.has_campaign_data

  if (!hasCampaignData) {
    return <AwaitingData />
  }

  const chartData = sgStats.map(d => ({
    label:           d.date.slice(5),
    'Open Rate':     d.open_rate,
    'Click Rate':    d.click_rate,
    'Delivery Rate': d.delivery_rate,
    'Sent':          d.requests,
  }))

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <SgKPI label="Avg Open Rate"     value={sgSummary.avg_open_rate}     suffix="%" color="#00d4ff" />
        <SgKPI label="Avg Click Rate"    value={sgSummary.avg_click_rate}    suffix="%" color="#8b5cf6" />
        <SgKPI label="Avg Delivery Rate" value={sgSummary.avg_delivery_rate} suffix="%" color="#00e5a0" />
        <SgKPI label="Avg Bounce Rate"   value={sgSummary.avg_bounce_rate}   suffix="%" color="#ff4757" />
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="label"
            tick={{ fill: '#8892a4', fontSize: 10 }}
            axisLine={false} tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="pct"
            tick={{ fill: '#8892a4', fontSize: 10 }}
            axisLine={false} tickLine={false}
            domain={[0, 100]}
            tickFormatter={v => `${v}%`}
          />
          <YAxis
            yAxisId="count"
            orientation="right"
            tick={{ fill: '#8892a4', fontSize: 10 }}
            axisLine={false} tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Legend content={<CustomLegend />} />
          <Bar
            yAxisId="count"
            dataKey="Sent"
            fill="rgba(139,92,246,0.25)"
            stroke="#8b5cf6"
            strokeWidth={1}
            radius={[2, 2, 0, 0]}
            maxBarSize={20}
          />
          <Area
            yAxisId="pct"
            type="monotone"
            dataKey="Delivery Rate"
            fill="rgba(0,229,160,0.06)"
            stroke="#00e5a0"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="Open Rate"
            stroke="#00d4ff"
            strokeWidth={2}
            dot={false}
            strokeDasharray="4 2"
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="Click Rate"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{
        marginTop: 14,
        padding: '8px 12px',
        background: 'rgba(0,229,160,0.05)',
        border: '1px solid rgba(0,229,160,0.15)',
        borderRadius: 6,
        fontSize: 11,
        color: '#8892a4',
      }}>
        <span style={{ color: '#00e5a0', fontWeight: 600 }}>Live — </span>
        {sgSummary.data_note}
      </div>
    </div>
  )
}
