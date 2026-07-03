#!/usr/bin/env python3
"""Gera dist/noticias/index.html: notícias de futebol (Google News RSS) e
trending topics do Brasil (Google Trends "Daily Search Trends").

Sem persistência — busca e renderiza do zero a cada execução (conteúdo é
efêmero, roda via build + cron a cada 4h). Só link+manchete+fonte; conteúdo
completo fica no site de origem (evita reproduzir texto de terceiros).
"""
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


def fetch_news(limit=20):
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
            seen_links.add(link)
            source_el = item.find("source")
            source = source_el.text.strip() if source_el is not None and source_el.text else ""
            if source and title.endswith(f" - {source}"):
                title = title[: -(len(source) + 3)].strip()
            try:
                dt = parsedate_to_datetime(_text(item, "pubDate"))
            except Exception:
                dt = None
            items.append({"title": title, "link": link, "source": source, "dt": dt})
    items.sort(key=lambda x: x["dt"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return items[:limit]


def fetch_trends(limit=12):
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


def render(news, trends):
    canonical = f"{BASE_URL}/noticias"
    title = "Notícias de Futebol e Trending Topics do Brasil | Predicts.info"
    description = (
        "Últimas notícias de futebol e Copa do Mundo 2026, além dos assuntos em alta no "
        "Brasil agora. Atualizado automaticamente a cada 4 horas."
    )

    def news_row(n):
        when = n["dt"].astimezone(TZ_BR).strftime("%d/%m %H:%M") if n["dt"] else ""
        src = f' · {esc(n["source"])}' if n["source"] else ""
        return (
            f'<a class="m-row m-row--link" href="{esc(n["link"])}" target="_blank" rel="noopener noreferrer nofollow">'
            f'<span class="m-teams" style="font-weight:600">{esc(n["title"])}</span>'
            f'<span class="m-info">{esc(when)}{src}</span>'
            "</a>"
        )

    def trend_card(t):
        traffic = f'{esc(t["traffic"])} buscas' if t["traffic"] else "Google Trends"
        sub = f'{traffic} · {esc(t["news_source"])}' if t["news_source"] else traffic
        href = t["news_url"] or f'https://www.google.com/search?q={urllib.parse.quote(t["title"])}'
        img = (
            f'<img src="{esc(t["picture"])}" alt="" loading="lazy" '
            'style="width:44px;height:44px;object-fit:cover;border-radius:8px;flex-shrink:0" />'
            if t["picture"] else ""
        )
        return (
            f'<a class="tcard" href="{esc(href)}" target="_blank" rel="noopener noreferrer nofollow">'
            f'{img}<span><span class="tcard-name">{esc(t["title"])}</span><br />'
            f'<span class="tcard-sub">{sub}</span></span></a>'
        )

    news_html = "".join(news_row(n) for n in news) or '<p class="m-info">Sem notícias no momento.</p>'
    trends_html = "".join(trend_card(t) for t in trends) or '<p class="m-info">Sem trends no momento.</p>'

    body = f"""<div class="crumb"><a href="/">Início</a> › Notícias</div>
<h1>Notícias de Futebol &amp; Trending no Brasil</h1>
<p style="color:var(--text2);margin:.5rem 0 1.5rem">Atualizado automaticamente a cada 4 horas · fontes externas, clique para ler na íntegra.</p>
<h2>Notícias de futebol</h2>
<div class="card">{news_html}</div>
<h2>Em alta no Brasil agora</h2>
<div class="grid">{trends_html}</div>
<div class="cta">
  <div style="font-size:1.3rem;font-weight:800">Não perca nenhum jogo da Copa 2026</div>
  <p>Crie sua conta grátis, simule partidas e dispute o ranking do bolão.</p>
  <a class="btn" href="/login?tab=register">Criar conta grátis →</a>
</div>"""
    jsonld = [{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Início", "item": BASE_URL + "/"},
            {"@type": "ListItem", "position": 2, "name": "Notícias", "item": canonical},
        ],
    }]
    return page_shell(title, description, canonical, body, jsonld)


def main():
    news = fetch_news()
    trends = fetch_trends()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(render(news, trends), encoding="utf-8")
    print(f"[news] {len(news)} notícias + {len(trends)} trends geradas em {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
