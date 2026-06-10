import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

const PeriodTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,10,20,0.95)',
      border: '1px solid rgba(255,71,87,0.25)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
    }}>
      <div style={{ color: '#8892a4', marginBottom: 6 }}>{label}</div>
      <div style={{ color: '#ff4757', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
        {payload[0].value} return{payload[0].value !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

export default function ReturnTrendChart({ weeklyData, monthlyData }) {
  const [mode, setMode] = useState('weekly')
  const chartData = mode === 'weekly' ? weeklyData : monthlyData
  const dataKey  = mode === 'weekly' ? 'week' : 'month'

  return (
    <div className="panel" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <div className="panel-title">Returns by Period</div>
          <div className="panel-sub">Devices returned per {mode === 'weekly' ? 'week' : 'month'} · SmartLabel excluded</div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {[{ key: 'weekly', label: 'Weekly' }, { key: 'monthly', label: 'Monthly' }].map(opt => (
            <button
              key={opt.key}
              onClick={() => setMode(opt.key)}
              style={{
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: mode === opt.key ? 600 : 400,
                background: mode === opt.key ? 'rgba(255,71,87,0.12)' : 'transparent',
                border: mode === opt.key
                  ? '1px solid rgba(255,71,87,0.35)'
                  : '1px solid rgba(255,255,255,0.07)',
                borderRadius: 6,
                color: mode === opt.key ? '#ff4757' : '#8892a4',
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (mode !== opt.key) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)' }}
              onMouseLeave={e => { if (mode !== opt.key) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey={dataKey}
            tick={{ fill: '#8892a4', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#8892a4', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<PeriodTooltip />} cursor={{ fill: 'rgba(255,71,87,0.05)' }} />
          <Bar
            dataKey="count"
            name="Returns"
            fill="#ff4757"
            fillOpacity={0.8}
            radius={[4, 4, 0, 0]}
            maxBarSize={52}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
