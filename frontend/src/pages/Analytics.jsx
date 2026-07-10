import { useState, useEffect, Fragment } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Line, Legend, AreaChart, Area, ReferenceLine, Cell } from 'recharts'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

const DEVICE_ICON = { mobile: '📱', tablet: '📟', desktop: '🖥️' }
const BROWSER_ICON = { Chrome: '🟡', Firefox: '🦊', Safari: '🧭', Edge: '🔵', Opera: '🔴', Bot: '🤖', Other: '⚪' }
const OS_ICON = { Windows: '🪟', Android: '🤖', iOS: '🍎', macOS: '🍎', Linux: '🐧', Other: '⚪' }
const PERIODS = [
  { value: 1,   label: 'Hoje',    short: '1d' },
  { value: 7,   label: '7 dias',  short: '7d' },
  { value: 14,  label: '14 dias', short: '14d' },
  { value: 30,  label: '30 dias', short: '30d' },
  { value: 90,  label: '90 dias', short: '90d' },
  { value: 365, label: '1 ano',   short: '1a' },
]

const FLAG = code => code ? `https://flagcdn.com/24x18/${code.toLowerCase()}.png` : null

const ACTION_LABEL = {
  'login':                   '🔐 Login',
  'profile.update':          '✏️ Perfil editado',
  'profile.password_change': '🔑 Senha alterada',
  'group.rename':            '📝 Grupo renomeado',
  'group.delete':            '🗑 Grupo excluído',
  'group.remove_member':     '👤 Membro removido',
  'group.join':              '➕ Entrou no grupo',
  'group.create':            '🆕 Grupo criado',
  'group.leave':             '🚪 Saiu do grupo',
  'group.cancel_invite':     '✖️ Convite cancelado',
  'group.invite_sent':       '✉️ Convite enviado',
  'group.invite_accept':     '✅ Convite aceito',
  'group.invite_reject':     '🚫 Convite recusado',
  'group.champion_pick':     '🏆 Campeão do grupo',
  'bet.place':               '🎯 Palpite feito',
  'bet.rejected':            '⚠️ Palpite rejeitado',
  'register':                '🌟 Cadastro',
  'password.reset':          '🔑 Senha redefinida (e-mail)',
}

function MiniBar({ value, max, color = 'var(--accent)' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--bg-overlay)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 400ms' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-2)', minWidth: 32, textAlign: 'right' }}>{value.toLocaleString()}</span>
    </div>
  )
}

const HEAT_DOW = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

