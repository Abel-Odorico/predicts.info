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

// ── Diagrama de arquitetura ──────────────────────────────────────────────────
// SVG dual-theme gerado com archify (peep-skills) a partir de
// docs/arquitetura.architecture.json. Pra atualizar: editar o JSON e rodar
//   node bin/archify.mjs render architecture docs/arquitetura.architecture.json docs/arquitetura.html
// depois exportar o SVG (menu Export) pra frontend/public/arquitetura.svg.

function ArchDiagram() {
  return (
    <div style={{ overflowX: 'auto', background: '#070c0a', borderRadius: 12, border: '1px solid var(--border)', padding: '18px 8px' }}>
      <img
        src="/arquitetura.svg"
        alt="Arquitetura do predicts.info: Usuário → nginx → FastAPI → PostgreSQL/Redis, com cron jobs, fontes de dados, LLMs, Evolution API e Telegram"
        style={{ display: 'block', width: '100%', minWidth: 820 }}
      />
      <div style={{ marginTop: 8, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)' }}>
        fonte: docs/arquitetura.architecture.json · gerado com archify
      </div>
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
  { freq: '*/5 min',  script: 'update_world_cup_data.sh',   func: 'Resultados Copa (Wikipedia+feed), Elo, mata-mata, projeções Telegram (Copa+Brasileirão), aviso grupo WA',       log: 'predicts-cron.log', live: true },
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

// ── Saúde dos Provedores LLM ──────────────────────────────────────────────────
// Nasceu do incidente 11/07: cadeia INTEIRA (Gemini rate-limit + OpenRouter 402)
// ficou fora por dias sem ninguém perceber. Botão "Testar agora" chama
// POST /admin/llm/test (admin), que percorre a cadeia real (mesma ordem de
// produção) testando cada provider individualmente — cacheado 5min no backend.

function fmtUsd(v) {
  if (v === null || v === undefined) return '—'
  return `US$ ${Number(v).toFixed(4)}`
}

function LlmHealthCard({ health, loading, err, onTest }) {
  const h4 = { fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, marginTop: 14 }
  const providers = health?.providers || []
  const nOk = providers.filter(p => p.ok).length
  const n = providers.length
  const credits = health?.openrouter_credits
  const consumption = health?.consumption_7d || []

  return (
    <div className="adm-card">
      <div className="adm-card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="adm-card__title">🧠 Saúde dos Provedores LLM</span>
        <button className="btn btn-sm" onClick={onTest} disabled={loading}>
          {loading ? '… testando' : '▶ Testar agora'}
        </button>
      </div>

      <div style={{ padding: '4px 2px' }}>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', margin: '0 0 10px' }}>
          Percorre a cadeia inteira (mesma ordem de produção — Gemini key1 → Gemini key2 → OpenAI → OpenRouter) com um
          prompt mínimo, um provider de cada vez. Máx. 1 execução real a cada 5min — cliques repetidos dentro da janela
          devolvem o resultado cacheado.
        </p>

        {err && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--lose)' }}>
            ✗ {err}
          </div>
        )}

        {!health && !loading && !err && (
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12.5, color: 'var(--text-4)', padding: '8px 2px' }}>
            Nenhum teste rodado ainda nesta sessão — clique em "Testar agora".
          </div>
        )}

        {health && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <span
                className="badge"
                style={{
                  fontSize: 11,
                  background: health.any_ok ? 'rgba(0,180,120,0.12)' : 'rgba(220,60,60,0.14)',
                  color: health.any_ok ? 'var(--win)' : 'var(--lose)',
                  border: `1px solid ${health.any_ok ? 'var(--win)' : 'var(--lose)'}`,
                }}
              >
                {health.any_ok ? `✅ ${nOk}/${n} provedores ok` : `⚠️ 0/${n} — CADEIA INTEIRA FORA`}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)' }}>
                testado {fmtShort(health.tested_at)}
              </span>
              {health.cached && (
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic' }}>
                  ⏳ resultado cacheado (5min)
                </span>
              )}
            </div>

            <div className="adm-table-wrap" style={{ marginBottom: 16 }}>
              <table className="adm-table">
                <thead><tr><th>Provider</th><th>Status</th><th>Latência</th><th>Erro</th></tr></thead>
                <tbody>
                  {providers.map((p, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{p.label}</td>
                      <td>{p.ok ? <span style={{ color: 'var(--win)' }}>✅ ok</span> : <span style={{ color: 'var(--lose)' }}>❌ falhou</span>}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.latency_ms} ms</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--lose)', maxWidth: 360 }}>{p.error || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={h4}>Créditos OpenRouter</div>
            {credits?.error ? (
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)' }}>⚠️ não foi possível consultar: {credits.error}</p>
            ) : credits ? (
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
                <div className="adm-kpi"><div className="adm-kpi__val">{fmtUsd(credits.total_credits)}</div><div className="adm-kpi__label">Total comprado</div></div>
                <div className="adm-kpi"><div className="adm-kpi__val" style={{ color: 'var(--accent)' }}>{fmtUsd(credits.total_usage)}</div><div className="adm-kpi__label">Usado (all-time)</div></div>
                <div className="adm-kpi"><div className="adm-kpi__val" style={{ color: credits.remaining > 1 ? 'var(--win)' : 'var(--lose)' }}>{fmtUsd(credits.remaining)}</div><div className="adm-kpi__label">Saldo restante</div></div>
              </div>
            ) : (
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Sem chave OpenRouter configurada.</p>
            )}

            <div style={h4}>Consumo (7 dias) — analysis_logs</div>
            <div className="adm-table-wrap">
              <table className="adm-table" style={{ fontSize: 11 }}>
                <thead><tr><th>Provider</th><th>Chamadas ok</th><th>Erros</th><th>Tokens</th><th>Custo (US$)</th></tr></thead>
                <tbody>
                  {consumption.length ? consumption.map((c, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{c.provider}</td>
                      <td>{c.calls_ok}</td>
                      <td style={{ color: c.calls_error ? 'var(--lose)' : 'var(--text-4)' }}>{c.calls_error}</td>
                      <td>{c.tokens_total.toLocaleString('pt-BR')}</td>
                      <td>{fmtUsd(c.cost_usd)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} style={{ color: 'var(--text-4)' }}>sem chamadas nos últimos 7 dias</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Custos & Consumo LLM ────────────────────────────────────────────────────
// GET /admin/llm/costs — KPIs (hoje BRT/7d/30d/projeção), série diária 14d,
// quebra por trigger (Análise/Oráculo/H2H) e por modelo. Fonte: analysis_logs.

function fmtInt(v) {
  return (v ?? 0).toLocaleString('pt-BR')
}

function LlmCostBars({ daily }) {
  const W = 640, H = 168, PADL = 6, PADR = 6, PADB = 22, PADT = 10
  const chartH = H - PADT - PADB
  const n = daily.length || 1
  const chartW = W - PADL - PADR
  const slot = chartW / n
  const barGap = Math.min(6, slot * 0.25)
  const barW = Math.max(4, slot - barGap)
  const maxCost = Math.max(0.000001, ...daily.map(d => d.cost_usd))

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 460, display: 'block' }}>
        <line x1={PADL} y1={PADT + chartH} x2={W - PADR} y2={PADT + chartH} stroke="currentColor" strokeOpacity="0.15" />
        {daily.map((d, i) => {
          const x = PADL + i * slot + barGap / 2
          const costH = d.cost_usd > 0 ? Math.max(2, (d.cost_usd / maxCost) * chartH) : 0
          const y = PADT + chartH - costH
          const dt = new Date(`${d.day}T12:00:00`)
          const label = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          const title = `${label} — US$ ${d.cost_usd.toFixed(4)} · ${d.calls_ok} ok / ${d.calls_error} erro · ${fmtInt(d.tokens)} tokens`
          return (
            <g key={d.day}>
              {/* hit area cheia da coluna, pro hover funcionar mesmo em dia sem custo (barra zero) */}
              <rect x={x} y={PADT} width={barW} height={chartH} fill="transparent">
                <title>{title}</title>
              </rect>
              {costH > 0 && (
                <rect x={x} y={y} width={barW} height={costH} rx="2" fill="var(--accent)" opacity="0.85">
                  <title>{title}</title>
                </rect>
              )}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fill: 'currentColor', opacity: 0.4 }}>
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function LlmCostsCard({ data, loading, err, onReload }) {
  const h4 = { fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, marginTop: 14 }
  const kpis = data?.kpis
  const budget = data?.budget
  const daily = data?.daily || []
  const byTrigger = data?.by_trigger || []
  const byModel = data?.by_model || []

  return (
    <div className="adm-card">
      <div className="adm-card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="adm-card__title">💰 Custos & Consumo LLM</span>
        <button className="btn btn-ghost btn-sm" onClick={onReload} disabled={loading}>
          {loading ? '… carregando' : '↻ Atualizar'}
        </button>
      </div>

      <div style={{ padding: '4px 2px' }}>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', margin: '0 0 10px' }}>
          Consumo real gravado em <code>analysis_logs</code> a cada chamada de LLM (análise de partida, Oráculo, H2H).
          Datas em horário de Brasília.
        </p>

        {err && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--lose)' }}>
            ✗ {err}
          </div>
        )}

        {!data && !loading && !err && (
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12.5, color: 'var(--text-4)', padding: '8px 2px' }}>
            Sem dados ainda.
          </div>
        )}

        {data && (
          <>
            {budget?.alert && (
              <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(220,60,60,0.1)', border: '1px solid var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 12.5, color: 'var(--lose)' }}>
                ⚠️ Custo de hoje já consumiu <strong>{budget.pct_used}%</strong> do orçamento diário (US$ {Number(budget.limit_usd).toFixed(2)}) — <code>llm_daily_budget_usd</code> em <code>site_config</code>.
              </div>
            )}

            <div className="adm-kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
              <div className="adm-kpi">
                <div className="adm-kpi__val" style={{ color: budget?.alert ? 'var(--lose)' : 'var(--text-1)' }}>{fmtUsd(kpis?.cost_today_usd)}</div>
                <div className="adm-kpi__label">Hoje (BRT)</div>
              </div>
              <div className="adm-kpi"><div className="adm-kpi__val">{fmtUsd(kpis?.cost_7d_usd)}</div><div className="adm-kpi__label">7 dias</div></div>
              <div className="adm-kpi"><div className="adm-kpi__val">{fmtUsd(kpis?.cost_30d_usd)}</div><div className="adm-kpi__label">30 dias</div></div>
              <div className="adm-kpi"><div className="adm-kpi__val" style={{ color: 'var(--accent)' }}>{fmtUsd(kpis?.monthly_projection_usd)}</div><div className="adm-kpi__label">Projeção mensal</div></div>
            </div>

            <div style={h4}>Custo por dia — últimos 14 dias (BRT)</div>
            {daily.length ? <LlmCostBars daily={daily} /> : (
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>sem chamadas no período</p>
            )}

            <div style={h4}>Por gatilho</div>
            <div className="adm-table-wrap" style={{ marginBottom: 16 }}>
              <table className="adm-table" style={{ fontSize: 11 }}>
                <thead><tr><th>Gatilho</th><th>Chamadas ok</th><th>Erros</th><th>Tokens</th><th>Custo (US$)</th></tr></thead>
                <tbody>
                  {byTrigger.length ? byTrigger.map((t, i) => (
                    <tr key={i}>
                      <td>{t.label}</td>
                      <td>{fmtInt(t.calls_ok)}</td>
                      <td style={{ color: t.calls_error ? 'var(--lose)' : 'var(--text-4)' }}>{fmtInt(t.calls_error)}</td>
                      <td>{fmtInt(t.tokens)}</td>
                      <td>{fmtUsd(t.cost_usd)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={5} style={{ color: 'var(--text-4)' }}>sem chamadas nos últimos 30 dias</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={h4}>Por modelo</div>
            <div className="adm-table-wrap">
              <table className="adm-table" style={{ fontSize: 11 }}>
                <thead><tr><th>Modelo</th><th>Provider</th><th>Chamadas ok</th><th>Erros</th><th>Tokens</th><th>Custo (US$)</th></tr></thead>
                <tbody>
                  {byModel.length ? byModel.map((m, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, maxWidth: 260, wordBreak: 'break-all' }}>{m.model}</td>
                      <td>{m.provider}</td>
                      <td>{fmtInt(m.calls_ok)}</td>
                      <td style={{ color: m.calls_error ? 'var(--lose)' : 'var(--text-4)' }}>{fmtInt(m.calls_error)}</td>
                      <td>{fmtInt(m.tokens)}</td>
                      <td>{fmtUsd(m.cost_usd)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={6} style={{ color: 'var(--text-4)' }}>sem chamadas nos últimos 30 dias</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Sistema() {
  const { token } = useAuth()
  const [sub, setSub] = useState('geral')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [llmHealth, setLlmHealth] = useState(null)
  const [llmLoading, setLlmLoading] = useState(false)
  const [llmErr, setLlmErr] = useState('')

  const [llmCosts, setLlmCosts] = useState(null)
  const [llmCostsLoading, setLlmCostsLoading] = useState(false)
  const [llmCostsErr, setLlmCostsErr] = useState('')

  async function load() {
    setLoading(true); setErr('')
    try { setStatus(await api.get('/admin/system/status', token)) }
    catch (e) { setErr(e?.message || 'Erro ao carregar status') }
    finally { setLoading(false) }
  }

  async function testLlm() {
    setLlmLoading(true); setLlmErr('')
    try { setLlmHealth(await api.post('/admin/llm/test', {}, token)) }
    catch (e) { setLlmErr(e?.message || 'Erro ao testar provedores') }
    finally { setLlmLoading(false) }
  }

  async function loadLlmCosts() {
    setLlmCostsLoading(true); setLlmCostsErr('')
    try { setLlmCosts(await api.get('/admin/llm/costs?days=30', token)) }
    catch (e) { setLlmCostsErr(e?.message || 'Erro ao carregar custos LLM') }
    finally { setLlmCostsLoading(false) }
  }

  useEffect(() => { load(); loadLlmCosts() }, [])

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
          <a href="/admin/bots" className="btn btn-ghost btn-sm">🤖 Bot Squad</a>
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
          <>
            <div className="adm-card" style={{ marginBottom: 16 }}>
              <div className="adm-card__header"><span className="adm-card__title">🧠 Motor de Simulação & Oráculo</span></div>
              <div style={{ padding: '4px 2px' }}>
                <div style={h4}>Pipeline (engine/)</div>
                <p style={p}><code>elo.py</code> → probabilidades · <code>poisson.py</code> (Dixon-Coles) → placares · <code>monte_carlo.py</code> (NumPy vetorizado) → distribuição · <code>weights.py</code> combina fatores em λ por time.</p>
                <div style={h4}>Pesos calibrados (bootstrap sobre jogos finalizados)</div>
                <p style={p}>odds de mercado <strong>53.7%</strong> · xG <strong>41.3%</strong> · H2H <strong>5%</strong> (carve-out manual, não fit estatístico — H2H é multiplicador 0.85–1.15, não peso linear puro). Recalibração tentada em 18/07 com Copa+BR piorou em holdout (vazamento de futuro no estado mutável dos times) — pesos mantidos. <code>market_odds</code> nunca recebe odds real (nunca populado) — sempre cai no fallback <code>elo_win_probabilities</code>.</p>
                <div style={h4}>Oráculo LLM (bot.py)</div>
                <p style={p}>Primário definido em oracle_provider (hoje OpenAI gpt-5-mini direto), fallback pela cadeia de análise. <strong>Gate de confiança 85</strong>: só diverge do baseline estatístico com alta convicção ou lesão/suspensão relevante — sem o gate, taxa de acerto de placar exato medida caiu de 11% pra 3,8% (dado real, 45 partidas). Cobre Copa e Brasileirão (prompt de clube dedicado).</p>
                <div style={h4}>Análise IA (analysis.py)</div>
                <p style={p}>Pré-gerada e cacheada por partida (nunca on-the-fly). Campo <code>hook</code> só pode citar número calculado e injetado no prompt (streaks do banco, artilheiro via cache Redis) — proibido a IA inventar estatística. Prompt dedicado pro Brasileirão (clube ≠ seleção: sem convocação, sem boletim médico).</p>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <LlmHealthCard
                health={llmHealth}
                loading={llmLoading}
                err={llmErr}
                onTest={testLlm}
              />
            </div>

            <LlmCostsCard
              data={llmCosts}
              loading={llmCostsLoading}
              err={llmCostsErr}
              onReload={loadLlmCosts}
            />
          </>
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
