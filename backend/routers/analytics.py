"""
POST /api/analytics/track  — log page view (public, rate-limited by IP)
GET  /api/analytics/stats  — aggregated stats (admin)
GET  /api/analytics/recent — recent raw visits (admin)
"""
import asyncio
from datetime import datetime, timedelta, timezone
from collections import Counter

import httpx
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import PageView, User
from auth_utils import require_admin

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Simple in-memory rate limit: ip → last_track timestamp
_rate: dict[str, datetime] = {}
_RATE_SEC = 10  # min seconds between tracks per IP+path


def _parse_ua(ua: str) -> tuple[str, str, str]:
    """Returns (device, browser, os)."""
    ua = ua or ""
    ul = ua.lower()

    # Device
    if "tablet" in ul or "ipad" in ul or ("android" in ul and "mobile" not in ul):
        device = "tablet"
    elif "mobile" in ul or "iphone" in ul or "android" in ul:
        device = "mobile"
    else:
        device = "desktop"

    # Browser (order matters)
    if "edg/" in ul or "edge/" in ul:
        browser = "Edge"
    elif "opr/" in ul or "opera" in ul:
        browser = "Opera"
    elif "chrome/" in ul and "chromium" not in ul:
        browser = "Chrome"
    elif "firefox/" in ul:
        browser = "Firefox"
    elif "safari/" in ul:
        browser = "Safari"
    elif "curl" in ul or "python" in ul or "httpx" in ul:
        browser = "Bot"
    else:
        browser = "Other"

    # OS
    if "windows" in ul:
        os_ = "Windows"
    elif "android" in ul:
        os_ = "Android"
    elif "iphone" in ul or "ipad" in ul:
        os_ = "iOS"
    elif "mac os" in ul or "macos" in ul:
        os_ = "macOS"
    elif "linux" in ul:
        os_ = "Linux"
    else:
        os_ = "Other"

    return device, browser, os_


async def _geo_lookup(ip: str) -> tuple[str, str, str]:
    """Returns (country_code, country_name, city). Falls back to empty strings."""
    if not ip or ip in ("127.0.0.1", "::1", "unknown"):
        return "", "", ""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"http://ip-api.com/json/{ip}?fields=status,country,countryCode,city")
            d = r.json()
            if d.get("status") == "success":
                return d.get("countryCode", ""), d.get("country", ""), d.get("city", "")
    except Exception:
        pass
    return "", "", ""


class TrackPayload(BaseModel):
    path: str = "/"
    referrer: str = ""


@router.post("/track", status_code=204)
async def track(
    payload: TrackPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    # X-Real-IP is set by nginx from $remote_addr (trusted).
    # X-Forwarded-For first entry is client-controlled and spoofable.
    ip = (
        request.headers.get("X-Real-IP", "").strip()
        or (request.client.host if request.client else "unknown")
    )
    ua = request.headers.get("User-Agent", "")

    # Rate limit: same ip+path within N seconds = skip
    key = f"{ip}:{payload.path}"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if key in _rate and (now - _rate[key]).total_seconds() < _RATE_SEC:
        return
    _rate[key] = now

    # Trim rate cache
    if len(_rate) > 5000:
        cutoff = now - timedelta(minutes=5)
        for k in [k for k, v in _rate.items() if v < cutoff]:
            _rate.pop(k, None)

    device, browser, os_ = _parse_ua(ua)
    country_code, country_name, city = await _geo_lookup(ip)

    pv = PageView(
        path=payload.path[:300],
        ip=ip,
        country=country_code,
        country_name=country_name,
        city=city,
        device=device,
        browser=browser,
        os=os_,
        referrer=(payload.referrer or "")[:500],
    )
    db.add(pv)
    db.commit()


@router.get("/stats")
def stats(
    days: int = 7,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    rows = db.query(PageView).filter(PageView.created_at >= since).all()

    total_views   = len(rows)
    unique_ips    = len({r.ip for r in rows if r.ip})
    unique_pages  = len({r.path for r in rows})

    # Views per day
    day_counter: Counter = Counter()
    for r in rows:
        day_counter[r.created_at.strftime("%Y-%m-%d")] += 1
    views_per_day = [{"date": d, "views": c} for d, c in sorted(day_counter.items())]

    # Top pages
    page_counter: Counter = Counter(r.path for r in rows)
    top_pages = [{"path": p, "views": c} for p, c in page_counter.most_common(10)]

    # Countries
    country_counter: Counter = Counter()
    for r in rows:
        if r.country:
            country_counter[(r.country, r.country_name or r.country)] += 1
    top_countries = [
        {"code": c, "name": n, "views": v}
        for (c, n), v in country_counter.most_common(10)
    ]

    # Devices
    device_counter: Counter = Counter(r.device for r in rows if r.device)
    devices = [{"device": d, "views": c} for d, c in device_counter.most_common()]

    # Browsers
    browser_counter: Counter = Counter(r.browser for r in rows if r.browser)
    browsers = [{"browser": b, "views": c} for b, c in browser_counter.most_common(8)]

    # OS
    os_counter: Counter = Counter(r.os for r in rows if r.os)
    os_list = [{"os": o, "views": c} for o, c in os_counter.most_common(8)]

    # Top referrers
    ref_counter: Counter = Counter(r.referrer for r in rows if r.referrer and r.referrer != "direct")
    top_refs = [{"referrer": r, "views": c} for r, c in ref_counter.most_common(8)]

    return {
        "days": days,
        "total_views": total_views,
        "unique_ips": unique_ips,
        "unique_pages": unique_pages,
        "views_per_day": views_per_day,
        "top_pages": top_pages,
        "top_countries": top_countries,
        "devices": devices,
        "browsers": browsers,
        "os": os_list,
        "top_referrers": top_refs,
    }


@router.get("/recent")
def recent(
    limit: int = 50,
    days: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(PageView)
    if days and days > 0:
        since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        query = query.filter(PageView.created_at >= since)
    rows = query.order_by(PageView.created_at.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "path": r.path,
            "ip": r.ip,
            "country": r.country,
            "country_name": r.country_name,
            "city": r.city,
            "device": r.device,
            "browser": r.browser,
            "os": r.os,
            "referrer": r.referrer,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
