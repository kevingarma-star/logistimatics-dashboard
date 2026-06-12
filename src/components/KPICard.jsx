import { useEffect, useRef, useState } from 'react'

const ACCENT = {
  cyan:   { color: '#00d4ff', dim: 'rgba(0,212,255,0.15)' },
  green:  { color: '#00e5a0', dim: 'rgba(0,229,160,0.15)' },
  purple: { color: '#8b5cf6', dim: 'rgba(139,92,246,0.15)' },
  amber:  { color: '#ffb700', dim: 'rgba(255,183,0,0.15)' },
  red:    { color: '#ff4757', dim: 'rgba(255,71,87,0.15)' },
}

// isFloat: if true, animate with 1 decimal place
function useCountUp(target, duration = 1200, isFloat = false) {
  const [display, setDisplay] = useState(0)
  const raf = useRef(null)

  useEffect(() => {
    const start = performance.now()
    const step = (now) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const ease = 1 - Math.pow(1 - progress, 3)
      const raw = target * ease
      setDisplay(isFloat ? Math.round(raw * 10) / 10 : Math.round(raw))
      if (progress < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [target, duration, isFloat])

  return display
}

export default function KPICard({ label, value, icon, accent = 'cyan', sub, trend, trendColor, suffix = '', onClick, active = false }) {
  const ac = ACCENT[accent] || ACCENT.cyan
  const isFloat = !Number.isInteger(value)
  const displayed = useCountUp(value, 1200, isFloat)
  const formatted = isFloat
    ? displayed.toFixed(displayed % 1 === 0 ? 1 : 1)
    : displayed.toLocaleString()

  return (
    <div
      className="kpi-card"
      style={{
        '--accent-color': ac.color,
        '--accent-dim': ac.dim,
        cursor: onClick ? 'pointer' : 'default',
        ...(active ? { boxShadow: `0 0 0 1.5px ${ac.color}80, 0 0 14px ${ac.color}20` } : {}),
      }}
      onClick={onClick}
      title={onClick ? `Click to drill down into ${label}` : undefined}
    >
      <div className="kpi-card-icon" style={{ background: ac.dim }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>

      {trend && (
        <div
          className="kpi-card-trend"
          style={{
            color: ACCENT[trendColor]?.color || ac.color,
            background: ACCENT[trendColor]?.dim || ac.dim,
          }}
        >
          {trend}
        </div>
      )}

      <div className="kpi-card-label">{label}</div>
      <div
        className="kpi-card-value"
        style={{
          color: ac.color,
          textShadow: `0 0 20px ${ac.color}60`,
        }}
      >
        {formatted}{suffix}
      </div>
      {sub && <div className="kpi-card-sub">{sub}</div>}
    </div>
  )
}
