#!/usr/bin/env python3
"""Gera páginas SEO estáticas por seleção em dist/copa/<slug>.html.

Fontes: API local (tournament/simulate + matches). Roda:
  - no build do frontend (package.json)
  - via cron a cada 6h (dados sincronizam nesse ritmo)

Saída: dist/copa/*.html, dist/copa/index.html, dist/sitemap-copa.xml.
Se a API estiver fora, avisa e sai com código 0 para não quebrar o build.
"""
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

API = "http://127.0.0.1:8130/api"
DIST = Path("/opt/predicts/frontend/dist")
OUT = DIST / "copa"
BASE_URL = "https://predicts.info"
TZ_BR = ZoneInfo("America/Sao_Paulo")

# code -> (nome pt-BR, slug, artigo definido: o/a/os/"")
TEAMS_PT = {
    "ALG": ("Argélia", "argelia", "a"),
    "ARG": ("Argentina", "argentina", "a"),
    "AUS": ("Austrália", "australia", "a"),
    "AUT": ("Áustria", "austria", "a"),
    "BEL": ("Bélgica", "belgica", "a"),
    "BIH": ("Bósnia e Herzegovina", "bosnia-e-herzegovina", "a"),
    "BRA": ("Brasil", "brasil", "o"),
    "CAN": ("Canadá", "canada", "o"),
    "CIV": ("Costa do Marfim", "costa-do-marfim", "a"),
    "COD": ("RD Congo", "rd-congo", "a"),
    "COL": ("Colômbia", "colombia", "a"),
    "CPV": ("Cabo Verde", "cabo-verde", ""),
    "CRO": ("Croácia", "croacia", "a"),
    "CUW": ("Curaçao", "curacao", ""),
    "CZE": ("República Tcheca", "republica-tcheca", "a"),
    "ECU": ("Equador", "equador", "o"),
    "EGY": ("Egito", "egito", "o"),
    "ENG": ("Inglaterra", "inglaterra", "a"),
    "ESP": ("Espanha", "espanha", "a"),
    "FRA": ("França", "franca", "a"),
    "GER": ("Alemanha", "alemanha", "a"),
    "GHA": ("Gana", "gana", ""),
    "HAI": ("Haiti", "haiti", "o"),
    "IRN": ("Irã", "ira", "o"),
    "IRQ": ("Iraque", "iraque", "o"),
    "JOR": ("Jordânia", "jordania", "a"),
    "JPN": ("Japão", "japao", "o"),
    "KOR": ("Coreia do Sul", "coreia-do-sul", "a"),
    "KSA": ("Arábia Saudita", "arabia-saudita", "a"),
    "MAR": ("Marrocos", "marrocos", ""),
    "MEX": ("México", "mexico", "o"),
    "NED": ("Holanda", "holanda", "a"),
    "NOR": ("Noruega", "noruega", "a"),
    "NZL": ("Nova Zelândia", "nova-zelandia", "a"),
    "PAN": ("Panamá", "panama", "o"),
    "PAR": ("Paraguai", "paraguai", "o"),
    "POR": ("Portugal", "portugal", ""),
    "QAT": ("Catar", "catar", "o"),
    "RSA": ("África do Sul", "africa-do-sul", "a"),
    "SCO": ("Escócia", "escocia", "a"),
    "SEN": ("Senegal", "senegal", "o"),
    "SUI": ("Suíça", "suica", "a"),
    "SWE": ("Suécia", "suecia", "a"),
    "TUN": ("Tunísia", "tunisia", "a"),
    "TUR": ("Turquia", "turquia", "a"),
    "URU": ("Uruguai", "uruguai", "o"),
    "USA": ("Estados Unidos", "estados-unidos", "os"),
    "UZB": ("Uzbequistão", "uzbequistao", "o"),
}

PHASE_ORDER = {"group": 0, "r32": 1, "r16": 2, "qf": 3, "sf": 4, "third": 5, "f": 6, "final": 6}
PHASE_PT = {
    "group": "Fase de grupos",
    "r32": "16 avos de final",
    "r16": "Oitavas de final",
    "qf": "Quartas de final",
    "sf": "Semifinal",
    "third": "Disputa de 3º lugar",
    "f": "Final",
    "final": "Final",
}
WEEKDAYS_PT = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]


