"""
POST /api/analytics/track  — log page view (public, rate-limited by IP)
GET  /api/analytics/stats  — aggregated stats (admin)
GET  /api/analytics/recent — recent raw visits (admin)
"""
import asyncio
from datetime import datetime, timedelta, timezone
from collections import Counter

import httpx
from fastapi import APIRouter, Depends, Query, Request
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

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    since = now - timedelta(days=days)

    # Primary: page_views grouped by user_id (logged-in page views)
    rows = db.execute(sa_text("""
        SELECT
            pv.user_id,
            u.name,
            u.email,
            COUNT(*) AS page_views,
            COUNT(DISTINCT DATE(pv.created_at)) AS active_days,
            MAX(pv.created_at) AS last_seen,
            MIN(pv.created_at) AS first_seen
        FROM page_views pv
        JOIN users u ON u.id = pv.user_id
        WHERE pv.user_id IS NOT NULL AND pv.created_at >= :since
        GROUP BY pv.user_id, u.name, u.email
        ORDER BY page_views DESC
        LIMIT :limit
    """), {"since": since, "limit": limit}).fetchall()

    result = []
    for r in rows:
        active_days = int(r[4]) or 1
        total_pv = int(r[3])
        result.append({
            "user_id": r[0],
            "name": r[1],
            "email": r[2],
            "page_views": total_pv,
            "active_days": active_days,
            "avg_views_per_day": round(total_pv / active_days, 1),
            "last_seen": r[5].isoformat() if r[5] else None,
            "first_seen": r[6].isoformat() if r[6] else None,
        })

    return {"days": days, "users": result}


@router.get("/bets-audit")
def bets_audit(
    result_filter: str | None = Query(default=None, alias="result"),  # exact|correct|wrong|pending
    phase: str | None = Query(default=None),
    user_id: int | None = Query(default=None),
    match_id: int | None = Query(default=None),
    limit: int = Query(default=200, le=1000),
    offset: int = Query(default=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    from sqlalchemy import text as sa_text

    conditions = ["1=1"]
    params: dict = {"limit": limit, "offset": offset}

    if result_filter == "exact":
        conditions.append("b.points_earned IN (3, 25)")
    elif result_filter == "correct":
        conditions.append("b.points_earned > 0 AND b.points_earned NOT IN (3, 25) AND b.evaluated_at IS NOT NULL")
    elif result_filter == "wrong":
        conditions.append("b.points_earned = 0 AND b.evaluated_at IS NOT NULL")
    elif result_filter == "pending":
        conditions.append("b.evaluated_at IS NULL")

    if phase:
        conditions.append("m.phase = :phase")
        params["phase"] = phase
    if user_id:
        conditions.append("b.user_id = :user_id")
        params["user_id"] = user_id
    if match_id:
        conditions.append("b.match_id = :match_id")
        params["match_id"] = match_id

    where = " AND ".join(conditions)

    rows = db.execute(sa_text(f"""
        SELECT
            b.id, b.user_id, u.name AS user_name, u.email AS user_email,
            b.match_id,
            ta.code AS team_a, tb.code AS team_b,
            ta.name AS team_a_name, tb.name AS team_b_name,
            b.score_a AS bet_a, b.score_b AS bet_b,
            mr.score_a AS real_a, mr.score_b AS real_b,
            b.points_earned, b.evaluated_at, b.created_at,
            m.match_date, m.phase, m.group_name
        FROM bets b
        JOIN users u ON u.id = b.user_id
        JOIN matches m ON m.id = b.match_id
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        LEFT JOIN match_results mr ON mr.match_id = m.id
        WHERE {where}
        ORDER BY b.created_at DESC
        LIMIT :limit OFFSET :offset
    """), params).fetchall()

    total_row = db.execute(sa_text(f"""
        SELECT COUNT(*) FROM bets b
        JOIN users u ON u.id = b.user_id
        JOIN matches m ON m.id = b.match_id
        JOIN teams ta ON ta.id = m.team_a_id
        JOIN teams tb ON tb.id = m.team_b_id
        LEFT JOIN match_results mr ON mr.match_id = m.id
        WHERE {where}
    """), {k: v for k, v in params.items() if k not in ("limit", "offset")}).scalar()

    # Summary stats (all bets, no filter)
    summary = db.execute(sa_text("""
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN b.points_earned IN (3,25) THEN 1 ELSE 0 END) AS exact,
            SUM(CASE WHEN b.points_earned > 0 AND b.points_earned NOT IN (3,25) AND b.evaluated_at IS NOT NULL THEN 1 ELSE 0 END) AS correct,
            SUM(CASE WHEN b.points_earned = 0 AND b.evaluated_at IS NOT NULL THEN 1 ELSE 0 END) AS wrong,
            SUM(CASE WHEN b.evaluated_at IS NULL THEN 1 ELSE 0 END) AS pending,
            COUNT(DISTINCT b.user_id) AS unique_users,
            COUNT(DISTINCT b.match_id) AS unique_matches
        FROM bets b
    """)).fetchone()

    def _res(r):
        if r[14] is None:  # evaluated_at
            return "pending"
        pts = r[13] or 0
        if pts in (3, 25):
            return "exact"
        if pts > 0:
            return "correct"
        return "wrong"

    items = []
    for r in rows:
        items.append({
            "id": r[0],
            "user_id": r[1],
            "user_name": r[2],
            "user_email": r[3],
            "match_id": r[4],
            "team_a": r[5], "team_b": r[6],
            "team_a_name": r[7], "team_b_name": r[8],
            "bet_a": r[9], "bet_b": r[10],
            "real_a": r[11], "real_b": r[12],
            "points": r[13] or 0,
            "result": _res(r),
            "evaluated_at": r[14].isoformat() if r[14] else None,
            "created_at": r[15].isoformat() if r[15] else None,
            "match_date": r[16].isoformat() if r[16] else None,
            "phase": r[17],
            "group_name": r[18],
        })

    return {
        "total": total_row or 0,
        "summary": {
            "total": int(summary[0] or 0),
            "exact": int(summary[1] or 0),
            "correct": int(summary[2] or 0),
            "wrong": int(summary[3] or 0),
            "pending": int(summary[4] or 0),
            "unique_users": int(summary[5] or 0),
            "unique_matches": int(summary[6] or 0),
        },
        "items": items,
    }
