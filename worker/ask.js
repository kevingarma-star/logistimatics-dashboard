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
  const cohorts  = data.cohorts    || []
  const funnel   = data.funnel     || []
  const survey   = data.survey_summary || {}

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

  const ctx = buildInsightsContext(body.data || {})

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
      system:     INSIGHTS_SYSTEM_PROMPT,
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

    return new Response('Not found', { status: 404 })
  },
}
