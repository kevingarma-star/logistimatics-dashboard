/**
 * Logistimatics AI Ask Worker
 * Deploy to Cloudflare Workers. Set ANTHROPIC_API_KEY as a secret.
 *
 * POST /ask  { messages: [{role, content}], data: <dashboard data.json> }
 * → { reply: "..." }
 */

const ALLOWED_ORIGINS = [
  'https://kevingarma-star.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

const SYSTEM_PROMPT = `You are an expert analyst for Logistimatics, a GPS tracker company.
You have access to live dashboard data from the customer activation campaign.
Answer questions concisely and insightfully. When referencing numbers, be precise.
Focus on actionable insights. If asked about things not in the data, say so briefly.
Use plain text — no markdown headers or bullet characters, just clean sentences and newlines.`

const INSIGHTS_SYSTEM_PROMPT = `You are a senior growth and retention analyst for Logistimatics, a GPS tracker company.
You will receive live campaign data and must return a single JSON object — nothing else, no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "health_score": <integer 0-100>,
  "health_label": <"Strong" | "Needs Attention" | "At Risk">,
  "summary": <2-3 sentence plain-text executive summary of overall campaign health>,
  "sections": [
    {
      "id": <unique snake_case string>,
      "title": <section title>,
      "content": <2-4 sentences of specific analysis referencing real numbers>,
      "metric": <key number as string, e.g. "12.4%" or "433">,
      "metric_label": <short label for the metric>,
      "sentiment": <"positive" | "neutral" | "negative">
    }
  ],
  "recommendations": [
    {
      "priority": <"high" | "medium" | "low">,
      "title": <short imperative action title, max 8 words>,
      "detail": <1-2 sentences explaining exactly what to do and why>
    }
  ]
}

Rules:
- sections must include: activation_funnel, email_engagement, cohort_performance, follow_up_effectiveness, and survey_signals (if survey data exists)
- recommendations must have 3-5 items ordered high → low priority
- Every metric and claim must come from the provided data — no fabrication
- Be specific and actionable — generic advice is not useful
- Return ONLY the JSON object`

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function buildDataContext(data) {
  const s  = data.summary            || {}
  const sg = data.sendgrid_summary   || {}

  let ctx = '=== DASHBOARD DATA (live snapshot) ===\n'
  ctx += `Total outreached: ${s.total_outreached ?? 'N/A'}\n`
  ctx += `Activated: ${s.activated ?? 'N/A'} (${s.activation_rate ?? 'N/A'}%)\n`
  ctx += `Pending: ${s.pending ?? 'N/A'}\n`
  ctx += `Follow-ups sent: ${s.followup_sent ?? 'N/A'} (${s.followup_conversion_rate ?? 'N/A'}% of follow-ups converted)\n`
  ctx += `Returned: ${s.returned ?? 'N/A'}\n`

  if (sg.avg_open_rate !== undefined) {
    ctx += `Email avg open rate: ${sg.avg_open_rate}%\n`
    ctx += `Email avg delivery rate: ${sg.avg_delivery_rate}%\n`
    ctx += `Email avg click rate: ${sg.avg_click_rate}%\n`
    ctx += `Email avg bounce rate: ${sg.avg_bounce_rate}%\n`
  }

  const cohorts = data.cohorts || []
  if (cohorts.length) {
    ctx += `Cohorts (${cohorts.length} batches): `
    ctx += cohorts.slice(0, 10).map(
      c => `${c.batch_date ?? '?'} [${c.sent ?? 0} sent, ${c.activated ?? 0} activated]`
    ).join(', ')
    if (cohorts.length > 10) ctx += ` ... +${cohorts.length - 10} more`
    ctx += '\n'
  }

  const survey = data.survey_summary || {}
  if (survey.has_survey_data) {
    ctx += `Survey: ${survey.total_responses ?? 0} responses, ${survey.response_rate ?? 0}% rate\n`
    for (const b of (survey.breakdown || [])) {
      ctx += `  ${b.label ?? '?'}: ${b.count ?? 0} (${b.pct ?? 0}%)\n`
    }
  }

  ctx += '=== END DATA ==='
  return ctx
}

function buildInsightsContext(data) {
  const s  = data.summary          || {}
  const sg = data.sendgrid_summary || {}
  const cohorts   = data.cohorts           || []
  const funnel    = data.funnel            || []
  const survey    = data.survey_summary    || {}
  const customers = data.customers         || []
  const timing    = data.activation_timing || {}

  let ctx = '=== CAMPAIGN DATA ===\n'

  // Core funnel
  ctx += `\n--- Activation Funnel ---\n`
  ctx += `Total customers outreached: ${s.total_outreached ?? 0}\n`
  ctx += `Activated: ${s.activated ?? 0} (${s.activation_rate ?? 0}% conversion rate)\n`
  ctx += `Pending activation: ${s.pending ?? 0}\n`
  ctx += `Returned device: ${s.returned ?? 0}\n`
  for (const f of funnel) {
    ctx += `Funnel stage "${f.stage}": ${f.value} (${f.pct}%)\n`
  }

  // Follow-up
  ctx += `\n--- Follow-up Performance ---\n`
  ctx += `Follow-ups sent: ${s.followup_sent ?? 0}\n`
  ctx += `Follow-up activated: ${s.followup_activated ?? 0}\n`
  ctx += `Follow-up conversion rate: ${s.followup_conversion_rate ?? 0}%\n`

  // Per-touch email campaign breakdown
  if (customers.length) {
    ctx += `\n--- Per-Touch Email Campaign Breakdown ---\n`
    const t1sent = customers.length
    const t2sent = customers.filter(c => c.fu_sent).length
    const t3sent = customers.filter(c => c.fu2_sent).length
    const t1act  = customers.filter(c => c.activated_after_touch === 'T1').length
    const t2act  = customers.filter(c => c.activated_after_touch === 'T2').length
    const t3act  = customers.filter(c => c.fu2_sent && c.status === 'Activated').length
    const pct = (n, d) => d ? (n / d * 100).toFixed(1) : '0.0'
    ctx += `T1 Initial Outreach: ${t1sent} sent → ${t1act} activated (${pct(t1act, t1sent)}% conv)\n`
    ctx += `T2 1st Follow-up: ${t2sent} sent → ${t2act} activated (${pct(t2act, t2sent)}% conv)\n`
    ctx += `T3 2nd Follow-up: ${t3sent} sent → ${t3act} activated (${pct(t3act, t3sent)}% conv)\n`
    ctx += `Pending after all 3 touches: ${customers.filter(c => c.fu2_sent && c.status === 'Pending').length}\n`

    // Warm leads: opened but haven't activated
    const warmLeads = customers.filter(c => c.sg_opens_count > 0 && c.status !== 'Activated').length
    const clickers  = customers.filter(c => c.sg_clicks_count > 0).length
    ctx += `Warm leads (opened but not yet activated): ${warmLeads}\n`
    ctx += `Clicked a link (high intent): ${clickers}\n`
  }

  // Email health
  ctx += `\n--- Email Engagement (SendGrid Category Stats: ${sg.total_requests ?? 0} emails, ${sg.period_start ?? '?'} to ${sg.period_end ?? '?'}) ---\n`
  ctx += `Delivery rate: ${sg.avg_delivery_rate ?? 'N/A'}% (${sg.total_delivered ?? 0}/${sg.total_requests ?? 0} delivered)\n`
  ctx += `Open rate: ${sg.avg_open_rate ?? 'N/A'}% (${sg.total_opens ?? 0} unique opens)\n`
  ctx += `Click rate: ${sg.avg_click_rate ?? 'N/A'}% (${sg.total_clicks ?? 0} unique clicks)\n`
  ctx += `Bounce rate: ${sg.avg_bounce_rate ?? 'N/A'}%\n`
  ctx += `Note: ${sg.total_requests ?? 0} of ${s.total_outreached ?? 0} customers have email tracking (category tags added ${sg.period_start ?? '?'})\n`

  // Cohort breakdown
  ctx += `\n--- Batch Performance (${cohorts.length} batches) ---\n`
  for (const c of cohorts) {
    ctx += `${c.batch_date}: ${c.total} sent, ${c.activated} activated (${c.activation_rate}%), `
    ctx += `${c.pending} pending, ${c.returned} returned, `
    ctx += `${c.followup_sent} follow-ups (${c.followup_conv_rate}% conv)\n`
  }

  // Activation timing
  if (timing.total_activated) {
    ctx += `\n--- Activation Timing ---\n`
    ctx += `Total activated: ${timing.total_activated} (${timing.with_activation_date} with date on record)\n`
    ctx += `Avg days to activate: ${timing.avg_days_to_activate}, Median: ${timing.median_days_to_activate} days\n`
    if (timing.by_touch?.length) {
      for (const t of timing.by_touch) {
        ctx += `  ${t.label} (${t.desc}): ${t.count} customers (${t.pct}% of activated)\n`
      }
    }
    if (timing.days_distribution?.length) {
      ctx += `Time-to-activate buckets: `
      ctx += timing.days_distribution.map(b => `${b.bucket} → ${b.count}`).join(', ')
      ctx += '\n'
    }
  }

  // Survey
  if (survey.has_survey_data) {
    ctx += `\n--- Activation Barrier Survey ---\n`
    ctx += `Surveys sent: ${survey.surveys_sent ?? 0}, responses: ${survey.total_responses ?? 0} (${survey.response_rate ?? 0}% rate)\n`
    for (const b of (survey.breakdown || [])) {
      ctx += `  "${b.label}": ${b.count} responses (${b.pct}%)\n`
    }
  }

  ctx += '\n=== END DATA ==='
  return ctx
}

async function handleAsk(request, env) {
  const origin = request.headers.get('Origin') || ''
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) }

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY secret is not set on this Worker.' }),
      { status: 500, headers }
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers })
  }

  const messages = body.messages || []
  const data     = body.data     || {}

  if (!messages.length) {
    return new Response(JSON.stringify({ error: 'messages array required' }), { status: 400, headers })
  }

  // Prepend data context into the first user message
  const ctx = buildDataContext(data)
  const apiMessages = messages.map((m, i) =>
    i === 0 && m.role === 'user'
      ? { role: 'user', content: ctx + '\n\n' + m.content }
      : m
  )

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: apiMessages,
    }),
  })

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text()
    return new Response(JSON.stringify({ error: `Anthropic API error ${anthropicRes.status}: ${err}` }), { status: 502, headers })
  }

  const result = await anthropicRes.json()
  const reply  = result.content?.[0]?.text ?? ''

  return new Response(JSON.stringify({ reply }), { status: 200, headers })
}

