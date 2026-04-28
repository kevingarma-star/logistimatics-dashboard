import { useState, useEffect } from 'react'
import KPICard from './components/KPICard'
import StatusDonut from './components/StatusDonut'
import TimelineChart from './components/TimelineChart'
import FunnelViz from './components/FunnelViz'
import CohortTable from './components/CohortTable'
import SendGridPanel from './components/SendGridPanel'
import DateRangePicker from './components/DateRangePicker'
import useFilteredData from './useFilteredData'

function App() {
  const [rawData, setRawData]     = useState(null)
  const [error, setError]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [rangeStart, setStart]    = useState(null)
  const [rangeEnd,   setEnd]      = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)

  const loadData = (isInitial = false) => {
    if (!isInitial) setRefreshing(true)
    fetch(`${import.meta.env.BASE_URL}data.json?t=${Date.now()}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => {
        setRawData(prev => {
          if (isInitial) {
            const dates = [...d.cohorts.map(c => c.batch_date)].sort()
            if (dates.length) { setStart(dates[0]); setEnd(dates[dates.length - 1]) }
          }
          return d
        })
        setLastRefresh(new Date())
        if (isInitial) setLoading(false)
        else setRefreshing(false)
      })
      .catch(e => {
        if (isInitial) { setError(e.message); setLoading(false) }
        else setRefreshing(false)
      })
  }

  useEffect(() => {
    loadData(true)
    // Poll every 30 minutes — matches watch.py default interval
    const POLL_MS = 30 * 60 * 1000
    const timer = setInterval(() => loadData(false), POLL_MS)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const data = useFilteredData(rawData, rangeStart, rangeEnd)

  // Date bounds from raw data
  const allDates  = rawData?.cohorts?.map(c => c.batch_date).sort() ?? []
  const minDate   = allDates[0]  ?? ''
  const maxDate   = allDates[allDates.length - 1] ?? ''
  const isFiltered = rangeStart !== minDate || rangeEnd !== maxDate

  if (loading) return (
    <div className="state-center">
      <div className="spinner" />
      <span style={{ fontSize: 13 }}>Loading dashboard data…</span>
    </div>
  )

  if (error || !data) return (
    <div className="state-center">
      <div className="error-box">
        <h3>No data found</h3>
        <p>Run the data generator first:<br /><br /><code>python generate_data.py</code></p>
      </div>
    </div>
  )

  const s  = data.summary
  const sg = data.sendgrid_summary || {}

  const generatedAt = rawData?.generated_at
    ? new Date(rawData.generated_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'Unknown'

  return (
    <>
      {/* ── Watermark ── */}
      <div className="watermark">
        <img src={`${import.meta.env.BASE_URL}LGMX LOGO.jpg`} alt="" />
        <span>Logistimatics</span>
      </div>
      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <img className="header-logo" src={`${import.meta.env.BASE_URL}LGMX LOGO.jpg`} alt="Logistimatics" />
          <div>
            <div className="header-title">Logistimatics</div>
            <div className="header-sub">Activation Campaign Dashboard</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <DateRangePicker
            minDate={minDate}
            maxDate={maxDate}
            start={rangeStart}
            end={rangeEnd}
            onChange={(s, e) => { setStart(s); setEnd(e) }}
          />
          {/* Manual refresh button */}
          <button
            onClick={() => loadData(false)}
            disabled={refreshing}
            title="Refresh data now"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36,
              background: refreshing ? 'rgba(0,212,255,0.25)' : 'rgba(0,212,255,0.12)',
              border: '1px solid rgba(0,212,255,0.6)',
              borderRadius: 8, cursor: refreshing ? 'default' : 'pointer',
              fontSize: 18, transition: 'all 0.15s',
              animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
              color: '#7ef6ff',
              textShadow: '0 0 10px #00d4ff',
              boxShadow: '0 0 8px rgba(0,212,255,0.25)',
            }}
          >
            ↻
          </button>
          <div className="header-meta" style={{ textAlign: 'right' }}>
            <div className="header-badge">Auto-refresh 30m</div>
            <div style={{ fontSize: 11, color: '#4a5568' }}>
              {lastRefresh
                ? `Fetched ${lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                : `Data from ${generatedAt}`}
            </div>
          </div>
        </div>
      </header>

      {/* ── Filter badge ── */}
      {isFiltered && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'rgba(0,212,255,0.07)',
          border: '1px solid rgba(0,212,255,0.2)',
          borderRadius: 20, padding: '4px 12px', marginBottom: 20,
          fontSize: 12, color: '#00d4ff',
        }}>
          <span>Filtered:</span>
          <strong style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            {rangeStart} → {rangeEnd}
          </strong>
          <span style={{ color: '#4a5568', margin: '0 2px' }}>·</span>
          <span>{data.cohorts.length} batch{data.cohorts.length !== 1 ? 'es' : ''}</span>
          <button
            onClick={() => { setStart(minDate); setEnd(maxDate) }}
            style={{
              background: 'rgba(255,71,87,0.12)', border: '1px solid rgba(255,71,87,0.25)',
              borderRadius: 4, padding: '1px 8px', color: '#ff4757',
              fontSize: 10, cursor: 'pointer', fontFamily: 'Inter, sans-serif', marginLeft: 4,
            }}
          >
            ✕ clear
          </button>
        </div>
      )}

      {/* ── Campaign KPIs ── */}
      <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
        Campaign Performance
      </div>
      <div className="kpi-grid">
        <KPICard label="Total Outreached" value={s.total_outreached} icon="📡" accent="cyan"   sub="Unique customers contacted" />
        <KPICard label="Activated"        value={s.activated}        icon="✅" accent="green"  sub={`${s.activation_rate}% conversion rate`} trend={`${s.activation_rate}%`} trendColor="green" />
        <KPICard label="Follow-ups Sent"  value={s.followup_sent}    icon="📩" accent="purple" sub={`${s.followup_conversion_rate}% of follow-ups converted`} />
        <KPICard label="Pending"          value={s.pending}          icon="⏳" accent="amber"  sub="Awaiting activation" />
        <KPICard label="Returned"         value={s.returned}         icon="↩"  accent="red"    sub="Device returned" />
      </div>

      {/* ── Email Health KPIs ── */}
      {sg.avg_open_rate !== undefined && (
        <>
          <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10, marginTop: 24 }}>
            Email Health · Campaign Emails
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <KPICard label="Avg Open Rate"     value={sg.avg_open_rate}     suffix="%" icon="👁"  accent="cyan"   sub="Unique opens / delivered" />
            <KPICard label="Avg Delivery Rate" value={sg.avg_delivery_rate} suffix="%" icon="📬" accent="green"  sub="Delivered / total requests" />
            <KPICard label="Avg Click Rate"    value={sg.avg_click_rate}    suffix="%" icon="🖱"  accent="purple" sub="Unique clicks / delivered" />
            <KPICard label="Avg Bounce Rate"   value={sg.avg_bounce_rate}   suffix="%" icon="⚠"  accent="red"    sub="Bounces / total requests" />
          </div>
        </>
      )}

      {/* ── Timeline + Donut ── */}
      <div style={{ marginTop: 24 }} />
      <div className="charts-row charts-row-2-1">
        <div className="panel">
          <div className="panel-title">Campaign Timeline</div>
          <div className="panel-sub">Emails sent per date</div>
          <TimelineChart data={data.timeline} />
        </div>
        <div className="panel">
          <div className="panel-title">Status Breakdown</div>
          <div className="panel-sub">Selected period</div>
          <StatusDonut summary={s} />
        </div>
      </div>

      {/* ── SendGrid engagement ── */}
      {rawData?.sendgrid_stats?.length > 0 && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-title">Email Engagement Trends</div>
          <div className="panel-sub">Open rate & delivery rate · Activation + follow-up emails · Activity Feed</div>
          <SendGridPanel sgStats={data.sendgrid_stats} sgSummary={sg} />
        </div>
      )}

      {/* ── Funnel + Cohort Table ── */}
      <div className="charts-row charts-row-1-2">
        <div className="panel">
          <div className="panel-title">Activation Funnel</div>
          <div className="panel-sub">Outreach → Follow-up → Conversion</div>
          <FunnelViz funnel={data.funnel} />
        </div>
        <div className="panel">
          <div className="panel-title">Cohort Performance</div>
          <div className="panel-sub">Breakdown by email batch date</div>
          <CohortTable cohorts={data.cohorts} />
        </div>
      </div>
    </>
  )
}

export default App
