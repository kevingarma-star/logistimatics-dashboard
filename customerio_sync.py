#!/usr/bin/env python3
"""
customerio_sync.py
Daily sync from Supabase shopify_orders -> Customer.io Track API.

Handles three cases:
  A. New orders (funnel entry)  -> identify person + track order_shipped
  B. Newly activated            -> track subscription_activated (campaign exit)
  C. Newly returned             -> track device_returned (campaign exit)

State between runs is persisted in customerio_sync_state.json.
"""

import json, base64, urllib.request, urllib.error
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# ── Config ────────────────────────────────────────────────────────────────────

CONFIG_PATH = Path(__file__).parent / "customerio_config.json"
STATE_PATH  = Path(__file__).parent / "customerio_sync_state.json"

with open(CONFIG_PATH) as f:
    cfg = json.load(f)

SITE_ID = cfg["site_id"]
API_KEY = cfg["api_key"]
AUTH    = base64.b64encode(f"{SITE_ID}:{API_KEY}".encode()).decode()

TRACK_BASE = "https://track.customer.io/api/v1"

# ── Supabase ──────────────────────────────────────────────────────────────────

import sys
sys.path.insert(0, str(Path(__file__).parent))
from supabase_client import _fetch_all

# ── Customer.io API helpers ───────────────────────────────────────────────────

def _cio_request(method, path, body=None):
    url = f"{TRACK_BASE}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Basic {AUTH}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return True, None
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:300]}"
    except Exception as e:
        return False, str(e)


def identify_person(email, attributes):
    """Create or update a person in Customer.io."""
    return _cio_request("PUT", f"/customers/{urllib.parse.quote(email, safe='')}", attributes)


def track_event(email, event_name, properties=None):
    """Fire an event for a person in Customer.io."""
    body = {"name": event_name}
    if properties:
        body["data"] = properties
    return _cio_request(
        "POST",
        f"/customers/{urllib.parse.quote(email, safe='')}/events",
        body,
    )


# ── State helpers ─────────────────────────────────────────────────────────────

def load_state():
    if STATE_PATH.exists():
        with open(STATE_PATH) as f:
            return json.load(f)
    return {"seen_orders": {}}   # {order_key: {sub_id, return_at}}


def save_state(state):
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


# ── Main ──────────────────────────────────────────────────────────────────────

import urllib.parse

def seed_state():
    """
    First-time init: snapshot all current Supabase state WITHOUT firing
    any events to Customer.io. Run once before going live so that
    historical activations/returns are not replayed as new events.
    """
    print("INIT MODE — seeding state snapshot (no events will be fired)", flush=True)
    state = {"seen_orders": {}}

    print("Fetching Supabase shopify_orders...", flush=True)
    rows = _fetch_all(
        "shopify_orders",
        "customer_email,serial,subscription_id,return_processed_at",
    )
    print(f"  {len(rows)} rows loaded", flush=True)

    skipped_sl = 0
    for r in rows:
        email    = (r.get("customer_email") or "").strip().lower()
        serial   = (r.get("serial") or "").strip()
        sub_id   = (r.get("subscription_id") or "").strip()
        return_at = (r.get("return_processed_at") or "").strip()

        if not email or not serial:
            continue
        if serial.upper().startswith("SL"):
            skipped_sl += 1
            continue

        state["seen_orders"][f"{email}|{serial}"] = {
            "sub_id":    sub_id,
            "return_at": return_at,
        }

    save_state(state)
    print(f"  Snapshot saved: {len(state['seen_orders'])} order rows")
    print(f"  Skipped SL serials: {skipped_sl}")
    print("  Run without --init to start syncing new changes.")


