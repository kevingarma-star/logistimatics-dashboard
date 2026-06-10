import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts'
import { REASON_CONFIG } from '../lib/returnReasons'

const REASON_BY_KEY = Object.fromEntries(REASON_CONFIG.map(r => [r.key, r]))

const ReasonTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const nonZero = payload.filter(p => p.value > 0)
  const total   = nonZero.reduce((s, p) => s + p.value, 0)
  return (
    <div style={{
      background: 'rgba(10,10,20,0.95)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      minWidth: 180,
    }}>
      <div style={{ color: '#8892a4', marginBottom: 8 }}>{label}</div>
      {nonZero.map(p => (
        <div key={p.dataKey} style={{
          display: 'flex', justifyContent: 'space-between', gap: 16,
          marginBottom: 3, alignItems: 'center',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#c8d0dc' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: 'inline-block', flexShrink: 0 }} />
            {p.name}
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: p.fill }}>
            {p.value}
          </span>
        </div>
      ))}
      {nonZero.length > 1 && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          marginTop: 6, paddingTop: 6,
          display: 'flex', justifyContent: 'space-between', gap: 16,
          color: '#f0f4ff',
        }}>
          <span>Total</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{total}</span>
        </div>
      )}
    </div>
  )
}

const ReasonLegend = ({ payload }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 14px', marginTop: 8, justifyContent: 'center' }}>
    {(payload || []).map(entry => (
      <div key={entry.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#8892a4' }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, display: 'inline-block' }} />
        {entry.value}
      </div>
    ))}
  </div>
)

// ── Top reasons (horizontal bar, one bar per category) ──────────────────────
function TopReasonsChart({ data }) {
  if (!data?.length) return (
    <div style={{ color: '#4a5568', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
      No categorised returns yet
    </div>
  )
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 40, left: 4, bottom: 0 }}
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
          dataKey="label"
          width={160}
          tick={{ fill: '#c8d0dc', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div style={{
                background: 'rgba(10,10,20,0.95)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 14px', fontSize: 12,
              }}>
                <div style={{ color: '#8892a4', marginBottom: 6 }}>{label}</div>
                <div style={{ color: payload[0].fill, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                  {payload[0].value} return{payload[0].value !== 1 ? 's' : ''}
                </div>
              </div>
            )
          }}
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {data.map(entry => (
            <Cell key={entry.key} fill={REASON_BY_KEY[entry.key]?.color || '#64748b'} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Reason trends by month (stacked bar) ────────────────────────────────────
function ReasonTrendsChart({ data }) {
  if (!data?.length) return null
  const activeKeys = REASON_CONFIG.filter(r => data.some(d => (d[r.key] || 0) > 0))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="month" tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<ReasonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend content={<ReasonLegend />} />
        {activeKeys.map((r, i) => (
          <Bar
            key={r.key}
            dataKey={r.key}
            name={r.label}
            stackId="r"
            fill={r.color}
            fillOpacity={0.85}
            radius={i === activeKeys.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
            maxBarSize={52}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Reason % by product (stacked horizontal bar) ────────────────────────────
function ReasonByProductChart({ data }) {
  if (!data?.length) return null
  const activeKeys = REASON_CONFIG.filter(r => data.some(d => (d[r.key] || 0) > 0))
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 52)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
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
        <Tooltip content={<ReasonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend content={<ReasonLegend />} />
        {activeKeys.map((r, i) => (
          <Bar
            key={r.key}
            dataKey={r.key}
            name={r.label}
            stackId="r"
            fill={r.color}
            fillOpacity={0.85}
            radius={i === activeKeys.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
            maxBarSize={32}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────
export default function ReturnReasonCharts({ topData, byMonthData, byProductData }) {
  const hasAny = topData?.length || byMonthData?.length || byProductData?.length
  if (!hasAny) return null

  return (
    <div>
      {/* Top reasons */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-title">Top Return Reasons</div>
        <div className="panel-sub">Categorised returns only · excludes undeliverable</div>
        <div style={{ marginTop: 16 }}>
          <TopReasonsChart data={topData} />
        </div>
      </div>

      {/* Side-by-side: trends + by product */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        {byMonthData?.length > 0 && (
          <div className="panel">
            <div className="panel-title">Reason Trends by Month</div>
            <div className="panel-sub">Are certain reasons rising over time?</div>
            <div style={{ marginTop: 12 }}>
              <ReasonTrendsChart data={byMonthData} />
            </div>
          </div>
        )}
        {byProductData?.length > 0 && (
          <div className="panel">
            <div className="panel-title">Reason by Product</div>
            <div className="panel-sub">Which devices drive which return reasons?</div>
            <div style={{ marginTop: 12 }}>
              <ReasonByProductChart data={byProductData} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
