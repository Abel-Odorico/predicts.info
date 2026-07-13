import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

function normalizeDate(value) {
  if (!value) return null
  const hasTz = value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)
  return hasTz ? value : `${value}Z`
}

function fmtShort(value) {
  if (!value) return '—'
  return new Date(normalizeDate(value)).toLocaleString('pt-BR', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

const SUBTABS = [
  { id: 'geral',     label: 'Visão Geral' },
  { id: 'backend',   label: 'Backend & Dados' },
  { id: 'automacao', label: 'Cron & Automação' },
  { id: 'motor',     label: 'Motor & IA' },
  { id: 'gotchas',   label: 'Gotchas' },
]

// ── Diagrama de arquitetura (SVG estático, dados reais do sistema) ──────────

function ArchBox({ x, y, w, h, title, sub, tone = 'neutral' }) {
  const tones = {
    neutral: { bg: 'var(--bg-overlay)', border: 'var(--border)', text: 'var(--text-1)' },
    accent:  { bg: 'rgba(15,122,120,0.12)', border: 'var(--accent)', text: 'var(--accent)' },
    db:      { bg: 'rgba(78,131,255,0.10)', border: '#4e83ff', text: '#7ea3ff' },
    redis:   { bg: 'rgba(255,90,90,0.10)', border: '#ff5a5a', text: '#ff8a8a' },
    ext:     { bg: 'rgba(232,196,74,0.08)', border: 'rgba(232,196,74,0.5)', text: '#e8c44a' },
    wa:      { bg: 'rgba(37,211,102,0.10)', border: '#25D366', text: '#25D366' },
  }
  const t = tones[tone] || tones.neutral
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={t.bg} stroke={t.border} strokeWidth={1.4} />
      <text x={x + w / 2} y={y + h / 2 - (sub ? 6 : -4)} textAnchor="middle" fontFamily="var(--font-cond)" fontWeight="700" fontSize="13" fill={t.text}>{title}</text>
      {sub && <text x={x + w / 2} y={y + h / 2 + 12} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--text-4)">{sub}</text>}
    </g>
  )
}

function Arrow({ x1, y1, x2, y2, label, dashed }) {
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--text-4)" strokeWidth={1.3}
        strokeDasharray={dashed ? '4 3' : undefined} markerEnd="url(#arrowhead)" opacity={0.75} />
      {label && (
        <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--text-4)">{label}</text>
      )}
    </g>
  )
}

function ArchDiagram() {
  const extBoxes = [
    { title: 'Evolution API', sub: 'WhatsApp Baileys', tone: 'wa' },
    { title: 'Telegram Bot API', sub: 'relatórios + projeções', tone: 'ext' },
    { title: 'Gemini / OpenRouter', sub: 'Oráculo + análise IA', tone: 'ext' },
    { title: 'football-data.org', sub: 'Brasileirão (BSA)', tone: 'ext' },
    { title: 'Wikipedia', sub: 'grupos, mata-mata, artilheiros', tone: 'ext' },
    { title: 'Feed tropatech', sub: 'fallback resultado ao vivo', tone: 'ext' },
  ]
  const extW = 176, extGap = 16
  const extStartX = (1180 - (extW * 6 + extGap * 5)) / 2

  return (
    <div style={{ overflowX: 'auto', background: '#070c0a', borderRadius: 12, border: '1px solid var(--border)', padding: '18px 8px' }}>
      <svg viewBox="0 0 1180 620" width="100%" style={{ minWidth: 820, display: 'block' }}>
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--text-4)" opacity={0.75} />
          </marker>
        </defs>

        {/* fronteira docker compose */}
        <rect x={20} y={190} width={1140} height={230} rx={14} fill="none" stroke="var(--border)" strokeDasharray="6 5" strokeWidth={1} />
        <text x={40} y={210} fontFamily="var(--font-mono)" fontSize="10" fill="var(--text-4)">docker compose · VPS (predicts_net)</text>

        {/* cliente */}
        <ArchBox x={490} y={16} w={200} h={54} title="Navegador / PWA" sub="React SPA + Service Worker" tone="neutral" />
        <Arrow x1={590} y1={70} x2={590} y2={104} />

        {/* nginx */}
        <ArchBox x={490} y={106} w={200} h={54} title="nginx (edge)" sub="SSL · proxy · SPA fallback" tone="accent" />

        {/* dist estático */}
        <ArchBox x={860} y={106} w={220} h={54} title="dist/ (estático)" sub="landing SEO + SPA build" tone="neutral" />
        <Arrow x1={690} y1={125} x2={858} y2={120} label="/ e /*.html" />

        {/* cron */}
        <ArchBox x={30} y={216} w={170} h={58} title="Cron (9 jobs)" sub="1min – 6h, ver Automação" tone="neutral" />
        <Arrow x1={200} y1={245} x2={488} y2={245} label="script.py / docker exec" />

        {/* nginx -> api */}
        <Arrow x1={560} y1={160} x2={560} y2={214} label="/api/*" />

        {/* api */}
        <ArchBox x={490} y={216} w={220} h={60} title="FastAPI (predicts_api)" sub="Uvicorn :8000 → :8130" tone="accent" />

        {/* db / redis */}
        <Arrow x1={560} y1={276} x2={430} y2={334} label="SQLAlchemy" />
        <ArchBox x={330} y={336} w={190} h={58} title="PostgreSQL 16" sub="predicts_db · predicts2026" tone="db" />

        <Arrow x1={640} y1={276} x2={760} y2={334} label="cache/sim" />
        <ArchBox x={670} y={336} w={190} h={58} title="Redis 7" sub="predicts_redis · TTL cache" tone="redis" />

        {/* external row */}
        {extBoxes.map((b, i) => {
          const bx = extStartX + i * (extW + extGap)
          return (
            <g key={b.title}>
              <Arrow x1={600} y1={278} x2={bx + extW / 2} y2={468} dashed />
              <ArchBox x={bx} y={470} w={extW} h={56} title={b.title} sub={b.sub} tone={b.tone} />
            </g>
          )
        })}
        <text x={extStartX} y={455} fontFamily="var(--font-mono)" fontSize="10" fill="var(--text-4)">serviços externos (HTTP, fora do compose)</text>
      </svg>
    </div>
  )
}