def _de(art):
    """Contração de+artigo: 'do Brasil', 'da Argentina', 'dos EUA', 'de Portugal'."""
    return {"o": "do ", "a": "da ", "os": "dos ", "": "de "}[art]


def _nom(art):
    """Artigo nominativo: 'o Brasil joga', 'Portugal joga'."""
    return {"o": "o ", "a": "a ", "os": "os ", "": ""}[art]


def fetch(path):
    with urllib.request.urlopen(f"{API}{path}", timeout=60) as r:
        return json.load(r)


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def br_datetime(iso):
    """match_date vem em UTC naive -> converte para Brasília."""
    dt = datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).astimezone(TZ_BR)
    return dt


def fmt_match_date(iso):
    dt = br_datetime(iso)
    return f"{WEEKDAYS_PT[dt.weekday()]}, {dt.strftime('%d/%m')} às {dt.strftime('%H:%M')} (Brasília)"


def build_team_data(sim_teams, matches):
    """Monta dict por code: infos, jogos, grupo, status real derivado das partidas."""
    teams = {}
    for t in sim_teams:
        code = t["code"]
        pt_name, slug, art = TEAMS_PT.get(code, (t["name"], code.lower(), ""))
        teams[code] = {
            **t,
            "pt_name": pt_name,
            "slug": slug,
            "art": art,
            "matches": [],
            "group": None,
            "status": None,
            "eliminated_phase": None,
        }

    phase_teams = {}  # phase -> set(codes)
    for m in matches:
        for side in ("team_a", "team_b"):
            tm = m.get(side)
            if not tm or tm["code"] not in teams:
                continue
            code = tm["code"]
            teams[code]["matches"].append(m)
            phase_teams.setdefault(m["phase"], set()).add(code)
            if m["phase"] == "group" and m.get("group_name"):
                teams[code]["group"] = m["group_name"]

    for t in teams.values():
        t["matches"].sort(key=lambda m: m.get("match_date") or "")

    # Eliminação por derrota em mata-mata; empate resolve por aparição em fase posterior
    knockout = sorted((p for p in phase_teams if p != "group"), key=lambda p: PHASE_ORDER.get(p, 9))
    for m in matches:
        phase = m["phase"]
        if phase == "group" or m["status"] != "finished" or not m.get("result"):
            continue
        a, b = m["team_a"]["code"], m["team_b"]["code"]
        sa, sb = m["result"]["score_a"], m["result"]["score_b"]
        loser = None
        if sa > sb:
            loser = b
        elif sb > sa:
            loser = a
        else:
            later = [p for p in knockout if PHASE_ORDER.get(p, 9) > PHASE_ORDER.get(phase, 9)]
            a_later = any(a in phase_teams.get(p, set()) for p in later)
            b_later = any(b in phase_teams.get(p, set()) for p in later)
            if a_later and not b_later:
                loser = b
            elif b_later and not a_later:
                loser = a
        if loser and teams[loser]["eliminated_phase"] is None:
            teams[loser]["eliminated_phase"] = phase

    first_ko = knockout[0] if knockout else None
    for code, t in teams.items():
        live = any(m["status"] == "live" for m in t["matches"])
        scheduled = [m for m in t["matches"] if m["status"] == "scheduled"]
        if live:
            t["status"] = ("live", "Em campo agora")
        elif t["eliminated_phase"]:
            t["status"] = ("out", f"Eliminada — {PHASE_PT[t['eliminated_phase']]}")
        elif first_ko and code not in phase_teams.get(first_ko, set()):
            t["status"] = ("out", "Eliminada — Fase de grupos")
            t["eliminated_phase"] = "group"
        elif scheduled:
            t["status"] = ("alive", f"Classificada — {PHASE_PT.get(scheduled[0]['phase'], 'próxima fase')}")
        else:
            t["status"] = ("alive", "Classificada — aguarda chaveamento")
        t["next_match"] = scheduled[0] if scheduled else None
        played = [m for m in t["matches"] if m["status"] == "finished"]
        t["last_phase"] = max((m["phase"] for m in t["matches"]), key=lambda p: PHASE_ORDER.get(p, 0), default="group")
        t["played"] = played
    return teams


