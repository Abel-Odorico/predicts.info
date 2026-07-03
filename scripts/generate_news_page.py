#!/usr/bin/env python3
"""Gera dist/noticias/index.html: notícias de futebol (Google News RSS) e
trending topics do Brasil (Google Trends "Daily Search Trends").

Sem persistência — busca e renderiza do zero a cada execução (conteúdo é
efêmero, roda via build + cron a cada 4h). Só link+manchete+fonte; conteúdo
completo fica no site de origem (evita reproduzir texto de terceiros).

Fontes excluídas ficam em news_admin_config.json (gerenciado pelo painel
admin — routers/news_admin.py), lido por _load_excluded_sources().
"""
import json
import os
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from generate_team_pages import esc, page_shell, BASE_URL, DIST, TZ_BR  # noqa: E402

OUT = DIST / "noticias"
NEWS_QUERIES = ["Copa do Mundo 2026", "futebol brasileiro"]
TRENDS_URL = "https://trends.google.com/trending/rss?geo=BR"
UA = "Mozilla/5.0 (compatible; PredictsBot/1.0; +https://predicts.info)"
NS = {"ht": "https://trends.google.com/trending/rss"}
CONFIG_PATH = Path(os.environ.get(
    "PREDICTS_BACKEND_DIR",
    str(Path(__file__).resolve().parent.parent / "backend"),
)) / "news_admin_config.json"


def _load_config():
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _load_excluded_sources():
    return {s.strip().lower() for s in _load_config().get("excluded_sources", [])}


def _save_stats(news_count, trends_count, generated_at):
    cfg = _load_config()
    cfg["last_generated"] = generated_at.isoformat()
    cfg["news_count"] = news_count
    cfg["trends_count"] = trends_count
    cfg.setdefault("excluded_sources", [])
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def _text(el, tag, ns=None):
    child = el.find(tag, ns) if ns else el.find(tag)
    return child.text.strip() if child is not None and child.text else ""


def _news_url(query):
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": query, "hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-419"}
    )


