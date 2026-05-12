#!/usr/bin/env node
/**
 * backfill_timing.js
 * Reads the Google Sheet for activation dates, cross-references the 3 CSV
 * touch logs, and patches data.json with timing fields + activation_timing section.
 */

const https  = require('https')
const fs     = require('fs')
const path   = require('path')

const CREDS_PATH   = path.join(process.env.HOME || process.env.USERPROFILE, '.google_workspace_mcp', 'credentials', 'kevin.garma@go2impact.com.json')
const SHEET_ID     = '1Y-L2MPIBEsCbHFDMOBGtWeTq29YrUwe-j3Bf6cc7Vf8'
const DATA_JSON    = path.join(__dirname, 'public', 'data.json')
const FU2_CSV      = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'skills', 'logistimatics-followup2', 'followup2-log.csv')

// ── HTTP helper ───────────────────────────────────────────────────────────────
function get(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    }, res => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
        resolve(JSON.parse(body))
      })
    })
    req.on('error', reject)
  })
}

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload)
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ── Token refresh ─────────────────────────────────────────────────────────────
async function getToken() {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'))
  const exp   = new Date(creds.expiry)
  if (exp > new Date(Date.now() + 60000)) {
    console.log('  Token still valid.')
    return creds.token
  }
  console.log('  Refreshing token...')
  const params = new URLSearchParams({
    client_id:     creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type:    'refresh_token',
  })
  const r = await post(`https://oauth2.googleapis.com/token?${params}`, '')
  if (!r.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(r)}`)
  // Update saved credentials
  creds.token  = r.access_token
  creds.expiry = new Date(Date.now() + r.expires_in * 1000).toISOString()
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2))
  return r.access_token
}

// ── Parse CSV (simple) ────────────────────────────────────────────────────────
function parseCSV(filePath) {
  if (!fs.existsSync(filePath)) return []
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    // Handle quoted fields
    const parts = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { parts.push(cur.trim()); cur = '' }
      else cur += ch
    }
    parts.push(cur.trim())
    return Object.fromEntries(headers.map((h, i) => [h, parts[i] || '']))
  })
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toDate(s) {
  if (!s) return null
  const d = new Date(s.slice(0, 10))
  return isNaN(d) ? null : d
}
function diffDays(a, b) {
  // a and b are Date objects; returns (a - b) in days
  return Math.round((a - b) / 86400000)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(55))
  console.log('  Logistimatics — Activation Timing Backfill')
  console.log('='.repeat(55))

  // 1. Get access token
  console.log('\n[1/5] Getting Google token...')
  const token = await getToken()

  // 2. Fetch Google Sheet (all rows, columns A-L)
  console.log('\n[2/5] Reading Google Sheet...')
  const range    = encodeURIComponent('A:L')
  const sheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`
  const sheetData = await get(sheetUrl, token)
  const rows = sheetData.values || []
  console.log(`  Total sheet rows: ${rows.length}`)

  // Build serial → activation_date map (precise: per-serial sub date)
  // Row format: [Order, Email, Name, ShipDate, Serial, Type, UserID, Notes, ReturnDate, SubID, SubAssignedAt, TermMonths]
  const serialActMap = {}  // serial → YYYY-MM-DD
  for (const row of rows.slice(1)) {
    const serial  = (row[4] || '').trim()
    const actDate = (row[10] || '').trim()
    if (!serial || !actDate) continue
    const dateOnly = actDate.slice(0, 10)
    // Keep earliest date per serial (shouldn't have duplicates, but just in case)
    if (!serialActMap[serial] || dateOnly < serialActMap[serial]) {
      serialActMap[serial] = dateOnly
    }
  }
  console.log(`  Serials with activation date: ${Object.keys(serialActMap).length}`)

  // 3. Read followup2 CSV for Touch 3 dates
  console.log('\n[3/5] Reading followup2 CSV...')
  const fu2Rows = parseCSV(FU2_CSV)
  const fu2Map  = {}
  for (const row of fu2Rows) {
    const email = (row.email || '').trim().toLowerCase()
    if (email && row.date && !fu2Map[email]) fu2Map[email] = row.date
  }
  console.log(`  Touch-3 records: ${fu2Rows.length}, unique emails: ${Object.keys(fu2Map).length}`)

  // 4. Load and patch data.json
  console.log('\n[4/5] Patching data.json...')
  const data      = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'))
  const customers = data.customers || []

  let matched = 0, unmatched = 0
  for (const c of customers) {
    const email   = (c.email || '').toLowerCase()
    const fu2Date = fu2Map[email] || ''
    c.fu2_sent = !!fu2Date
    c.fu2_date = fu2Date

    // Find activation date by looking up the customer's specific serials in the sheet.
    // A customer may have old subscriptions; we want the date from the serial(s)
    // that were part of THIS outreach (i.e., the ones in c.serials).
    // Take the earliest activation date among their serials that is >= sent_date.
    let actDate = ''
    if (c.serials) {
      const sentDt = toDate(c.sent_date)
      const serList = c.serials.split(',').map(s => s.trim()).filter(Boolean)
      const candidates = serList
        .map(s => serialActMap[s])
        .filter(Boolean)
      // Prefer dates on or after outreach date; if none, fall back to latest available
      const afterOutreach = candidates.filter(d => sentDt && toDate(d) >= sentDt)
      if (afterOutreach.length > 0) {
        actDate = afterOutreach.sort()[0]  // earliest post-outreach activation
      } else if (candidates.length > 0) {
        actDate = candidates.sort().reverse()[0]  // latest pre-outreach (best guess)
      }
    }

    c.activation_date = actDate

    if (c.status === 'Activated' && actDate) {
      const actDt  = toDate(actDate)
      const sentDt = toDate(c.sent_date)
      if (actDt && sentDt) {
        c.days_to_activate = diffDays(actDt, sentDt)
        if (c.days_to_activate < 0) {
          // Activated before Touch 1 was sent — pre-outreach, not campaign-driven
          c.activated_after_touch = 'pre'
        } else {
          // Classify which touch preceded activation
          const fu2Dt = fu2Date ? toDate(fu2Date) : null
          const fuDt  = c.fu_date ? toDate(c.fu_date) : null
          if (fu2Dt && actDt >= fu2Dt) {
            c.activated_after_touch = 'T3'
          } else if (fuDt && actDt >= fuDt) {
            c.activated_after_touch = 'T2'
          } else {
            c.activated_after_touch = 'T1'
          }
        }
        matched++
      } else {
        c.days_to_activate = null
        c.activated_after_touch = null
        unmatched++
      }
    } else {
      c.days_to_activate = null
      c.activated_after_touch = null
      if (c.status === 'Activated' && !actDate) unmatched++
    }
  }
  console.log(`  Activated with date: ${matched}, without date: ${unmatched}`)

  // 5. Compute activation_timing section
  console.log('\n[5/5] Computing activation_timing...')
  const timedAll     = customers.filter(c => c.status === 'Activated' && c.days_to_activate != null)
  const preOutreach  = timedAll.filter(c => c.activated_after_touch === 'pre')
  // Campaign-driven: activated on or after Touch 1 was sent
  const timed        = timedAll.filter(c => c.activated_after_touch !== 'pre')

  const touchCounts = { T1: 0, T2: 0, T3: 0 }
  for (const c of timed) touchCounts[c.activated_after_touch || 'T1']++
  const nTimed = timed.length

  const byTouch = [
    { touch: 'T1', label: 'After Touch 1', desc: 'Activated without needing a follow-up',
      count: touchCounts.T1, pct: nTimed ? +(touchCounts.T1 / nTimed * 100).toFixed(1) : 0 },
    { touch: 'T2', label: 'After Touch 2', desc: 'Activated after the second email',
      count: touchCounts.T2, pct: nTimed ? +(touchCounts.T2 / nTimed * 100).toFixed(1) : 0 },
    { touch: 'T3', label: 'After Touch 3', desc: 'Activated after the third email',
      count: touchCounts.T3, pct: nTimed ? +(touchCounts.T3 / nTimed * 100).toFixed(1) : 0 },
  ]

  const allDays = timed.map(c => c.days_to_activate).sort((a, b) => a - b)
  const avgDays    = allDays.length ? +(allDays.reduce((s, d) => s + d, 0) / allDays.length).toFixed(1) : null
  const medianDays = allDays.length ? allDays[Math.floor(allDays.length / 2)] : null

  const BUCKETS = [
    ['≤ 3d',   d => d <= 3],
    ['4–7d',   d => d >= 4  && d <= 7],
    ['8–14d',  d => d >= 8  && d <= 14],
    ['15–21d', d => d >= 15 && d <= 21],
    ['22–30d', d => d >= 22 && d <= 30],
    ['31–45d', d => d >= 31 && d <= 45],
    ['46+d',   d => d >= 46],
  ]
  const daysDist = BUCKETS.map(([bucket, fn]) => ({
    bucket,
    count: allDays.filter(fn).length,
  }))

  data.activation_timing = {
    total_activated:         customers.filter(c => c.status === 'Activated').length,
    with_activation_date:    matched,
    pre_outreach_count:      preOutreach.length,
    campaign_driven_count:   nTimed,
    avg_days_to_activate:    avgDays,
    median_days_to_activate: medianDays,
    by_touch:                byTouch,
    days_distribution:       daysDist,
  }

  fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2))
  console.log('\nResults:')
  console.log(`  Customers with timing data: ${matched}`)
  console.log(`  Pre-outreach (activated before T1): ${preOutreach.length}`)
  console.log(`  Campaign-driven: ${nTimed}`)
  console.log(`  Avg days to activate: ${avgDays}d  (campaign-driven only)`)
  console.log(`  Median days:          ${medianDays}d  (campaign-driven only)`)
  console.log(`  After Touch 1: ${touchCounts.T1} (${byTouch[0].pct}%)`)
  console.log(`  After Touch 2: ${touchCounts.T2} (${byTouch[1].pct}%)`)
  console.log(`  After Touch 3: ${touchCounts.T3} (${byTouch[2].pct}%)`)
  console.log(`\n  data.json updated -> ${DATA_JSON}`)
  console.log('='.repeat(55))
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