CSS = """
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{color-scheme:light;--bg:#f5f8fc;--bg2:#fff;--border:rgba(35,72,104,.14);--accent:#0f7a78;--accent2:#0a5856;
--text1:#102133;--text2:#39556f;--text3:#70869d;--pill:rgba(15,122,120,.08);--ctaBorder:rgba(15,122,120,.18);--r:8px}
[data-theme=dark]{color-scheme:dark;--bg:#0a0a0f;--bg2:#111118;--border:#1e1e2e;--accent:#7c3aed;--accent2:#a855f7;
--text1:#f1f0ff;--text2:#a8a7c0;--text3:#5c5b78;--pill:rgba(255,255,255,.04);--ctaBorder:rgba(124,58,237,.2)}
body{background:var(--bg);color:var(--text1);font-family:system-ui,-apple-system,sans-serif;line-height:1.6}
a{color:var(--accent2);text-decoration:none}a:hover{text-decoration:underline}
nav{display:flex;align-items:center;justify-content:space-between;padding:1rem 2rem;border-bottom:1px solid var(--border);background:var(--bg2)}
.nav-brand{font-size:1.1rem;font-weight:800;color:var(--text1)}.nav-brand span{color:var(--accent2)}
.nav-cta{background:var(--accent);color:#f7fffd;padding:.5rem 1.1rem;border-radius:var(--r);font-weight:600;font-size:.85rem}
.nav-cta:hover{background:var(--accent2);text-decoration:none}
main{max-width:860px;margin:0 auto;padding:1.5rem 1.25rem 3rem}
.crumb{font-size:.8rem;color:var(--text3);margin-bottom:1.25rem}
.hero{display:flex;align-items:center;gap:1.25rem;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:1.5rem;flex-wrap:wrap}
.hero img{width:86px;height:60px;object-fit:cover;border-radius:6px;box-shadow:0 0 0 1px var(--border)}
h1{font-size:clamp(1.5rem,4.5vw,2.2rem);font-weight:900;line-height:1.15;letter-spacing:-.02em}
.meta{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.5rem}
.chip{background:var(--pill);border:1px solid var(--border);border-radius:100px;padding:.2rem .7rem;font-size:.75rem;font-weight:600;color:var(--text2)}
.chip--live{color:#fff;background:#16a34a;border-color:#16a34a}
.chip--out{color:#fff;background:#b91c1c;border-color:#b91c1c}
.chip--alive{color:#fff;background:var(--accent);border-color:var(--accent)}
h2{font-size:1.2rem;font-weight:800;margin:2.25rem 0 .9rem}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:1.25rem}
.prob-row{display:flex;align-items:center;gap:.7rem;padding:.4rem 0;font-size:.9rem}
.prob-label{min-width:130px;color:var(--text2);font-weight:600}
.prob-bar{flex:1;height:9px;background:var(--pill);border-radius:100px;overflow:hidden}
.prob-bar span{display:block;height:100%;background:var(--accent);border-radius:100px}
.prob-val{min-width:52px;text-align:right;font-weight:800;color:var(--accent2);font-variant-numeric:tabular-nums}
.m-row{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.6rem 0;border-bottom:1px solid var(--border);font-size:.9rem;flex-wrap:wrap}
.m-row:last-child{border-bottom:none}
.m-teams{display:flex;align-items:center;gap:.45rem;font-weight:700}
.m-teams img{width:23px;height:16px;object-fit:cover;border-radius:3px;box-shadow:0 0 0 1px var(--border)}
.m-score{font-weight:900;font-variant-numeric:tabular-nums}
.m-info{color:var(--text3);font-size:.78rem}
.faq-item{border-bottom:1px solid var(--border);padding:1rem 0}
.faq-item:last-child{border-bottom:none}
.faq-q{font-weight:700;margin-bottom:.35rem}
.faq-a{color:var(--text2);font-size:.92rem}
.teams-nav{display:flex;flex-wrap:wrap;gap:.45rem}
.team-pill{display:inline-flex;align-items:center;gap:.4rem;background:var(--pill);border:1px solid var(--border);border-radius:100px;padding:.3rem .75rem;font-size:.8rem;font-weight:600;color:var(--text2)}
.team-pill:hover{border-color:var(--accent2);text-decoration:none;color:var(--text1)}
.team-pill img{width:20px;height:14px;object-fit:cover;border-radius:2px}
.cta{background:var(--pill);border:1px solid var(--ctaBorder);border-radius:12px;text-align:center;padding:2rem 1.5rem;margin-top:2.5rem}
.cta p{color:var(--text2);margin:.4rem 0 1.2rem}
.btn{display:inline-block;background:var(--accent);color:#f7fffd;padding:.7rem 1.8rem;border-radius:var(--r);font-weight:700}
.btn:hover{background:var(--accent2);text-decoration:none}
footer{border-top:1px solid var(--border);padding:1.5rem;text-align:center;color:var(--text3);font-size:.8rem;margin-top:2rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:.8rem}
.tcard{display:flex;align-items:center;gap:.7rem;background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:.8rem .9rem}
.tcard:hover{border-color:var(--accent2);text-decoration:none}
.tcard img{width:34px;height:24px;object-fit:cover;border-radius:4px;box-shadow:0 0 0 1px var(--border)}
.tcard-name{font-weight:700;font-size:.9rem;color:var(--text1)}
.tcard-sub{font-size:.72rem;color:var(--text3)}
"""

