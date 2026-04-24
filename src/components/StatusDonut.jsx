import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

const SEGMENTS = [
  { key: 'activated', label: 'Activated', color: '#00e5a0' },
  { key: 'pending',   label: 'Pending',   color: '#ffb700' },
  { key: 'returned',  label: 'Returned',  color: '#ff4757' },
]

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const { name, value, payload: p } = payload[0]
  return (
    <div style={{
      background: 'rgba(10,10,20,0.95)',
      border: '1px solid rgba(0,212,255,0.2)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
    }}>
      <div style={{ color: p.fill, fontWeight: 600, marginBottom: 4 }}>{name}</div>
      <div style={{ color: '#f0f4ff', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
        {value.toLocaleString()} customers
      </div>
    </div>
  )
}

export default function StatusDonut({ summary }) {
  const total = summary.total_outreached || 1

  const pieData = SEGMENTS.map(s => ({
    name:  s.label,
    value: summary[s.key] ?? 0,
    color: s.color,
  })).filter(d => d.value > 0)

  return (
    <div>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={72}
            paddingAngle={3}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            stroke="none"
          >
            {pieData.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>

      <div className="donut-legend">
        {SEGMENTS.map(s => {
          const val = summary[s.key] ?? 0
          const pct = ((val / total) * 100).toFixed(1)
          return (
            <div key={s.key} className="legend-item">
              <div className="legend-dot" style={{ background: s.color }} />
              <div className="legend-label">{s.label}</div>
              <div className="legend-val">{val.toLocaleString()}</div>
              <div className="legend-pct">{pct}%</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
