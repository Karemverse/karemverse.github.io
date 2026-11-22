"""Refresh the JSON files the site reads.

data/github.json   daily GitHub contributions for the last year (always).
data/revenue.json  monthly Stripe revenue per product (only when STRIPE_KEY_* env vars exist).

Stripe keys: one restricted key per Stripe account, read-only "Balance" permission, passed as
env vars named STRIPE_KEY_<PRODUCT>, for example STRIPE_KEY_INVITEO. The product id is the
lowercased suffix. Keys are read from the environment only and never written anywhere.

Standard library only, so the GitHub Action needs no install step.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GITHUB_USER = "KaremBenChikha"

# Stripe balance transaction types that count as revenue (refunds come in negative).
REVENUE_TYPES = {"charge", "payment", "refund", "payment_refund", "payment_failure_refund"}


# ---------- pure helpers (unit tested) ----------

def last_12_months(today: dt.date) -> list[str]:
    """Return 12 'YYYY-MM' keys ending with today's month, oldest first."""
    y, m = today.year, today.month
    out = []
    for _ in range(12):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def month_start(key: str) -> dt.datetime:
    y, m = map(int, key.split("-"))
    return dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)


def aggregate_revenue(txns: list[dict], months: list[str], today: dt.date) -> dict:
    """Sum balance transactions into months. Amounts are in the smallest currency unit."""
    by_month = OrderedDict((k, 0) for k in months)
    last30 = 0
    currency = None
    cutoff = dt.datetime.combine(today - dt.timedelta(days=30), dt.time(), tzinfo=dt.timezone.utc)
    for t in txns:
        if t.get("type") not in REVENUE_TYPES:
            continue
        when = dt.datetime.fromtimestamp(t["created"], tz=dt.timezone.utc)
        key = f"{when.year:04d}-{when.month:02d}"
        if key not in by_month:
            continue
        currency = currency or t.get("currency")
        by_month[key] += int(t["amount"])
        if when >= cutoff:
            last30 += int(t["amount"])
    return {
        "currency": (currency or "usd").lower(),
        "months": [[k, v] for k, v in by_month.items()],
        "last30": last30,
    }


def contributions_from_calendar(calendar: dict) -> dict:
    days = [
        [d["date"], d["contributionCount"]]
        for w in calendar["weeks"]
        for d in w["contributionDays"]
    ]
    return {"total": calendar["totalContributions"], "days": days}


def stripe_keys_from_env(env: dict) -> dict:
    return {
        k[len("STRIPE_KEY_"):].lower(): v
        for k, v in sorted(env.items())
        if k.startswith("STRIPE_KEY_") and v.strip()
    }


# ---------- network ----------

def _get_json(url: str, headers: dict, data: bytes | None = None) -> dict:
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_github(token: str) -> dict:
    query = """query($login:String!){user(login:$login){contributionsCollection{
      contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}"""
    body = json.dumps({"query": query, "variables": {"login": GITHUB_USER}}).encode()
    res = _get_json(
        "https://api.github.com/graphql",
        {"Authorization": f"bearer {token}", "Content-Type": "application/json"},
        body,
    )
    if "errors" in res:
        raise RuntimeError(f"GitHub GraphQL error: {res['errors'][0].get('message')}")
    cal = res["data"]["user"]["contributionsCollection"]["contributionCalendar"]
    return contributions_from_calendar(cal)


def fetch_stripe_txns(key: str, since: dt.datetime) -> list[dict]:
    auth = base64.b64encode(f"{key}:".encode()).decode()
    headers = {"Authorization": f"Basic {auth}"}
    params = {"limit": "100", "created[gte]": str(int(since.timestamp()))}
    out: list[dict] = []
    while True:
        url = "https://api.stripe.com/v1/balance_transactions?" + urllib.parse.urlencode(params)
        page = _get_json(url, headers)
        out.extend(page["data"])
        if not page.get("has_more"):
            return out
        params["starting_after"] = page["data"][-1]["id"]


def main() -> int:
    today = dt.datetime.now(dt.timezone.utc).date()
    DATA.mkdir(exist_ok=True)

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        gh = fetch_github(token)
        gh["asOf"] = today.isoformat()
        (DATA / "github.json").write_text(json.dumps(gh, separators=(",", ":")) + "\n")
        print(f"github: {gh['total']} contributions")
    else:
        print("github: no token, skipped")

    keys = stripe_keys_from_env(dict(os.environ))
    if keys:
        months = last_12_months(today)
        since = month_start(months[0])
        products = {}
        for pid, key in keys.items():
            products[pid] = aggregate_revenue(fetch_stripe_txns(key, since), months, today)
            print(f"stripe: {pid} ok")
        (DATA / "revenue.json").write_text(
            json.dumps({"asOf": today.isoformat(), "products": products}, indent=1) + "\n"
        )
    else:
        print("stripe: no STRIPE_KEY_* set, skipped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