async function handleInsights(request, env) {
  const origin  = request.headers.get('Origin') || ''
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) }

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY secret is not set on this Worker.' }),
      { status: 500, headers }
    )
  }

  let body
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers })
  }

  const ctx   = buildInsightsContext(body.data || {})
  const focus = body.focus || null

  const FOCUS_DIRECTIVES = {
    email:    'FOCUS DIRECTIVE: Go significantly deeper on email engagement. Break down open rates, click rates, and delivery across each touch (T1/T2/T3). Identify which touch has the highest drop-off and what the warm leads (opened but not activated) signal. Surface non-obvious patterns in the per-touch data.',
    funnel:   'FOCUS DIRECTIVE: Go significantly deeper on funnel drop-off. Identify exactly where customers are falling out — after T1, T2, or T3 — and compare conversion rates across touches. Use the timing data to flag whether slower activators eventually convert or churn.',
    cohorts:  'FOCUS DIRECTIVE: Go significantly deeper on cohort performance. Identify the highest and lowest performing batches, flag statistical outliers, and look for trends over time. If a recent batch is underperforming, say why based on the data.',
    survey:   'FOCUS DIRECTIVE: Go significantly deeper on survey signals. Analyze each activation barrier reason in detail. Cross-reference response rate against total pending customers to gauge confidence. Surface which barrier should be prioritized for product or messaging changes.',
  }

  const systemPrompt = focus && FOCUS_DIRECTIVES[focus]
    ? INSIGHTS_SYSTEM_PROMPT + '\n\n' + FOCUS_DIRECTIVES[focus]
    : INSIGHTS_SYSTEM_PROMPT

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':          env.ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: ctx }],
    }),
  })

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text()
    return new Response(
      JSON.stringify({ error: `Anthropic API error ${anthropicRes.status}: ${err}` }),
      { status: 502, headers }
    )
  }

  const result  = await anthropicRes.json()
  const rawText = result.content?.[0]?.text ?? ''

  let insights
  try {
    insights = JSON.parse(rawText)
  } catch {
    return new Response(
      JSON.stringify({ error: 'Model returned invalid JSON', raw: rawText }),
      { status: 502, headers }
    )
  }

  insights.generated_at = new Date().toISOString()
  return new Response(JSON.stringify(insights), { status: 200, headers })
}

