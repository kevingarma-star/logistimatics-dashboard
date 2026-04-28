export default function CohortTable({ cohorts, onDrillDown }) {
  if (!cohorts?.length) return (
    <div style={{ color: '#4a5568', fontSize: 13, paddingTop: 20, textAlign: 'center' }}>
      No cohort data
    </div>
  )

  return (
    <div className="cohort-table-wrap">
      <table className="cohort-table">
        <thead>
          <tr>
            <th>Batch Date</th>
            <th>Sent</th>
            <th>Activated</th>
            <th>Pending</th>
            <th>Returned</th>
            <th>Follow-up</th>
            <th>Conv. Rate</th>
          </tr>
        </thead>
        <tbody>
          {cohorts.map(c => (
            <tr
              key={c.batch_date}
              onClick={() => onDrillDown?.(c.batch_date)}
              style={{ cursor: onDrillDown ? 'pointer' : 'default' }}
              onMouseEnter={e => { if (onDrillDown) e.currentTarget.style.background = 'rgba(0,212,255,0.04)' }}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <td>
                <span className="mono" style={{ color: '#00d4ff', fontSize: 12 }}>
                  {c.label}
                </span>
              </td>
              <td className="mono">{c.total}</td>
              <td>
                <span className="badge badge-green">{c.activated}</span>
              </td>
              <td>
                <span className="badge badge-amber">{c.pending}</span>
              </td>
              <td>
                {c.returned > 0
                  ? <span className="badge badge-red">{c.returned}</span>
                  : <span style={{ color: '#4a5568' }}>—</span>
                }
              </td>
              <td className="mono" style={{ color: '#8b5cf6' }}>
                {c.followup_sent}
              </td>
              <td>
                <div className="rate-bar">
                  <div className="rate-bar-track">
                    <div
                      className="rate-bar-fill"
                      style={{
                        width: `${Math.min(c.activation_rate, 100)}%`,
                        background: c.activation_rate >= 30
                          ? 'linear-gradient(90deg, #00e5a0cc, #00e5a0)'
                          : c.activation_rate >= 10
                          ? 'linear-gradient(90deg, #ffb700cc, #ffb700)'
                          : 'linear-gradient(90deg, #ff4757cc, #ff4757)',
                      }}
                    />
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      minWidth: 36,
                      textAlign: 'right',
                      color: c.activation_rate >= 30 ? '#00e5a0'
                           : c.activation_rate >= 10 ? '#ffb700'
                           : '#ff4757',
                    }}
                  >
                    {c.activation_rate}%
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
