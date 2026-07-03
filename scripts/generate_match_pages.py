#!/usr/bin/env python3
"""Gera páginas SEO estáticas por partida em dist/jogos/<slug>.html.

Reaproveita helpers de generate_team_pages.py (fetch, esc, page_shell, TEAMS_PT,
PHASE_PT, match_slug, br_datetime, fmt_match_date). Roda:
  - no build do frontend (package.json)
  - via cron a cada 6h (mesmo horário do generate_team_pages.py)

Saída: dist/jogos/*.html, dist/jogos/index.html, dist/sitemap-jogos.xml.
Se a API estiver fora, avisa e sai com código 0 para não quebrar o build.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_team_pages import (  # noqa: E402
    fetch, esc, page_shell, br_datetime, fmt_match_date, match_slug,
    TEAMS_PT, PHASE_PT, BASE_URL, DIST, TZ_BR, API,
)

OUT = DIST / "jogos"


def _team_pt(team):
    return TEAMS_PT.get(team["code"], (team["name"], team["code"].lower(), ""))


def fetch_odds(match_id):
    req = urllib.request.Request(f"{API}/matches/{match_id}/simulate?n=50000", method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception:
        return None


def render_match_page(m, odds):
    a, b = m["team_a"], m["team_b"]
    a_pt, a_slug, _ = _team_pt(a)
    b_pt, b_slug, _ = _team_pt(b)
    slug = match_slug(m)
    canonical = f"{BASE_URL}/jogos/{slug}"

    finished = m["status"] == "finished" and m.get("result")
    live = m["status"] == "live"
    phase_label = PHASE_PT.get(m["phase"], m["phase"])
    group_txt = f" — Grupo {m['group_name']}" if m.get("group_name") else ""
    when = fmt_match_date(m["match_date"]) if m.get("match_date") else "data a definir"

    if finished:
        sa, sb = m["result"]["score_a"], m["result"]["score_b"]
        title = f"{a_pt} {sa} x {sb} {b_pt} — Resultado | Copa do Mundo 2026"
        description = (
            f"{a_pt} {sa} x {sb} {b_pt}: resultado final, estatísticas e ficha da partida "
            f"da Copa do Mundo 2026 ({phase_label})."
        )
    elif live:
        title = f"{a_pt} x {b_pt} AO VIVO — Copa do Mundo 2026"
        description = f"Acompanhe {a_pt} x {b_pt} ao vivo — placar em tempo real da Copa do Mundo 2026 ({phase_label})."
    else:
        title = f"{a_pt} x {b_pt}: palpite, horário e probabilidades | Copa 2026"
        description = (
            f"{a_pt} x {b_pt}, {when}: probabilidades estatísticas, palpite de placar e ficha da partida. "
            f"{phase_label}{group_txt} da Copa do Mundo 2026."
        )

    # --- hero score/status
    if finished:
        score_html = f'<div class="m-score" style="font-size:2rem">{m["result"]["score_a"]} × {m["result"]["score_b"]}</div>'
        chip = '<span class="chip chip--out">Encerrada</span>'
    elif live:
        sa = m.get("live_score_a")
        sb = m.get("live_score_b")
        score_html = f'<div class="m-score" style="font-size:2rem">🟢 {sa if sa is not None else "-"} × {sb if sb is not None else "-"}</div>'
        chip = '<span class="chip chip--live">Ao vivo</span>'
    else:
        score_html = '<div class="vs-label" style="font-size:1.4rem;font-weight:800;color:var(--text3)">VS</div>'
        chip = '<span class="chip chip--alive">Agendada</span>'

    place = f' · {esc(m["city"])}' if m.get("city") else ""

    # --- odds section (apenas para partidas ainda não realizadas)
    odds_html = ""
    if not finished and odds:
        odds_html = f"""<h2>Probabilidades estatísticas</h2>