HEAD_SCRIPT = """<script>(function(){var t=localStorage.getItem('predicts_theme')||'light';
if(t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
document.documentElement.setAttribute('data-theme',t)})()</script>"""

TRACK = """<script>try{fetch('/api/analytics/track',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({path:location.pathname,referrer:document.referrer||''}),keepalive:true}).catch(function(){})}catch(e){}</script>"""


def page_shell(title, description, canonical, body, jsonld_blocks):
    ld = "\n".join(
        f'<script type="application/ld+json">{json.dumps(b, ensure_ascii=False)}</script>' for b in jsonld_blocks
    )
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
{HEAD_SCRIPT}
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="{canonical}" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#0f7a78" />
<meta property="og:type" content="website" />
<meta property="og:url" content="{canonical}" />
<meta property="og:title" content="{esc(title)}" />
<meta property="og:description" content="{esc(description)}" />
<meta property="og:image" content="{BASE_URL}/og-image.jpg" />
<meta property="og:site_name" content="Predicts.info" />
<meta property="og:locale" content="pt_BR" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{esc(title)}" />
<meta name="twitter:description" content="{esc(description)}" />
<meta name="twitter:image" content="{BASE_URL}/og-image.jpg" />
{ld}
<style>{CSS}</style>
</head>
<body>
<nav>
  <a class="nav-brand" href="/">Predicts<span>.</span>info</a>
  <a href="/dashboard" class="nav-cta">Abrir Simulador →</a>
</nav>
<main>
{body}
</main>
<footer>
  <p>© 2026 Predicts.info · Previsões estatísticas para a Copa do Mundo 2026 · Não afiliado à FIFA</p>
  <p style="margin-top:.4rem"><a href="/">Início</a> · <a href="/copa/">Seleções</a> · <a href="/torneio">Torneio</a> · <a href="/grupos">Grupos</a> · <a href="/resultados">Resultados</a> · <a href="/ranking">Ranking</a></p>
