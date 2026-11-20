/**
 * sync_cancellations_appscript.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Google Apps Script — paste the entire file into your Google Sheet's
 * script editor (Extensions → Apps Script), then follow SETUP below.
 *
 * SETUP (one-time):
 *   1. In the script editor, click Project Settings (gear icon) →
 *      Script Properties → Add property:
 *        SUPABASE_URL          https://ttuwdvwanxixzqrscmbz.supabase.co
 *        SUPABASE_SERVICE_KEY  <your service-role key from Supabase →
 *                               Settings → API → service_role>
 *        SHEET_NAME            <exact name of the tab in your spreadsheet>
 *
 *   2. Run setupDailyTrigger() once (from the editor Run menu) to register
 *      the daily sync trigger.  You'll be asked to authorize the script.
 *
 *   3. Run syncCancellationsToSupabase() manually once to do the initial
 *      full import (same as running upsert_cancellations.py).
 *
 * After that the script runs automatically every day at ~6 AM and syncs
 * any new or updated rows.
 *
 * NOTE: This uses the Supabase SERVICE ROLE key (not the anon/publishable
 * key) because writes require elevated permissions.  The key is stored in
 * Script Properties, never in the script source code itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── cancel_mode → cancel_category mapping ─────────────────────────────────────
var CANCEL_MODE_TO_CATEGORY = {
  'customer cancellation':        'Voluntary (customer)',
  'other user cancellation':      'Voluntary (customer)',
  'gpx admin cancellation':       'Voluntary (via GPX staff)',
  'non-payment':                  'Involuntary (non-payment)',
  'ops bulk update':              'Operational (GPX staff)',
  'device unassigned (archived)': 'Operational (GPX staff)',
  'account data deleted':         'Operational (GPX staff)',
};

// Columns written to Supabase (must match table definition exactly)
var KNOWN_COLS = [
  'cancellation_id', 'subscription_id', 'account_id',
  'outcome', 'cancel_mode', 'cancel_category', 'cancel_timing',
  'initiated_by', 'initiated_by_name', 'initiated_by_email', 'cancelled_by',
  'initiated_at', 'effective_at', 'withdrawn_at', 'term_end_at',
  'recovered_at', 'sub_started_at', 'customer_since',
  'pending_overdue', 'current_status', 'account_fully_churned',
  'recovery', 'recovered_subscription_id',
  'account_title', 'primary_contact_name', 'primary_contact_email',
  'device_model', 'device_serial', 'purchase_channel',
  'plan_months', 'plan_price_usd', 'plan_monthly_price_usd',
  'sub_age_months', 'mrr_at_cancel_usd', 'cancellation_reason',
];

var TIMESTAMP_COLS = [
  'initiated_at', 'effective_at', 'withdrawn_at', 'term_end_at',
  'recovered_at', 'sub_started_at', 'customer_since',
];

var BOOL_COLS   = ['pending_overdue', 'account_fully_churned'];
var NUMERIC_COLS = [
  'plan_months', 'plan_price_usd', 'plan_monthly_price_usd',
  'sub_age_months', 'mrr_at_cancel_usd',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseCol(name) {
  return String(name).trim().toLowerCase().replace(/[\s\-\/]+/g, '_');
}

function deriveCategory(row) {
  var cat = row['cancel_category'];
  if (cat && String(cat).trim()) return String(cat).trim();
  var mode = String(row['cancel_mode'] || '').trim().toLowerCase();
  return CANCEL_MODE_TO_CATEGORY[mode] || null;
}

function parseTimestamp(val) {
  if (val === null || val === undefined || val === '') return null;
  // Google Sheets returns Date objects for date cells
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString();
  }
  var s = String(val).trim();
  if (!s || s === 'Invalid Date') return null;
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function parseBool(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'boolean') return val;
  var s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return null;
}

function parseNumeric(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return val;
  var n = parseFloat(String(val).replace(/[$,]/g, '').trim());
  return isNaN(n) ? null : n;
}

// ── Main sync function ────────────────────────────────────────────────────────

function syncCancellationsToSupabase() {
  var props   = PropertiesService.getScriptProperties();
  var baseUrl = props.getProperty('SUPABASE_URL');
  var svcKey  = props.getProperty('SUPABASE_SERVICE_KEY');
  var sheetName = props.getProperty('SHEET_NAME');

  if (!baseUrl || !svcKey || !sheetName) {
    throw new Error(
      'Missing Script Properties. Set SUPABASE_URL, SUPABASE_SERVICE_KEY, and SHEET_NAME.'
    );
  }

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet "' + sheetName + '" not found.');

  var allValues = sheet.getDataRange().getValues();
  if (allValues.length < 2) {
    Logger.log('Sheet is empty or has only headers — nothing to sync.');
    return;
  }

  // Build column index: normalised header → column index
  var rawHeaders = allValues[0];
  var colIndex   = {};
  rawHeaders.forEach(function(h, i) { colIndex[normaliseCol(h)] = i; });

  if (colIndex['cancellation_id'] === undefined) {
    throw new Error('Column "cancellation_id" (or similar) not found in sheet headers.');
  }

  var now    = new Date().toISOString();
  var rows   = [];
  var skipped = 0;

  for (var r = 1; r < allValues.length; r++) {
    var rowArr = allValues[r];
    var cid = String(rowArr[colIndex['cancellation_id']] || '').trim();
    if (!cid) { skipped++; continue; }

    // Build a raw map of normalised_col → cell value
    var raw = {};
    Object.keys(colIndex).forEach(function(col) {
      raw[col] = rowArr[colIndex[col]];
    });

    var rec = { cancellation_id: cid, refreshed_at: now };

    KNOWN_COLS.forEach(function(col) {
      if (col === 'cancellation_id') return;
      var val = raw[col];

      if (TIMESTAMP_COLS.indexOf(col) !== -1) {
        rec[col] = parseTimestamp(val);
      } else if (BOOL_COLS.indexOf(col) !== -1) {
        rec[col] = parseBool(val);
      } else if (NUMERIC_COLS.indexOf(col) !== -1) {
        rec[col] = parseNumeric(val);
      } else if (col === 'recovery') {
        rec[col] = (val !== null && val !== undefined && String(val).trim()) ? String(val).trim() : '';
      } else {
        var s = (val !== null && val !== undefined) ? String(val).trim() : '';
        rec[col] = s || null;
      }
    });

    rec['cancel_category'] = deriveCategory(rec);
    rows.push(rec);
  }

  Logger.log('Rows to upsert: ' + rows.length + '  |  Skipped (no ID): ' + skipped);
  if (!rows.length) return;

  // Upsert in batches of 200
  var BATCH = 200;
  var endpoint = baseUrl + '/rest/v1/subscription_cancellations';
  var headers  = {
    'apikey':        svcKey,
    'Authorization': 'Bearer ' + svcKey,
    'Content-Type':  'application/json',
    'Prefer':        'resolution=merge-duplicates',
  };

  var totalUpserted = 0;
  for (var i = 0; i < rows.length; i += BATCH) {
    var batch = rows.slice(i, i + BATCH);
    var resp  = UrlFetchApp.fetch(endpoint, {
      method:           'post',
      headers:          headers,
      payload:          JSON.stringify(batch),
      muteHttpExceptions: true,
    });

    var status = resp.getResponseCode();
    if (status < 200 || status >= 300) {
      Logger.log('ERROR on batch ' + Math.floor(i / BATCH + 1) + ': HTTP ' + status);
      Logger.log(resp.getContentText().slice(0, 500));
      // Continue with remaining batches rather than aborting
    } else {
      totalUpserted += batch.length;
      Logger.log('Batch ' + Math.floor(i / BATCH + 1) + ' — ' + (i + batch.length) + '/' + rows.length + ' rows upserted');
    }
  }

  Logger.log('Done — ' + totalUpserted + ' rows written to subscription_cancellations');

  // Write a summary to a "Sync Log" sheet (creates it if absent)
  writeSyncLog(ss, totalUpserted, skipped, rows.length);
}

// ── Sync log sheet ────────────────────────────────────────────────────────────

function writeSyncLog(ss, upserted, skipped, total) {
  var logSheet = ss.getSheetByName('Sync Log');
  if (!logSheet) {
    logSheet = ss.insertSheet('Sync Log');
    logSheet.appendRow(['Timestamp', 'Total rows', 'Upserted', 'Skipped']);
    logSheet.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
  logSheet.appendRow([new Date(), total, upserted, skipped]);
}

// ── Custom menu ───────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Supabase Sync')
    .addItem('Sync now', 'syncCancellationsToSupabase')
    .addItem('Set up daily trigger', 'setupDailyTrigger')
    .addItem('Remove daily trigger', 'removeDailyTrigger')
    .addToUi();
}

// ── Trigger management ────────────────────────────────────────────────────────

/**
 * Run this once from the script editor to set up a daily trigger at 6 AM.
 * Re-running it won't create duplicates — it removes any existing
 * syncCancellationsToSupabase trigger first.
 */
function setupDailyTrigger() {
  removeDailyTrigger(); // remove old one if present
  ScriptApp.newTrigger('syncCancellationsToSupabase')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  Logger.log('Daily trigger set — runs every day at ~6 AM.');
  SpreadsheetApp.getUi().alert('Daily trigger set — sync will run every day at ~6 AM.');
}

function removeDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'syncCancellationsToSupabase'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
}