<div class="card">
  <div class="prob-row"><span class="prob-label">{a["code"]}</span><span class="prob-bar"><span style="width:{max(odds['prob_a'],1):.1f}%"></span></span><span class="prob-val">{odds['prob_a']:.1f}%</span></div>
  <div class="prob-row"><span class="prob-label">Empate</span><span class="prob-bar"><span style="width:{max(odds['prob_draw'],1):.1f}%"></span></span><span class="prob-val">{odds['prob_draw']:.1f}%</span></div>
  <div class="prob-row"><span class="prob-label">{b["code"]}</span><span class="prob-bar"><span style="width:{max(odds['prob_b'],1):.1f}%"></span></span><span class="prob-val">{odds['prob_b']:.1f}%</span></div>
  <p class="m-info" style="margin-top:.7rem">Simulação Monte Carlo · Predicts.info · gols esperados {a["code"]} {odds['xg_a']:.2f} × {odds['xg_b']:.2f} {b["code"]}</p>
</div>
<h2>Placares mais prováveis</h2>
<div class="card"><div class="teams-nav">{"".join(
    f'<span class="team-pill">{s["score"].replace("x"," × ")} <strong style="margin-left:4px">{s["prob"]:.1f}%</strong></span>'
    for s in odds.get("top_scores", [])[:6]
)}</div></div>"""

    # --- FAQ
    faq = [(f"Que horas é o jogo {a_pt} x {b_pt}?",
            f"{a_pt} e {b_pt} jogam {when}." if not finished else f"A partida já foi encerrada — {when}.")]
    if odds and not finished:
        fav = a_pt if odds["prob_a"] > odds["prob_b"] else b_pt
        fav_pct = max(odds["prob_a"], odds["prob_b"])
        faq.append((f"Quem é favorito em {a_pt} x {b_pt}?",
                    f"Segundo o simulador estatístico do Predicts.info, {fav} é favorito com {fav_pct:.1f}% de chance de vitória."))
    if finished:
        sa, sb = m["result"]["score_a"], m["result"]["score_b"]
        winner = a_pt if sa > sb else b_pt if sb > sa else None
        faq.append((f"Qual o resultado de {a_pt} x {b_pt}?",
                    f"{a_pt} {sa} x {sb} {b_pt}." + (f" Vitória de {winner}." if winner else " Empate.")))
    faq.append((f"Onde assistir {a_pt} x {b_pt}?",
                "Consulte a programação oficial da FIFA e das emissoras de TV aberta/streaming do seu país para a Copa do Mundo 2026."))

    jsonld = [
        {
            "@context": "https://schema.org",
            "@type": "SportsEvent",
            "name": f"{a_pt} x {b_pt}",
            "startDate": m["match_date"] if m.get("match_date") else None,
            "eventStatus": "https://schema.org/EventCompleted" if finished else "https://schema.org/EventScheduled",
            "location": {"@type": "Place", "name": m.get("city") or m.get("venue") or "Copa do Mundo 2026"},
            "homeTeam": {"@type": "SportsTeam", "name": a_pt},
            "awayTeam": {"@type": "SportsTeam", "name": b_pt},
            "url": canonical,
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": aw}}
                for q, aw in faq
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Início", "item": BASE_URL + "/"},
                {"@type": "ListItem", "position": 2, "name": "Jogos", "item": BASE_URL + "/jogos/"},
                {"@type": "ListItem", "position": 3, "name": f"{a_pt} x {b_pt}", "item": canonical},
            ],
        },
    ]
    jsonld = [b for b in jsonld if b.get("startDate") or b["@type"] != "SportsEvent"]

    faq_html = "".join(
        f'<div class="faq-item"><div class="faq-q">{esc(q)}</div><div class="faq-a">{esc(aw)}</div></div>' for q, aw in faq
    )

    body = f"""<div class="crumb"><a href="/">Início</a> › <a href="/jogos/">Jogos</a> › {esc(a_pt)} x {esc(b_pt)}</div>
<div class="hero">
  <img src="{a["flag_url"].replace("w80","w160")}" alt="Bandeira de {esc(a_pt)}" />
  <div>
    <h1>{esc(a_pt)} x {esc(b_pt)} — Copa do Mundo 2026</h1>
    <div class="meta">{chip}<span class="chip">{phase_label}{group_txt}</span></div>
  </div>
  <img src="{b["flag_url"].replace("w80","w160")}" alt="Bandeira de {esc(b_pt)}" />
