import { useMemo } from 'react'

/**
 * Filters all dashboard data to the selected date range and
 * recomputes summary metrics, funnel, SendGrid stats, and activation
 * timing from the filtered slice.
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
    const cohorts   = data.cohorts.filter(c => inRange(c.batch_date))
    const timeline  = data.timeline.filter(t => inRange(t.date))
    // sgStats filtered by date — used only for the trend chart (SendGridPanel)
    const sgStats   = (data.sendgrid_stats || []).filter(s => inRange(s.date))
    const customers = (data.customers || []).filter(c => inRange(c.sent_date))

    // ── T0-only customers: in-transit recipients who never received T1 ──
    // These are NOT in the customers array (which is built from T1 recipients)
    // so they must be counted separately to get accurate Campaign Overview totals.
    const customerEmailSet = new Set(customers.map(c => c.email))
    const inTransitFiltered = (data.in_transit_customers || []).filter(c => inRange(c.sent_date))
    const t0Only            = inTransitFiltered.filter(c => !customerEmailSet.has(c.email))
    const t0OnlyActivated   = t0Only.filter(c => c.status === 'Activated').length
    const t0OnlyPending     = t0Only.filter(c => c.status === 'Pending').length
    const t0OnlyReturned    = t0Only.filter(c => c.status === 'Returned').length

    // ── Recompute summary from filtered cohorts + T0-only ─────────────
    const t1Total   = cohorts.reduce((s, c) => s + c.total,     0)
    const t1Act     = cohorts.reduce((s, c) => s + c.activated, 0)
    const t1Pending = cohorts.reduce((s, c) => s + c.pending,   0)
    const t1Return  = cohorts.reduce((s, c) => s + c.returned,  0)
    // Use timeline for follow-up sent count so it reflects actual send date, not cohort date
    const fuSent    = timeline.reduce((s, t) => s + (t.followup ?? 0), 0)
    const fuActiv   = cohorts.reduce((s, c) => s + (c.followup_activated ?? 0), 0)

    const total     = t1Total   + t0Only.length
    const activated = t1Act     + t0OnlyActivated
    const pending   = t1Pending + t0OnlyPending
    const returned  = t1Return  + t0OnlyReturned

    const summary = {
      ...data.summary,
      total_outreached:         total,
      activated,
      pending,
      returned,
      followup_sent:            fuSent,
      followup_activated:       fuActiv,
      activation_rate:          total  ? +(activated / total  * 100).toFixed(1) : 0,
      followup_conversion_rate: fuSent ? +(fuActiv   / fuSent * 100).toFixed(1) : 0,
      // Expose T0-exclusive counts for EmailCampaignBreakdown
      in_transit_exclusive_sent:      t0Only.length,
      in_transit_exclusive_activated: t0OnlyActivated,
    }

    // ── Recompute funnel from filtered summary ─────────────────────────
    const funnel = [
      { stage: 'Outreached',     value: total,     pct: 100 },
      { stage: 'Follow-up Sent', value: fuSent,    pct: total ? +(fuSent   / total * 100).toFixed(1) : 0 },
      { stage: 'Activated',      value: activated, pct: total ? +(activated / total * 100).toFixed(1) : 0 },
    ]

    // ── Recompute Email Health KPIs from per-customer sg_* flags ───────
    //
    // Per-customer flags (sg_delivered, sg_opened, etc.) are the authoritative
    // source for Email Health KPIs because:
    //   1. They are denormalized onto every customer and filter cleanly with the
    //      cohort date range — no SG-stat date vs cohort date misalignment.
    //   2. They exactly match what the drill-down modals show, so KPI numbers
    //      and list counts are always consistent.
    //   3. They aggregate across all touches (T1+T2+T3) per customer, including
    //      sends that happened after the latest cohort date.
    //
    // The aggregate sgStats slice is kept for the SendGridPanel trend chart only.
    const sgTracked   = customers.filter(c => c.sg_delivered != null || c.sg_bounced != null)
    const sgDelivered = sgTracked.filter(c => c.sg_delivered === true)
    const sgOpened    = sgDelivered.filter(c => c.sg_opened  === true)
    const sgClicked   = sgDelivered.filter(c => c.sg_clicked === true)
    const sgBounced   = sgTracked.filter(c => c.sg_bounced   === true)

    const nTracked   = sgTracked.length
    const nDelivered = sgDelivered.length
    const nOpened    = sgOpened.length
    const nClicked   = sgClicked.length
    const nBounced   = sgBounced.length

    const baseSg   = data.sendgrid_summary || {}
    const hasSgData = nTracked > 0

    // Unsubscribes have no per-customer flag — pull from filtered sgStats if available
    const filteredUns = sgStats.reduce((s, r) => s + (r.unsubscribes || 0), 0)

    const sgSummary = hasSgData ? {
      ...baseSg,
      has_campaign_data:       true,
      // Totals: customer-level counts that match drill-down populations
      total_delivered:         nDelivered,
      total_requests:          nTracked,
      total_opens:             nOpened,
      total_clicks:            nClicked,
      total_bounces:           nBounced,
      total_unsubscribes:      filteredUns,
      // Rates: per-customer (customer who opened / customers delivered, etc.)
      avg_open_rate:           nDelivered ? +(nOpened    / nDelivered * 100).toFixed(1) : 0,
      avg_click_rate:          nDelivered ? +(nClicked   / nDelivered * 100).toFixed(2) : 0,
      avg_delivery_rate:       nTracked   ? +(nDelivered / nTracked   * 100).toFixed(1) : 0,
      avg_bounce_rate:         nTracked   ? +(nBounced   / nTracked   * 100).toFixed(2) : 0,
      // Period reflects the active date filter
      period_start:            start || baseSg.period_start,
      period_end:              end   || baseSg.period_end,
      // Per-customer fields (same values — kept for any downstream consumers)
      customer_tracked:        nTracked,
      customer_delivered:      nDelivered,
      customer_opened:         nOpened,
      customer_clicked:        nClicked,
      customer_bounced:        nBounced,
      customer_open_rate:      nDelivered ? +(nOpened    / nDelivered * 100).toFixed(1) : 0,
      customer_click_rate:     nDelivered ? +(nClicked   / nDelivered * 100).toFixed(2) : 0,
      customer_delivery_rate:  nTracked   ? +(nDelivered / nTracked   * 100).toFixed(1) : 0,
      customer_bounce_rate:    nTracked   ? +(nBounced   / nTracked   * 100).toFixed(2) : 0,
    } : { ...baseSg, has_campaign_data: false }

    // ── Recompute activation timing from filtered customers ────────────
    // Touch attribution counts ALL activated customers (matching generate_data.py).
    // Days/avg/median only use the subset with a known activation date.
    const allActivated = customers.filter(c => c.status === 'Activated')
    // timed = post-outreach subset used for avg/median/histogram only
    const timed = allActivated.filter(c => c.days_to_activate != null && c.days_to_activate >= 0)
    const touchCounts = { T0: 0, T1: 0, T2: 0, T3: 0 }
    for (const c of allActivated) {
      const t = c.activated_after_touch || 'T1'
      touchCounts[t] = (touchCounts[t] || 0) + 1
    }
    const nAll   = allActivated.length
    const nTimed = timed.length
    const allDays = timed.map(c => c.days_to_activate).sort((a, b) => a - b)
    const avgDays = allDays.length ? +(allDays.reduce((s, d) => s + d, 0) / allDays.length).toFixed(1) : null
    const medDays = allDays.length ? allDays[Math.floor(allDays.length / 2)] : null

    const BUCKETS = [
      ['≤ 3d',   d => d <= 3],
      ['4–7d',   d => d >= 4  && d <= 7],
      ['8–14d',  d => d >= 8  && d <= 14],
      ['15–21d', d => d >= 15 && d <= 21],
      ['22–30d', d => d >= 22 && d <= 30],
      ['31–45d', d => d >= 31 && d <= 45],
      ['46+d',   d => d >= 46],
    ]

    // T0 uses campaign-level totals from the summary (in_transit_log covers recipients
    // who may have activated before T1 was sent and aren't in customers[]).
    // Pct for T0 is a conversion rate (activated / sent), not an attribution share.
    const t0Count = summary.in_transit_activated ?? 0
    const t0Sent  = summary.in_transit_sent ?? 0

    const activationTiming = {
      total_activated:         nAll,
      with_activation_date:    nAll,   // all activated count toward the total
      timed_count:             nTimed, // post-outreach subset shown as sub-text
      avg_days_to_activate:    avgDays,
      median_days_to_activate: medDays,
      by_touch: [
        { touch: 'T0', label: 'After In-Transit', desc: `${t0Sent} sent · includes pre-T1 activations`, count: t0Count, pct: t0Sent ? +(t0Count / t0Sent * 100).toFixed(1) : 0, isConvRate: true },
        { touch: 'T1', label: 'After Touch 1', desc: 'Activated without needing a follow-up',    count: touchCounts.T1, pct: nAll ? +(touchCounts.T1 / nAll * 100).toFixed(1) : 0 },
        { touch: 'T2', label: 'After Touch 2', desc: 'Activated after the second email',          count: touchCounts.T2, pct: nAll ? +(touchCounts.T2 / nAll * 100).toFixed(1) : 0 },
        { touch: 'T3', label: 'After Touch 3', desc: 'Activated after the third email',           count: touchCounts.T3, pct: nAll ? +(touchCounts.T3 / nAll * 100).toFixed(1) : 0 },
      ],
      days_distribution: BUCKETS.map(([label, fn]) => ({
        bucket: label,
        count:  allDays.filter(fn).length,
      })),
    }

    return {
      ...data,
      summary,
      cohorts,
      timeline,
      funnel,
      customers,
      sendgrid_stats:    sgStats,
      sendgrid_summary:  sgSummary,
      activation_timing: activationTiming,
    }
  }, [data, start, end])
}
