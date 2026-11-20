import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import KPICard from './KPICard'
import InsightsPage from './InsightsPage'
import DateRangePicker from './DateRangePicker'
import { supabase } from '../lib/supabaseClient'

// ── Constants ─────────────────────────────────────────────────────────────────

const CAT_COLORS = {
  'Voluntary (customer)':      '#00d4ff',
  'Voluntary (via GPX staff)': '#8b5cf6',
  'Involuntary (non-payment)': '#ff4757',
  'Operational (GPX staff)':   '#ffb700',
}


const POLL_MS = 5 * 60 * 1000

// cancel_mode → cancel_category (applied client-side when category is missing)
const MODE_TO_CATEGORY = {
  'customer cancellation':        'Voluntary (customer)',
  'other user cancellation':      'Voluntary (customer)',
  'gpx admin cancellation':       'Voluntary (via GPX staff)',
  'non-payment':                  'Involuntary (non-payment)',
  'ops bulk update':              'Operational (GPX staff)',
  'device unassigned (archived)': 'Operational (GPX staff)',
  'account data deleted':         'Operational (GPX staff)',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(yyyyMm) {
  if (!yyyyMm) return ''
  const [y, m] = yyyyMm.split('-')
  return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function fmtMrr(v) {
  if (!v && v !== 0) return '—'
  return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(n, d) {
  if (!d) return '—'
  return `${Math.round((n / d) * 100)}%`
}

function daysLeft(termEndAt) {
  if (!termEndAt) return null
  return Math.ceil((new Date(termEndAt) - Date.now()) / 86400000)
}

function categoryOf(row) {
  if (row.cancel_category) return row.cancel_category
  const mode = (row.cancel_mode || '').toLowerCase()
  return MODE_TO_CATEGORY[mode] || 'Operational (GPX staff)'
}

function tenureBucket(months) {
  const m = Number(months) || 0
  if (m < 1)   return '<1 mo'
  if (m < 3)   return '1–3 mo'
  if (m < 6)   return '3–6 mo'
  if (m < 12)  return '6–12 mo'
  if (m < 24)  return '12–24 mo'
  return '24+ mo'
}

const TENURE_ORDER = ['<1 mo', '1–3 mo', '3–6 mo', '6–12 mo', '12–24 mo', '24+ mo']

// ── Supabase fetch (paginated) ────────────────────────────────────────────────

async function fetchAll(table, select = '*', order = null) {
  const PAGE = 1000
  let all = []
  let from = 0
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1)
    if (order) q = q.order(order, { ascending: false })
    const { data, error } = await q
    if (error) throw error
    all = [...all, ...(data || [])]
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#0e0e1a',
      border: '1px solid rgba(0,212,255,0.2)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      fontFamily: 'Inter, sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      minWidth: 140,
    }}>
      {label && <div style={{ color: '#8892a4', marginBottom: 6, fontSize: 11 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.fill, flexShrink: 0 }} />
          <span style={{ color: '#8892a4', flex: 1 }}>{p.name}</span>
          <span style={{ color: p.color || p.fill, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
            {formatter ? formatter(p.value, p.name) : (p.value ?? 0).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Small segment bar chart ───────────────────────────────────────────────────

function SegmentChart({ title, data, nameKey, color = '#00d4ff' }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 220 }}>
      <div className="panel-title">{title}</div>
      <div className="panel-sub">Cancelled · count</div>
      {data.length === 0
        ? <div style={{ color: '#4a5568', fontSize: 12, paddingTop: 16 }}>No data</div>
        : (
          <ResponsiveContainer width="100%" height={Math.max(140, data.length * 28)}>
            <BarChart layout="vertical" data={data} margin={{ left: 0, right: 32, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#4a5568', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey={nameKey} width={100} tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="count" fill={color} radius={[0, 3, 3, 0]} label={{ position: 'right', fill: '#4a5568', fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        )
      }
    </div>
  )
}

// ── Initiator card ────────────────────────────────────────────────────────────

function InitiatorCard({ label, count, total, mrr, winbackPct, color, dim }) {
  const pct = total ? Math.round((count / total) * 100) : 0
  return (
    <div className="kpi-card" style={{ '--accent-color': color, '--accent-dim': dim }}>
      <div className="kpi-card-label">{label}</div>
      <div className="kpi-card-value" style={{ color, textShadow: `0 0 20px ${color}60` }}>
        {count.toLocaleString()}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#8892a4' }}><span style={{ color }}>{pct}%</span> of total</span>
        <span style={{ fontSize: 11, color: '#8892a4' }}>MRR lost: <span style={{ color: '#f0f4ff', fontFamily: 'JetBrains Mono, monospace' }}>{fmtMrr(mrr)}</span></span>
        <span style={{ fontSize: 11, color: '#8892a4' }}>Win-back: <span style={{ color: '#00e5a0', fontFamily: 'JetBrains Mono, monospace' }}>{winbackPct}</span></span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ChurnDashboard() {
  const [cancellations, setCancellations] = useState([])
  const [insights, setInsights]           = useState([])
  const [loading, setLoading]             = useState(true)
  const [tablesMissing, setTablesMissing] = useState(false)
  const [error, setError]                 = useState(null)
  const [refreshing, setRefreshing]       = useState(false)
  const [lastRefresh, setLastRefresh]     = useState(null)
  const [rangeStart, setStart]            = useState(null)
  const [rangeEnd, setEnd]                = useState(null)
  const [tab, setTab]                     = useState('analytics')
  const [pendingSearch, setPendingSearch] = useState('')

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async (isInitial = false) => {
    if (!isInitial) setRefreshing(true)
    try {
      const [cRows, iRows] = await Promise.all([
        fetchAll('subscription_cancellations', '*', 'initiated_at'),
        fetchAll('cancellation_conversation_insights',
          'id,cancellation_id,subscription_id,account_id,customer_email,conversation_url,intercom_conversation_id,reason_category,save_attempted,save_offer,saved,sentiment,initiated_by_staff,staff_member_name,requested_by_customer,conversation_created_at'),
      ])
      setCancellations(cRows)
      setInsights(iRows)
      setLastRefresh(new Date())
      if (isInitial) {
        setLoading(false)
        // Default date range: all time
        const dates = cRows.map(c => (c.initiated_at || '').slice(0, 10)).filter(Boolean).sort()
        if (dates.length) { setStart(dates[0]); setEnd(dates[dates.length - 1]) }
      } else {
        setRefreshing(false)
      }
    } catch (err) {
      const msg = err?.message || String(err)
      if (msg.includes('relation') || msg.includes('does not exist') || msg.includes('42P01')) {
        setTablesMissing(true)
      } else {
        setError(msg)
      }
      if (isInitial) setLoading(false)
      else setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData(true)
    const timer = setInterval(() => loadData(false), POLL_MS)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Date bounds ─────────────────────────────────────────────────────────────

  const { minDate, maxDate } = useMemo(() => {
    const dates = cancellations.map(c => (c.initiated_at || '').slice(0, 10)).filter(Boolean).sort()
    return { minDate: dates[0] || '', maxDate: dates[dates.length - 1] || '' }
  }, [cancellations])

  // ── Date-filtered cancellations ─────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!cancellations.length) return []
    return cancellations.filter(c => {
      const d = (c.initiated_at || '').slice(0, 10)
      if (rangeStart && d < rangeStart) return false
      if (rangeEnd   && d > rangeEnd)   return false
      return true
    })
  }, [cancellations, rangeStart, rangeEnd])

  // ── Enrich with insights (client-side join) ──────────────────────────────────

  const enriched = useMemo(() => {
    if (!filtered.length) return []
    const insightByCid  = new Map(insights.filter(i => i.cancellation_id).map(i => [i.cancellation_id, i]))
    const insightBySid  = new Map(insights.filter(i => i.subscription_id && !i.cancellation_id).map(i => [i.subscription_id, i]))
    return filtered.map(c => {
      const ins = insightByCid.get(c.cancellation_id)
        || (c.subscription_id ? insightBySid.get(c.subscription_id) : null)
        || insights.find(i =>
            !i.cancellation_id && !i.subscription_id
            && (i.account_id === c.account_id || i.customer_email === c.primary_contact_email)
            && i.conversation_created_at
            && Math.abs(new Date(i.conversation_created_at) - new Date(c.initiated_at)) <= 14 * 86400000
          )
        || null
      return {
        ...c,
        cancel_category: categoryOf(c),
        reason:      ins?.reason_category || 'Unknown',
        staff_name:  c.initiated_by_name || ins?.staff_member_name || (c.cancel_category === 'Voluntary (via GPX staff)' ? 'Kevin Garma' : 'Unattributed'),
        conversation_url: ins?.conversation_url || null,
        save_attempted: ins?.save_attempted ?? null,
        save_offer:     ins?.save_offer || null,
        saved:          ins?.saved ?? null,
        sentiment:      ins?.sentiment || null,
        insight:        ins,
      }
    })
  }, [filtered, insights])

  // ── KPIs ─────────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const cancelled  = enriched.filter(c => c.outcome === 'Cancelled')
    const pending    = enriched.filter(c => c.outcome === 'Pending')
    const withdrawn  = enriched.filter(c => c.outcome === 'Withdrawn')
    const total      = enriched.length

    const mrrLost    = cancelled.reduce((s, c) => s + (Number(c.mrr_at_cancel_usd) || 0), 0)
    const pendingOverdue = pending.filter(c => c.pending_overdue).length
    const winbacks   = cancelled.filter(c => c.recovery && c.recovery.trim()).length

    return {
      cancelledCount:  cancelled.length,
      mrrLost,
      pendingCount:    pending.length,
      pendingOverdue,
      savedCount:      withdrawn.length,
      savedPct:        total ? Math.round((withdrawn.length / total) * 100) : 0,
      winbackCount:    winbacks,
      winbackRate:     cancelled.length ? Math.round((winbacks / cancelled.length) * 100) : 0,
      total,
    }
  }, [enriched])

  // ── Who initiated (4 cards) ──────────────────────────────────────────────────

  const initiatorData = useMemo(() => {
    const cats = [
      { key: 'Voluntary (customer)',      label: 'Customer self-serve',           color: '#00d4ff', dim: 'rgba(0,212,255,0.15)' },
      { key: 'Voluntary (via GPX staff)', label: 'Team on behalf of customer',    color: '#8b5cf6', dim: 'rgba(139,92,246,0.15)' },
      { key: 'Involuntary (non-payment)', label: 'Non-payment (system)',           color: '#ff4757', dim: 'rgba(255,71,87,0.15)' },
      { key: 'Operational (GPX staff)',   label: 'Operational (staff)',            color: '#ffb700', dim: 'rgba(255,183,0,0.15)' },
    ]
    const cancelled = enriched.filter(c => c.outcome === 'Cancelled')
    const total     = enriched.length
    return cats.map(cat => {
      const rows    = cancelled.filter(c => c.cancel_category === cat.key)
      const mrr     = rows.reduce((s, c) => s + (Number(c.mrr_at_cancel_usd) || 0), 0)
      const winback = rows.filter(c => c.recovery && c.recovery.trim()).length
      return {
        ...cat,
        count:      rows.length,
        total,
        mrr,
        winbackPct: fmtPct(winback, rows.length),
      }
    })
  }, [enriched])

  // ── Monthly stacked bar + MRR line ──────────────────────────────────────────

  const monthlyStackData = useMemo(() => {
    const map = {}
    enriched.filter(c => c.outcome === 'Cancelled').forEach(c => {
      const month = (c.initiated_at || '').slice(0, 7)
      if (!month) return
      if (!map[month]) map[month] = { month, monthLabel: fmtMonth(month), mrrLost: 0 }
      const cat = c.cancel_category || 'Unknown'
      map[month][cat] = (map[month][cat] || 0) + 1
      map[month].mrrLost += Number(c.mrr_at_cancel_usd) || 0
    })
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  }, [enriched])

  // ── Team-initiated table ─────────────────────────────────────────────────────

  const staffTableData = useMemo(() => {
    const teamRows = enriched.filter(c =>
      c.cancel_category === 'Voluntary (via GPX staff)' && c.outcome === 'Cancelled'
    )
    const unmatched = teamRows.filter(c => !c.insight).length
    const byStaff = {}
    teamRows.forEach(c => {
      const name = c.staff_name || 'Unattributed'
      if (!byStaff[name]) byStaff[name] = { name, count: 0, mrr: 0, saveAttempted: 0, saved: 0, reasons: {} }
      byStaff[name].count++
      byStaff[name].mrr += Number(c.mrr_at_cancel_usd) || 0
      if (c.save_attempted) byStaff[name].saveAttempted++
      if (c.saved) byStaff[name].saved++
      if (c.reason !== 'Unknown') byStaff[name].reasons[c.reason] = (byStaff[name].reasons[c.reason] || 0) + 1
    })
    const rows = Object.values(byStaff)
      .map(r => ({
        ...r,
        topReason: Object.entries(r.reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
        saveAttemptedPct: fmtPct(r.saveAttempted, r.count),
        savedPct: fmtPct(r.saved, r.count),
      }))
      .sort((a, b) => {
        if (a.name === 'Unattributed') return 1
        if (b.name === 'Unattributed') return -1
        return b.count - a.count
      })
    return { rows, unmatched, total: teamRows.length }
  }, [enriched])

  // ── Why customers cancel (from insights) ─────────────────────────────────────

  const reasonData = useMemo(() => {
    const voluntary = enriched.filter(c =>
      c.outcome === 'Cancelled' &&
      (c.cancel_category === 'Voluntary (customer)' || c.cancel_category === 'Voluntary (via GPX staff)')
    )
    const withInsight = voluntary.filter(c => c.insight)
    const byReason = {}
    voluntary.forEach(c => {
      const r = c.reason !== 'Unknown' ? c.reason : null
      if (!r) return
      if (!byReason[r]) byReason[r] = { reason: r, selfServe: 0, teamHelped: 0 }
      if (c.cancel_category === 'Voluntary (customer)') byReason[r].selfServe++
      else byReason[r].teamHelped++
    })
    const rows = Object.values(byReason)
      .map(r => ({ ...r, total: r.selfServe + r.teamHelped }))
      .sort((a, b) => b.total - a.total)
    return { rows, voluntaryCount: voluntary.length, matchedCount: withInsight.length }
  }, [enriched])

  // ── Retention / save ─────────────────────────────────────────────────────────

  const saveData = useMemo(() => {
    const withInsight = enriched.filter(c => c.insight)
    const attempted   = withInsight.filter(c => c.save_attempted)
    const saved       = withInsight.filter(c => c.saved)
    const byOffer = {}
    attempted.forEach(c => {
      const offer = c.save_offer || 'Unspecified'
      if (!byOffer[offer]) byOffer[offer] = { offer, attempted: 0, saved: 0 }
      byOffer[offer].attempted++
      if (c.saved) byOffer[offer].saved++
    })
    const offers = Object.values(byOffer).sort((a, b) => b.attempted - a.attempted)
    return {
      withInsight: withInsight.length,
      attempted: attempted.length,
      saved: saved.length,
      attemptedPct: fmtPct(attempted.length, withInsight.length),
      savedPct: fmtPct(saved.length, attempted.length),
      offers,
    }
  }, [enriched])

  // ── Churn by segment ─────────────────────────────────────────────────────────

  const segmentData = useMemo(() => {
    const cancelled = enriched.filter(c => c.outcome === 'Cancelled')
    if (!cancelled.length) return { device: [], channel: [], plan: [], tenure: [] }

    // device_model top 8 + Other
    const deviceMap = {}
    cancelled.forEach(c => {
      const k = c.device_model || 'Unknown'
      deviceMap[k] = (deviceMap[k] || 0) + 1
    })
    const deviceSorted = Object.entries(deviceMap).sort((a, b) => b[1] - a[1])
    const TOP = 8
    const topDevices = deviceSorted.slice(0, TOP).map(([name, count]) => ({ name, count }))
    const otherCount = deviceSorted.slice(TOP).reduce((s, [, c]) => s + c, 0)
    if (otherCount) topDevices.push({ name: 'Other', count: otherCount })

    // purchase_channel
    const chanMap = {}
    cancelled.forEach(c => {
      const k = c.purchase_channel || 'Unknown'
      chanMap[k] = (chanMap[k] || 0) + 1
    })
    const channel = Object.entries(chanMap).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))

    // plan_months buckets
    const planMap = {}
    cancelled.forEach(c => {
      const m = Number(c.plan_months)
      const k = m >= 24 ? '24+ mo' : m >= 12 ? '12 mo' : m >= 6 ? '6 mo' : m >= 1 ? '1 mo' : 'Other'
      planMap[k] = (planMap[k] || 0) + 1
    })
    const planOrder = ['1 mo', '6 mo', '12 mo', '24+ mo', 'Other']
    const plan = planOrder.filter(k => planMap[k]).map(k => ({ name: k, count: planMap[k] }))

    // tenure bucket
    const tenureMap = {}
    cancelled.forEach(c => {
      const k = tenureBucket(c.sub_age_months)
      tenureMap[k] = (tenureMap[k] || 0) + 1
    })
    const tenure = TENURE_ORDER.filter(k => tenureMap[k]).map(k => ({ name: k, count: tenureMap[k] }))

    return { device: topDevices, channel, plan, tenure }
  }, [enriched])

  // ── Non-payment recovery ──────────────────────────────────────────────────────

  const nonPaymentData = useMemo(() => {
    const npRows = enriched.filter(c =>
      c.cancel_category === 'Involuntary (non-payment)' && c.outcome === 'Cancelled'
    )
    const byMonth = {}
    npRows.forEach(c => {
      const month = (c.initiated_at || '').slice(0, 7)
      if (!month) return
      if (!byMonth[month]) byMonth[month] = { month, monthLabel: fmtMonth(month), cancelled: 0, recovered: 0 }
      byMonth[month].cancelled++
      if (c.recovery && c.recovery.trim()) byMonth[month].recovered++
    })
    return Object.values(byMonth)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, recoveryPct: m.cancelled ? Math.round((m.recovered / m.cancelled) * 100) : 0 }))
  }, [enriched])

  // ── Pending table ─────────────────────────────────────────────────────────────

  const pendingRows = useMemo(() => {
    const q = pendingSearch.toLowerCase()
    return enriched
      .filter(c => c.outcome === 'Pending')
      .filter(c => !q || [c.account_title, c.primary_contact_name, c.primary_contact_email]
        .some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => {
        const ta = a.term_end_at || '9999'
        const tb = b.term_end_at || '9999'
        return ta < tb ? -1 : ta > tb ? 1 : 0
      })
  }, [enriched, pendingSearch])

  // ── Recent cancellations ──────────────────────────────────────────────────────

  const recentRows = useMemo(() =>
    [...enriched]
      .filter(c => c.outcome === 'Cancelled')
      .sort((a, b) => (b.initiated_at || '') < (a.initiated_at || '') ? -1 : 1)
      .slice(0, 100),
  [enriched])

  // ── CSV export ────────────────────────────────────────────────────────────────

  const exportPendingCsv = useCallback(() => {
    const cols = ['account_title', 'primary_contact_name', 'primary_contact_email',
                  'device_model', 'plan_months', 'mrr_at_cancel_usd', 'initiated_by',
                  'term_end_at', 'pending_overdue']
    const header = [...cols, 'days_left'].join(',')
    const lines  = pendingRows.map(r => [
      ...cols.map(c => JSON.stringify(r[c] ?? '')),
      daysLeft(r.term_end_at) ?? '',
    ].join(','))
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `pending-cancellations-${new Date().toISOString().slice(0, 10)}.csv`,
    })
    a.click()
    URL.revokeObjectURL(a.href)
  }, [pendingRows])

  // ── Loading / error states ────────────────────────────────────────────────────

  if (loading) return (
    <div className="state-center" style={{ minHeight: 200 }}>
      <div className="spinner" />
      <span style={{ fontSize: 13 }}>Loading churn data…</span>
    </div>
  )

  if (tablesMissing) return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 320, gap: 16 }}>
      <div style={{ fontSize: 36 }}>⚠</div>
      <div className="panel-title" style={{ fontSize: 18 }}>Churn tables not set up</div>
      <div className="panel-sub" style={{ textAlign: 'center', maxWidth: 480, lineHeight: 1.7 }}>
        Run the SQL migration first, then import your CSV export:
      </div>
      <pre style={{ background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.15)', borderRadius: 8, padding: '10px 16px', fontSize: 12, color: '#00d4ff', fontFamily: 'JetBrains Mono, monospace' }}>
        {`-- 1. Run migrations/001_churn_tables.sql in Supabase SQL editor\n-- 2. python upsert_cancellations.py path/to/export.csv`}
      </pre>
    </div>
  )

  if (error) return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: 12 }}>
      <div style={{ fontSize: 24 }}>⚠</div>
      <div style={{ color: '#ff4757', fontSize: 13 }}>{error}</div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div>

      {/* ── Tab toggle + refresh ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, alignItems: 'center' }}>
        {[
          { key: 'analytics', label: '◧ Analytics' },
          { key: 'insights',  label: '✦ AI Insights' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 20px', fontSize: 13,
            fontWeight: tab === t.key ? 600 : 400,
            background: tab === t.key ? 'rgba(0,212,255,0.1)' : 'transparent',
            border: tab === t.key ? '1px solid rgba(0,212,255,0.35)' : '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8,
            color: tab === t.key ? '#00d4ff' : '#8892a4',
            cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (tab !== t.key) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)' }}
          onMouseLeave={e => { if (tab !== t.key) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)' }}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {/* Date picker */}
        <DateRangePicker
          minDate={minDate}
          maxDate={maxDate}
          start={rangeStart}
          end={rangeEnd}
          onChange={(s, e) => { setStart(s); setEnd(e) }}
        />
        <button
          onClick={() => loadData(false)}
          disabled={refreshing}
          title="Refresh churn data"
          style={{
            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: refreshing ? 'rgba(0,212,255,0.25)' : 'rgba(0,212,255,0.12)',
            border: '1px solid rgba(0,212,255,0.25)', borderRadius: 8,
            cursor: refreshing ? 'default' : 'pointer', fontSize: 16, color: '#00d4ff',
            animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
          }}
        >↻</button>
        {lastRefresh && (
          <div style={{ fontSize: 11, color: '#4a5568' }}>
            Fetched {lastRefresh.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        <div style={{ fontSize: 10, color: '#4a5568', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '3px 8px' }}>
          Auto-refresh 5m
        </div>
      </div>

      {/* ── AI Insights tab (placeholder) ── */}
      {tab === 'insights' && (
        <InsightsPage
          insights={null}
          loading={false}
          error={null}
          generatedAt={null}
          onGenerate={() => {}}
          title="AI Churn Insights"
          subtitle="Automated analysis of cancellation patterns, save performance, and at-risk segments"
          loadingTitle="Analyzing churn data…"
          loadingSubtitle="Churn AI insights will be available once the automation endpoint is configured."
        />
      )}

      {/* ── Analytics tab ── */}
      {tab === 'analytics' && <>

        {/* Empty state if no data yet */}
        {enriched.length === 0 && (
          <div className="panel" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            <div className="panel-title">No cancellations in this date range</div>
            <div className="panel-sub" style={{ marginTop: 6 }}>
              {cancellations.length === 0
                ? 'Import data with: python upsert_cancellations.py path/to/export.csv'
                : 'Try widening the date range'}
            </div>
          </div>
        )}

        {enriched.length > 0 && <>

        {/* ═══ KPI ROW ═══ */}
        <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
          Churn Overview
        </div>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          <KPICard
            label="Cancellations"
            value={kpis.cancelledCount}
            icon="✕"
            accent="red"
            sub={`outcome = Cancelled`}
          />
          <KPICard
            label="Churn rate — needs active-sub data"
            value={0}
            icon="📉"
            accent="amber"
            sub="Provide subscriptions table for %"
          />
          <KPICard
            label="MRR Lost"
            value={Math.round(kpis.mrrLost)}
            icon="💸"
            accent="red"
            suffix=""
            sub={`$${kpis.mrrLost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          />
          <KPICard
            label="Pending"
            value={kpis.pendingCount}
            icon="⏳"
            accent="amber"
            sub={kpis.pendingOverdue ? `${kpis.pendingOverdue} overdue` : 'None overdue'}
          />
          <KPICard
            label="Saved"
            value={kpis.savedCount}
            icon="🛡"
            accent="green"
            sub={`${kpis.savedPct}% of all initiated`}
            trend={`${kpis.savedPct}%`}
            trendColor="green"
          />
          <KPICard
            label="Win-back Rate"
            value={kpis.winbackRate}
            icon="↩"
            accent="purple"
            suffix="%"
            sub={`${kpis.winbackCount} of ${kpis.cancelledCount} recovered`}
          />
        </div>

        {/* ═══ WHO INITIATED ═══ */}
        <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10, marginTop: 8 }}>
          Who initiated the cancellation
        </div>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
          {initiatorData.map(d => (
            <InitiatorCard key={d.key} {...d} />
          ))}
        </div>

        {/* Monthly stacked bar + MRR line */}
        {monthlyStackData.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-title">Monthly Cancellations by Category</div>
            <div className="panel-sub">Stacked by cancel category · MRR lost on right axis</div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={monthlyStackData} margin={{ top: 10, right: 48, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="monthLabel" tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#4a5568', fontSize: 10 }}
                  tickFormatter={v => `$${Math.round(v / 1000)}k`} axisLine={false} tickLine={false} />
                <Tooltip
                  content={<ChartTooltip formatter={(v, name) => name === 'MRR Lost ($)' ? fmtMrr(v) : v} />}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#8892a4', paddingTop: 8 }} />
                {Object.entries(CAT_COLORS).map(([cat, color]) => (
                  <Bar key={cat} yAxisId="left" dataKey={cat} stackId="a" fill={color} name={cat} />
                ))}
                <Line yAxisId="right" type="monotone" dataKey="mrrLost" stroke="#00e5a0"
                  dot={false} name="MRR Lost ($)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ═══ TEAM-INITIATED TABLE ═══ */}
        {staffTableData.rows.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-title">Team-Initiated Cancellations</div>
            <div className="panel-sub" style={{ marginBottom: 16 }}>
              GPX staff cancellations on behalf of customers ·{' '}
              {staffTableData.unmatched > 0 && (
                <span style={{ color: '#ffb700' }}>
                  {staffTableData.unmatched} of {staffTableData.total} not yet matched to an Intercom conversation
                </span>
              )}
            </div>
            <div className="cohort-table-wrap">
              <table className="cohort-table">
                <thead>
                  <tr>
                    <th>Staff member</th>
                    <th>Cancellations</th>
                    <th>MRR lost</th>
                    <th>Top reason</th>
                    <th>Save attempted</th>
                    <th>Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {staffTableData.rows.map(r => (
                    <tr key={r.name}>
                      <td style={{ color: r.name === 'Unattributed' ? '#4a5568' : '#f0f4ff', fontStyle: r.name === 'Unattributed' ? 'italic' : undefined }}>
                        {r.name}
                      </td>
                      <td><span className="mono" style={{ color: '#00d4ff' }}>{r.count}</span></td>
                      <td><span className="mono" style={{ color: '#8892a4' }}>{fmtMrr(r.mrr)}</span></td>
                      <td style={{ color: '#8892a4', fontSize: 12 }}>{r.topReason}</td>
                      <td><span className="mono" style={{ color: '#8892a4' }}>{r.saveAttemptedPct}</span></td>
                      <td><span className="mono" style={{ color: '#00e5a0' }}>{r.savedPct}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ WHY CUSTOMERS CANCEL ═══ */}
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-title">Why customers cancel</div>
          <div className="panel-sub">
            Voluntary cancellations only · sourced from helpdesk conversations ·{' '}
            {reasonData.matchedCount} of {reasonData.voluntaryCount} voluntary cancellations have a matched helpdesk conversation
          </div>
          {reasonData.rows.length === 0 ? (
            <div style={{ color: '#4a5568', fontSize: 13, paddingTop: 20, textAlign: 'center', lineHeight: 2 }}>
              Reasons will appear once the helpdesk automation starts writing to{' '}
              <code style={{ background: 'rgba(0,212,255,0.08)', padding: '2px 7px', borderRadius: 4, fontSize: 12, color: '#00d4ff' }}>
                cancellation_conversation_insights
              </code>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, reasonData.rows.length * 36)}>
              <BarChart layout="vertical" data={reasonData.rows} margin={{ left: 8, right: 48, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#4a5568', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="reason" width={190} tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#8892a4' }} />
                <Bar dataKey="selfServe" stackId="r" name="Customer self-serve" fill="#00d4ff"
                  label={{ position: 'right', fill: '#4a5568', fontSize: 10,
                    formatter: (v, _, i) => i === 0 ? reasonData.rows[i]?.total : '' }} />
                <Bar dataKey="teamHelped" stackId="r" name="Team on behalf" fill="#8b5cf6" radius={[0, 3, 3, 0]}
                  label={{ position: 'right', fill: '#4a5568', fontSize: 10,
                    formatter: (_, __, i) => reasonData.rows[i]?.total || '' }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ═══ RETENTION / SAVE ═══ */}
        {saveData.withInsight > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-title">Retention / save performance</div>
            <div className="panel-sub">From matched Intercom conversations only ({saveData.withInsight} cancellations)</div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
              {[
                { label: 'Save attempted', value: saveData.attemptedPct, sub: `${saveData.attempted} of ${saveData.withInsight}`, color: '#ffb700' },
                { label: 'Saved (retained)', value: saveData.savedPct, sub: `${saveData.saved} of ${saveData.attempted} who were offered a save`, color: '#00e5a0' },
              ].map(k => (
                <div key={k.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '14px 20px', minWidth: 160 }}>
                  <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 6 }}>{k.label}</div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 28, fontWeight: 600, color: k.color, lineHeight: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: '#4a5568', marginTop: 4 }}>{k.sub}</div>
                </div>
              ))}
            </div>
            {saveData.offers.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>By save offer</div>
                <div className="cohort-table-wrap">
                  <table className="cohort-table">
                    <thead><tr><th>Offer</th><th>Attempted</th><th>Saved</th><th>Success rate</th></tr></thead>
                    <tbody>
                      {saveData.offers.map(o => (
                        <tr key={o.offer}>
                          <td style={{ color: '#f0f4ff' }}>{o.offer}</td>
                          <td><span className="mono" style={{ color: '#8892a4' }}>{o.attempted}</span></td>
                          <td><span className="mono" style={{ color: '#00e5a0' }}>{o.saved}</span></td>
                          <td><span className="mono" style={{ color: '#ffb700' }}>{fmtPct(o.saved, o.attempted)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ CHURN BY SEGMENT ═══ */}
        <div style={{ fontSize: 10, color: '#4a5568', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: 10 }}>
          Churn by segment · cancelled only
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <SegmentChart title="Device model" data={segmentData.device} nameKey="name" color="#00d4ff" />
          <SegmentChart title="Purchase channel" data={segmentData.channel} nameKey="name" color="#8b5cf6" />
          <SegmentChart title="Plan length" data={segmentData.plan} nameKey="name" color="#ffb700" />
          <SegmentChart title="Tenure at cancel" data={segmentData.tenure} nameKey="name" color="#00e5a0" />
        </div>

        {/* ═══ NON-PAYMENT RECOVERY ═══ */}
        {nonPaymentData.length > 0 && (
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-title">Involuntary (non-payment) recovery</div>
            <div className="panel-sub">Monthly non-payment cancellations vs. reactivations</div>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={nonPaymentData} margin={{ top: 10, right: 48, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="monthLabel" tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: '#4a5568', fontSize: 10 }}
                  tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
                <Tooltip
                  content={<ChartTooltip formatter={(v, name) => name === '% Recovered' ? `${v}%` : v} />}
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#8892a4', paddingTop: 8 }} />
                <Bar yAxisId="left" dataKey="cancelled" name="Cancelled" fill="#ff4757" />
                <Bar yAxisId="left" dataKey="recovered" name="Reactivated" fill="#00e5a0" />
                <Line yAxisId="right" type="monotone" dataKey="recoveryPct" stroke="#ffb700"
                  dot={false} name="% Recovered" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ═══ PENDING CANCELLATIONS TABLE ═══ */}
        <div className="panel" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="panel-title" style={{ marginBottom: 2 }}>Pending cancellations — save opportunities</div>
              <div className="panel-sub" style={{ marginBottom: 0 }}>
                {pendingRows.length} pending · sorted by term end date · <span style={{ color: '#ff4757' }}>red = overdue</span>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <input
              type="text"
              placeholder="Search account / name / email…"
              value={pendingSearch}
              onChange={e => setPendingSearch(e.target.value)}
              style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(0,212,255,0.18)',
                borderRadius: 6, padding: '7px 12px', color: '#f0f4ff', fontSize: 12,
                fontFamily: 'Inter, sans-serif', outline: 'none', width: 240,
              }}
            />
            <button
              onClick={exportPendingCsv}
              style={{
                background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.25)',
                borderRadius: 6, padding: '7px 14px', color: '#00d4ff', fontSize: 12,
                cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
              }}
            >
              ↓ CSV
            </button>
          </div>
          {pendingRows.length === 0 ? (
            <div style={{ color: '#4a5568', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              {kpis.pendingCount === 0 ? 'No pending cancellations' : 'No results match your search'}
            </div>
          ) : (
            <div className="cohort-table-wrap">
              <table className="cohort-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Contact</th>
                    <th>Device</th>
                    <th>Plan</th>
                    <th>MRR</th>
                    <th>Initiated by</th>
                    <th>Term ends</th>
                    <th>Days left</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRows.map((r, i) => {
                    const dl = daysLeft(r.term_end_at)
                    const overdue = r.pending_overdue || (dl !== null && dl < 0)
                    return (
                      <tr key={r.cancellation_id || i} style={overdue ? { background: 'rgba(255,71,87,0.04)' } : undefined}>
                        <td style={{ color: overdue ? '#ff4757' : '#f0f4ff', fontWeight: 500 }}>
                          {r.account_title || '—'}
                        </td>
                        <td>
                          <div style={{ fontSize: 12, color: '#f0f4ff' }}>{r.primary_contact_name || '—'}</div>
                          <div style={{ fontSize: 11, color: '#4a5568' }}>{r.primary_contact_email}</div>
                        </td>
                        <td style={{ color: '#8892a4', fontSize: 12 }}>{r.device_model || '—'}</td>
                        <td><span className="mono" style={{ fontSize: 11, color: '#8892a4' }}>{r.plan_months ? `${r.plan_months}mo` : '—'}</span></td>
                        <td><span className="mono" style={{ color: '#f0f4ff' }}>{fmtMrr(r.mrr_at_cancel_usd)}</span></td>
                        <td style={{ color: '#8892a4', fontSize: 12 }}>{r.initiated_by || '—'}</td>
                        <td><span className="mono" style={{ fontSize: 12, color: overdue ? '#ff4757' : '#8892a4' }}>
                          {r.term_end_at ? r.term_end_at.slice(0, 10) : '—'}
                        </span></td>
                        <td>
                          {dl !== null
                            ? <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: overdue ? '#ff4757' : (dl <= 7 ? '#ffb700' : '#8892a4') }}>
                                {overdue ? `${Math.abs(dl)}d ago` : `${dl}d`}
                              </span>
                            : <span style={{ color: '#4a5568' }}>—</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ═══ RECENT CANCELLATIONS ═══ */}
        <div className="panel" style={{ marginBottom: 0 }}>
          <div className="panel-title">Recent cancellations</div>
          <div className="panel-sub">
            Last {recentRows.length} · outcome = Cancelled · click a row to open helpdesk conversation
          </div>
          <div className="cohort-table-wrap">
            <table className="cohort-table">
              <thead>
                <tr>
                  <th>Initiated</th>
                  <th>Account</th>
                  <th>Device</th>
                  <th>Category</th>
                  <th>Reason</th>
                  <th>MRR</th>
                  <th>Staff / initiated by</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((r, i) => (
                  <tr
                    key={r.cancellation_id || i}
                    onClick={() => { if (r.conversation_url) window.open(r.conversation_url, '_blank', 'noopener') }}
                    style={{ cursor: r.conversation_url ? 'pointer' : 'default' }}
                    onMouseEnter={e => { if (r.conversation_url) e.currentTarget.style.background = 'rgba(0,212,255,0.04)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '' }}
                  >
                    <td><span className="mono" style={{ color: '#00d4ff', fontSize: 12 }}>{(r.initiated_at || '').slice(0, 10) || '—'}</span></td>
                    <td>
                      <div style={{ fontWeight: 500, color: '#f0f4ff', fontSize: 13 }}>{r.account_title || '—'}</div>
                      <div style={{ fontSize: 11, color: '#4a5568' }}>{r.primary_contact_email}</div>
                    </td>
                    <td style={{ color: '#8892a4', fontSize: 12 }}>{r.device_model || '—'}</td>
                    <td>
                      <span style={{ fontSize: 11, color: CAT_COLORS[r.cancel_category] || '#8892a4', fontWeight: 500 }}>
                        {r.cancel_category || '—'}
                      </span>
                    </td>
                    <td style={{ maxWidth: 220 }}>
                      {r.reason !== 'Unknown'
                        ? <span style={{ fontSize: 12, color: '#8892a4' }}>{r.reason}</span>
                        : <span style={{ color: '#4a5568', fontSize: 12 }}>—</span>
                      }
                    </td>
                    <td><span className="mono" style={{ color: '#f0f4ff', fontSize: 12 }}>{fmtMrr(r.mrr_at_cancel_usd)}</span></td>
                    <td style={{ color: r.staff_name === 'Unattributed' ? '#4a5568' : '#8892a4', fontSize: 12, fontStyle: r.staff_name === 'Unattributed' ? 'italic' : undefined }}>
                      {r.staff_name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        </>}
        {/* /enriched.length > 0 */}

      </>}
      {/* /Analytics tab */}

    </div>
  )
}