// ── Status pill / passo de fluxo ─────────────────────────────────────────────

function StatusPill({ ok, label, detail }) {
  const color = ok === true ? 'var(--win)' : ok === false ? 'var(--lose)' : 'var(--text-4)'
  const dot = ok === true ? '●' : ok === false ? '●' : '○'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 10 }}>
      <span style={{ color, fontSize: 14 }}>{dot}</span>
      <div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', fontWeight: 700 }}>{label}</div>
        {detail && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)' }}>{detail}</div>}
      </div>
    </div>
  )
}

function FlowStep({ n, title, detail, color = 'var(--accent)' }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: color, color: '#08110e', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</div>
      <div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{title}</div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>{detail}</div>
      </div>
    </div>
  )
}

// ── Dados estáticos de documentação ──────────────────────────────────────────

const ROUTER_GROUPS = [
  { group: 'Copa 2026', items: [
    ['matches.py', 'listagem + simulação de partidas (Monte Carlo/Elo/xG)'],
    ['knockout.py', 'mata-mata via Wikipedia'],
    ['champion.py', 'palpite campeão/vice + bônus'],
    ['tournament.py', 'grupos, bracket, bracket-sides'],
    ['teams.py', 'seleções, ranking, elenco'],
    ['awards.py', 'artilheiros (Wikipedia, cache Redis)'],
  ]},
  { group: 'Brasileirão', items: [
    ['brasileirao.py', 'público: tabela, projeção Monte Carlo, rodada'],
    ['brasileirao_sync.py', 'admin: sync football-data.org + Elo replay + pontuação'],
  ]},
  { group: 'Apostas & Ranking', items: [
    ['bets.py', 'apostas por placar, pontuação (regra V2 — Precisão)'],
    ['ranking.py', 'ranking geral por competição'],
    ['user_groups.py', 'bolões privados, highlights, ranking de grupo'],
    ['groups.py', 'grupos públicos (fase de grupos Copa)'],
    ['competition.py', 'competição paralela por fase (não confundir c/ multi-competição)'],
  ]},
  { group: 'IA / Bot', items: [
    ['bot.py', 'Oráculo LLM predictor + apostador bot (gate de confiança 85)'],
    ['analysis.py', 'análise IA por partida (cache, campo "hook" factual)'],
  ]},
  { group: 'WhatsApp', items: [
    ['whatsapp.py', 'Evolution API — webhook, opt-in, aposta por mensagem, campanhas'],
  ]},
  { group: 'Notificações', items: [
    ['notifications.py', 'in-app (sino) + roteamento de push por tipo'],
    ['push.py', 'Web Push VAPID'],
    ['version.py', 'changelog de versões + fan-out WhatsApp no notify'],
  ]},
  { group: 'Admin & Dados', items: [
    ['admin.py', 'gestão geral — usuários, resultados, competições, sistema'],
    ['analytics.py', 'page views, retenção, coorte, auditoria de apostas'],
    ['audit.py', 'log de ações sensíveis'],
    ['report.py', 'relatório diário no Telegram'],
    ['telegram.py', 'projeções automáticas 24h antes do jogo'],
    ['poll.py', 'consultas públicas (votação)'],
    ['auth.py', 'login, registro, perfil, JWT'],
  ]},
]

