import { useEffect, useRef, useState } from 'react'

const COLORS = ['#00d4ff', '#8b5cf6', '#00e5a0']

function useAnimated(ready) {
  const [animate, setAnimate] = useState(false)
  useEffect(() => {
    if (ready) {
      const t = setTimeout(() => setAnimate(true), 100)
      return () => clearTimeout(t)
    }
  }, [ready])
  return animate
}

export default function FunnelViz({ funnel, onDrillDown }) {
  const animate = useAnimated(!!funnel?.length)

  if (!funnel?.length) return null

  const maxVal = funnel[0]?.value || 1

  return (
    <div className="funnel-stages">
      {funnel.map((stage, i) => {
        const pct = (stage.value / maxVal) * 100
        const dropPct = i > 0
          ? (((funnel[i-1].value - stage.value) / funnel[i-1].value) * 100).toFixed(1)
          : null

        return (
          <div key={stage.stage}>
            {/* Arrow connector between stages */}
            {i > 0 && (
              <div className="funnel-arrow" style={{ margin: '4px 0' }}>
                <div className="funnel-arrow-line" />
                <span style={{ color: '#4a5568', fontSize: 10 }}>↓ -{dropPct}%</span>
                <div className="funnel-arrow-line" />
              </div>
            )}

            <div
              className="funnel-stage"
              onClick={() => onDrillDown?.(stage.stage)}
              style={{ cursor: onDrillDown ? 'pointer' : 'default' }}
            >
              <div className="funnel-stage-label">
                <span className="funnel-stage-name">{stage.stage}</span>
                <span
                  className="funnel-stage-count"
                  style={{ color: COLORS[i], fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {stage.value.toLocaleString()}
                </span>
              </div>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar-fill"
                  style={{
                    width: animate ? `${pct}%` : '0%',
                    background: `linear-gradient(90deg, ${COLORS[i]}cc, ${COLORS[i]})`,
                    boxShadow: `0 0 8px ${COLORS[i]}60`,
                  }}
                />
              </div>
              <div className="funnel-pct" style={{ color: COLORS[i] + '99' }}>
                {stage.pct}% of total outreached
              </div>
            </div>
          </div>
        )
      })}

      {/* Conversion summary box */}
      <div style={{
        marginTop: 16,
        padding: '12px 16px',
        background: 'rgba(0,229,160,0.06)',
        border: '1px solid rgba(0,229,160,0.18)',
        borderRadius: 8,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ fontSize: 11, color: '#8892a4', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
          Overall Conversion
        </span>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 20,
          fontWeight: 700,
          color: '#00e5a0',
          textShadow: '0 0 16px rgba(0,229,160,0.5)',
        }}>
          {funnel[funnel.length - 1]?.pct ?? 0}%
        </span>
      </div>
    </div>
  )
}
