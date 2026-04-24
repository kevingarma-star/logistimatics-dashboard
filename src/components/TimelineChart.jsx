import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
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
      minWidth: 140,
    }}>
      <div style={{ color: '#8892a4', marginBottom: 8, fontWeight: 600 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          color: p.color, marginBottom: 4,
        }}>
          <span>{p.name}</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: '#f0f4ff' }}>
            {p.value}
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

export default function TimelineChart({ data }) {
  if (!data?.length) return <div style={{ color: '#4a5568', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>No timeline data</div>

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barGap={3}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#8892a4', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: '#8892a4', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend content={<CustomLegend />} />
        <Bar
          dataKey="activation"
          name="Activation"
          fill="#00d4ff"
          radius={[3, 3, 0, 0]}
          maxBarSize={28}
          fillOpacity={0.85}
        />
        <Bar
          dataKey="followup"
          name="Follow-up"
          fill="#8b5cf6"
          radius={[3, 3, 0, 0]}
          maxBarSize={28}
          fillOpacity={0.85}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
