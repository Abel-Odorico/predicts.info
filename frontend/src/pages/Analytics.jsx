import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

const DEVICE_ICON = { mobile: '📱', tablet: '📟', desktop: '🖥️' }
const BROWSER_ICON = { Chrome: '🟡', Firefox: '🦊', Safari: '🧭', Edge: '🔵', Opera: '🔴', Bot: '🤖', Other: '⚪' }
const OS_ICON = { Windows: '🪟', Android: '🤖', iOS: '🍎', macOS: '🍎', Linux: '🐧', Other: '⚪' }
const PERIODS = [
  { value: 1, label: 'Hoje', short: '1d' },
  { value: 7, label: '7 dias', short: '7d' },
  { value: 14, label: '14 dias', short: '14d' },
  { value: 30, label: '30 dias', short: '30d' },
  { value: 90, label: '90 dias', short: '90d' },
  { value: 365, label: '1 ano', short: '1a' },
]

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

function StatCard({ label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: 'var(--s5)' }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 'var(--s2)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 900, color: color || 'var(--accent)', lineHeight: 1 }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', marginTop: 'var(--s2)' }}>{sub}</div>}
    </div>
  )
}

function DayChart({ data }) {
  if (!data || data.length === 0) return <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>Sem dados</div>
  const max = Math.max(...data.map(d => d.views), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, padding: '0 var(--s2)' }}>
      {data.map(d => {
        const pct = (d.views / max) * 100
        return (
          <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <div title={`${d.date}: ${d.views}`} style={{
              width: '100%', height: `${Math.max(pct, 4)}%`,
              background: `color-mix(in srgb, var(--accent) ${40 + Math.round(pct * 0.6)}%, transparent)`,
              borderRadius: '3px 3px 0 0', cursor: 'default',
              border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
            }} />
            <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--font-data)', transform: 'rotate(-45deg)', transformOrigin: 'center', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 28 }}>
              {d.date.slice(5)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const FLAG = code => code ? `https://flagcdn.com/16x12/${code.toLowerCase()}.png` : null

const ACTION_LABEL = {
  'profile.update':          '✏️ Perfil editado',
  'profile.password_change': '🔑 Senha alterada',
  'group.rename':            '📝 Grupo renomeado',
  'group.delete':            '🗑 Grupo excluído',
  'group.remove_member':     '👤 Membro removido',
  'group.join':              '➕ Entrou no grupo',
}

export default function Analytics() {
  const { token } = useAuth()
  const [stats, setStats]   = useState(null)
  const [recent, setRecent] = useState([])
  const [days, setDays]     = useState(7)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState('overview')

  const [auditLogs, setAuditLogs]       = useState(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditFilter, setAuditFilter]   = useState('')

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
    { id: 'pages',     label: '📄 Páginas' },
    { id: 'geo',       label: '🌍 Localidade' },
    { id: 'tech',      label: '💻 Tecnologia' },
    { id: 'recent',    label: '🕐 Recentes' },
    { id: 'audit',     label: '🔐 Auditoria' },
  ]

  return (
    <div className="page">
      <div className="fade-in-1">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s3)' }}>
          <div>
            <h1 className="page-title">ANALYTICS</h1>
            <p className="page-subtitle">Tráfego · Dispositivos · Localidade · Navegadores · Período: {selectedPeriod.label}</p>
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
      </div>

      <div className="card fade-in-2" style={{ marginTop: 'var(--s4)' }}>
        <div className="card__body" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
          <div className="stack gap-3">
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
              Filtros por Período
            </div>
            <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
              {PERIODS.map(period => (
                <button
                  key={`period-card-${period.value}`}
                  onClick={() => setDays(period.value)}
                  className={`btn btn-ghost btn-sm${days === period.value ? ' btn-ghost--active' : ''}`}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="fade-in-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--s4)', marginTop: 'var(--s6)' }}>
        <StatCard label="Page Views"    value={stats.total_views}  color="var(--accent)" />
        <StatCard label="IPs únicos"    value={stats.unique_ips}   color="var(--win)" />
        <StatCard label="Páginas únicas" value={stats.unique_pages} color="#f59e0b" />
        <StatCard label="Período"       value={selectedPeriod.short} color="var(--text-2)" sub={selectedPeriod.label} />
      </div>

      {/* Day chart */}
      <div className="card fade-in-2" style={{ marginTop: 'var(--s4)' }}>
        <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>📈 Views por Dia</span></div>
        <div className="card__body"><DayChart data={stats.views_per_day} /></div>
      </div>

      {/* Tabs */}
      <div className="phase-nav fade-in-3" style={{ marginTop: 'var(--s6)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`phase-nav__btn${tab === t.id ? ' phase-nav__btn--active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s4)', marginTop: 'var(--s4)' }} className="fade-in-1">
          {/* Top pages mini */}
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

          {/* Devices */}
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

          {/* Browsers */}
          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🌐 Navegadores</span></div>
            <div className="card__body">
              <div className="stack gap-3">
                {stats.browsers.map(b => (
                  <div key={b.browser} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>{BROWSER_ICON[b.browser] || '⚪'} {b.browser}</span>
                    <MiniBar value={b.views} max={maxBrowser} color="#f59e0b" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top countries mini */}
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

      {/* Pages tab */}
      {tab === 'pages' && (
        <div className="card fade-in-1" style={{ marginTop: 'var(--s4)' }}>
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
      )}

      {/* Geo tab */}
      {tab === 'geo' && (
        <div className="card fade-in-1" style={{ marginTop: 'var(--s4)' }}>
          <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🌍 Países</span></div>
          <div className="card__body">
            {stats.top_countries.length === 0
              ? <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Nenhum dado de localidade ainda. O geo-lookup popula com novos acessos.</p>
              : (
                <div className="stack gap-4">
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
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🌐 Navegadores</span></div>
            <div className="card__body">
              <div className="stack gap-4">
                {stats.browsers.map(b => (
                  <div key={b.browser} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 120px', alignItems: 'center', gap: 'var(--s3)' }}>
                    <span style={{ fontSize: 18 }}>{BROWSER_ICON[b.browser] || '⚪'}</span>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)' }}>{b.browser}</span>
                    <MiniBar value={b.views} max={maxBrowser} color="#f59e0b" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header"><span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🖥️ Sistema Operacional</span></div>
            <div className="card__body">
              <div className="stack gap-4">
                {stats.os.map(o => (
                  <div key={o.os} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 120px', alignItems: 'center', gap: 'var(--s3)' }}>
                    <span style={{ fontSize: 18 }}>{OS_ICON[o.os] || '⚪'}</span>
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)' }}>{o.os}</span>
                    <MiniBar value={o.views} max={stats.os[0].views} color="var(--win)" />
                  </div>
                ))}
              </div>
            </div>
          </div>
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
              {['', 'profile', 'group'].map(f => (
                <button
                  key={f || 'all'}
                  className={`btn btn-sm ${auditFilter === f ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => { setAuditFilter(f); loadAudit(f) }}
                >
                  {f === '' ? 'Todos' : f === 'profile' ? 'Perfil' : 'Grupos'}
                </button>
              ))}
            </div>
            {auditLoading && <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)' }}>Carregando...</p>}
            {!auditLoading && auditLogs?.logs?.length === 0 && (
              <p style={{ color: 'var(--text-3)', fontSize: 13, fontFamily: 'var(--font-cond)' }}>
                Nenhum log ainda — ações de usuários aparecerão aqui.
              </p>
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
                      <span style={{ color: 'var(--text-2)' }}>{r.country || '—'}</span>
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
