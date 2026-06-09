import { useState, useEffect, useCallback } from 'react'
import KPICard from './components/KPICard'
import StatusDonut from './components/StatusDonut'
import TimelineChart from './components/TimelineChart'
import FunnelViz from './components/FunnelViz'
import CohortTable from './components/CohortTable'
import SendGridPanel from './components/SendGridPanel'
import EmailCampaignBreakdown from './components/EmailCampaignBreakdown'
import DateRangePicker from './components/DateRangePicker'
import DrillDownModal from './components/DrillDownModal'
import SurveyPanel from './components/SurveyPanel'
import InsightsPage from './components/InsightsPage'
import ActivationTimingPage from './components/ActivationTimingPage'
import WeekOverWeekChart from './components/WeekOverWeekChart'
import useFilteredData from './useFilteredData'

function App() {
  const [rawData, setRawData]     = useState(null)
  const [error, setError]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [rangeStart, setStart]    = useState(null)
  const [rangeEnd,   setEnd]      = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [drill, setDrill]     = useState(null) // { title, subtitle, customers }
  const [tab, setTab]         = useState('dashboard')
  const [section, setSection] = useState('activation')

  // Insights state (lifted so it survives tab switches)
  const [insights, setInsights]             = useState(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError]   = useState(null)
  const [insightsAt, setInsightsAt]         = useState(null)

  // Fetch data.json. In dev mode read from local public/. In production, try the
  // GitHub API first (60s CDN cache, fresh data). If rate-limited (403) fall back
  // to the GitHub Pages URL (up to 10-min cache but always works).
  const GH_API_URL  = 'https://api.github.com/repos/kevingarma-star/logistimatics-dashboard/contents/data.json?ref=gh-pages'
  const GH_PAGES_URL = 'https://kevingarma-star.github.io/logistimatics-dashboard/data.json'
  const fetchData = (bust = false) => {
    if (import.meta.env.DEV) {
      const url = `${import.meta.env.BASE_URL}data.json${bust ? `?_=${Date.now()}` : ''}`
      return fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    }
    const apiUrl = bust ? `${GH_API_URL}&_=${Date.now()}` : GH_API_URL
    return fetch(apiUrl, { headers: { Accept: 'application/vnd.github.v3.raw' } })
      .then(r => {
        if (r.status === 403 || r.status === 429) {
          // Rate-limited — fall back to GitHub Pages CDN (may be up to 10 min stale)
          return fetch(`${GH_PAGES_URL}${bust ? `?_=${Date.now()}` : ''}`)
            .then(r2 => { if (!r2.ok) throw new Error(`HTTP ${r2.status}`); return r2.json() })
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
  }

  const loadData = (isInitial = false, bust = false) => {
    if (!isInitial) setRefreshing(true)
    fetchData(bust)
      .then(d => {
        const dates = [...d.cohorts.map(c => c.batch_date)].sort()
        if (isInitial) {
          if (dates.length) { setStart(dates[0]); setEnd(dates[dates.length - 1]) }
        } else {
          // Expand the range if new cohorts appeared beyond the current window
          if (dates.length) {
            setStart(prev => (!prev || dates[0] < prev) ? dates[0] : prev)
            setEnd(prev   => (!prev || dates[dates.length - 1] > prev) ? dates[dates.length - 1] : prev)
          }
        }
        setRawData(d)
        setLastRefresh(new Date())
        if (isInitial) setLoading(false)
        else setRefreshing(false)
      })
      .catch(e => {
        if (isInitial) { setError(e.message); setLoading(false) }
        else setRefreshing(false)
      })
  }

  const hardRefresh = () => {
    // Always re-fetch data.json with a cache-busting timestamp so the browser
    // never returns a stale cached response. Also poke the local server (best-effort).
    loadData(false, true)
    fetch('http://localhost:8765/refresh', { method: 'POST' }).catch(() => {})
  }

  const INSIGHTS_ENDPOINT = (import.meta.env.VITE_AI_ENDPOINT || 'http://localhost:8765') + '/insights'

  const generateInsights = useCallback((focus) => {
    if (!rawData) return
    setInsightsLoading(true)
    setInsightsError(null)
    fetch(INSIGHTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: rawData, focus: focus || null }),
    })
      .then(res => res.json().then(json => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (!ok) throw new Error(json.error || `Server error`)
        setInsights(json)
        setInsightsAt(new Date())
      })
      .catch(err => setInsightsError(err.message))
      .finally(() => setInsightsLoading(false))
  }, [rawData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate insights the first time the user opens that tab
  useEffect(() => {
    if (tab === 'insights' && !insights && !insightsLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      generateInsights()
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData(true)
    // Poll every 5 minutes — well within GitHub API rate limit (60 req/hr unauthenticated).
    // Manual refresh button (↻) triggers an immediate bust fetch for real-time updates.
    const POLL_MS = 5 * 60 * 1000
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

  const s        = data.summary
  const sg       = data.sendgrid_summary || {}
  const all      = data.customers || []
  const surveySummary   = rawData?.survey_summary   ?? {}
  const surveyResponses = rawData?.survey_responses ?? rawData?.survey_summary?.recent ?? []

  // ── Drill-down helpers ────────────────────────────────────────────────────
  const openDrill = (title, subtitle, customers, showSgCols = false) =>
    setDrill({ title, subtitle, customers, showSgCols })

  const drillStatus = status => openDrill(
    status,
    `Customers with status: ${status}`,
    all.filter(c => c.status === status)
  )
  const drillAll = () => openDrill(
    'All Outreached',
    'Every customer in the current date range',
    all
  )
  const drillCohort = batchDate => openDrill(
    `Batch — ${batchDate}`,
    `Customers whose activation email was sent on ${batchDate}`,
    all.filter(c => c.sent_date === batchDate)
  )
  const drillSg = (label, filterFn, subtitle) =>
    openDrill(label, subtitle, all.filter(filterFn), true)

  const drillFunnel = stage => {
    const map = {
      'Outreached':     [all, 'All customers outreached'],
      'Follow-up Sent': [all.filter(c => c.fu_sent), 'Customers who received a follow-up'],
      'Activated':      [all.filter(c => c.status === 'Activated'), 'Customers who activated'],
    }
    const [customers, subtitle] = map[stage] || [all, stage]
    openDrill(stage, subtitle, customers)
  }

  const generatedAt = rawData?.generated_at
    ? new Date(rawData.generated_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : 'Unknown'

  return (
    <>
      {/* ── Header — full width ── */}
      <header className="header">
        <div className="header-brand">
          <img className="header-logo" src={`${import.meta.env.BASE_URL}lgmx-bolt.png`} alt="Logistimatics" />
          <div>
            <div className="header-title">Logistimatics</div>
            <div className="header-sub">
              {section === 'activation' && 'Activation Dashboard'}
              {section === 'return'     && 'Return Dashboard'}
              {section === 'churn'      && 'Churn Dashboard'}
            </div>
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
            onClick={hardRefresh}
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
            <div className="header-badge">Auto-refresh 5m</div>
            <div style={{ fontSize: 11, color: '#4a5568' }}>
              {lastRefresh
                ? `Fetched ${lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                : `Data from ${generatedAt}`}
            </div>
          </div>
        </div>
      </header>

      {/* ── Section nav ── */}
      <div style={{
        display: 'flex', gap: 6, marginBottom: 24,
        padding: '6px 8px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 12,
        width: 'fit-content',
      }}>
        {[
          { key: 'activation', label: 'Activation Dashboard', icon: '◉' },
          { key: 'return',     label: 'Return Dashboard',     icon: '↩' },
          { key: 'churn',      label: 'Churn Dashboard',      icon: '⚠' },
        ].map(sec => (
          <button
            key={sec.key}
            onClick={() => setSection(sec.key)}
            style={{
              padding: '9px 22px',
              fontSize: 13,
              fontWeight: section === sec.key ? 600 : 400,
              background: section === sec.key
                ? 'linear-gradient(135deg, rgba(0,212,255,0.15), rgba(0,212,255,0.07))'
                : 'transparent',
              border: section === sec.key
                ? '1px solid rgba(0,212,255,0.35)'
                : '1px solid transparent',
              borderRadius: 8,
              color: section === sec.key ? '#00d4ff' : '#8892a4',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', gap: 7,
            }}
            onMouseEnter={e => { if (section !== sec.key) e.currentTarget.style.color = '#c0cad8' }}
            onMouseLeave={e => { if (section !== sec.key) e.currentTarget.style.color = '#8892a4' }}
          >
            <span style={{ fontSize: 14 }}>{sec.icon}</span>
            {sec.label}
          </button>
        ))}
      </div>

      {/* ── Return Dashboard ── */}
      {section === 'return' && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 12 }}>
          <div style={{ fontSize: 36 }}>↩</div>
          <div className="panel-title" style={{ fontSize: 18 }}>Return Dashboard</div>
          <div className="panel-sub" style={{ textAlign: 'center', maxWidth: 400 }}>
            Coming soon — analysis of returned devices, return rates, and customer patterns.
          </div>
        </div>
      )}

      {/* ── Churn Dashboard ── */}
      {section === 'churn' && (
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 12 }}>
          <div style={{ fontSize: 36 }}>⚠</div>
          <div className="panel-title" style={{ fontSize: 18 }}>Churn Dashboard</div>
          <div className="panel-sub" style={{ textAlign: 'center', maxWidth: 400 }}>
            Coming soon — churn signals, at-risk customers, and retention metrics.
          </div>
        </div>
      )}

      {/* ── Activation Dashboard ── */}
      {section === 'activation' && <>

      {/* ── Tab toggle ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28 }}>
        {[
          { key: 'dashboard', label: '◧ Dashboard' },
          { key: 'timing',    label: '⏱ Activation Timing' },
          { key: 'insights',  label: '✦ AI Insights' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: tab === t.key ? 600 : 400,
              background: tab === t.key ? 'rgba(0,212,255,0.1)' : 'transparent',
              border: tab === t.key
                ? '1px solid rgba(0,212,255,0.35)'
                : '1px solid rgba(255,255,255,0.07)',
              borderRadius: 8,
              color: tab === t.key ? '#00d4ff' : '#8892a4',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (tab !== t.key) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)' }}
            onMouseLeave={e => { if (tab !== t.key) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Activation Timing tab ── */}
      {tab === 'timing' && (
        <ActivationTimingPage rawData={data} onDrill={openDrill} />
      )}

      {/* ── Insights tab ── */}
      {tab === 'insights' && (
        <InsightsPage
          insights={insights}
          loading={insightsLoading}
          error={insightsError}
          generatedAt={insightsAt}
          onGenerate={generateInsights}
        />
      )}

      {/* ── Dashboard body ── */}
      {tab === 'dashboard' && <div>

          {/* Filter badge */}
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

          {/* Campaign KPIs */}
          <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
            Campaign Overview
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <KPICard label="Total Outreached" value={s.total_outreached} icon="📡" accent="cyan"   sub="Unique customers contacted" onClick={drillAll} />
            <KPICard label="Activated"        value={s.activated}        icon="✅" accent="green"  sub={`${s.activation_rate}% conversion rate`} trend={`${s.activation_rate}%`} trendColor="green" onClick={() => drillStatus('Activated')} />
            <KPICard label="Pending"          value={s.pending}          icon="⏳" accent="amber"  sub="Awaiting activation" onClick={() => drillStatus('Pending')} />
            <KPICard label="Returned"         value={s.returned}         icon="↩"  accent="red"    sub="Device returned" onClick={() => drillStatus('Returned')} />
          </div>

          {/* Per-email breakdown */}
          <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10, marginTop: 24 }}>
            Email Campaigns
          </div>
          <EmailCampaignBreakdown customers={all} summary={s} onDrill={openDrill} inTransitCustomers={data.in_transit_customers ?? []} />

          {/* Email Health KPIs */}
          {sg.has_campaign_data && (
            <>
              <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10, marginTop: 24 }}>
                Email Health · Campaign Emails
              </div>
              <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <KPICard label="Open Rate"     value={sg.avg_open_rate}     suffix="%" icon="👁"  accent="cyan"   sub={`${sg.total_opens} unique opens · ${sg.total_delivered} delivered`}   onClick={() => drillSg('Opened Emails',    c => c.sg_opened === true,    'Customers who opened at least one campaign email')} />
                <KPICard label="Delivery Rate" value={sg.avg_delivery_rate} suffix="%" icon="📬" accent="green"  sub={`${sg.total_delivered} / ${sg.total_requests} sent`}                   onClick={() => drillSg('Delivered Emails', c => c.sg_delivered === true, 'Customers whose email was successfully delivered')} />
                <KPICard label="Click Rate"    value={sg.avg_click_rate}    suffix="%" icon="🖱"  accent="purple" sub={`${sg.total_clicks} unique clicks · ${sg.total_delivered} delivered`}  onClick={() => drillSg('Clicked Emails',   c => c.sg_clicked === true,   'Customers who clicked a link in a campaign email')} />
                <KPICard label="Bounce Rate"   value={sg.avg_bounce_rate}   suffix="%" icon="⚠"  accent="red"    sub={`${sg.total_bounces} bounces · ${sg.total_requests} sent`}             onClick={() => drillSg('Bounced Emails',   c => c.sg_bounced === true,   'Customers whose email bounced or was blocked')} />
              </div>
              {/* Tracking coverage notice */}
              <div style={{
                marginTop: 10,
                padding: '8px 14px',
                background: 'rgba(255,183,0,0.05)',
                border: '1px solid rgba(255,183,0,0.18)',
                borderRadius: 6,
                fontSize: 11,
                color: '#8892a4',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}>
                <span style={{ color: '#ffb700', fontWeight: 600 }}>Coverage — </span>
                Rates based on per-customer email events ·{' '}
                <span style={{ color: '#f0f4ff', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                  {sg.total_requests} of {s.total_outreached} customers tracked
                </span>{' '}
                ({sg.period_start} → {sg.period_end}).
                {s.total_outreached > sg.total_requests && (
                  <span>
                    {' '}{s.total_outreached - sg.total_requests} customers have no email event data yet.
                  </span>
                )}
              </div>
            </>
          )}

          {/* Timeline + Donut */}
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
              <StatusDonut summary={s} onDrillDown={drillStatus} />
            </div>
          </div>

          {/* Week-over-week activations */}
          <div className="panel" style={{ marginTop: 20 }}>
            <div className="panel-title">Campaign Activations — Week over Week</div>
            <div className="panel-sub">Sat–Fri weeks · campaign-driven only (excludes uncontacted customers) · stacked by email touch</div>
            <WeekOverWeekChart customers={all} inTransitCustomers={data.in_transit_customers ?? []} />
          </div>

          {/* SendGrid engagement */}
          {rawData?.sendgrid_stats?.length > 0 && (
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-title">Email Engagement Trends</div>
              <div className="panel-sub">Open rate & delivery rate · Activation + follow-up emails · Activity Feed</div>
              <SendGridPanel sgStats={data.sendgrid_stats} sgSummary={sg} />
            </div>
          )}

          {/* Funnel + Cohort Table */}
          <div className="charts-row charts-row-1-2">
            <div className="panel">
              <div className="panel-title">Activation Funnel</div>
              <div className="panel-sub">Outreach → Follow-up → Conversion</div>
              <FunnelViz funnel={data.funnel} onDrillDown={drillFunnel} />
            </div>
            <div className="panel">
              <div className="panel-title">Batch Performance</div>
              <div className="panel-sub">Breakdown by email batch date</div>
              <CohortTable cohorts={data.cohorts} onDrillDown={drillCohort} />
            </div>
          </div>

          {/* Survey Insights */}
          <div className="panel" style={{ marginTop: 20, marginBottom: 0 }}>
            <div className="panel-title">Survey Insights</div>
            <div className="panel-sub">Why aren't customers activating? · ≥30 days post-ship, still pending</div>
            <SurveyPanel surveySummary={surveySummary} surveyResponses={surveyResponses} />
          </div>

      </div>}
      {/* /Dashboard tab body */}

      </>}
      {/* /Activation Dashboard section */}

      {/* ── Drill-down modal — rendered outside layout so it overlays everything ── */}
      {drill && (
        <DrillDownModal
          title={drill.title}
          subtitle={drill.subtitle}
          customers={drill.customers}
          showSgCols={drill.showSgCols}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  )
}

export default App