const RETURN_INSIGHTS_SYSTEM_PROMPT = `You are a senior returns analyst for Logistimatics, a GPS tracker company.
You will receive product return data and must return a single JSON object — nothing else, no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "health_score": <integer 0-100, where 100 = best possible, lower = more concerning return patterns>,
  "health_label": <"Healthy" | "Needs Attention" | "Concerning">,
  "summary": <2-3 sentence plain-text executive summary of return patterns and their root causes>,
  "sections": [
    {
      "id": <unique snake_case string>,
      "title": <section title>,
      "content": <2-4 sentences of specific analysis referencing real numbers from the data>,
      "metric": <key number as string, e.g. "31.6%" or "3">,
      "metric_label": <short label for the metric>,
      "sentiment": <"positive" | "neutral" | "negative">
    }
  ],
  "recommendations": [
    {
      "priority": <"high" | "medium" | "low">,
      "title": <short imperative action title, max 8 words>,
      "detail": <1-2 sentences explaining exactly what to do and why>
    }
  ]
}

Rules:
- sections must include: return_volume, reason_breakdown, product_analysis, pricing_signals, undeliverable_rate
- recommendations must have 3-5 items ordered high to low priority
- health_score: start at 100, deduct for rising return trends, high undeliverable %, quick return times (under 14 days), fixable recurring reasons
- Every metric and claim must come from the provided data — no fabrication
- Be specific and actionable — generic advice is not useful
- Return ONLY the JSON object`