const CRON_JOBS = [
  { freq: '*/5 min',  script: 'update_world_cup_data.sh',   func: 'Resultados Copa (Wikipedia+feed), Elo, mata-mata, projeções Telegram, aviso grupo WA',       log: 'predicts-cron.log', live: true },
  { freq: '1 min',    script: 'check_kickoff.py',           func: 'Detecta início de jogo — lembrete WhatsApp/push 1h antes',                                   log: 'predicts-kickoff.log' },
  { freq: '1 min',    script: 'check_goals.py',              func: 'Detecta gol ao vivo — push imediato',                                                        log: 'predicts-goals.log' },
  { freq: '1 min',    script: 'whatsapp_campaign_worker.py', func: 'Processa fila de campanhas WhatsApp pendentes (20/lote)',                                    log: 'predicts-whatsapp.log' },
  { freq: '*/30 min', script: 'update_brasileirao_data.sh',  func: 'Sync Brasileirão — football-data.org (BSA) + Elo replay + evaluate_bets',                    log: 'predicts-brasileirao.log' },
  { freq: '*/6h',     script: 'generate_team_pages.py',      func: 'SEO — páginas estáticas de seleção (48 páginas)',                                            log: 'predicts-team-pages.log' },
  { freq: '*/6h',     script: 'generate_match_pages.py',     func: 'SEO — páginas estáticas de partida (102 páginas)',                                           log: 'predicts-match-pages.log' },
  { freq: '*/4h',     script: 'generate_news_page.py',       func: 'SEO — página de notícias + trends',                                                          log: 'predicts-news.log' },
  { freq: 'diário 4h', script: 'cleanup_notifications.py',   func: 'Apaga notificações com mais de 60 dias (NOTIFICATION_RETENTION_DAYS)',                       log: 'predicts-notif-cleanup.log' },
]

const GOTCHAS = [
  { problema: 'Resultado mata-mata só via Wikipedia atrasa horas', causa: 'Bets não pontuam, ranking parado', solucao: 'Fallback sync_finished_from_live_feed (tropatech) roda antes no cron' },
  { problema: 'docker compose restart api', causa: 'NÃO recarrega .env', solucao: 'Usar docker compose up -d api pra variável nova' },
  { problema: 'competitions.id não é sequencial', causa: 'brasileirao2026 = 4, não 2 (id 2 foi teste deletado)', solucao: 'Sempre get_competition_id(db, code), nunca hardcode' },
  { problema: 'Ranking.user_id não é mais unique', causa: '1 linha por (usuário, competição) desde multi-competição', solucao: 'Todo lookup de Ranking precisa filtrar competition_id' },
  { problema: 'Scan global de Match/Team sem filtro', causa: 'Pega Brasileirão junto do sync da Copa — já apagou dados 1x (incidente 10/07)', solucao: 'Sempre filtrar competition_id em scan novo' },
  { problema: 'clubelo.com não cobre clubes brasileiros', causa: 'só Europa', solucao: 'Elo do Brasileirão é replay próprio da temporada (recompute_stats)' },
  { problema: 'Corinthians × Coritiba: mesmo TLA "COR" na BSA', causa: 'API football-data ambígua', solucao: 'TLA_FIX em brasileirao_sync.py (Coritiba=CTB)' },
  { problema: '2 classes CSS setando animation no mesmo elemento', causa: 'última no cascade cancela a 1ª inteira — elemento fica opacity:0 travado', solucao: 'Entrada + loop numa ÚNICA declaração animation (shorthand)' },
  { problema: 'market_odds (peso do motor) nunca recebe odds real', causa: 'TeamInput.odds_win nunca populado em lugar nenhum', solucao: 'Sempre cai no fallback elo_win_probabilities' },
  { problema: 'Feature nova não aparece pro usuário', causa: 'quase sempre Service Worker com cache velho, raramente bug', solucao: 'Checar curl API + grep no bundle + versão do sw.js antes de investigar "bug"' },
  { problema: 'Token JWT vencido (7d)', causa: 'chamadas autenticadas dão 401, UI parece "logada"', solucao: 'api.js desloga no 1º 401 com token presente' },
  { problema: 'Escudo de clube é quadrado, .duel-bar__flag foi feita pra bandeira', causa: 'object-fit:cover corta imagem quadrada', solucao: 'Override CSS escopado por contexto (object-fit:contain)' },
]

