import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'

// Week starts Saturday. Returns the Saturday date string (YYYY-MM-DD) for a given date.
function getWeekSaturday(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.getUTCDay() // 0=Sun, 6=Sat
  const offset = (day + 1) % 7 // Sat→0, Sun→1, Mon→2 … Fri→6
  const sat = new Date(d)
  sat.setUTCDate(d.getUTCDate() - offset)
  return sat.toISOString().slice(0, 10)
}

function formatWeekLabel(satStr) {
  const d = new Date(satStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function formatWeekRange(satStr) {
  const sat = new Date(satStr + 'T12:00:00Z')
  const fri = new Date(sat)
  fri.setUTCDate(sat.getUTCDate() + 6)
  const opts = { month: 'short', day: 'numeric', timeZone: 'UTC' }
  return `${sat.toLocaleDateString('en-US', opts)} – ${fri.toLocaleDateString('en-US', opts)}`
}

const TOUCH_CONFIG = [
  { key: 'T0', label: 'In-Transit',       color: '#f59e0b' },
  { key: 'T1', label: 'Activation Email', color: '#00d4ff' },
  { key: 'T2', label: 'Follow-up 1',      color: '#8b5cf6' },
  { key: 'T3', label: 'Follow-up 2',      color: '#10b981' },
]

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
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
      {payload.map(p => p.value > 0 && (
        <div key={p.name} style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          color: p.fill, marginBottom: 4,
        }}>
          <span>{p.name}</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: '#f0f4ff' }}>
            {p.value}
          </span>
        </div>
      ))}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        marginTop: 6, paddingTop: 6,
        display: 'flex', justifyContent: 'space-between',
        color: '#f0f4ff', fontWeight: 700,
      }}>
        <span>Total</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{total}</span>
      </div>
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

export default function WeekOverWeekChart({ customers }) {
  // Campaign-driven activations only: must have activation_date and a touch attribution
  const activated = (customers || []).filter(
    c => c.status === 'Activated' && c.activation_date && c.activated_after_touch
  )

  if (!activated.length) {
    return (
      <div style={{ color: '#4a5568', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
        No campaign-driven activations yet
      </div>
    )
  }

  // Build a map: weekSat → { T0, T1, T2, T3 }
  const weekMap = {}
  activated.forEach(c => {
    const sat = getWeekSaturday(c.activation_date)
    if (!weekMap[sat]) weekMap[sat] = { T0: 0, T1: 0, T2: 0, T3: 0 }
    const t = c.activated_after_touch
    if (weekMap[sat][t] !== undefined) weekMap[sat][t]++
  })

  const chartData = Object.keys(weekMap)
    .sort()
    .map(sat => ({
      week: formatWeekRange(sat),
      label: formatWeekLabel(sat),
      ...weekMap[sat],
    }))

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#8892a4', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis
          tick={{ fill: '#8892a4', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend content={<CustomLegend />} />
        {TOUCH_CONFIG.map(({ key, label, color }) => (
          <Bar
            key={key}
            dataKey={key}
            name={label}
            stackId="a"
            fill={color}
            fillOpacity={0.85}
            radius={key === 'T3' ? [3, 3, 0, 0] : [0, 0, 0, 0]}
            maxBarSize={40}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