</footer>
{TRACK}
</body>
</html>"""


def render_match_row(m, code):
    a, b = m["team_a"], m["team_b"]
    if m["status"] == "finished" and m.get("result"):
        mid = f'<span class="m-score">{m["result"]["score_a"]} × {m["result"]["score_b"]}</span>'
    elif m["status"] == "live":
        sa = m.get("live_score_a")
        sb = m.get("live_score_b")
        mid = f'<span class="m-score">🟢 {sa if sa is not None else "-"} × {sb if sb is not None else "-"}</span>'
    else:
        mid = f'<span class="m-info">{esc(fmt_match_date(m["match_date"])) if m.get("match_date") else "a definir"}</span>'
    place = f' · {esc(m["city"])}' if m.get("city") else ""
    return (
        '<div class="m-row">'
        f'<span class="m-teams"><img src="{a["flag_url"]}" alt="{esc(a["name"])}" loading="lazy" />{a["code"]}'
        f' {mid} '
        f'{b["code"]}<img src="{b["flag_url"]}" alt="{esc(b["name"])}" loading="lazy" /></span>'
        f'<span class="m-info">{PHASE_PT.get(m["phase"], m["phase"])}{place}</span>'
        "</div>"
    )


def render_team_page(t, teams, computed_at):
    name = t["pt_name"]
    slug = t["slug"]
    canonical = f"{BASE_URL}/copa/{slug}"
    kind, status_label = t["status"]
    alive = kind in ("alive", "live")
    group = t.get("group")

    # --- textos SEO
    if alive:
        title = f"{name} na Copa 2026: chances de título, próximos jogos e simulações"
        chance_txt = (
            f"{name} tem {t['prob_title']:.1f}% de chance de ser campeã da Copa do Mundo 2026, "
            f"segundo o simulador do Predicts.info (Elo + Poisson + Monte Carlo, 100 mil simulações do torneio)."
        )
        description = (
            f"{name} na Copa do Mundo 2026: {t['prob_title']:.1f}% de chance de título, "
            f"probabilidades por fase, resultados e próximos jogos. Simulações atualizadas a cada rodada."
        )
    else:
        title = f"{name} na Copa 2026: campanha, resultados e estatísticas"
        chance_txt = f"{name} foi eliminada da Copa do Mundo 2026 ({PHASE_PT[t['eliminated_phase']]})."
        description = (
            f"Campanha de {name} na Copa do Mundo 2026: todos os resultados, "
            f"eliminação na {PHASE_PT[t['eliminated_phase']].lower()} e estatísticas do simulador."
        )

    # --- FAQ
    if t["next_match"] and t["next_match"].get("match_date"):
        nm = t["next_match"]
        opp = nm["team_b"] if nm["team_a"]["code"] == t["code"] else nm["team_a"]
        opp_pt = TEAMS_PT.get(opp["code"], (opp["name"], ""))[0]
        next_txt = (
            f"O próximo jogo de {name} é contra {opp_pt}, {fmt_match_date(nm['match_date'])}, "
            f"válido pela fase: {PHASE_PT.get(nm['phase'], nm['phase'])}."
        )
    elif alive:
        next_txt = f"{name} está classificada e aguarda a definição do chaveamento da próxima fase."
    else:
        next_txt = f"{name} não joga mais na Copa 2026 — a equipe foi eliminada ({PHASE_PT[t['eliminated_phase']]})."

    group_txt = (
        f"{name} disputou o Grupo {group} da Copa do Mundo 2026, que tem 12 grupos com 4 seleções cada."
        if group
        else f"{name} disputa a Copa do Mundo 2026."
    )
    faq = [
        (f"Quais as chances de {name} ganhar a Copa 2026?", chance_txt),
        (f"Quando {name} joga na Copa 2026?", next_txt),
        (f"Em que grupo {name} ficou na Copa 2026?", group_txt),
    ]

    jsonld = [
        {
            "@context": "https://schema.org",
            "@type": "SportsTeam",
            "name": name,
            "alternateName": t["name"],
            "sport": "Soccer",
            "url": canonical,
            "logo": t["flag_url"],
            "memberOf": {"@type": "SportsOrganization", "name": t.get("confederation") or "FIFA"},
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
                for q, a in faq
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Início", "item": BASE_URL + "/"},
                {"@type": "ListItem", "position": 2, "name": "Seleções da Copa 2026", "item": BASE_URL + "/copa/"},
                {"@type": "ListItem", "position": 3, "name": name, "item": canonical},
            ],
        },
    ]

    chips = [f'<span class="chip chip--{kind if kind != "live" else "live"}">{esc(status_label)}</span>']
    if group:
        chips.append(f'<span class="chip">Grupo {group}</span>')
    if t.get("confederation"):
        chips.append(f'<span class="chip">{esc(t["confederation"])}</span>')
    chips.append(f'<span class="chip">Elo {int(t["elo_rating"])}</span>')

    prob_html = ""
    if alive:
        rows = [
            ("Oitavas de final", t["prob_r16"]),
            ("Quartas de final", t["prob_qf"]),
            ("Semifinal", t["prob_sf"]),
            ("Final", t["prob_final"]),
            ("Título 🏆", t["prob_title"]),
        ]
        bars = "".join(
            f'<div class="prob-row"><span class="prob-label">{lbl}</span>'
            f'<span class="prob-bar"><span style="width:{max(p, 1):.1f}%"></span></span>'
            f'<span class="prob-val">{p:.1f}%</span></div>'
            for lbl, p in rows
        )
        prob_html = f"""<h2>Probabilidades de {esc(name)} por fase</h2>