function fmtDomainRows(tables, domain) {
  return (tables || []).filter(t => t.domain === domain)
}

export default function Sistema() {
  const { token } = useAuth()
  const [sub, setSub] = useState('geral')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true); setErr('')
    try { setStatus(await api.get('/admin/system/status', token)) }
    catch (e) { setErr(e?.message || 'Erro ao carregar status') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const h4 = { fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, marginTop: 14 }
  const p = { fontFamily: 'var(--font-cond)', fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.65, margin: '0 0 8px' }

  const domains = [...new Set((status?.tables || []).map(t => t.domain))]

  return (
    <div className="adm-shell">
      <div className="adm-header">
        <div className="adm-header__left">
          <div className="adm-header__title">🧬 SISTEMA</div>
          <div className="adm-header__sub">predicts.info · arquitetura, dados e funcionamento em tempo real</div>
        </div>
        <div className="adm-header__actions">
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>{loading ? '…' : '↻ Atualizar'}</button>
          <a href="/admin" className="btn btn-ghost btn-sm">🛠 Painel Admin</a>
          <a href="/admin/whatsapp" className="btn btn-ghost btn-sm">💬 WhatsApp</a>
        </div>
      </div>

      <div className="adm-pane fade-in-1">
        {err && <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--lose)' }}>✗ {err}</div>}

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          {SUBTABS.map(st => (
            <button key={st.id} className={sub === st.id ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setSub(st.id)}>{st.label}</button>
          ))}
        </div>

        {/* ── VISÃO GERAL ── */}
        {sub === 'geral' && (
          <>
            <div className="adm-card" style={{ marginBottom: 16 }}>
              <div className="adm-card__header"><span className="adm-card__title">🗺 Diagrama de Arquitetura</span></div>
              <ArchDiagram />
            </div>

            <div className="adm-card" style={{ marginBottom: 16 }}>
              <div className="adm-card__header"><span className="adm-card__title">📡 Status ao Vivo</span></div>
              {status && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
                    <StatusPill ok={status.db === 'ok'} label="PostgreSQL" detail={status.db === 'ok' ? 'predicts2026' : status.db} />
                    <StatusPill ok={status.redis === 'ok'} label="Redis" detail={status.redis === 'ok' ? 'cache/sim' : status.redis} />
                    <StatusPill ok={status.whatsapp.enabled ? status.whatsapp.state === 'open' : null} label="WhatsApp (Evolution)" detail={status.whatsapp.enabled ? (status.whatsapp.state || 'desconhecido') : 'desativado'} />
                    <StatusPill ok={!!status.cron.log_updated_at} label="Cron principal (5min)" detail={status.cron.log_updated_at ? `atualizado ${fmtShort(status.cron.log_updated_at)}` : 'sem log'} />
                  </div>

                  <div className="adm-kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                    <div className="adm-kpi"><div className="adm-kpi__val">{status.users.total}</div><div className="adm-kpi__label">Usuários</div></div>
                    <div className="adm-kpi"><div className="adm-kpi__val" style={{ color: 'var(--win)' }}>{status.users.active}</div><div className="adm-kpi__label">Ativos</div></div>
                    <div className="adm-kpi"><div className="adm-kpi__val" style={{ color: '#25D366' }}>{status.users.whatsapp_opt_in}</div><div className="adm-kpi__label">Opt-in WhatsApp</div></div>
                    <div className="adm-kpi"><div className="adm-kpi__val" style={{ color: 'var(--accent)' }}>{status.bets_total}</div><div className="adm-kpi__label">Apostas totais</div></div>
                  </div>

                  <div style={h4}>Competições</div>
                  <div className="adm-table-wrap" style={{ marginBottom: 4 }}>
                    <table className="adm-table">
                      <thead><tr><th>Competição</th><th>Status</th><th>Times</th><th>Jogos</th><th>Result.</th><th>Apostas</th><th>Ranking</th></tr></thead>
                      <tbody>
                        {status.competitions.map(c => (
                          <tr key={c.id}>
                            <td>{c.name} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>#{c.id} {c.code}</span></td>
                            <td><span className="badge badge-live" style={{ fontSize: 9 }}>{c.status}</span></td>
                            <td>{c.teams}</td><td>{c.matches}</td><td>{c.results}</td><td>{c.bets}</td><td>{c.ranked_users}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {status.poll && (
                    <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(15,122,120,0.08)', border: '1px solid rgba(15,122,120,0.2)', borderRadius: 8 }}>
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>📊 Votação ativa: <strong>{status.poll.title}</strong> — {status.poll.votes} voto(s), fecha {fmtShort(status.poll.closes_at)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* ── BACKEND & DADOS ── */}
        {sub === 'backend' && (
          <>
            <div className="adm-card" style={{ marginBottom: 16 }}>
              <div className="adm-card__header"><span className="adm-card__title">📐 Stack & Deploy</span></div>
              <div style={{ padding: '4px 2px' }}>
                <p style={p}>Backend <strong>FastAPI</strong> (Python 3.11) + Uvicorn · Frontend <strong>React 18 + Vite</strong>, <code>motion/react</code> e <code>d3</code> v7 pras animações · Banco <strong>PostgreSQL 16</strong> (predicts2026) · Cache <strong>Redis 7</strong> · Migrations Alembic · nginx → 127.0.0.1:8130 · PWA (service worker + Web Push VAPID).</p>
                <p style={p}>nginx serve <code>/</code> → landing estática pública (SEO) · <code>/api/</code> → FastAPI · rotas restantes → SPA React. Frontend é volume-mounted (<code>npm run build</code> já basta). Backend tem bind mount (<code>docker compose restart api</code> recarrega código, mas NÃO recarrega <code>.env</code>).</p>
                <div style={h4}>Multi-competição</div>
                <p style={p}>Tabela <code>competitions</code>, coluna <code>competition_id</code> em teams/matches/bets/rankings. IDs não são sequenciais confiáveis (Copa=1, Brasileirão=4) — sempre resolver via <code>get_competition_id(db, code)</code>. Ranking é 1 linha por (usuário, competição).</p>
              </div>
            </div>

            <div className="adm-card" style={{ marginBottom: 16 }}>
              <div className="adm-card__header"><span className="adm-card__title">🗄 Banco de Dados — {status?.tables?.length || 0} tabelas monitoradas (contagem ao vivo)</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, padding: '4px 2px' }}>
                {domains.map(domain => (
                  <div key={domain}>
                    <div style={h4}>{domain}</div>
                    <div className="adm-table-wrap">
                      <table className="adm-table" style={{ fontSize: 11 }}>
                        <tbody>
                          {fmtDomainRows(status?.tables, domain).map(t => (
                            <tr key={t.table}>
                              <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>{t.table}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{t.rows.toLocaleString('pt-BR')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="adm-card">
              <div className="adm-card__header"><span className="adm-card__title">🗂 Routers do Backend</span></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, padding: '4px 2px' }}>
                {ROUTER_GROUPS.map(g => (
                  <div key={g.group}>
                    <div style={h4}>{g.group}</div>
                    {g.items.map(([file, desc]) => (
                      <div key={file} style={{ marginBottom: 6 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{file}</span>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11.5, color: 'var(--text-4)' }}>{desc}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── CRON & AUTOMAÇÃO ── */}
        {sub === 'automacao' && (
          <>
            <div className="adm-card" style={{ marginBottom: 16 }}>
              <div className="adm-card__header"><span className="adm-card__title">🔄 Fluxo de Dados — Copa 2026 (cron 5min)</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '10px 4px' }}>
                <FlowStep n={1} title="sync_finished_from_live_feed (fallback tropatech)" detail="pontua mata-mata rápido mesmo sem a Wikipedia ter atualizado ainda" />
                <FlowStep n={2} title="apply_world_cup_snapshot (Wikipedia)" detail="grupos + resultado gravado em match_results — pontua pela EXISTÊNCIA do resultado, não pelo status (que 'pisca')" />
                <FlowStep n={3} title="Loop de pontuação reavalia TODAS as apostas" detail="reconstrói rankings do zero por competição, dentro da mesma função" />
                <FlowStep n={4} title="sync_team_stats (Elo) + sync_knockout_matches" detail="atualiza força dos times e mata-mata (Wikipedia, só adiciona/atualiza)" />
                <FlowStep n={5} title="Notificações & WhatsApp disparados" detail="DM resultado pessoal (opt-in match_result), destaque top10, projeção Telegram 24h antes" color="var(--text-4)" />
              </div>
            </div>

            <div className="adm-card" style={{ marginBottom: 16 }}>
              <div className="adm-card__header"><span className="adm-card__title">⏱ Cron Jobs — {CRON_JOBS.length} ativos</span></div>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead><tr><th>Frequência</th><th>Script</th><th>Função</th><th>Log</th></tr></thead>
                  <tbody>
                    {CRON_JOBS.map(j => (
                      <tr key={j.script}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{j.freq} {j.live && <span className="badge badge-live" style={{ fontSize: 8, marginLeft: 4 }}>log lido ao vivo</span>}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{j.script}</td>
                        <td style={{ fontSize: 12 }}>{j.func}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)' }}>{j.log}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="adm-card">
              <div className="adm-card__header"><span className="adm-card__title">📜 Cron principal — últimas linhas do log</span></div>
              <div style={{ background: '#08110e', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-3)', maxHeight: 240, overflowY: 'auto' }}>
                {status?.cron?.tail?.length ? status.cron.tail.map((l, i) => <div key={i}>{l}</div>) : <span style={{ color: 'var(--text-4)' }}>sem log disponível</span>}
              </div>
            </div>
          </>
        )}

        {/* ── MOTOR & IA ── */}
        {sub === 'motor' && (
          <div className="adm-card">
            <div className="adm-card__header"><span className="adm-card__title">🧠 Motor de Simulação & Oráculo</span></div>
            <div style={{ padding: '4px 2px' }}>
              <div style={h4}>Pipeline (engine/)</div>
              <p style={p}><code>elo.py</code> → probabilidades · <code>poisson.py</code> (Dixon-Coles) → placares · <code>monte_carlo.py</code> (NumPy vetorizado) → distribuição · <code>weights.py</code> combina fatores em λ por time.</p>
              <div style={h4}>Pesos calibrados (bootstrap sobre jogos finalizados)</div>
              <p style={p}>odds de mercado <strong>56.5%</strong> · xG <strong>43.5%</strong> · H2H <strong>5%</strong> (carve-out manual, não fit estatístico — soma passa de 100% porque H2H é multiplicador 0.85–1.15, não peso linear puro). <code>market_odds</code> nunca recebe odds real (nunca populado) — sempre cai no fallback <code>elo_win_probabilities</code>.</p>
              <div style={h4}>Oráculo LLM (bot.py)</div>
              <p style={p}>Cadeia Gemini key1 → Gemini key2 → OpenRouter (6 modelos free). <strong>Gate de confiança 85</strong>: só diverge do baseline estatístico com alta convicção ou lesão/suspensão relevante — sem o gate, taxa de acerto de placar exato medida caiu de 11% pra 3,8% (dado real, 45 partidas).</p>
              <div style={h4}>Análise IA (analysis.py)</div>
              <p style={p}>Pré-gerada e cacheada por partida (nunca on-the-fly). Campo <code>hook</code> só pode citar número calculado e injetado no prompt (streaks do banco, artilheiro via cache Redis) — proibido a IA inventar estatística. Prompt dedicado pro Brasileirão (clube ≠ seleção: sem convocação, sem boletim médico).</p>
            </div>
          </div>
        )}

        {/* ── GOTCHAS ── */}
        {sub === 'gotchas' && (
          <div className="adm-card">
            <div className="adm-card__header"><span className="adm-card__title">⚠️ Gotchas Conhecidos — não regredir</span></div>
            <div style={{ display: 'grid', gap: 10, padding: '4px 2px' }}>
              {GOTCHAS.map((g, i) => (
                <div key={i} style={{ padding: '10px 14px', background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12.5, color: 'var(--text-1)' }}>{g.problema}</div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11.5, color: 'var(--lose)', marginTop: 2 }}>Causa: {g.causa}</div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11.5, color: 'var(--win)', marginTop: 2 }}>Solução: {g.solucao}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
