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
      model: 'claude-opus-4-6',
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

    return new Response('Not found', { status: 404 })
  },
}