<div class="card">{bars}
<p class="m-info" style="margin-top:.7rem">Simulador Predicts.info · Elo + Poisson + Monte Carlo · atualizado em {br_datetime(computed_at).strftime('%d/%m/%Y %H:%M')} (Brasília) · <a href="/torneio">ver as 48 seleções →</a></p>
</div>"""
    else:
        prob_html = f"""<h2>Campanha encerrada</h2>
<div class="card"><p>{esc(chance_txt)} Veja abaixo todos os resultados da campanha e simule cenários no <a href="/dashboard">simulador</a>.</p></div>"""

    matches_html = "".join(render_match_row(m, t["code"]) for m in t["matches"]) or '<p class="m-info">Sem jogos registrados.</p>'

    faq_html = "".join(
        f'<div class="faq-item"><div class="faq-q">{esc(q)}</div><div class="faq-a">{esc(a)}</div></div>' for q, a in faq
    )

    # links internos: 10 favoritos vivos + rivais de grupo
    favs = sorted((x for x in teams.values() if x["status"][0] != "out" and x["code"] != t["code"]),
                  key=lambda x: -x["prob_title"])[:10]
    rivals = [x for x in teams.values() if group and x.get("group") == group and x["code"] != t["code"]]
    seen, links = set(), []
    for x in rivals + favs:
        if x["code"] in seen:
            continue
        seen.add(x["code"])
        links.append(
            f'<a class="team-pill" href="/copa/{x["slug"]}"><img src="{x["flag_url"]}" alt="{esc(x["pt_name"])}" loading="lazy" />{esc(x["pt_name"])}</a>'
        )

    body = f"""<div class="crumb"><a href="/">Início</a> › <a href="/copa/">Seleções</a> › {esc(name)}</div>
<div class="hero">
  <img src="{t["flag_url"].replace("w80", "w160")}" alt="Bandeira de {esc(name)}" />
  <div>
    <h1>{esc(name)} na Copa do Mundo 2026</h1>
    <div class="meta">{"".join(chips)}</div>
  </div>
</div>
{prob_html}
<h2>Jogos de {esc(name)} na Copa 2026</h2>
<div class="card">{matches_html}</div>
<h2>Perguntas frequentes</h2>
<div class="card">{faq_html}</div>
<h2>Outras seleções</h2>
<div class="teams-nav">{"".join(links)} <a class="team-pill" href="/copa/">todas as 48 →</a></div>
<div class="cta">
  <div style="font-size:1.3rem;font-weight:800">Palpite nos jogos de {esc(name)}</div>
  <p>Crie sua conta grátis, aposte no placar e dispute o ranking do bolão da Copa 2026.</p>
  <a class="btn" href="/login?tab=register">Criar conta grátis →</a>
