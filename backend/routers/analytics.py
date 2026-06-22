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
    user_id: int | None = None


@router.post("/track", status_code=204)
async def track(
    payload: TrackPayload,
    request: Request,
    db: Session = Depends(get_db),
):
    ip = (
        request.headers.get("X-Real-IP", "").strip()
        or (request.client.host if request.client else "unknown")
    )
    ua = request.headers.get("User-Agent", "")

    key = f"{ip}:{payload.path}"
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if key in _rate and (now - _rate[key]).total_seconds() < _RATE_SEC:
        return
    _rate[key] = now

    if len(_rate) >= 1000:
        cutoff = now - timedelta(minutes=5)
        for k in [k for k, v in _rate.items() if v < cutoff]:
            _rate.pop(k, None)

    device, browser, os_ = _parse_ua(ua)
    country_code, country_name, city = await _geo_lookup(ip)

    pv = PageView(
        path=payload.path[:300],
        ip=ip,
        user_id=payload.user_id,
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
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=days)
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

    # OS — total views + unique IPs
    os_ips: dict[str, set] = {}
    for r in rows:
        if r.os:
            os_ips.setdefault(r.os, set()).add(r.ip)
    os_counter: Counter = Counter(r.os for r in rows if r.os)
    os_list = [
        {"os": o, "views": os_counter[o], "unique_ips": len(os_ips.get(o, set()))}
        for o, _ in os_counter.most_common(8)
    ]

    # Browsers — total views + unique IPs
    br_ips: dict[str, set] = {}
    for r in rows:
        if r.browser:
            br_ips.setdefault(r.browser, set()).add(r.ip)
    # rebuild browser_counter with unique_ips
    browsers = [
        {"browser": b, "views": browser_counter[b], "unique_ips": len(br_ips.get(b, set()))}
        for b, _ in browser_counter.most_common(8)
    ]

    # Top referrers
    ref_counter: Counter = Counter(r.referrer for r in rows if r.referrer and r.referrer != "direct")
    top_refs = [{"referrer": r, "views": c} for r, c in ref_counter.most_common(8)]

    # Bounce rate — IPs with only 1 page view in period
    ip_views: Counter = Counter(r.ip for r in rows if r.ip)
    single_view_ips = sum(1 for c in ip_views.values() if c == 1)
    bounce_rate = round((single_view_ips / unique_ips * 100) if unique_ips else 0, 1)

    # Avg pages per visitor
    avg_pages = round(total_views / unique_ips, 2) if unique_ips else 0

    # Returning visitors — IPs seen before the current period
    ips_in_period = {r.ip for r in rows if r.ip}
    returning_ips_count = 0
    if ips_in_period:
        older_ips = {
            r.ip for r in db.query(PageView.ip)
            .filter(PageView.created_at < since, PageView.ip.in_(ips_in_period))
            .all()
        }
        returning_ips_count = len(older_ips)
    new_visitor_ips = unique_ips - returning_ips_count

    # New user registrations in period
    new_users_rows = db.query(User).filter(User.created_at >= since).all()
    new_users = len(new_users_rows)
    conversion_rate = round((new_users / unique_ips * 100) if unique_ips else 0, 2)

    # Registrations per day
    reg_day_counter: Counter = Counter()
    for u in new_users_rows:
        if u.created_at:
            reg_day_counter[u.created_at.strftime("%Y-%m-%d")] += 1
    registrations_per_day = [{"date": d, "count": c} for d, c in sorted(reg_day_counter.items())]

    # Total users
    total_users = db.query(func.count(User.id)).scalar() or 0

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
        "bounce_rate": bounce_rate,
        "avg_pages": avg_pages,
        "returning_visitors": returning_ips_count,
        "new_visitors": new_visitor_ips,
        "new_users": new_users,
        "total_users": total_users,
        "conversion_rate": conversion_rate,
        "registrations_per_day": registrations_per_day,
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


@router.get("/top-users")
def top_users(
    days: int = 30,
    limit: int = 20,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from sqlalchemy import text as sa_text
    from models import AuditLog

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=days)

    # Logins per user from audit_logs (action = 'login')
    login_rows = db.execute(sa_text("""
        SELECT
            al.user_id,
            u.name,
            u.email,
            COUNT(*) AS total_logins,
            MAX(al.created_at) AS last_login,
            MIN(al.created_at) AS first_login
        FROM audit_logs al
        JOIN users u ON u.id = al.user_id
        WHERE al.action = 'login' AND al.created_at >= :since
        GROUP BY al.user_id, u.name, u.email
        ORDER BY total_logins DESC
        LIMIT :limit
    """), {"since": since, "limit": limit}).fetchall()

    # Page views per user (only rows with user_id set)
    pv_rows = db.execute(sa_text("""
        SELECT
            pv.user_id,
            COUNT(*) AS page_views,
            COUNT(DISTINCT DATE(pv.created_at)) AS active_days,
            MAX(pv.created_at) AS last_seen
        FROM page_views pv
        WHERE pv.user_id IS NOT NULL AND pv.created_at >= :since
        GROUP BY pv.user_id
    """), {"since": since}).fetchall()

    pv_map = {r[0]: {"page_views": r[1], "active_days": r[2], "last_seen": r[3]} for r in pv_rows}

    result = []
    for r in login_rows:
        uid = r[0]
        pv = pv_map.get(uid, {})
        active_days = pv.get("active_days", 0) or 1
        total_pv = pv.get("page_views", 0) or 0
        result.append({
            "user_id": uid,
            "name": r[1],
            "email": r[2],
            "total_logins": r[3],
            "last_login": r[4].isoformat() if r[4] else None,
            "page_views": total_pv,
            "active_days": active_days,
            "avg_views_per_day": round(total_pv / active_days, 1) if active_days else 0,
            "last_seen": pv.get("last_seen").isoformat() if pv.get("last_seen") else None,
        })

    return {"days": days, "users": result}