const RETURN_FOCUS_DIRECTIVES = {
  reasons:  'FOCUS DIRECTIVE: Go significantly deeper on return reason categories. Break down each reason by volume, trend over time, and which product SKUs are most affected. Identify the top fixable reason and exactly what should change.',
  products: 'FOCUS DIRECTIVE: Go significantly deeper on product/SKU analysis. Compare return rates per device type, flag which SKU has the highest return rate, and surface any reason patterns that are SKU-specific.',
  pricing:  'FOCUS DIRECTIVE: Go significantly deeper on pricing signals. Look for patterns in return timing (quick returns may signal buyer remorse), reason categories related to value or cost, and what this implies for pricing or onboarding messaging.',
  churn:    'FOCUS DIRECTIVE: Go significantly deeper on churn risk. Identify which return reasons suggest permanently lost customers vs those who may be re-engaged. Flag any patterns in undeliverable returns that suggest address or fulfillment issues.',
}

function buildReturnInsightsContext(data, focus) {
  const returnsList = data.returns_list        || []
  const total       = data.total_returns       || 0
  const undeliv     = data.undeliverable_count || 0
  const byMonth     = data.returns_by_month    || []
  const categorised = total - undeliv

  let ctx = '=== RETURN DATA ===\n'
  ctx += `\nTotal returns tracked (May 2026 onwards): ${total}\n`
  ctx += `Undeliverable (no B2C Returns conversation in Intercom): ${undeliv}`
  ctx += ` (${total ? Math.round(undeliv / total * 100) : 0}%)\n`
  ctx += `Categorised returns with Intercom reason: ${categorised}\n`

  ctx += '\n--- Returns by Month ---\n'
  for (const m of byMonth) {
    ctx += `  ${m.month}: ${m.count} returns\n`
  }

  // Reason category breakdown
  const reasonCounts = {}
  for (const r of returnsList) {
    if (r.reason_category && !r.is_undeliverable) {
      reasonCounts[r.reason_category] = (reasonCounts[r.reason_category] || 0) + 1
    }
  }
  ctx += '\n--- Return Reason Categories ---\n'
  for (const [cat, count] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    const pct = categorised ? Math.round(count / categorised * 100) : 0
    ctx += `  ${cat.replace(/_/g, ' ')}: ${count} (${pct}%)\n`
  }

  // Product breakdown
  const productCounts = {}
  for (const r of returnsList) {
    if (r.device_type && !r.is_undeliverable) {
      productCounts[r.device_type] = (productCounts[r.device_type] || 0) + 1
    }
  }
  ctx += '\n--- Returns by Product/SKU ---\n'
  for (const [prod, count] of Object.entries(productCounts).sort((a, b) => b[1] - a[1])) {
    ctx += `  ${prod}: ${count} returns\n`
  }

  // Avg days to return
  const daysList = []
  for (const r of returnsList) {
    if (r.ship_date && r.return_date && !r.is_undeliverable) {
      const ship = new Date(r.ship_date + 'T12:00:00Z')
      const ret  = new Date(r.return_date + 'T12:00:00Z')
      const d    = Math.round((ret - ship) / 86400000)
      if (d >= 0) daysList.push(d)
    }
  }
  if (daysList.length) {
    const avg = daysList.reduce((a, b) => a + b, 0) / daysList.length
    ctx += `\nAverage days ship → return: ${avg.toFixed(1)} days (from ${daysList.length} records with both dates)\n`
  }

  // Weekly cadence
  const weekCounts = {}
  for (const r of returnsList) {
    if (r.return_date) {
      const d      = new Date(r.return_date + 'T12:00:00Z')
      const offset = (d.getUTCDay() + 6) % 7   // Mon = 0
      const mon    = new Date(d)
      mon.setUTCDate(d.getUTCDate() - offset)
      const key = mon.toISOString().slice(0, 10)
      weekCounts[key] = (weekCounts[key] || 0) + 1
    }
  }
  if (Object.keys(weekCounts).length) {
    ctx += '\n--- Weekly return cadence ---\n'
    for (const wk of Object.keys(weekCounts).sort()) {
      ctx += `  Week of ${wk}: ${weekCounts[wk]} returns\n`
    }
  }

  // Individual return summaries (categorised only)
  ctx += '\n--- Individual Return Summaries (categorised only) ---\n'
  for (const r of returnsList) {
    if (!r.is_undeliverable && r.reason_summary) {
      ctx += `[${r.customer_name || 'Unknown'}] ${r.device_type || 'Unknown device'} · ${r.reason_category || 'uncategorised'}: ${r.reason_summary}\n\n`
    }
  }

  if (focus) {
    ctx += `\n=== ANALYSIS FOCUS: ${focus.toUpperCase()} ===\n`
    ctx += 'Go deeper on this area in your sections and recommendations.\n'
  }

  ctx += '\n=== END DATA ==='
  return ctx
}