</div>"""

    return page_shell(title, description, canonical, body, jsonld)


def render_index(teams, computed_at):
    canonical = f"{BASE_URL}/copa/"
    alive = sorted((t for t in teams.values() if t["status"][0] != "out"), key=lambda t: -t["prob_title"])
    out = sorted((t for t in teams.values() if t["status"][0] == "out"),
                 key=lambda t: (-PHASE_ORDER.get(t["eliminated_phase"] or "group", 0), -t["elo_rating"]))

    def card(t):
        sub = f'{t["prob_title"]:.1f}% título' if t["status"][0] != "out" else t["status"][1]
        return (
            f'<a class="tcard" href="/copa/{t["slug"]}"><img src="{t["flag_url"]}" alt="{esc(t["pt_name"])}" loading="lazy" />'
            f'<span><span class="tcard-name">{esc(t["pt_name"])}</span><br /><span class="tcard-sub">{esc(sub)}</span></span></a>'
        )

    title = "Seleções da Copa 2026: chances, jogos e campanha de cada uma das 48"
    description = (
        "Página de cada uma das 48 seleções da Copa do Mundo 2026: probabilidade de título, "
        "resultados, próximos jogos e campanha completa, com simulações estatísticas atualizadas."
    )
    jsonld = [
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": "Seleções da Copa do Mundo 2026",
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "name": t["pt_name"], "url": f"{BASE_URL}/copa/{t['slug']}"}
                for i, t in enumerate(alive + out)
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Início", "item": BASE_URL + "/"},
                {"@type": "ListItem", "position": 2, "name": "Seleções da Copa 2026", "item": canonical},
            ],
        },
    ]
    body = f"""<div class="crumb"><a href="/">Início</a> › Seleções</div>
<h1>As 48 seleções da Copa do Mundo 2026</h1>
<p style="color:var(--text2);margin:.5rem 0 1.5rem">Chances de título, campanha e próximos jogos de cada seleção — atualizado em {br_datetime(computed_at).strftime('%d/%m/%Y %H:%M')} (Brasília).</p>
<h2>Ainda na disputa ({len(alive)})</h2>
<div class="grid">{"".join(card(t) for t in alive)}</div>
<h2>Eliminadas ({len(out)})</h2>
<div class="grid">{"".join(card(t) for t in out)}</div>
<div class="cta">
  <div style="font-size:1.3rem;font-weight:800">Quem você acha que leva a taça?</div>
  <p>Aposte no placar dos próximos jogos e dispute o ranking do bolão — grátis.</p>
  <a class="btn" href="/login?tab=register">Criar conta grátis →</a>
</div>"""
    return page_shell(title, description, canonical, body, jsonld)


def render_sitemap(teams):
    today = datetime.now(TZ_BR).strftime("%Y-%m-%d")
    urls = [f"""  <url>
    <loc>{BASE_URL}/copa/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>"""]
    for t in sorted(teams.values(), key=lambda t: t["slug"]):
        urls.append(f"""  <url>
    <loc>{BASE_URL}/copa/{t["slug"]}</loc>
    <lastmod>{today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>""")
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(urls) + "\n</urlset>\n"


def main():
    try:
        sim = fetch("/tournament/simulate")
        matches = fetch("/matches?limit=1000")
    except Exception as e:
        print(f"[team-pages] API indisponível, páginas mantidas: {e}")
        return 0

    teams = build_team_data(sim["teams"], matches)
    computed_at = sim.get("computed_at") or datetime.now(timezone.utc).isoformat()

    OUT.mkdir(parents=True, exist_ok=True)
    for t in teams.values():
        (OUT / f"{t['slug']}.html").write_text(render_team_page(t, teams, computed_at), encoding="utf-8")
    (OUT / "index.html").write_text(render_index(teams, computed_at), encoding="utf-8")
    (DIST / "sitemap-copa.xml").write_text(render_sitemap(teams), encoding="utf-8")
    print(f"[team-pages] {len(teams)} páginas + index + sitemap-copa.xml geradas em {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