</div>
<div class="card" style="text-align:center;margin-top:1.25rem">
  <div style="display:flex;align-items:center;justify-content:center;gap:1.5rem;flex-wrap:wrap">
    <span style="font-weight:700">{esc(a_pt)}</span>
    {score_html}
    <span style="font-weight:700">{esc(b_pt)}</span>
  </div>
  <p class="m-info" style="margin-top:.6rem">{esc(when)}{place}</p>
</div>
{odds_html}
<h2>Perguntas frequentes</h2>
<div class="card">{faq_html}</div>
<div class="cta">
  <div style="font-size:1.3rem;font-weight:800">Dê seu palpite para {esc(a_pt)} x {esc(b_pt)}</div>
  <p>Crie sua conta grátis, aposte no placar exato e dispute o ranking do bolão da Copa 2026.</p>
  <a class="btn" href="/login?tab=register">Criar conta grátis →</a>
</div>"""

    return page_shell(title, description, canonical, body, jsonld)


def render_index(matches):
    canonical = f"{BASE_URL}/jogos/"
    title = "Jogos da Copa do Mundo 2026: palpites, horários e resultados"
    description = (
        "Todos os 104 jogos da Copa do Mundo 2026 com palpites, probabilidades estatísticas, "
        "horários e resultados atualizados jogo a jogo."
    )

    def card(m):
        a, b = m["team_a"], m["team_b"]
        a_pt = _team_pt(a)[0]
        b_pt = _team_pt(b)[0]
        if m["status"] == "finished" and m.get("result"):
            sub = f'{m["result"]["score_a"]} × {m["result"]["score_b"]} · encerrada'
        elif m["status"] == "live":
            sub = "🟢 ao vivo"
        else:
            sub = fmt_match_date(m["match_date"]) if m.get("match_date") else "a definir"
        return (
            f'<a class="tcard" href="/jogos/{match_slug(m)}">'
            f'<img src="{a["flag_url"]}" alt="{esc(a_pt)}" loading="lazy" />'
            f'<span><span class="tcard-name">{esc(a_pt)} x {esc(b_pt)}</span><br /><span class="tcard-sub">{esc(sub)}</span></span>'
            f'</a>'
        )

    sorted_matches = sorted(matches, key=lambda m: m.get("match_date") or "")
    jsonld = [{
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Jogos da Copa do Mundo 2026",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": f'{_team_pt(m["team_a"])[0]} x {_team_pt(m["team_b"])[0]}', "url": f"{BASE_URL}/jogos/{match_slug(m)}"}
            for i, m in enumerate(sorted_matches)
        ],
    }]

    body = f"""<div class="crumb"><a href="/">Início</a> › Jogos</div>
<h1>Jogos da Copa do Mundo 2026</h1>
<p style="color:var(--text2);margin:.5rem 0 1.5rem">Palpite, horário, probabilidades e resultado de cada um dos 104 jogos da Copa 2026.</p>
<div class="grid">{"".join(card(m) for m in sorted_matches)}</div>"""
    return page_shell(title, description, canonical, body, jsonld)


def render_sitemap(matches):
    today = datetime.now(TZ_BR).strftime("%Y-%m-%d")
    urls = [f"""  <url>
    <loc>{BASE_URL}/jogos/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.7</priority>
  </url>"""]
    for m in matches:
        urls.append(f"""  <url>
    <loc>{BASE_URL}/jogos/{match_slug(m)}</loc>
    <lastmod>{today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.6</priority>
  </url>""")
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n"


def main():
    try:
        matches = fetch("/matches?limit=1000")
    except Exception as e:
        print(f"[match-pages] API indisponível, páginas mantidas: {e}")
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    for m in matches:
        odds = None
        if not (m["status"] == "finished" and m.get("result")):
            odds = fetch_odds(m["id"])
        (OUT / f"{match_slug(m)}.html").write_text(render_match_page(m, odds), encoding="utf-8")
    (OUT / "index.html").write_text(render_index(matches), encoding="utf-8")
    (DIST / "sitemap-jogos.xml").write_text(render_sitemap(matches), encoding="utf-8")
    print(f"[match-pages] {len(matches)} páginas + index + sitemap-jogos.xml geradas em {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
