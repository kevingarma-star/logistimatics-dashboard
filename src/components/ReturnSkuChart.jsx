import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'

const SKU_COLORS = ['#00d4ff', '#8b5cf6', '#ff4757', '#ffa502', '#2ed573', '#ff6b81']

const SkuTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,10,20,0.95)',
      border: '1px solid rgba(0,212,255,0.2)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
    }}>
      <div style={{ color: '#8892a4', marginBottom: 6 }}>{label}</div>
      <div style={{ color: '#00d4ff', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
        {payload[0].value} return{payload[0].value !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

export default function ReturnSkuChart({ data, onDrillDown, drillFilter }) {
  if (!data?.length) return null
  const isFiltered = drillFilter?.type === 'device'
  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div className="panel-title">Returns by Product</div>
      <div className="panel-sub">All {data.reduce((s, d) => s + d.count, 0)} returns · includes undeliverable</div>
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 32, left: 4, bottom: 0 }}
          style={{ cursor: onDrillDown ? 'pointer' : 'default' }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: '#8892a4', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="device"
            width={140}
            tick={{ fill: '#c8d0dc', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<SkuTooltip />} cursor={{ fill: 'rgba(0,212,255,0.04)' }} />
          <Bar
            dataKey="count"
            radius={[0, 4, 4, 0]}
            maxBarSize={32}
            onClick={onDrillDown ? (barData) => onDrillDown({ type: 'device', value: barData.device, label: barData.device }) : undefined}
          >
            {data.map((entry, i) => {
              const isActive = isFiltered && drillFilter.value === entry.device
              return (
                <Cell
                  key={i}
                  fill={SKU_COLORS[i % SKU_COLORS.length]}
                  fillOpacity={isFiltered ? (isActive ? 0.95 : 0.2) : 0.85}
                />
              )
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