def fetch_news(limit=24):
    excluded = _load_excluded_sources()
    seen_links = set()
    items = []
    for query in NEWS_QUERIES:
        try:
            root = ET.fromstring(_get(_news_url(query)))
        except Exception:
            continue
        for item in root.iter("item"):
            link = _text(item, "link")
            title = _text(item, "title")
            if not link or not title or link in seen_links:
                continue
            source_el = item.find("source")
            source = source_el.text.strip() if source_el is not None and source_el.text else ""
            if source.lower() in excluded:
                continue
            seen_links.add(link)
            if source and title.endswith(f" - {source}"):
                title = title[: -(len(source) + 3)].strip()
            try:
                dt = parsedate_to_datetime(_text(item, "pubDate"))
            except Exception:
                dt = None
            items.append({"title": title, "link": link, "source": source, "dt": dt})
    items.sort(key=lambda x: x["dt"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return items[:limit]


def fetch_trends(limit=10):
    try:
        root = ET.fromstring(_get(TRENDS_URL))
    except Exception:
        return []
    items = []
    for item in root.iter("item"):
        title = _text(item, "title")
        if not title:
            continue
        traffic = _text(item, "ht:approx_traffic", NS)
        picture = _text(item, "ht:picture", NS)
        news_item = item.find("ht:news_item", NS)
        news_url = news_source = ""
        if news_item is not None:
            news_url = _text(news_item, "ht:news_item_url", NS)
            news_source = _text(news_item, "ht:news_item_source", NS)
        items.append({
            "title": title, "traffic": traffic, "picture": picture,
            "news_url": news_url, "news_source": news_source,
        })
    return items[:limit]


def _relative(dt, now):
    if not dt:
        return ""
    secs = (now - dt).total_seconds()
    if secs < 90:
        return "agora mesmo"
    mins = int(secs // 60)
    if mins < 60:
        return f"há {mins} min"
    hours = int(mins // 60)
    if hours < 24:
        return f"há {hours}h"
    days = int(hours // 24)
    return f"há {days} dia{'s' if days != 1 else ''}"


NEWS_CSS = """
.news-hero{background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 14%,var(--bg2)),var(--bg2));
  border:1px solid var(--border);border-radius:16px;padding:2rem 1.75rem;margin-bottom:1.75rem;text-align:center}
.news-hero h1{font-size:clamp(1.6rem,4.5vw,2.4rem);margin-bottom:.5rem}
.news-hero p{color:var(--text2);max-width:640px;margin:0 auto}
.news-hero__badge{display:inline-flex;align-items:center;gap:6px;margin-top:1rem;padding:.35rem .9rem;
  border-radius:99px;background:var(--pill);border:1px solid var(--border);font-size:.78rem;color:var(--text2)}
.news-hero__badge::before{content:'';width:7px;height:7px;border-radius:50%;background:#2ec980;
  box-shadow:0 0 0 0 rgba(46,201,128,.6);animation:news-pulse 1.8s infinite}
@keyframes news-pulse{0%,100%{box-shadow:0 0 0 0 rgba(46,201,128,.6)}70%{box-shadow:0 0 0 6px rgba(46,201,128,0)}}
.trend-strip{display:flex;gap:.6rem;overflow-x:auto;padding:.3rem .1rem 1rem;margin-bottom:.5rem;scrollbar-width:thin}
.trend-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:.5rem 1rem;border-radius:99px;
  background:var(--bg2);border:1px solid var(--border);font-size:.85rem;font-weight:600;color:var(--text1);white-space:nowrap}
.trend-chip:hover{border-color:var(--accent2);text-decoration:none}
.trend-chip__rank{color:var(--accent2);font-weight:800}
.trend-chip__traffic{color:var(--text3);font-weight:500;font-size:.75rem}
.news-card{display:flex;flex-direction:column;gap:.4rem;padding:1.1rem 1.25rem;border-bottom:1px solid var(--border);transition:background .15s}
.news-card:last-child{border-bottom:none}
.news-card:hover{background:var(--pill);text-decoration:none}
.news-card__meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.src-pill{font-size:.7rem;font-weight:700;padding:.15rem .55rem;border-radius:99px;letter-spacing:.02em}
.src-0{background:rgba(15,122,120,.14);color:#0a5856}
.src-1{background:rgba(232,160,48,.16);color:#8a5a00}
.src-2{background:rgba(74,144,232,.15);color:#1a4d8a}
.src-3{background:rgba(155,93,232,.15);color:#5a2d8a}
.src-4{background:rgba(46,201,128,.15);color:#146b3f}
.src-5{background:rgba(232,82,82,.13);color:#8a1f1f}
[data-theme=dark] .src-0{color:#5fd9d6}[data-theme=dark] .src-1{color:#f0c060}
[data-theme=dark] .src-2{color:#8ab6f5}[data-theme=dark] .src-3{color:#c3a0f5}
[data-theme=dark] .src-4{color:#6fe0a8}[data-theme=dark] .src-5{color:#f09090}
.news-card__time{font-size:.75rem;color:var(--text3)}
.news-card__title{font-size:1.02rem;font-weight:700;color:var(--text1);line-height:1.4}
.news-cta-inline{display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;
  padding:1.1rem 1.4rem;margin:1.5rem 0;border-radius:12px;background:color-mix(in srgb,var(--accent) 8%,var(--bg2));
  border:1px solid color-mix(in srgb,var(--accent) 22%,var(--border))}
.news-cta-inline strong{font-size:1.05rem}
.news-seo-block{font-size:.85rem;color:var(--text3);line-height:1.7;margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border)}

/* Metáfora animada: trends como ticker de assuntos passando (bombando agora) */
.trend-marquee{overflow:hidden;margin-bottom:.5rem;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent);
  mask-image:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent)}
.trend-track{display:flex;gap:.6rem;width:max-content;animation:trend-scroll 34s linear infinite;padding:.3rem .1rem 1rem}
.trend-marquee:hover .trend-track,.trend-marquee:focus-within .trend-track{animation-play-state:paused}
@keyframes trend-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}

/* Entrada suave dos cards de notícia ao rolar */
.news-reveal{opacity:0;transform:translateY(14px);transition:opacity 500ms ease,transform 500ms ease}
.news-reveal.in-view{opacity:1;transform:translateY(0)}

@media (prefers-reduced-motion: reduce){
  .trend-track{animation:none}
  .trend-marquee{overflow-x:auto}
  .news-reveal{opacity:1;transform:none;transition:none}
}
"""


def render(news, trends, generated_at):
    canonical = f"{BASE_URL}/noticias"
    title = "Notícias de Futebol Hoje e Trending Topics do Brasil | Predicts.info"
    description = (
        "Últimas notícias de futebol e da Copa do Mundo 2026 em tempo real, além dos assuntos "
        "em alta no Brasil agora. Atualizado automaticamente a cada 4 horas."
    )
    now = datetime.now(timezone.utc)
    updated_label = generated_at.astimezone(TZ_BR).strftime("%d/%m às %H:%M")

    def news_card(n, i):
        when = _relative(n["dt"], now)
        src_class = f"src-{hash(n['source'] or 'x') % 6}"
        src = f'<span class="src-pill {src_class}">{esc(n["source"])}</span>' if n["source"] else ""
        return (
            f'<a class="news-card news-reveal" style="transition-delay:{(i % 6) * 60}ms" '
            f'href="{esc(n["link"])}" target="_blank" rel="noopener noreferrer nofollow">'
            f'<div class="news-card__meta">{src}<span class="news-card__time">{esc(when)}</span></div>'
            f'<div class="news-card__title">{esc(n["title"])}</div>'
            "</a>"
        )

    def trend_chip(t, i):
        traffic = f'<span class="trend-chip__traffic">{esc(t["traffic"])}</span>' if t["traffic"] else ""
        href = t["news_url"] or f'https://www.google.com/search?q={urllib.parse.quote(t["title"])}'
        return (
            f'<a class="trend-chip" href="{esc(href)}" target="_blank" rel="noopener noreferrer nofollow">'
            f'<span class="trend-chip__rank">#{i + 1}</span> {esc(t["title"])} {traffic}</a>'
        )

    news_html = "".join(news_card(n, i) for i, n in enumerate(news)) or '<p class="m-info" style="padding:1rem">Sem notícias no momento.</p>'
    trends_html = "".join(trend_chip(t, i) for i, t in enumerate(trends)) or '<p class="m-info">Sem trends no momento.</p>'

    # CTA no meio da lista de notícias (após o 6º item, se houver o suficiente)
    news_items_html = news_html
    if len(news) > 6:
        cards = [news_card(n, i) for i, n in enumerate(news)]
        mid_cta = (
            '<div class="news-cta-inline"><div><strong>⚽ Simule qualquer jogo da Copa 2026</strong>'
            '<div style="color:var(--text3);font-size:.85rem;margin-top:2px">Probabilidades em tempo real, Elo + Monte Carlo.</div></div>'
            '<a class="btn" href="/dashboard">Simular agora →</a></div>'
        )
        news_items_html = "".join(cards[:6]) + mid_cta + "".join(cards[6:])

    body = f"""<div class="crumb"><a href="/">Início</a> › Notícias</div>
<div class="news-hero">
  <h1>⚽ Notícias de Futebol &amp; Trending no Brasil</h1>
  <p>As últimas manchetes do futebol brasileiro e da Copa do Mundo 2026, mais os assuntos em alta agora no Brasil — tudo num só lugar.</p>
  <span class="news-hero__badge">Atualizado em {esc(updated_label)} (Brasília) · a cada 4h</span>
</div>
<h2>🔥 Em alta no Brasil agora</h2>
<div class="trend-marquee"><div class="trend-track">{trends_html}<span aria-hidden="true" style="display:contents">{trends_html}</span></div></div>
<h2>Notícias de futebol</h2>
<div class="card" style="padding:0">{news_items_html}</div>
<div class="news-seo-block">
  <p>O Predicts.info reúne automaticamente as principais notícias de futebol e da Copa do Mundo 2026
  publicadas pelos maiores veículos esportivos do Brasil, além dos assuntos mais buscados no Google
  Trends para o país. As manchetes acima levam direto à fonte original — clique para ler a matéria
  completa. Enquanto isso, aproveite para <a href="/dashboard">simular os próximos jogos da Copa 2026</a>,
  ver as <a href="/torneio">probabilidades de título das 48 seleções</a> ou
  <a href="/login?tab=register">criar sua conta grátis</a> e disputar o bolão da Copa com seus amigos.</p>
</div>
<div class="cta">
  <div style="font-size:1.3rem;font-weight:800">Pronto para prever a Copa 2026?</div>
  <p>Crie sua conta grátis, dê seu palpite de placar e dispute o ranking do bolão.</p>
  <a class="btn" href="/login?tab=register">Criar conta grátis →</a>
</div>
<script>
(function(){{
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  var els = document.querySelectorAll('.news-reveal')
  var io = new IntersectionObserver(function(entries){{
    entries.forEach(function(e){{
      if (!e.isIntersecting) return
      e.target.classList.add('in-view')
      io.unobserve(e.target)
    }})
  }}, {{ threshold: 0.15 }})
  els.forEach(function(el){{ io.observe(el) }})
}})()
</script>"""

    jsonld = [
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Início", "item": BASE_URL + "/"},
                {"@type": "ListItem", "position": 2, "name": "Notícias", "item": canonical},
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "name": "Notícias de futebol",
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "name": n["title"], "url": n["link"]}
                for i, n in enumerate(news[:15])
            ],
        },
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": [
                {
                    "@type": "Question", "name": "De onde vêm essas notícias?",
                    "acceptedAnswer": {"@type": "Answer", "text": "As manchetes são agregadas do Google Notícias a partir dos principais veículos esportivos do Brasil, e os assuntos em alta vêm do Google Trends para o Brasil."},
                },
                {
                    "@type": "Question", "name": "Com que frequência a página de notícias atualiza?",
                    "acceptedAnswer": {"@type": "Answer", "text": "A página é atualizada automaticamente a cada 4 horas com as notícias e trending topics mais recentes."},
                },
            ],
        },
    ]
    return page_shell(title, description, canonical, f"<style>{NEWS_CSS}</style>{body}", jsonld)


def main():
    news = fetch_news()
    trends = fetch_trends()
    generated_at = datetime.now(timezone.utc)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(render(news, trends, generated_at), encoding="utf-8")
    _save_stats(len(news), len(trends), generated_at)
    print(f"[news] {len(news)} notícias + {len(trends)} trends geradas em {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