// Mapa de calor dia-da-semana × hora (horário de Brasília). grid = 7×24.
function HourHeatmap({ grid, rgb }) {
  if (!grid || grid.length !== 7) {
    return <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>Sem dados</div>
  }
  const flat = grid.flat()
  const max = Math.max(1, ...flat)
  const total = flat.reduce((a, b) => a + b, 0)
  // Hora de pico (somando os 7 dias)
  const hourTotals = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h], 0))
  const peakHour = hourTotals.indexOf(Math.max(...hourTotals))

  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(24, 1fr)', gap: 3, minWidth: 620 }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-4)', textAlign: 'center' }}>
              {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
            </div>
          ))}
          {grid.map((row, d) => (
            <Fragment key={d}>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', display: 'flex', alignItems: 'center', paddingRight: 6 }}>{HEAT_DOW[d]}</div>
              {row.map((v, h) => {
                const a = v === 0 ? 0 : 0.14 + 0.86 * (v / max)
                return (
                  <div key={h}
                    title={`${HEAT_DOW[d]} ${String(h).padStart(2, '0')}h — ${v}`}
                    style={{ aspectRatio: '1', minHeight: 14, borderRadius: 3, background: v === 0 ? 'var(--bg-overlay)' : `rgba(${rgb}, ${a.toFixed(2)})` }} />
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s2)', marginTop: 'var(--s3)', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
        <span>Total: <b style={{ color: 'var(--text-2)' }}>{total.toLocaleString()}</b> · Pico: <b style={{ color: `rgb(${rgb})` }}>{String(peakHour).padStart(2, '0')}h</b></span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          menos
          <span style={{ display: 'flex', gap: 2 }}>
            {[0.14, 0.4, 0.66, 0.92].map(a => (
              <span key={a} style={{ width: 12, height: 12, borderRadius: 2, background: `rgba(${rgb}, ${a})` }} />
            ))}
          </span>
          mais
        </span>
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div className="card" style={{ padding: 'var(--s5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--s2)' }}>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
        {icon && <span style={{ fontSize: 16, opacity: 0.6 }}>{icon}</span>}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, color: color || 'var(--accent)', lineHeight: 1 }}>
        {typeof value === 'number' ? value.toLocaleString('pt-BR') : value}
      </div>
      {sub && <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', marginTop: 'var(--s2)' }}>{sub}</div>}
    </div>
  )
}

function DualChart({ viewsData, regsData, showRegs, newVisitorsData, showNewVisitors }) {
  if (!viewsData || viewsData.length === 0)
    return <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>Sem dados</div>

  const regMap = Object.fromEntries((regsData || []).map(d => [d.date, d.count]))
  const newVisMap = Object.fromEntries((newVisitorsData || []).map(d => [d.date, d.new_visitors]))
  const data = viewsData.map(d => ({
    date: d.date.slice(5),
    views: d.views,
    cadastros: regMap[d.date] || 0,
    novosVisitantes: newVisMap[d.date] || 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 9, fill: 'var(--text-4)', fontFamily: 'var(--font-data)' }}
          tickLine={false} axisLine={false}
          interval={data.length > 20 ? Math.floor(data.length / 10) : 0}
        />
        <YAxis
          tick={{ fontSize: 9, fill: 'var(--text-4)', fontFamily: 'var(--font-data)' }}
          tickLine={false} axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-data)',
            color: 'var(--text-1)',
          }}
          labelStyle={{ color: 'var(--text-3)', marginBottom: 4 }}
          cursor={{ fill: 'var(--bg-overlay)' }}
        />
        <Bar dataKey="views" fill="var(--accent)" opacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={24} name="Views" />
        {showRegs && (
          <Bar dataKey="cadastros" fill="var(--win)" opacity={0.9} radius={[2, 2, 0, 0]} maxBarSize={12} name="Cadastros" />
        )}
        {showNewVisitors && (
          <Bar dataKey="novosVisitantes" fill="#f59e0b" opacity={0.9} radius={[2, 2, 0, 0]} maxBarSize={12} name="Novos visitantes" />
        )}
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function Analytics() {
  const { token } = useAuth()
  const [stats, setStats]   = useState(null)
  const [recent, setRecent] = useState([])
  const [days, setDays]     = useState(7)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState(() => new URLSearchParams(window.location.search).get('tab') || 'overview')
  const [chartOverlay, setChartOverlay] = useState(false)
  const [chartOverlayNewVis, setChartOverlayNewVis] = useState(false)
  const [heatMetric, setHeatMetric]     = useState('access')

  const [auditLogs, setAuditLogs]       = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilter, setAuditFilter]   = useState('')
  const [topUsers, setTopUsers]         = useState(null)
  const [topUsersLoading, setTopUsersLoading] = useState(false)

  const [betsAudit, setBetsAudit]           = useState(null)
  const [betsLoading, setBetsLoading]       = useState(false)
  const [betsResultFilter, setBetsResultFilter] = useState('')
  const [betsUserFilter, setBetsUserFilter]     = useState('')
  const [betsOffset, setBetsOffset]             = useState(0)
  const BETS_LIMIT = 100

  const [retention, setRetention]           = useState(null)
  const [retentionLoading, setRetentionLoading] = useState(false)
  const [cohort, setCohort]                 = useState(null)
  const [cohortLoading, setCohortLoading]   = useState(false)

  const [funnel, setFunnel]                 = useState(null)
  const [funnelLoading, setFunnelLoading]   = useState(false)

  const [simStats, setSimStats]             = useState(null)
  const [simStatsLoading, setSimStatsLoading] = useState(false)

  const [simImpact, setSimImpact]           = useState(null)
  const [simImpactLoading, setSimImpactLoading] = useState(false)

  const [traffic, setTraffic]               = useState(null)
  const [trafficLoading, setTrafficLoading] = useState(false)

  const [v2Usage, setV2Usage]               = useState(null)
  const [v2UsageLoading, setV2UsageLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get(`/analytics/stats?days=${days}`, token),
      api.get(`/analytics/recent?limit=100&days=${days}`, token),
    ]).then(([s, r]) => {
      setStats(s)
      setRecent(r)
    }).catch(console.error).finally(() => setLoading(false))
  }, [days, token])

  useEffect(() => {
    if (tab !== 'audit') return
    loadAudit()
  }, [tab, token])

  useEffect(() => {
    if (tab !== 'pages') return
    setV2UsageLoading(true)
    api.get(`/analytics/v2-usage?days=${days}`, token)
      .then(d => setV2Usage(d))
      .catch(() => {})
      .finally(() => setV2UsageLoading(false))
  }, [tab, days, token])

  useEffect(() => {
    if (tab !== 'usuarios') return
    setTopUsersLoading(true)
    api.get(`/analytics/top-users?days=${days}`, token)
      .then(d => setTopUsers(d))
      .catch(() => {})
      .finally(() => setTopUsersLoading(false))
  }, [tab, days, token])

  useEffect(() => {
    if (tab !== 'bets') return
    loadBetsAudit(betsResultFilter, betsUserFilter, 0)
  }, [tab, token])

  useEffect(() => {
    if (tab !== 'retencao') return
    setRetentionLoading(true)
    api.get('/analytics/retention?weeks=10', token)
      .then(d => setRetention(d))
      .catch(console.error)
      .finally(() => setRetentionLoading(false))
    setCohortLoading(true)
    api.get('/analytics/cohort', token)
      .then(d => setCohort(d))
      .catch(console.error)
      .finally(() => setCohortLoading(false))
  }, [tab, token])

  useEffect(() => {
    if (tab !== 'retencao') return
    setFunnelLoading(true)
    api.get(`/analytics/funnel?days=${days}`, token)
      .then(d => setFunnel(d))
      .catch(console.error)
      .finally(() => setFunnelLoading(false))
    setSimStatsLoading(true)
    api.get(`/analytics/simulations?days=${days}`, token)
      .then(d => setSimStats(d))
      .catch(console.error)
      .finally(() => setSimStatsLoading(false))
    setSimImpactLoading(true)
    api.get(`/analytics/simulation-impact?days=30&weeks=8`, token)
      .then(d => setSimImpact(d))
      .catch(console.error)
      .finally(() => setSimImpactLoading(false))
    setTrafficLoading(true)
    api.get(`/analytics/traffic-sources?days=${days}`, token)
      .then(d => setTraffic(d))
      .catch(console.error)
      .finally(() => setTrafficLoading(false))
  }, [tab, days, token])

  function loadBetsAudit(res = betsResultFilter, user = betsUserFilter, off = betsOffset) {
    setBetsLoading(true)
    const qs = new URLSearchParams({ limit: BETS_LIMIT, offset: off })
    if (res) qs.set('result', res)
    if (user) qs.set('user_id', user)
    api.get(`/analytics/bets-audit?${qs}`, token)
      .then(d => { setBetsAudit(d); setBetsOffset(off) })
      .catch(console.error)
      .finally(() => setBetsLoading(false))
  }

  function loadAudit(action = auditFilter) {
    setAuditLoading(true)
    const qs = action ? `?action=${encodeURIComponent(action)}&limit=200` : '?limit=200'
    api.get(`/audit/logs${qs}`, token)
      .then(d => setAuditLogs(d))
      .catch(console.error)
      .finally(() => setAuditLoading(false))
  }

  if (loading) return <Spinner text="Carregando analytics..." />
  if (!stats) return <div className="page"><p style={{ color: 'var(--text-3)' }}>Sem dados.</p></div>

  const maxPage    = stats.top_pages[0]?.views || 1
  const maxCountry = stats.top_countries[0]?.views || 1
  const maxBrowser = stats.browsers[0]?.views || 1
  const maxDevice  = stats.devices[0]?.views || 1
  const selectedPeriod = PERIODS.find(p => p.value === days) || PERIODS[1]

  const TABS = [
    { id: 'overview',  label: '📊 Visão Geral' },
    { id: 'usuarios',  label: '👥 Usuários' },
    { id: 'pages',     label: '📄 Páginas' },
    { id: 'geo',       label: '🌍 Localidade' },
    { id: 'tech',      label: '💻 Tecnologia' },
    { id: 'recent',    label: '🕐 Recentes' },
    { id: 'bets',      label: '🎯 Apostas' },
    { id: 'retencao',  label: '🔄 Retenção & Funil' },
    { id: 'audit',     label: '🔐 Auditoria' },
  ]

  return (
    <div className="page">
      {/* Header */}
      <div className="fade-in-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <div>
          <h1 className="page-title">ANALYTICS</h1>
          <p className="page-subtitle">Tráfego · Usuários · Conversão · {selectedPeriod.label}</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {PERIODS.map(period => (
            <button key={period.value} onClick={() => setDays(period.value)}
              className={`btn btn-ghost btn-sm${days === period.value ? ' btn-ghost--active' : ''}`}
              style={{ fontSize: 12 }}>
              {period.short}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs row 1 — tráfego */}
      <div className="fade-in-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s3)', marginTop: 'var(--s5)' }}>
        <KpiCard label="Page Views"      value={stats.total_views}  color="var(--accent)"  icon="👁" />
        <KpiCard label="Visitantes únicos" value={stats.unique_ips} color="var(--win)"     icon="🙋" />
        <KpiCard label="Novos visitantes" value={stats.new_visitors ?? stats.unique_ips} color="#f59e0b" icon="🆕" sub={`${stats.returning_visitors ?? 0} retornantes`} />
        <KpiCard label="Novos hoje"       value={stats.new_visitors_today ?? 0} color="#f59e0b" icon="☀️" sub="visitantes únicos" />
        <KpiCard label="Páginas únicas"   value={stats.unique_pages} color="#a78bfa"      icon="📄" />
      </div>

      {/* KPIs row 2 — engajamento e conversão */}
      <div className="fade-in-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
        <KpiCard label="Novos Cadastros"  value={stats.new_users ?? 0}    color="var(--win)"  icon="✅" sub={`de ${stats.total_users ?? '?'} total`} />
        <KpiCard label="Taxa de Conversão" value={`${stats.conversion_rate ?? 0}%`} color="#10b981" icon="🎯" sub="visitantes → cadastros" />
        <KpiCard label="Bounce Rate"      value={`${stats.bounce_rate ?? 0}%`}      color={stats.bounce_rate > 60 ? 'var(--lose)' : '#f59e0b'} icon="↩️" sub="visitas de 1 página" />
        <KpiCard label="Páginas/Visita"   value={stats.avg_pages ?? 0}    color="var(--accent)" icon="📈" sub="engajamento médio" />
      </div>

      {/* Day chart + legenda */}
      <div className="card fade-in-2" style={{ marginTop: 'var(--s4)' }}>
        <div className="card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>📈 Views por Dia</span>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={chartOverlay} onChange={e => setChartOverlay(e.target.checked)} />
              <span style={{ color: 'var(--win)' }}>+ cadastros</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={chartOverlayNewVis} onChange={e => setChartOverlayNewVis(e.target.checked)} />
              <span style={{ color: '#f59e0b' }}>+ novos visitantes</span>
            </label>
          </div>
        </div>
        <div className="card__body">
          <DualChart
            viewsData={stats.views_per_day}
            regsData={stats.registrations_per_day}
            showRegs={chartOverlay}
            newVisitorsData={stats.new_visitors_per_day}
            showNewVisitors={chartOverlayNewVis}
          />
        </div>
      </div>

      {/* Mapa de calor — acessos / apostas por hora do dia (BRT) */}
      <div className="card fade-in-2" style={{ marginTop: 'var(--s4)' }}>
        <div className="card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s2)' }}>
          <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🔥 Mapa de Calor por Hora</span>
          <div style={{ display: 'flex', gap: 'var(--s2)' }}>
            <button onClick={() => setHeatMetric('access')}
              className={`btn btn-ghost btn-sm${heatMetric === 'access' ? ' btn-ghost--active' : ''}`} style={{ fontSize: 12 }}>
              👁 Acessos
            </button>
            <button onClick={() => setHeatMetric('bets')}
              className={`btn btn-ghost btn-sm${heatMetric === 'bets' ? ' btn-ghost--active' : ''}`} style={{ fontSize: 12 }}>
              🎯 Apostas
            </button>
          </div>
        </div>
        <div className="card__body">
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', margin: '0 0 var(--s3)', letterSpacing: '0.03em' }}>
            Dia da semana × hora (horário de Brasília) · {selectedPeriod.label}
          </p>
          <HourHeatmap
            grid={heatMetric === 'access' ? stats.access_heatmap : stats.bets_heatmap}
            rgb={heatMetric === 'access' ? '15,122,120' : '232,196,74'}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="phase-nav fade-in-3" style={{ marginTop: 'var(--s5)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`phase-nav__tab${tab === t.id ? ' active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s4)', marginTop: 'var(--s4)' }} className="fade-in-1">
          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>📄 Top Páginas</span></div>
            <div className="card__body">
              <div className="stack gap-3">
                {stats.top_pages.slice(0, 5).map(p => (
                  <div key={p.path} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path || '/'}</span>
                    <MiniBar value={p.views} max={maxPage} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>📱 Dispositivos</span></div>
            <div className="card__body">
              <div className="stack gap-3">
                {stats.devices.map(d => (
                  <div key={d.device} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', textTransform: 'capitalize' }}>{DEVICE_ICON[d.device] || '⚪'} {d.device}</span>
                    <MiniBar value={d.views} max={maxDevice} color="var(--win)" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🌐 Navegadores</span></div>
            <div className="card__body">
              <div className="stack gap-3">
                {stats.browsers.map(b => (
                  <div key={b.browser} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>{BROWSER_ICON[b.browser] || '⚪'} {b.browser}</span>
                      {b.unique_ips != null && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)' }}>{b.unique_ips} únicos</span>}
                    </div>
                    <MiniBar value={b.unique_ips || b.views} max={Math.max(...stats.browsers.map(x => x.unique_ips || x.views), 1)} color="#f59e0b" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🌍 Top Países</span></div>
            <div className="card__body">
              <div className="stack gap-3">
                {stats.top_countries.slice(0, 5).map(c => (
                  <div key={c.code} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {FLAG(c.code) && <img src={FLAG(c.code)} alt={c.code} style={{ width: 16, height: 12, borderRadius: 1 }} />}
                      {c.name || c.code || 'Desconhecido'}
                    </span>
                    <MiniBar value={c.views} max={maxCountry} color="var(--conf-uefa, #4a90e8)" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Usuários tab */}
      {tab === 'usuarios' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s4)', marginTop: 'var(--s4)' }} className="fade-in-1">
          {/* Funil de conversão */}
          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🎯 Funil de Conversão</span></div>
            <div className="card__body">
              <div className="stack gap-4">
                {[
                  { label: 'Visitantes únicos', value: stats.unique_ips, color: 'var(--accent)', pct: 100 },
                  { label: 'Novos visitantes',  value: stats.new_visitors ?? stats.unique_ips, color: '#f59e0b', pct: stats.unique_ips ? Math.round(((stats.new_visitors ?? stats.unique_ips) / stats.unique_ips) * 100) : 0 },
                  { label: 'Novos cadastros',   value: stats.new_users ?? 0, color: 'var(--win)', pct: stats.unique_ips ? Math.round(((stats.new_users ?? 0) / stats.unique_ips) * 100) : 0 },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>{row.label}</span>
                      <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: row.color, fontWeight: 700 }}>{row.value.toLocaleString('pt-BR')} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({row.pct}%)</span></span>
                    </div>
                    <div style={{ height: 8, background: 'var(--bg-overlay)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${row.pct}%`, height: '100%', background: row.color, borderRadius: 4, transition: 'width 500ms' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Visitantes novos vs retornantes */}
          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🔄 Visitantes</span></div>
            <div className="card__body">
              <div className="stack gap-4">
                {[
                  { label: 'Novos',       value: stats.new_visitors ?? 0,       color: 'var(--accent)' },
                  { label: 'Retornantes', value: stats.returning_visitors ?? 0,  color: '#a78bfa' },
                ].map(row => {
                  const total = (stats.new_visitors ?? 0) + (stats.returning_visitors ?? 0)
                  const pct = total > 0 ? Math.round((row.value / total) * 100) : 0
                  return (
                    <div key={row.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>{row.label}</span>
                        <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: row.color }}>{row.value.toLocaleString('pt-BR')} ({pct}%)</span>
                      </div>
                      <div style={{ height: 8, background: 'var(--bg-overlay)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: row.color, borderRadius: 4, transition: 'width 500ms' }} />
                      </div>
                    </div>
                  )
                })}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s3)' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Engajamento</div>
                  <div style={{ display: 'flex', gap: 'var(--s4)' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 900, color: 'var(--accent)' }}>{stats.avg_pages ?? 0}</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>páginas/visita</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 900, color: stats.bounce_rate > 60 ? 'var(--lose)' : '#f59e0b' }}>{stats.bounce_rate ?? 0}%</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>bounce rate</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cadastros por dia */}
          {stats.registrations_per_day?.length > 0 && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>✅ Cadastros por Dia</span></div>
              <div className="card__body">
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart
                    data={stats.registrations_per_day.map(d => ({ date: d.date.slice(5), cadastros: d.count }))}
                    margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-4)', fontFamily: 'var(--font-data)' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-4)', fontFamily: 'var(--font-data)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, color: 'var(--text-1)' }} cursor={{ fill: 'var(--bg-overlay)' }} />
                    <Bar dataKey="cadastros" fill="var(--win)" radius={[3, 3, 0, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textAlign: 'center', marginTop: 'var(--s3)' }}>
                  {stats.new_users} novos usuários · total {stats.total_users}
                </div>
              </div>
            </div>
          )}

          {/* Top usuários */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>👑 Usuários Mais Ativos</span>
              {topUsersLoading && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>carregando…</span>}
            </div>
            <div className="card__body">
              {!topUsers || topUsers.users?.length === 0
                ? <p style={{ color: 'var(--text-3)', fontSize: 13, fontFamily: 'var(--font-cond)' }}>Sem dados ainda. Usuários logados aparecerão aqui conforme navegam no sistema.</p>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-data)' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['#', 'Usuário', 'Page views', 'Dias ativos', 'Média/dia', 'Último acesso'].map(h => (
                            <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {topUsers.users.map((u, i) => (
                          <tr key={u.user_id} style={{ borderBottom: '1px solid var(--border)' }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                            onMouseLeave={e => e.currentTarget.style.background = ''}>
                            <td style={{ padding: '5px 8px', color: 'var(--text-3)', fontWeight: 700 }}>
                              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                            </td>
                            <td style={{ padding: '5px 8px' }}>
                              <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>{u.name}</div>
                              <div style={{ color: 'var(--text-4)', fontSize: 10 }}>{u.email}</div>
                            </td>
                            <td style={{ padding: '5px 8px', color: 'var(--accent)', fontWeight: 700, textAlign: 'right' }}>{u.page_views.toLocaleString()}</td>
                            <td style={{ padding: '5px 8px', color: 'var(--text-2)', textAlign: 'right' }}>{u.active_days}</td>
                            <td style={{ padding: '5px 8px', color: 'var(--text-2)', textAlign: 'right' }}>{u.avg_views_per_day}</td>
                            <td style={{ padding: '5px 8px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                              {u.last_login ? new Date(u.last_login).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              }
            </div>
          </div>
        </div>
      )}

      {/* Pages tab */}
      {tab === 'pages' && (
        <>
          <div className="card fade-in-1">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>⚡ Adoção V2 (proposta simulação)</span></div>
            <div className="card__body">
              {v2UsageLoading ? <Spinner /> : v2Usage ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--accent)' }}>{v2Usage.adoption_pct}%</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>das visitas na tela de simulação foram V2</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text-1)' }}>{v2Usage.v2_views}</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>visitas V2 ({v2Usage.v1_views} V1)</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text-1)' }}>{v2Usage.v2_unique_ips}</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>visitantes únicos (IP) na V2</div>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text-1)' }}>{v2Usage.v2_unique_users}</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>usuários logados testaram V2</div>
                    </div>
                  </div>
                  {v2Usage.top_matches.length > 0 && (
                    <>
                      <div className="section-title">Partidas mais testadas na V2</div>
                      <div className="stack gap-3">
                        {v2Usage.top_matches.map(m => (
                          <div key={m.match_id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', alignItems: 'center', gap: 'var(--s3)' }}>
                            <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: 'var(--text-1)' }}>
                              {m.team_a ? `${m.team_a} × ${m.team_b}` : `#${m.match_id}`}
                            </span>
                            <MiniBar value={m.views} max={v2Usage.top_matches[0].views} />
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {v2Usage.v2_views === 0 && (
                    <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
                      Ninguém visitou a V2 ainda neste período.
                    </p>
                  )}
                </>
              ) : (
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)' }}>Sem dados.</p>
              )}
            </div>
          </div>

          <div className="card fade-in-2" style={{ marginTop: 'var(--s4)' }}>
          <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>📄 Todas as Páginas</span></div>
          <div className="card__body">
            <div className="stack gap-4">
              {stats.top_pages.map((p, i) => (
                <div key={p.path} style={{ display: 'grid', gridTemplateColumns: '24px 1fr 120px', alignItems: 'center', gap: 'var(--s3)' }}>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>#{i + 1}</span>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path || '/'}</span>
                  <MiniBar value={p.views} max={maxPage} />
                </div>
              ))}
            </div>
            {stats.top_referrers.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 'var(--s6)' }}>🔗 Referrers</div>
                <div className="stack gap-3">
                  {stats.top_referrers.map(r => (
                    <div key={r.referrer} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', alignItems: 'center', gap: 'var(--s3)' }}>
                      <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.referrer}</span>
                      <MiniBar value={r.views} max={stats.top_referrers[0].views} color="#f59e0b" />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          </div>
        </>
      )}

      {/* Geo tab */}
      {tab === 'geo' && (
        <div className="card fade-in-1" style={{ marginTop: 'var(--s4)' }}>
          <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🌍 Países</span></div>
          <div className="card__body">
            {stats.top_countries.length === 0
              ? <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Nenhum dado de localidade ainda. O geo-lookup popula com novos acessos.</p>
              : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)', maxHeight: 420, overflowY: 'auto' }}>
                  {stats.top_countries.map((c, i) => (
                    <div key={c.code} style={{ display: 'grid', gridTemplateColumns: '24px 28px 1fr 120px', alignItems: 'center', gap: 'var(--s3)' }}>
                      <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>#{i + 1}</span>
                      {FLAG(c.code)
                        ? <img src={FLAG(c.code)} alt={c.code} style={{ width: 24, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                        : <span>🏳️</span>
                      }
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)' }}>{c.name || c.code || 'Desconhecido'}</span>
                      <MiniBar value={c.views} max={maxCountry} color="var(--win)" />
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        </div>
      )}

      {/* Tech tab */}
      {tab === 'tech' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s4)', marginTop: 'var(--s4)' }} className="fade-in-1">
          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>📱 Dispositivos</span></div>
            <div className="card__body">
              <div className="stack gap-4">
                {stats.devices.map(d => (
                  <div key={d.device} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 120px', alignItems: 'center', gap: 'var(--s3)' }}>
                    <span style={{ fontSize: 18 }}>{DEVICE_ICON[d.device] || '⚪'}</span>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)', textTransform: 'capitalize' }}>{d.device}</span>
                    <MiniBar value={d.views} max={maxDevice} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🌐 Navegadores</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>visitantes únicos</span>
            </div>
            <div className="card__body">
              <div className="stack gap-4">
                {stats.browsers.map(b => {
                  const maxUniq = Math.max(...stats.browsers.map(x => x.unique_ips || 0), 1)
                  return (
                    <div key={b.browser} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto 80px', alignItems: 'center', gap: 'var(--s3)' }}>
                      <span style={{ fontSize: 18 }}>{BROWSER_ICON[b.browser] || '⚪'}</span>
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)' }}>{b.browser}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>{b.unique_ips ?? '—'}</span>
                      <MiniBar value={b.unique_ips || b.views} max={maxUniq} color="#f59e0b" />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🖥️ Sistema Operacional</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>visitantes únicos</span>
            </div>
            <div className="card__body">
              <div className="stack gap-4">
                {stats.os.map(o => {
                  const maxUniq = Math.max(...stats.os.map(x => x.unique_ips || 0), 1)
                  return (
                    <div key={o.os} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto 80px', alignItems: 'center', gap: 'var(--s3)' }}>
                      <span style={{ fontSize: 18 }}>{OS_ICON[o.os] || '⚪'}</span>
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)' }}>{o.os}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>{o.unique_ips ?? '—'}</span>
                      <MiniBar value={o.unique_ips || o.views} max={maxUniq} color="var(--win)" />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bets audit tab */}
      {tab === 'bets' && (
        <div className="fade-in-1" style={{ marginTop: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>

          {/* Summary KPIs */}
          {betsAudit?.summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--s3)' }}>
              {[
                { label: 'Total apostas', val: betsAudit.summary.total, color: 'var(--accent)' },
                { label: 'Placar exato', val: betsAudit.summary.exact, color: 'var(--win)' },
                { label: 'Resultado certo', val: betsAudit.summary.correct, color: '#f59e0b' },
                { label: 'Erradas', val: betsAudit.summary.wrong, color: 'var(--lose)' },
                { label: 'Pendentes', val: betsAudit.summary.pending, color: 'var(--text-3)' },
                { label: 'Apostadores', val: betsAudit.summary.unique_users, color: '#a78bfa' },
                { label: 'Jogos apostados', val: betsAudit.summary.unique_matches, color: '#38bdf8' },
              ].map(({ label, val, color }) => (
                <div key={label} className="card" style={{ padding: 'var(--s4)' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-4)', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 900, color }}>{val?.toLocaleString('pt-BR') ?? '—'}</div>
                </div>
              ))}
            </div>
          )}

          {/* Filtros */}
          <div className="card">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🎯 Auditoria de Apostas</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)' }}>
                {betsAudit ? `${betsAudit.total.toLocaleString()} registros` : ''}
              </span>
            </div>
            <div className="card__body">
              <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s4)', alignItems: 'center' }}>
                {[
                  { v: '', l: 'Todos' },
                  { v: 'exact', l: '🎯 Placar exato' },
                  { v: 'correct', l: '✓ Resultado certo' },
                  { v: 'wrong', l: '✗ Erradas' },
                  { v: 'pending', l: '⏳ Pendentes' },
                ].map(({ v, l }) => (
                  <button key={v || 'all'}
                    className={`btn btn-sm ${betsResultFilter === v ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => { setBetsResultFilter(v); loadBetsAudit(v, betsUserFilter, 0) }}
                  >{l}</button>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => loadBetsAudit(betsResultFilter, betsUserFilter, betsOffset)} disabled={betsLoading}>
                  {betsLoading ? '⏳' : '↻'}
                </button>
              </div>

              {betsLoading && <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)' }}>Carregando...</p>}

              {!betsLoading && betsAudit?.items?.length === 0 && (
                <p style={{ color: 'var(--text-3)', fontSize: 13, fontFamily: 'var(--font-cond)' }}>Nenhuma aposta encontrada.</p>
              )}

              {!betsLoading && betsAudit?.items?.length > 0 && (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-data)' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Quando', 'Usuário', 'Jogo', 'Palpite', 'Placar real', 'Resultado', 'Pts'].map(h => (
                            <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {betsAudit.items.map(item => {
                          const resColor = item.result === 'exact' ? 'var(--win)'
                            : item.result === 'correct' ? '#f59e0b'
                            : item.result === 'wrong' ? 'var(--lose)'
                            : 'var(--text-4)'
                          const resLabel = item.result === 'exact' ? '🎯 Exato'
                            : item.result === 'correct' ? '✓ Certo'
                            : item.result === 'wrong' ? '✗ Errado'
                            : '⏳ Pendente'
                          return (
                            <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'default' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                              onMouseLeave={e => e.currentTarget.style.background = ''}>
                              <td style={{ padding: '4px 8px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                {item.created_at ? new Date(item.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                              </td>
                              <td style={{ padding: '4px 8px' }}>
                                <div style={{ color: 'var(--text-1)', fontWeight: 600, whiteSpace: 'nowrap' }}>{item.user_name}</div>
                                <div style={{ color: 'var(--text-4)', fontSize: 9 }}>{item.user_email}</div>
                              </td>
                              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                                <span style={{ color: 'var(--text-2)' }}>{item.team_a} × {item.team_b}</span>
                                {item.group_name && <span style={{ color: 'var(--text-4)', fontSize: 9, marginLeft: 4 }}>{item.group_name}</span>}
                              </td>
                              <td style={{ padding: '4px 8px', fontWeight: 700, color: 'var(--text-1)', textAlign: 'center' }}>
                                {item.bet_a}–{item.bet_b}
                              </td>
                              <td style={{ padding: '4px 8px', color: 'var(--text-2)', textAlign: 'center' }}>
                                {item.real_a != null ? `${item.real_a}–${item.real_b}` : '—'}
                              </td>
                              <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                                <span style={{ color: resColor, fontWeight: 600, fontFamily: 'var(--font-cond)', fontSize: 11 }}>{resLabel}</span>
                              </td>
                              <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: item.points > 0 ? 'var(--win)' : 'var(--text-3)' }}>
                                {item.result === 'pending' ? '—' : item.points}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Paginação */}
                  {betsAudit.total > BETS_LIMIT && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 'var(--s3)', justifyContent: 'center' }}>
                      <button className="btn btn-ghost btn-sm" disabled={betsOffset === 0}
                        onClick={() => loadBetsAudit(betsResultFilter, betsUserFilter, Math.max(0, betsOffset - BETS_LIMIT))}>
                        ← Anterior
                      </button>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                        {betsOffset + 1}–{Math.min(betsOffset + BETS_LIMIT, betsAudit.total)} de {betsAudit.total}
                      </span>
                      <button className="btn btn-ghost btn-sm" disabled={betsOffset + BETS_LIMIT >= betsAudit.total}
                        onClick={() => loadBetsAudit(betsResultFilter, betsUserFilter, betsOffset + BETS_LIMIT)}>
                        Próxima →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Retenção tab */}
      {tab === 'retencao' && (
        <div className="fade-in-1" style={{ marginTop: 'var(--s4)' }}>
          {/* ── Origem de tráfego ────────────────────────────────── */}
          {trafficLoading || !traffic ? (
            <Spinner text="Carregando origem de tráfego..." />
          ) : (
            <div className="card" style={{ marginBottom: 'var(--s4)' }}>
              <div className="card__header">
                <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>
                  🌐 De onde vêm os visitantes — últimos {traffic.days} dias
                </span>
              </div>
              <div className="card__body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--s4)' }}>
                  {traffic.sources.map(s => {
                    const maxV = traffic.sources[0]?.uniq || 1
                    const barW = Math.max(4, Math.round(s.uniq / maxV * 100))
                    return (
                      <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', width: 150, flexShrink: 0 }}>
                          {s.label}
                        </span>
                        <div style={{ flex: 1, background: 'var(--bg-overlay)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                          <div style={{ width: `${barW}%`, height: '100%', borderRadius: 4, background: 'var(--accent)' }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-1)', fontWeight: 700, width: 40, textAlign: 'right' }}>
                          {s.uniq}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div style={{
                  padding: 'var(--s3)', background: 'var(--bg-overlay)', borderRadius: 8,
                  border: '1px solid var(--border)', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)',
                }}>
                  👥 Indicação entre usuários: <strong style={{ color: 'var(--text-1)' }}>{traffic.new_users_referred}</strong> de {traffic.new_users} novos cadastros vieram de link de indicação
                  {traffic.new_users ? ` (${Math.round(traffic.new_users_referred / traffic.new_users * 100)}%)` : ''}.
                </div>
              </div>
            </div>
          )}

          {/* ── Funil de conversão ────────────────────────────────── */}
          {funnelLoading || !funnel ? (
            <Spinner text="Carregando funil..." />
          ) : (
            <div className="card">
              <div className="card__header">
                <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>
                  🔽 Funil de Conversão — últimos {funnel.days} dias
                </span>
              </div>
              <div className="card__body">
                {funnel.steps.map((s, i) => {
                  const maxV = funnel.steps[0]?.views || 1
                  const barW = Math.max(4, Math.round(s.views / maxV * 100))
                  const pct = s.pct_landing ?? s.pct_prev
                  const isBottleneck = pct < 30 && i > 0 && s.note === null
                  const color = i === 0 ? 'var(--accent)'
                    : pct >= 60 ? 'var(--win)'
                    : pct >= 30 ? '#f59e0b'
                    : 'var(--lose)'
                  const labelPct = i === funnel.steps.length - 1
                    ? `${s.pct_prev}% dos cadastros`
                    : i > 0
                      ? `${pct}% da landing`
                      : null
                  return (
                    <div key={i} style={{ marginBottom: 'var(--s4)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{
                            width: 22, height: 22, borderRadius: '50%', background: color,
                            color: '#fff', display: 'inline-flex', alignItems: 'center',
                            justifyContent: 'center', fontSize: 11, fontWeight: 900, flexShrink: 0,
                          }}>{i + 1}</span>
                          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)', fontWeight: 700 }}>
                            {s.step}
                          </span>
                          {isBottleneck && (
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, background: 'rgba(239,68,68,0.12)', color: 'var(--lose)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>
                              GARGALO
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          {labelPct && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color, fontWeight: 700 }}>
                              {labelPct}
                            </span>
                          )}
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 14, color: 'var(--text-1)', fontWeight: 900 }}>
                            {s.views.toLocaleString('pt-BR')}
                          </span>
                        </div>
                      </div>
                      <div style={{ background: 'var(--bg-overlay)', borderRadius: 4, height: 10, overflow: 'hidden' }}>
                        <div style={{
                          width: `${barW}%`, height: '100%', borderRadius: 4,
                          background: color, transition: 'width 0.6s ease',
                        }} />
                      </div>
                      {s.note && (
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 3, fontStyle: 'italic' }}>
                          ℹ️ {s.note}
                        </div>
                      )}
                      {s.drop > 0 && i > 0 && s.note === null && (
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                          ↳ {s.drop.toLocaleString('pt-BR')} saíram nesta etapa
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Resumo */}
                <div style={{
                  marginTop: 'var(--s4)', padding: 'var(--s3)', background: 'var(--bg-overlay)',
                  borderRadius: 8, border: '1px solid var(--border)',
                }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Resumo
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 'var(--s3)' }}>
                    {[
                      { label: 'Landing → Cadastro', value: `${funnel.steps[4] && funnel.steps[0]?.views ? ((funnel.steps[4].views / funnel.steps[0].views) * 100).toFixed(1) : 0}%`, color: 'var(--accent)' },
                      { label: 'Cadastro → 1ª aposta', value: `${funnel.steps[4]?.pct_prev ?? 0}%`, color: 'var(--win)' },
                      { label: 'Maior drop', value: funnel.steps.slice(1).sort((a,b) => a.pct_prev - b.pct_prev)[0]?.step || '—', color: 'var(--lose)', small: true },
                    ].map(m => (
                      <div key={m.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-data)', fontSize: m.small ? 12 : 20, fontWeight: 900, color: m.color, lineHeight: 1.2 }}>{m.value}</div>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Simulações geradas ────────────────────────────────── */}
          {simStatsLoading || !simStats ? (
            <Spinner text="Carregando simulações..." />
          ) : (
            <div className="card" style={{ marginTop: 'var(--s4)' }}>
              <div className="card__header">
                <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>
                  🎲 Simulações geradas — últimos {simStats.days} dias
                </span>
              </div>
              <div className="card__body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
                  {[
                    { label: 'Total de simulações', value: simStats.total_sims, color: 'var(--accent)' },
                    { label: 'Visitantes únicos que simularam', value: simStats.uniq_ips, color: 'var(--win)' },
                    { label: 'Simulações de cadastrados', value: simStats.sims_registered, color: 'var(--text-1)' },
                    { label: 'Simulações anônimas', value: simStats.sims_anon, color: '#f59e0b' },
                  ].map(m => (
                    <div key={m.label} style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 20, fontWeight: 900, color: m.color, lineHeight: 1.2 }}>
                        {(m.value ?? 0).toLocaleString('pt-BR')}
                      </div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>{m.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{
                  padding: 'var(--s3)', background: 'var(--bg-overlay)', borderRadius: 8,
                  border: '1px solid var(--border)', marginBottom: 'var(--s4)',
                }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Novos visitantes ({simStats.new_visitors.toLocaleString('pt-BR')})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px,1fr))', gap: 'var(--s3)' }}>
                    {[
                      { label: 'Geraram simulação', value: simStats.new_visitors_simulated, total: simStats.new_visitors, color: 'var(--win)' },
                      { label: 'Se cadastraram', value: simStats.new_visitors_registered, total: simStats.new_visitors, color: 'var(--accent)' },
                    ].map(m => (
                      <div key={m.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-data)', fontSize: 18, fontWeight: 900, color: m.color, lineHeight: 1.2 }}>
                          {(m.value ?? 0).toLocaleString('pt-BR')}
                          <span style={{ fontSize: 12, color: 'var(--text-4)', fontWeight: 700 }}>
                            {' '}({simStats.new_visitors ? Math.round((m.value / simStats.new_visitors) * 100) : 0}%)
                          </span>
                        </div>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 'var(--s4)', marginBottom: 'var(--s4)' }}>
                  {/* Por dispositivo */}
                  <div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Simulações por dispositivo
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {simStats.by_device.length === 0 && (
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Sem dados.</div>
                      )}
                      {simStats.by_device.map(d => {
                        const maxV = simStats.by_device[0]?.sims || 1
                        const barW = Math.max(4, Math.round(d.sims / maxV * 100))
                        return (
                          <div key={d.device} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', width: 80, flexShrink: 0, textTransform: 'capitalize' }}>{d.device}</span>
                            <div style={{ flex: 1, background: 'var(--bg-overlay)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                              <div style={{ width: `${barW}%`, height: '100%', borderRadius: 4, background: 'var(--accent)' }} />
                            </div>
                            <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-1)', fontWeight: 700, width: 30, textAlign: 'right' }}>{d.sims}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Tempo até 1ª simulação */}
                  <div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Tempo até 1ª simulação
                    </div>
                    {simStats.time_to_first_sim.median_secs == null ? (
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Sem dados suficientes.</div>
                    ) : (
                      <div style={{ display: 'flex', gap: 'var(--s4)' }}>
                        <div>
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: 22, fontWeight: 900, color: 'var(--accent)' }}>
                            {simStats.time_to_first_sim.median_secs < 60
                              ? `${simStats.time_to_first_sim.median_secs}s`
                              : `${Math.round(simStats.time_to_first_sim.median_secs / 60)}min`}
                          </div>
                          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>mediana</div>
                        </div>
                        <div>
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: 22, fontWeight: 900, color: 'var(--text-2)' }}>
                            {simStats.time_to_first_sim.avg_secs < 60
                              ? `${simStats.time_to_first_sim.avg_secs}s`
                              : `${Math.round(simStats.time_to_first_sim.avg_secs / 60)}min`}
                          </div>
                          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>média</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Partidas mais simuladas */}
                <div style={{ marginBottom: 'var(--s4)' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Partidas mais simuladas
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {simStats.top_matches.length === 0 && (
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Sem dados no período.</div>
                    )}
                    {simStats.top_matches.map(m => {
                      const maxV = simStats.top_matches[0]?.sims || 1
                      const barW = Math.max(4, Math.round(m.sims / maxV * 100))
                      return (
                        <div key={m.match_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', width: 100, flexShrink: 0 }}>{m.label}</span>
                          <div style={{ flex: 1, background: 'var(--bg-overlay)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                            <div style={{ width: `${barW}%`, height: '100%', borderRadius: 4, background: 'var(--win)' }} />
                          </div>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-1)', fontWeight: 700, width: 30, textAlign: 'right' }}>{m.sims}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Onde os novos visitantes que NÃO simularam pararam
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {simStats.drop_off_pages.length === 0 && (
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Sem dados no período.</div>
                  )}
                  {simStats.drop_off_pages.map(p => {
                    const maxV = simStats.drop_off_pages[0]?.uniq || 1
                    const barW = Math.max(4, Math.round(p.uniq / maxV * 100))
                    return (
                      <div key={p.path} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', width: 180, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.path}
                        </span>
                        <div style={{ flex: 1, background: 'var(--bg-overlay)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                          <div style={{ width: `${barW}%`, height: '100%', borderRadius: 4, background: 'var(--lose)' }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-1)', fontWeight: 700, width: 30, textAlign: 'right' }}>
                          {p.uniq}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Simulação vale a pena? conversão + retenção comparada ── */}
          {simImpactLoading || !simImpact ? (
            <Spinner text="Calculando impacto das simulações..." />
          ) : (
            <div className="card" style={{ marginTop: 'var(--s4)' }}>
              <div className="card__header">
                <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>
                  💡 Simulação vale a pena? — últimos {simImpact.days} dias
                </span>
              </div>
              <div className="card__body">
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--s5)', flexWrap: 'wrap',
                  padding: 'var(--s4)', background: 'var(--bg-overlay)', borderRadius: 8,
                  border: '1px solid var(--border)', marginBottom: 'var(--s4)',
                }}>
                  <div style={{ textAlign: 'center', minWidth: 100 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 900, color: 'var(--win)', lineHeight: 1 }}>
                      {simImpact.conversion.pct}%
                    </div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', marginTop: 3 }}>
                      simulou → apostou na mesma partida
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', flex: 1, minWidth: 200 }}>
                    {simImpact.conversion.converted_pairs.toLocaleString('pt-BR')} de {simImpact.conversion.total_pairs.toLocaleString('pt-BR')} pares usuário×partida simulados viraram aposta na mesma partida.
                  </div>
                </div>

                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Retenção WoW: quem simulou vs quem nunca simulou ({simImpact.weeks} semanas)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px,1fr))', gap: 'var(--s4)' }}>
                  {[
                    { label: 'Já simulou alguma vez', data: simImpact.retention_simulated, color: 'var(--win)' },
                    { label: 'Nunca simulou', data: simImpact.retention_never_simulated, color: 'var(--lose)' },
                  ].map(g => (
                    <div key={g.label} style={{ padding: 'var(--s3)', background: 'var(--bg-overlay)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)', fontWeight: 700, marginBottom: 6 }}>{g.label}</div>
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 26, fontWeight: 900, color: g.color, lineHeight: 1 }}>
                        {g.data.avg_wow != null ? `${g.data.avg_wow}%` : '—'}
                      </div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>
                        média retenção WoW · {g.data.weeks.at(-1)?.active ?? 0} ativos na última semana
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(retentionLoading || cohortLoading) && !retention && <Spinner text="Calculando retenção..." />}
          {retention && (() => {
            const s = retention.summary
            const wkLabel = w => new Date(w + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

            // Health classification
            const wow = s.latest_wow
            const health = wow == null ? null : wow >= 50 ? 'great' : wow >= 30 ? 'ok' : 'bad'
            const healthCfg = {
              great: { color: '#22c55e', bg: 'rgba(34,197,94,.12)', label: 'SAUDÁVEL',  icon: '✅' },
              ok:    { color: '#f59e0b', bg: 'rgba(245,158,11,.12)', label: 'ATENÇÃO',   icon: '⚠️' },
              bad:   { color: '#ef4444', bg: 'rgba(239,68,68,.12)',  label: 'CRÍTICO',   icon: '🚨' },
            }
            const hc = health ? healthCfg[health] : { color: 'var(--text-3)', bg: 'var(--bg-overlay)', label: 'SEM DADOS', icon: '—' }

            // Average WoW across all weeks with data
            const wowWeeks = retention.weeks.filter(w => w.wow_retention != null)
            const avgWow = wowWeeks.length ? Math.round(wowWeeks.reduce((a, w) => a + w.wow_retention, 0) / wowWeeks.length) : null

            const delta = s.latest_wow != null && s.prev_wow != null ? (s.latest_wow - s.prev_wow).toFixed(1) : null

            // Chart data
            const areaData = retention.weeks.map(w => ({ label: wkLabel(w.week_start), Novos: w.new, Retornantes: w.returning }))
            const barData  = retention.weeks.filter(w => w.wow_retention != null).map(w => ({ label: wkLabel(w.week_start), ret: w.wow_retention }))

            return (
              <>
                {/* ── Banner de saúde ─────────────────────────────────── */}
                <div style={{ marginTop: 'var(--s4)', borderRadius: 'var(--radius)', background: hc.bg, border: `1px solid ${hc.color}33`, padding: 'var(--s5) var(--s6)', display: 'flex', alignItems: 'center', gap: 'var(--s6)', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: hc.color }}>{hc.icon} {hc.label}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 42, fontWeight: 900, lineHeight: 1, color: hc.color }}>{wow != null ? `${wow}%` : '—'}</span>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>retenção WoW esta semana</span>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.3 }}>
                      {wow != null
                        ? `${Math.round((s.latest_returning / (s.latest_active || 1)) * 10)} em cada 10 usuários ativos já apostaram antes`
                        : 'Dados insuficientes para calcular retenção'}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap' }}>
                      {delta != null && (
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: parseFloat(delta) >= 0 ? '#22c55e' : '#ef4444' }}>
                          {parseFloat(delta) >= 0 ? '▲' : '▼'} {Math.abs(delta)}pp vs semana anterior
                        </span>
                      )}
                      {avgWow != null && (
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                          Média histórica: {avgWow}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s3)', minWidth: 240 }}>
                    {[
                      { label: 'Ativos',      value: s.latest_active,    color: 'var(--text-1)' },
                      { label: 'Novos',        value: s.latest_new,       color: '#22c55e' },
                      { label: 'Retornantes',  value: s.latest_returning, color: '#3b82f6' },
                    ].map(k => (
                      <div key={k.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>{k.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Evolução: Novos vs Retornantes ──────────────────── */}
                <div className="card" style={{ marginTop: 'var(--s4)' }}>
                  <div className="card__header">
                    <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>📈 Crescimento — Novos vs Retornantes</span>
                    <div style={{ display: 'flex', gap: 'var(--s4)', alignItems: 'center' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: '#3b82f6' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#3b82f6', display: 'inline-block' }} /> Retornantes</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: '#22c55e' }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#22c55e', display: 'inline-block' }} /> Novos</span>
                    </div>
                  </div>
                  <div className="card__body">
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={areaData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gRet" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.55} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                          </linearGradient>
                          <linearGradient id="gNew" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.55} />
                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0.1} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-data)' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-data)' }} allowDecimals={false} />
                        <Tooltip contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                        <Area type="monotone" dataKey="Retornantes" stackId="1" stroke="#3b82f6" strokeWidth={2} fill="url(#gRet)" />
                        <Area type="monotone" dataKey="Novos"       stackId="1" stroke="#22c55e" strokeWidth={2} fill="url(#gNew)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* ── Retenção WoW por semana ──────────────────────────── */}
                {barData.length > 0 && (
                <div className="card" style={{ marginTop: 'var(--s4)' }}>
                  <div className="card__header">
                    <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🔁 Taxa de Retenção Semana a Semana</span>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>% de usuários da semana anterior que voltaram</span>
                  </div>
                  <div className="card__body">
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={barData} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-data)' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-data)' }} unit="%" domain={[0, 100]} />
                        <Tooltip contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={v => [`${v}%`, 'Retenção WoW']} />
                        <ReferenceLine y={50} stroke="#22c55e" strokeDasharray="4 2" label={{ value: '50% meta', position: 'insideTopRight', fontSize: 9, fill: '#22c55e' }} />
                        <ReferenceLine y={30} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: '30% limite', position: 'insideTopRight', fontSize: 9, fill: '#f59e0b' }} />
                        <Bar dataKey="ret" radius={[4, 4, 0, 0]} maxBarSize={48}>
                          {barData.map((d, i) => (
                            <Cell key={i} fill={d.ret >= 50 ? '#22c55e' : d.ret >= 30 ? '#f59e0b' : '#ef4444'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                )}

                {/* ── Cohort heatmap ───────────────────────────────────── */}
                <div className="card" style={{ marginTop: 'var(--s4)' }}>
                  <div className="card__header">
                    <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🧱 Análise de Coorte</span>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>% do coorte que voltou após N semanas</span>
                  </div>
                  <div className="card__body">
                    {cohortLoading && <Spinner text="Calculando coortes..." />}
                    {!cohortLoading && cohort && cohort.cohorts.length > 0 && (() => {
                      const cols = Array.from({ length: cohort.max_offset + 1 }, (_, i) => i)
                      // smooth HSL gradient: 100%=green, 50%=yellow, 0%=red
                      function cellBg(pct) {
                        if (pct == null) return { bg: 'var(--bg-overlay)', fg: 'var(--text-4)' }
                        const h = Math.round(pct * 1.2)   // 0→0 (red), 100→120 (green)
                        const s = pct > 0 ? 75 : 0
                        const l = pct > 0 ? 38 : 20
                        const alpha = pct > 0 ? 0.25 + pct * 0.006 : 0.08
                        return { bg: `hsla(${h},${s}%,${l}%,${alpha + 0.35})`, fg: pct >= 40 ? '#fff' : 'var(--text-1)' }
                      }
                      return (
                        <>
                          <div style={{ overflowX: 'auto', marginBottom: 'var(--s3)' }}>
                            <table style={{ borderCollapse: 'separate', borderSpacing: 3, fontSize: 11, fontFamily: 'var(--font-data)', whiteSpace: 'nowrap' }}>
                              <thead>
                                <tr>
                                  <th style={{ padding: '4px 10px', textAlign: 'left', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, minWidth: 64 }}>Coorte</th>
                                  <th style={{ padding: '4px 8px', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, minWidth: 44 }}>n</th>
                                  {cols.map(c => (
                                    <th key={c} style={{ padding: '4px 8px', textAlign: 'center', color: c === 0 ? 'var(--accent)' : 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, minWidth: 52 }}>
                                      {c === 0 ? 'Sem 0' : `+${c}s`}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {cohort.cohorts.map(row => {
                                  const byOffset = Object.fromEntries(row.weeks.map(w => [w.offset, w]))
                                  const label = new Date(row.cohort_week + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                                  return (
                                    <tr key={row.cohort_week}>
                                      <td style={{ padding: '5px 10px', color: 'var(--text-2)', fontWeight: 600, fontFamily: 'var(--font-cond)' }}>{label}</td>
                                      <td style={{ padding: '5px 8px', textAlign: 'center', color: 'var(--text-3)' }}>{row.size}</td>
                                      {cols.map(c => {
                                        const cell = byOffset[c]
                                        const { bg, fg } = cellBg(cell?.pct ?? null)
                                        return (
                                          <td key={c}
                                            title={cell ? `${cell.active} usuários · ${cell.pct}%` : '—'}
                                            style={{ padding: '5px 8px', textAlign: 'center', borderRadius: 6, background: bg, color: fg, fontWeight: c === 0 ? 700 : 500, minWidth: 52 }}>
                                            {cell ? `${cell.pct}%` : ''}
                                          </td>
                                        )
                                      })}
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                          {/* Gradient legend */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s2)' }}>
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>0%</span>
                            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'linear-gradient(to right, hsla(0,75%,38%,.7), hsla(60,75%,38%,.7), hsla(120,75%,38%,.7))' }} />
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>100%</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>
                            <span>Crítico</span><span>Atenção</span><span>Saudável</span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Audit tab */}
      {tab === 'audit' && (
        <div className="card fade-in-1" style={{ marginTop: 'var(--s4)' }}>
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🔐 Logs de Auditoria</span>
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
              {auditLogs && <span className="badge badge-group">{auditLogs.total} total</span>}
              <button className="btn btn-ghost btn-sm" onClick={() => loadAudit(auditFilter)} disabled={auditLoading}>
                {auditLoading ? '⏳' : '↻'}
              </button>
            </div>
          </div>
          <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
            <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
              {[
                { v: '',        l: 'Todos' },
                { v: 'login',   l: 'Logins' },
                { v: 'profile', l: 'Perfil' },
                { v: 'group',   l: 'Grupos' },
              ].map(({ v, l }) => (
                <button
                  key={v || 'all'}
                  className={`btn btn-sm ${auditFilter === v ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => { setAuditFilter(v); loadAudit(v) }}
                >
                  {l}
                </button>
              ))}
            </div>
            {auditLoading && <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)' }}>Carregando...</p>}
            {!auditLoading && auditLogs?.logs?.length === 0 && (
              <p style={{ color: 'var(--text-3)', fontSize: 13, fontFamily: 'var(--font-cond)' }}>Nenhum log ainda.</p>
            )}
            {!auditLoading && auditLogs?.logs?.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-data)' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Quando', 'Usuário', 'Ação', 'Detalhes', 'IP'].map(h => (
                        <th key={h} style={{ padding: 'var(--s2) var(--s3)', textAlign: 'left', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.logs.map(log => (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                          {log.created_at ? new Date(log.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
                          <div>{log.user_name || '—'}</div>
                          {log.user_email && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{log.user_email}</div>}
                        </td>
                        <td style={{ padding: 'var(--s2) var(--s3)', whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12 }}>
                            {ACTION_LABEL[log.action] || log.action}
                          </span>
                        </td>
                        <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-2)', maxWidth: 260 }}>
                          {log.details ? (
                            <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                              {Object.entries(log.details).map(([k, v]) =>
                                `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`
                              ).join(' · ')}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{log.ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent tab */}
      {tab === 'recent' && (
        <div className="card fade-in-1" style={{ marginTop: 'var(--s4)' }}>
          <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🕐 Últimas Visitas</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-data)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Hora', 'Página', 'IP', 'País', 'Cidade', 'Dispositivo', 'Navegador', 'OS', 'Referrer'].map(h => (
                    <th key={h} style={{ padding: 'var(--s2) var(--s3)', textAlign: 'left', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', transition: 'background 100ms' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-overlay)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.created_at ? new Date(r.created_at).toLocaleString('pt-BR', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-1)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.path || '/'}</td>
                    <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{r.ip || '—'}</td>
                    <td style={{ padding: 'var(--s2) var(--s3)', whiteSpace: 'nowrap' }}>
                      {r.country && FLAG(r.country) && <img src={FLAG(r.country)} alt={r.country} style={{ width: 16, height: 11, marginRight: 4, borderRadius: 1, verticalAlign: 'middle' }} />}
                      <span style={{ color: 'var(--text-2)' }}>{r.country_name || r.country || '—'}</span>
                    </td>
                    <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-3)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.city || '—'}</td>
                    <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-2)', textTransform: 'capitalize' }}>{DEVICE_ICON[r.device]} {r.device || '—'}</td>
                    <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-2)' }}>{r.browser || '—'}</td>
                    <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-2)' }}>{r.os || '—'}</td>
                    <td style={{ padding: 'var(--s2) var(--s3)', color: 'var(--text-3)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.referrer || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