async function handleReturnInsights(request, env) {
  const origin  = request.headers.get('Origin') || ''
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) }

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY secret is not set on this Worker.' }),
      { status: 500, headers }
    )
  }

  let body
  try { body = await request.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers })
  }

  const focus      = body.focus || null
  const ctx        = buildReturnInsightsContext(body.data || {}, focus)
  const systemPrompt = focus && RETURN_FOCUS_DIRECTIVES[focus]
    ? RETURN_INSIGHTS_SYSTEM_PROMPT + '\n\n' + RETURN_FOCUS_DIRECTIVES[focus]
    : RETURN_INSIGHTS_SYSTEM_PROMPT

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: ctx }],
    }),
  })

  if (!anthropicRes.ok) {
    const err = await anthropicRes.text()
    return new Response(
      JSON.stringify({ error: `Anthropic API error ${anthropicRes.status}: ${err}` }),
      { status: 502, headers }
    )
  }

  const result  = await anthropicRes.json()
  const rawText = result.content?.[0]?.text ?? ''

  let insights
  try {
    insights = JSON.parse(rawText)
  } catch {
    return new Response(
      JSON.stringify({ error: 'Model returned invalid JSON', raw: rawText }),
      { status: 502, headers }
    )
  }

  insights.generated_at = new Date().toISOString()
  return new Response(JSON.stringify(insights), { status: 200, headers })
}

const REASON_LABELS = {
  time:       "Haven't had time yet",
  need:       "Don't need it yet",
  activation: 'Issue with the activation page',
  ready:      'Not ready for a paying subscription',
}

async function handleSurvey(request, env) {
  const url    = new URL(request.url)
  const reason = url.searchParams.get('r') || ''
  const email  = url.searchParams.get('e') || ''
  const name   = url.searchParams.get('n') || ''
  const serial = url.searchParams.get('s') || ''

  const reasonLabel = REASON_LABELS[reason] || reason

  if (email && reason) {
    const today       = new Date().toISOString().slice(0, 10)
    const supabaseUrl = env.SUPABASE_URL
    const supabaseKey = env.SUPABASE_KEY

    try {
      await fetch(`${supabaseUrl}/rest/v1/survey_responses`, {
        method: 'POST',
        headers: {
          'apikey':        supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal',
        },
        body: JSON.stringify({
          date:         today,
          email:        email.trim().toLowerCase(),
          name:         name,
          reason:       reason,
          reason_label: reasonLabel,
        }),
      })
    } catch {
      // Don't block the redirect on DB errors
    }
  }

  let redirectUrl
  if (reason === 'activation') {
    redirectUrl = 'https://logistimatics.com/pages/contact'
  } else {
    redirectUrl = serial
      ? `https://my.logistimatics.com/activate/#${serial}`
      : 'https://my.logistimatics.com/activate'
  }

  return Response.redirect(redirectUrl, 302)
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const url    = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (request.method === 'POST' && url.pathname === '/ask') {
      return handleAsk(request, env)
    }

    if (request.method === 'POST' && url.pathname === '/insights') {
      return handleInsights(request, env)
    }

    if (request.method === 'POST' && url.pathname === '/return-insights') {
      return handleReturnInsights(request, env)
    }

    if (request.method === 'GET' && url.pathname === '/survey') {
      return handleSurvey(request, env)
    }

    return new Response('Not found', { status: 404 })
  },
}
