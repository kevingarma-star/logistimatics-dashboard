import { useMemo } from 'react'

/**
 * Filters all dashboard data to the selected date range and
 * recomputes summary metrics, funnel, and SendGrid stats from the slice.
 */
export default function useFilteredData(data, start, end) {
  return useMemo(() => {
    if (!data) return null

    const inRange = date => {
      if (!date) return false
      if (start && date < start) return false
      if (end   && date > end)   return false
      return true
    }

    // ── Filter arrays ──────────────────────────────────────────────────
    const cohorts     = data.cohorts.filter(c => inRange(c.batch_date))
    const timeline    = data.timeline.filter(t => inRange(t.date))
    const sgStats     = (data.sendgrid_stats || []).filter(s => inRange(s.date))
    const customers   = (data.customers || []).filter(c => inRange(c.sent_date))

    // ── Recompute summary from filtered cohorts ────────────────────────
    const total      = cohorts.reduce((s, c) => s + c.total,              0)
    const activated  = cohorts.reduce((s, c) => s + c.activated,          0)
    const pending    = cohorts.reduce((s, c) => s + c.pending,            0)
    const returned   = cohorts.reduce((s, c) => s + c.returned,           0)
    // Use timeline for follow-up sent count so it reflects actual send date, not cohort date
    const fuSent     = timeline.reduce((s, t) => s + (t.followup ?? 0),   0)
    const fuActiv    = cohorts.reduce((s, c) => s + (c.followup_activated ?? 0), 0)

    const summary = {
      ...data.summary,
      total_outreached:         total,
      activated,
      pending,
      returned,
      followup_sent:            fuSent,
      followup_activated:       fuActiv,
      activation_rate:          total   ? +(activated / total   * 100).toFixed(1) : 0,
      followup_conversion_rate: fuSent  ? +(fuActiv   / fuSent  * 100).toFixed(1) : 0,
    }

    // ── Recompute funnel from filtered summary ─────────────────────────
    const funnel = [
      { stage: 'Outreached',     value: total,     pct: 100 },
      { stage: 'Follow-up Sent', value: fuSent,    pct: total ? +(fuSent   / total * 100).toFixed(1) : 0 },
      { stage: 'Activated',      value: activated, pct: total ? +(activated / total * 100).toFixed(1) : 0 },
    ]

    // ── Recompute SendGrid summary from filtered stats ─────────────────
    let sgSummary = data.sendgrid_summary || {}
    if (sgStats.length && sgSummary.has_campaign_data !== false) {
      const del  = sgStats.reduce((s, d) => s + (d.delivered ?? 0),      0)
      const open = sgStats.reduce((s, d) => s + (d.unique_opens ?? 0),   0)
      const clk  = sgStats.reduce((s, d) => s + (d.unique_clicks ?? 0),  0)
      const bnc  = sgStats.reduce((s, d) => s + (d.bounces ?? 0),        0)
      const req  = sgStats.reduce((s, d) => s + (d.requests ?? (del || 1)),0)
      sgSummary = {
        ...sgSummary,
        avg_open_rate:      del ? +(open / del * 100).toFixed(1) : 0,
        avg_click_rate:     del ? +(clk  / del * 100).toFixed(2) : 0,
        avg_delivery_rate:  req ? +(del  / req * 100).toFixed(1) : 0,
        avg_bounce_rate:    req ? +(bnc  / req * 100).toFixed(2) : 0,
      }
    }

    return { ...data, summary, cohorts, timeline, funnel, customers, sendgrid_stats: sgStats, sendgrid_summary: sgSummary }
  }, [data, start, end])
}