def main(init=False):
    if init:
        seed_state()
        return

    print("Loading state...", flush=True)
    state = load_state()
    seen = state["seen_orders"]   # key = f"{email}|{serial}"

    if not seen:
        print("WARNING: state is empty. Run with --init first to snapshot existing data.")
        print("         Proceeding anyway — only truly new orders will fire events.")

    print("Fetching Supabase shopify_orders...", flush=True)
    rows = _fetch_all(
        "shopify_orders",
        "customer_email,billing_name,ship_date,serial,subscription_id,return_processed_at",
    )
    print(f"  {len(rows)} rows loaded", flush=True)

    # Group rows by email — one person per email in Customer.io
    by_email = defaultdict(list)
    for r in rows:
        email = (r.get("customer_email") or "").strip().lower()
        if not email:
            continue
        serial = (r.get("serial") or "").strip()
        if serial.upper().startswith("SL"):
            continue
        if not serial:
            continue
        by_email[email].append(r)

    new_entries = activated = returned = errors = 0

    for email, person_rows in by_email.items():
        # Build merged person state from all their rows
        name       = ""
        ship_dates = []
        serials    = []
        any_sub_id = any((r.get("subscription_id") or "").strip() for r in person_rows)
        any_return = any((r.get("return_processed_at") or "").strip() for r in person_rows)

        for r in person_rows:
            serial  = (r.get("serial") or "").strip()
            billing = (r.get("billing_name") or "").strip()
            sd      = (r.get("ship_date") or "").strip()[:10]

            if not name and billing:
                name = billing.split()[0]
            if serial and serial not in serials:
                serials.append(serial)
            if sd:
                ship_dates.append(sd)

        if not serials:
            continue

        first_serial = serials[0]
        ship_date    = max(ship_dates) if ship_dates else ""
        first_name   = name or "there"
        serials_str  = ",".join(serials)

        # Check each individual row for state changes
        for r in person_rows:
            serial    = (r.get("serial") or "").strip()
            sub_id    = (r.get("subscription_id") or "").strip()
            return_at = (r.get("return_processed_at") or "").strip()
            order_key = f"{email}|{serial}"
            prev      = seen.get(order_key, {})

            # Case B: newly activated
            if sub_id and not prev.get("sub_id"):
                ok, err = track_event(email, "subscription_activated", {"serial": serial})
                if ok:
                    activated += 1
                    print(f"  [ACTIVATED] {email} serial={serial}")
                else:
                    errors += 1
                    print(f"  [ERROR] activation event for {email}: {err}")

            # Case C: newly returned
            if return_at and not prev.get("return_at"):
                ok, err = track_event(email, "device_returned", {"serial": serial})
                if ok:
                    returned += 1
                    print(f"  [RETURNED] {email} serial={serial}")
                else:
                    errors += 1
                    print(f"  [ERROR] return event for {email}: {err}")

            # Update seen state
            seen[order_key] = {"sub_id": sub_id, "return_at": return_at}

        # Case A: new person (not seen before at all for any serial)
        person_keys = [f"{email}|{s}" for s in serials]
        is_new = not any(k in state["seen_orders"] for k in person_keys)

        if is_new and not any_sub_id and not any_return and ship_date:
            # Identify person
            ok, err = identify_person(email, {
                "first_name":   first_name,
                "serials":      serials_str,
                "first_serial": first_serial,
                "ship_date":    ship_date,
            })
            if not ok:
                errors += 1
                print(f"  [ERROR] identify {email}: {err}")
                continue

            # Fire funnel entry event
            ok, err = track_event(email, "order_shipped", {
                "ship_date":    ship_date,
                "serial":       first_serial,
                "serials":      serials_str,
                "first_name":   first_name,
            })
            if ok:
                new_entries += 1
                print(f"  [NEW] {email} ({first_name}) ship={ship_date} serials={serials_str}")
            else:
                errors += 1
                print(f"  [ERROR] order_shipped event for {email}: {err}")

    save_state(state)

    print(f"""
=== SYNC COMPLETE ===
  New funnel entries:  {new_entries}
  Activated (exited):  {activated}
  Returned (exited):   {returned}
  Errors:              {errors}
""")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--init", action="store_true",
                        help="Seed state snapshot from current Supabase data (no events fired). Run once before going live.")
    args = parser.parse_args()
    main(init=args.init)
