import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

function normalizeDate(value) {
  if (!value) return null
  const hasTz = value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)
  return hasTz ? value : `${value}Z`
}

function fmt(value) {
  if (!value) return '—'
  return new Date(normalizeDate(value)).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtShort(value) {
  if (!value) return '—'
  return new Date(normalizeDate(value)).toLocaleString('pt-BR', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatCountdown(value, nowMs) {
  if (!value) return '—'
  const diff = new Date(normalizeDate(value)).getTime() - nowMs
  if (diff <= 0) return 'Executando agora'
  const totalSeconds = Math.floor(diff / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const TABS = [
  { id: 'growth',   label: 'Crescimento',  icon: '📈' },
  { id: 'users',    label: 'Usuários',     icon: '👥' },
  { id: 'results',  label: 'Resultados',   icon: '⚽' },
  { id: 'sync',     label: 'Sincronização', icon: '🔄' },
  { id: 'bets',     label: 'Apostas',      icon: '🎯' },
  { id: 'coverage', label: 'Cobertura',    icon: '📋' },
]

const PERIODS = [
  { id: 'day',      label: 'Dia' },
  { id: 'week',     label: 'Semana' },
  { id: 'month',    label: 'Mês' },
  { id: 'quarter',  label: 'Trimestre' },
  { id: 'semester', label: 'Semestre' },
  { id: 'year',     label: 'Ano' },
]

export default function Admin() {
  const { user, token } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('growth')
  const [nowMs, setNowMs] = useState(Date.now())

  // Users
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [userQuery, setUserQuery] = useState('')
  const [userMsg, setUserMsg] = useState('')
  const [savingUserId, setSavingUserId] = useState(null)

  // Results
  const [matches, setMatches] = useState([])
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [score, setScore] = useState({ a: '', b: '', xg_a: '', xg_b: '' })
  const [resultMsg, setResultMsg] = useState('')
  const [cacheMsg, setCacheMsg] = useState('')

  // Sync
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncPolling, setSyncPolling] = useState(false)

  // Bets
  const [allBets, setAllBets] = useState(null)
  const [betsLoading, setBetsLoading] = useState(false)

  // Coverage
  const [betCoverage, setBetCoverage] = useState(null)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [coverageStatus, setCoverageStatus] = useState('scheduled')

  // Growth
  const [growth, setGrowth] = useState(null)
  const [growthLoading, setGrowthLoading] = useState(false)
  const [growthPeriod, setGrowthPeriod] = useState('month')
  const [hiddenSeries, setHiddenSeries] = useState({})

  function toggleSeries(key) {
    setHiddenSeries(prev => ({ ...prev, [key]: !prev[key] }))
  }

  useEffect(() => {
    if (!user || user.role !== 'admin') { navigate('/'); return }
    loadUsers()
    loadSyncStatus()
  }, [user, token])

  // Tab-driven lazy loading
  useEffect(() => {
    if (tab === 'growth')   loadGrowth(growthPeriod)
    if (tab === 'results' && matches.length === 0 && !matchesLoading) loadMatches()
    if (tab === 'bets' && !allBets && !betsLoading) loadBets()
    if (tab === 'coverage' && !betCoverage && !coverageLoading) loadCoverage('scheduled')
  }, [tab])

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (!token || !user || user.role !== 'admin') return
    const iv = setInterval(loadSyncStatus, 30000)
    return () => clearInterval(iv)
  }, [token, user])

  async function loadSyncStatus() {
    try { setSyncStatus(await api.get('/admin/sync-status', token)) } catch {}
  }

  async function loadGrowth(period = growthPeriod) {
    setGrowthLoading(true)
    try {
      const data = await api.get(`/admin/stats/growth?period=${period}`, token)
      setGrowth(data)
      setGrowthPeriod(period)
    } catch {}
    finally { setGrowthLoading(false) }
  }

  async function loadUsers(query = userQuery) {
    setUsersLoading(true)
    try {
      const suffix = query?.trim() ? `?q=${encodeURIComponent(query.trim())}&limit=100` : '?limit=100'
      setUsers(await api.get(`/admin/users${suffix}`, token))
    } catch { setUsers([]) }
    finally { setUsersLoading(false) }
  }

  async function loadMatches() {
    setMatchesLoading(true)
    try { setMatches(await api.get('/matches?status=scheduled&limit=100')) }
    catch { setMatches([]) }
    finally { setMatchesLoading(false) }
  }

  async function loadBets() {
    setBetsLoading(true)
    try { setAllBets(await api.get('/admin/bets/all?limit=50', token)) }
    catch {}
    finally { setBetsLoading(false) }
  }

  async function loadCoverage(status = coverageStatus) {
    setCoverageLoading(true)
    try {
      setBetCoverage(await api.get(`/admin/bets/coverage?status=${status}&limit=50`, token))
      setCoverageStatus(status)
    } catch {}
    finally { setCoverageLoading(false) }
  }

  async function submitResult(e) {
    e.preventDefault()
    setResultMsg('')
    const sa = parseInt(score.a), sb = parseInt(score.b)
    if (isNaN(sa) || isNaN(sb)) { setResultMsg('Preencha o placar'); return }
    try {
      const res = await api.post('/admin/results', {
        match_id: selected.id, score_a: sa, score_b: sb,
        xg_a: score.xg_a ? parseFloat(score.xg_a) : null,
        xg_b: score.xg_b ? parseFloat(score.xg_b) : null,
      }, token)
      const eloLines = Object.entries(res.elo_update)
        .map(([code, e]) => `${code} ${e.before.toFixed(0)}→${e.after.toFixed(0)} (${e.delta > 0 ? '+' : ''}${e.delta})`)
        .join(' · ')
      setResultMsg(`✓ ${res.result} — ${res.outcome.toUpperCase()} · Elo: ${eloLines}`)
      setSelected(null)
      setScore({ a: '', b: '', xg_a: '', xg_b: '' })
      setMatches(m => m.filter(x => x.id !== selected.id))
    } catch (e) { setResultMsg(`✗ ${e.message}`) }
  }

  async function updateUserRole(userId, role) {
    setUserMsg('')
    setSavingUserId(userId)
    try {
      const res = await api.patch(`/admin/users/${userId}`, { role }, token)
      setUsers(list => list.map(item => item.id === userId ? { ...item, role: res.role } : item))
      setUserMsg(`✓ ${res.email} → ${res.role}`)
    } catch (e) { setUserMsg(`✗ ${e.message}`) }
    finally { setSavingUserId(null) }
  }

  async function startSync() {
    setSyncStatus({ running: true, log: [], updated: 0, errors: [] })
    setSyncPolling(true)
    try { await api.post('/admin/sync-elo', {}, token) }
    catch (e) { setSyncStatus(s => ({ ...s, running: false, error: e.message })); setSyncPolling(false); return }
    const iv = setInterval(async () => {
      try {
        const st = await api.get('/admin/sync-status', token)
        setSyncStatus(st)
        if (!st?.running) { clearInterval(iv); setSyncPolling(false) }
      } catch { clearInterval(iv); setSyncPolling(false) }
    }, 2000)
  }

  async function clearCache() {
    setCacheMsg('')
    try {
      const res = await api.post('/admin/recalculate', {}, token)
      setCacheMsg(`✓ ${res.keys_removed} chaves removidas`)
    } catch (e) { setCacheMsg(`✗ ${e.message}`) }
  }

  if (!user) return null
  if (user.role !== 'admin') return (
    <div className="page" style={{ textAlign: 'center', padding: 'var(--s16)' }}>
      <p style={{ color: 'var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 18 }}>Acesso negado</p>
    </div>
  )

  const scheduler = syncStatus?.scheduler
  const adminCount = users.filter(u => u.role === 'admin').length
  const noBetsCount = users.filter(u => !u.bets_count).length
  const totalPoints = users.reduce((s, u) => s + (u.bets_points || 0), 0)
  const withPhone = users.filter(u => u.phone).length

  return (
    <div className="adm-shell">

      {/* ── Header ────────────────────────────────────── */}
      <div className="adm-header">
        <div className="adm-header__left">
          <div className="adm-header__title">ADMIN</div>
          <div className="adm-header__sub">predicts.info · painel de controle</div>
        </div>
        <div className="adm-header__actions">
          <a href="/admin/analytics" className="btn btn-ghost btn-sm">📊 Analytics</a>
          <a href="/admin/options"   className="btn btn-ghost btn-sm">⚙️ Config</a>
        </div>
      </div>

      {/* ── KPI strip ─────────────────────────────────── */}
      <div className="adm-kpi-strip">
        <div className="adm-kpi">
          <div className="adm-kpi__val">{users.length}</div>
          <div className="adm-kpi__label">Usuários</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi__val" style={{ color: 'var(--accent)' }}>{adminCount}</div>
          <div className="adm-kpi__label">Admins</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi__val" style={{ color: 'var(--win)' }}>{withPhone}</div>
          <div className="adm-kpi__label">Com WhatsApp</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi__val" style={{ color: 'var(--lose)' }}>{noBetsCount}</div>
          <div className="adm-kpi__label">Sem apostas</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi__val">{totalPoints}</div>
          <div className="adm-kpi__label">Pontos somados</div>
        </div>
        <div className="adm-kpi">
          <div className="adm-kpi__val" style={{ color: syncStatus?.running ? 'var(--win)' : 'var(--text-3)' }}>
            {syncStatus?.running ? 'SYNC' : syncStatus?.finished_at ? 'OK' : '—'}
          </div>
          <div className="adm-kpi__label">Auto-sync</div>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────── */}
      <div className="adm-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`adm-tab${tab === t.id ? ' adm-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="adm-tab__icon">{t.icon}</span>
            <span className="adm-tab__label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── Tab: Crescimento ──────────────────────────── */}
      {tab === 'growth' && (
        <div className="adm-pane fade-in-1">

          {/* Period filter */}
          <div className="adm-period-bar">
            {PERIODS.map(p => (
              <button
                key={p.id}
                className={`btn btn-sm ${growthPeriod === p.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => loadGrowth(p.id)}
                disabled={growthLoading}
              >{p.label}</button>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={() => loadGrowth(growthPeriod)} disabled={growthLoading}>↻</button>
          </div>

          {growthLoading && (
            <div style={{ padding: 'var(--s8)', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>Carregando...</div>
          )}

          {!growthLoading && growth && (
            <>
              {/* ── KPI Cards ─────────────────────────── */}
              <div className="adm-growth-cards">
                {[
                  { label: 'Total Usuários',    val: growth.summary.total_users,        color: 'var(--text-1)' },
                  { label: 'Novos Hoje',        val: growth.summary.new_today,           color: 'var(--win)' },
                  { label: 'Novos na Semana',   val: growth.summary.new_week,            color: 'var(--win)' },
                  { label: 'Novos no Mês',      val: growth.summary.new_month,           color: 'var(--accent)' },
                  { label: 'Total Apostas',     val: growth.summary.total_bets,          color: 'var(--text-1)' },
                  { label: 'Apostas Hoje',      val: growth.summary.bets_today,          color: 'var(--win)' },
                  { label: 'Apostadores Únicos',val: growth.summary.unique_bettors,      color: 'var(--accent)' },
                  { label: 'Média Apostas/User',val: growth.summary.avg_bets_per_user,   color: 'var(--text-2)' },
                ].map(card => (
                  <div key={card.label} className="adm-growth-card">
                    <div className="adm-growth-card__val" style={{ color: card.color }}>{card.val}</div>
                    <div className="adm-growth-card__label">{card.label}</div>
                  </div>
                ))}
                {growth.summary.most_active_user && (
                  <div className="adm-growth-card adm-growth-card--wide">
                    <div className="adm-growth-card__val" style={{ color: 'var(--accent)', fontSize: 16 }}>
                      {growth.summary.most_active_user}
                    </div>
                    <div className="adm-growth-card__label">Usuário Mais Ativo · {growth.summary.most_active_bets} apostas</div>
                  </div>
                )}
                {growth.summary.most_bet_match && (
                  <div className="adm-growth-card adm-growth-card--wide">
                    <div className="adm-growth-card__val" style={{ color: 'var(--accent)', fontSize: 16 }}>
                      {growth.summary.most_bet_match}
                    </div>
                    <div className="adm-growth-card__label">Jogo Mais Apostado · {growth.summary.most_bet_match_cnt} apostas</div>
                  </div>
                )}
              </div>

              {/* ── Chart: Usuários ───────────────────── */}
              <div className="adm-card">
                <div className="adm-card__head">
                  <span className="adm-card__title">Novos Usuários × Usuários Acumulados</span>
                  <span className="adm-card__meta">{PERIODS.find(p => p.id === growthPeriod)?.label}</span>
                </div>
                {growth.users_series.length === 0 ? (
                  <div className="adm-table__empty">Nenhum dado para este período.</div>
                ) : (
                  <div style={{ padding: 'var(--s4) var(--s2)' }}>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={growth.users_series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(41,75,107,0.15)" />
                        <XAxis dataKey="label" tick={{ fontFamily: 'var(--font-data)', fontSize: 11, fill: 'var(--text-3)' }} />
                        <YAxis yAxisId="left"  tick={{ fontFamily: 'var(--font-data)', fontSize: 11, fill: 'var(--text-3)' }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontFamily: 'var(--font-data)', fontSize: 11, fill: 'var(--text-3)' }} />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font-cond)', fontSize: 13 }}
                          labelStyle={{ color: 'var(--text-1)', fontWeight: 700 }}
                        />
                        <Legend
                          onClick={e => toggleSeries(e.dataKey)}
                          wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 13, cursor: 'pointer' }}
                        />
                        <Bar
                          yAxisId="left"
                          dataKey="new"
                          name="Novos usuários"
                          fill="#0f7a78"
                          fillOpacity={hiddenSeries['new'] ? 0 : 0.85}
                          radius={[3,3,0,0]}
                          hide={hiddenSeries['new']}
                        />
                        <Line
                          yAxisId="right"
                          dataKey="cumulative"
                          name="Acumulado"
                          stroke="#e8c44a"
                          strokeWidth={2}
                          dot={false}
                          hide={hiddenSeries['cumulative']}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* ── Chart: Apostas ────────────────────── */}
              <div className="adm-card">
                <div className="adm-card__head">
                  <span className="adm-card__title">Apostas por Período × Apostadores Únicos</span>
                  <span className="adm-card__meta">{PERIODS.find(p => p.id === growthPeriod)?.label}</span>
                </div>
                {growth.bets_series.length === 0 ? (
                  <div className="adm-table__empty">Nenhuma aposta neste período.</div>
                ) : (
                  <div style={{ padding: 'var(--s4) var(--s2)' }}>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={growth.bets_series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(41,75,107,0.15)" />
                        <XAxis dataKey="label" tick={{ fontFamily: 'var(--font-data)', fontSize: 11, fill: 'var(--text-3)' }} />
                        <YAxis yAxisId="left"  tick={{ fontFamily: 'var(--font-data)', fontSize: 11, fill: 'var(--text-3)' }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontFamily: 'var(--font-data)', fontSize: 11, fill: 'var(--text-3)' }} />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font-cond)', fontSize: 13 }}
                          labelStyle={{ color: 'var(--text-1)', fontWeight: 700 }}
                        />
                        <Legend
                          onClick={e => toggleSeries(e.dataKey)}
                          wrapperStyle={{ fontFamily: 'var(--font-cond)', fontSize: 13, cursor: 'pointer' }}
                        />
                        <Bar
                          yAxisId="left"
                          dataKey="bets"
                          name="Apostas"
                          fill="#2ec980"
                          fillOpacity={hiddenSeries['bets'] ? 0 : 0.85}
                          radius={[3,3,0,0]}
                          hide={hiddenSeries['bets']}
                        />
                        <Line
                          yAxisId="right"
                          dataKey="unique_users"
                          name="Apostadores únicos"
                          stroke="#e85252"
                          strokeWidth={2}
                          dot={false}
                          hide={hiddenSeries['unique_users']}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Usuários ─────────────────────────────── */}
      {tab === 'users' && (
        <div className="adm-pane fade-in-1">
          <div className="adm-pane__toolbar">
            <input
              type="text"
              className="form-input"
              placeholder="Nome, e-mail ou @username…"
              value={userQuery}
              onChange={e => setUserQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadUsers()}
            />
            <button className="btn btn-primary" onClick={() => loadUsers()}>Buscar</button>
            <button className="btn btn-ghost" onClick={() => { setUserQuery(''); loadUsers('') }}>↺</button>
          </div>

          {userMsg && (
            <div className="adm-feedback" style={{ color: userMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
              {userMsg}
            </div>
          )}

          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>@Username</th>
                  <th>WhatsApp</th>
                  <th>E-mail</th>
                  <th className="adm-table__num">Apostas</th>
                  <th className="adm-table__num">Pts</th>
                  <th>Cargo</th>
                  <th>Cadastro / Atualização</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {usersLoading && (
                  <tr><td colSpan={9} className="adm-table__empty">Carregando...</td></tr>
                )}
                {!usersLoading && users.length === 0 && (
                  <tr><td colSpan={9} className="adm-table__empty">Nenhum usuário encontrado.</td></tr>
                )}
                {!usersLoading && users.map(u => (
                  <tr key={u.id} className={u.role === 'admin' ? 'adm-table__row--admin' : ''}>
                    <td>
                      <div className="adm-table__name">{u.name}</div>
                      <div className="adm-table__id">ID {u.id}</div>
                    </td>
                    <td>
                      {u.username
                        ? <span className="adm-table__username">@{u.username}</span>
                        : <span className="adm-table__nil">—</span>}
                    </td>
                    <td>
                      {u.phone
                        ? (
                          <a
                            href={`https://wa.me/${u.phone.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="adm-table__wa"
                          >
                            <span className="adm-table__wa-icon">📱</span>
                            {u.phone}
                          </a>
                        )
                        : <span className="adm-table__nil">—</span>}
                    </td>
                    <td className="adm-table__email">{u.email}</td>
                    <td className="adm-table__num">{u.bets_count}</td>
                    <td className="adm-table__num adm-table__pts">{u.bets_points}</td>
                    <td>
                      <span className={`badge ${u.role === 'admin' ? 'badge-live' : 'badge-group'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="adm-table__date">
                      <div>{fmtShort(u.created_at)}</div>
                      {u.updated_at && u.updated_at !== u.created_at && (
                        <div style={{ color: 'var(--accent)', fontSize: 10, marginTop: 2 }}>
                          ↻ {fmtShort(u.updated_at)}
                        </div>
                      )}
                    </td>
                    <td>
                      <button
                        className={`btn btn-sm ${u.role === 'admin' ? 'btn-ghost' : 'btn-primary'}`}
                        disabled={savingUserId === u.id || (u.id === user.id && u.role === 'admin')}
                        onClick={() => updateUserRole(u.id, u.role === 'admin' ? 'user' : 'admin')}
                      >
                        {savingUserId === u.id ? '...' : u.role === 'admin' ? '− Admin' : '+ Admin'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Resultados ───────────────────────────── */}
      {tab === 'results' && (
        <div className="adm-pane adm-pane--two-col fade-in-1">
          {/* Match list */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Partidas Abertas</span>
              {matchesLoading
                ? <span className="adm-card__meta">carregando…</span>
                : <span className="adm-card__meta">{matches.length} jogos</span>
              }
            </div>
            <div className="admin-list">
              {matchesLoading && (
                <p style={{ padding: 'var(--s4)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando...</p>
              )}
              {!matchesLoading && matches.length === 0 && (
                <p style={{ padding: 'var(--s6)', color: 'var(--text-3)', textAlign: 'center', fontFamily: 'var(--font-cond)' }}>
                  Todas as partidas finalizadas
                </p>
              )}
              {matches.map(m => (
                <div
                  key={m.id}
                  onClick={() => { setSelected(m); setScore({ a: '', b: '', xg_a: '', xg_b: '' }); setResultMsg('') }}
                  className={`admin-match-row${selected?.id === m.id ? ' admin-match-row--active' : ''}`}
                >
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', minWidth: 28 }}>
                    G{m.group_name}
                  </span>
                  <span className="admin-match-row__teams">{m.team_a.code} vs {m.team_b.code}</span>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>#{m.id}</span>
                </div>
              ))}
            </div>

            {selected && (
              <form onSubmit={submitResult} className="admin-score-form">
                <div className="admin-score-match">{selected.team_a.code} × {selected.team_b.code}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 'var(--s3)', alignItems: 'center' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{selected.team_a.code}</div>
                    <input type="number" min="0" max="20" className="score-input" value={score.a} onChange={e => setScore(s => ({ ...s, a: e.target.value }))} placeholder="0" autoFocus />
                  </div>
                  <span style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text-3)' }}>×</span>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>{selected.team_b.code}</div>
                    <input type="number" min="0" max="20" className="score-input" value={score.b} onChange={e => setScore(s => ({ ...s, b: e.target.value }))} placeholder="0" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
                  <div className="form-group">
                    <label className="form-label">xG {selected.team_a.code}</label>
                    <input type="number" step="0.01" min="0" max="10" className="form-input" value={score.xg_a} onChange={e => setScore(s => ({ ...s, xg_a: e.target.value }))} placeholder="0.00" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">xG {selected.team_b.code}</label>
                    <input type="number" step="0.01" min="0" max="10" className="form-input" value={score.xg_b} onChange={e => setScore(s => ({ ...s, xg_b: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Registrar Resultado</button>
                  <button type="button" className="btn btn-ghost" onClick={() => { setSelected(null); setResultMsg('') }}>Cancelar</button>
                </div>
                {resultMsg && (
                  <div className="adm-feedback" style={{ color: resultMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>{resultMsg}</div>
                )}
              </form>
            )}
            {resultMsg && !selected && (
              <div style={{ padding: 'var(--s3) var(--s4)', borderTop: '1px solid var(--border)', fontFamily: 'var(--font-data)', fontSize: 12, color: resultMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                {resultMsg}
              </div>
            )}
          </div>

          {/* Cache */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Cache Redis</span>
            </div>
            <div style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)' }}>
                Limpa todas as simulações em cache — próxima chamada recomputa do zero.
              </p>
              <button onClick={clearCache} className="btn btn-ghost w-full">Limpar Cache</button>
              {cacheMsg && (
                <div className="adm-feedback" style={{ color: cacheMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>{cacheMsg}</div>
              )}
            </div>
            <div className="adm-card__head" style={{ borderTop: '1px solid var(--border)', marginTop: 0 }}>
              <span className="adm-card__title">Pontuação</span>
            </div>
            <div style={{ padding: 'var(--s3) var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
              {['Elo atualizado (K=32) automaticamente', 'Exato = 3 pts · Resultado certo = 1 pt', 'Cache invalidado após resultado', 'xG refina simulações futuras'].map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 'var(--s2)', fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--win)', lineHeight: 1.5 }}>✓</span>{l}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Sincronização ────────────────────────── */}
      {tab === 'sync' && (
        <div className="adm-pane fade-in-1">
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">🔄 Sincronizar Dados Reais</span>
              <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                {syncStatus?.auto_sync_interval_hours && (
                  <span className="badge badge-live">⏱ auto {syncStatus.auto_sync_interval_hours}h</span>
                )}
                {syncStatus?.finished_at && !syncStatus.running && (
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                    {syncStatus.updated}/48 atualizados
                  </span>
                )}
              </div>
            </div>
            <div style={{ padding: 'var(--s5)', display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)' }}>
                Reimporta grupos, calendário, placares e convocados, depois recalcula Elo, gols médios e forma recente (~30s).
              </p>

              <div className="adm-sync-grid">
                {[
                  { label: 'Servidor iniciado', val: fmt(scheduler?.server_started_at) },
                  { label: 'Último auto-sync',  val: fmt(scheduler?.last_auto_finished_at) },
                  { label: 'Próximo auto-sync', val: syncStatus?.running && syncStatus?.trigger === 'auto' ? 'Executando agora' : fmt(scheduler?.next_auto_run_at) },
                  { label: 'Contagem', val: syncStatus?.running && syncStatus?.trigger === 'auto' ? 'Executando agora' : formatCountdown(scheduler?.next_auto_run_at, nowMs) },
                  { label: 'Status cron', val: scheduler?.last_auto_ok === false ? '✗ Falhou' : scheduler?.last_auto_finished_at ? '✓ Operacional' : 'Aguardando…', accent: scheduler?.last_auto_ok === false ? 'var(--lose)' : 'var(--win)' },
                ].map((item, i) => (
                  <div key={i} className="adm-sync-item">
                    <div className="adm-sync-item__label">{item.label}</div>
                    <div className="adm-sync-item__val" style={item.accent ? { color: item.accent } : {}}>{item.val}</div>
                  </div>
                ))}
              </div>

              <button onClick={startSync} disabled={syncPolling} className="btn btn-primary w-full">
                {syncPolling ? '⏳ Sincronizando...' : '↓ Atualizar Dados Reais'}
              </button>

              {syncStatus && (
                <div className="admin-log">
                  {syncStatus.log?.slice(-20).map((line, i) => (
                    <div key={i} style={{ color: line.startsWith('✓') ? 'var(--win)' : line.startsWith('✗') ? 'var(--lose)' : 'var(--text-2)' }}>{line}</div>
                  ))}
                  {syncStatus.running && <div style={{ color: 'var(--accent)', marginTop: 4 }}>● {syncStatus.updated}/48 atualizados…</div>}
                  {!syncStatus.running && syncStatus.finished_at && (
                    <div style={{ color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                      ✓ {syncStatus.updated} times atualizados{syncStatus.errors?.length > 0 ? ` · Erros: ${syncStatus.errors.join(', ')}` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {syncStatus?.history?.length > 0 && (
            <div className="adm-card" style={{ marginTop: 'var(--s4)' }}>
              <div className="adm-card__head">
                <span className="adm-card__title">Histórico</span>
                <span className="badge badge-group">{syncStatus.history.length} runs</span>
              </div>
              <div style={{ padding: 'var(--s2) 0' }}>
                {syncStatus.history.map((run, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--s2) var(--s4)', borderBottom: i < syncStatus.history.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 12, fontFamily: 'var(--font-cond)' }}>
                    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                      <span style={{ color: run.ok ? 'var(--win)' : 'var(--lose)' }}>{run.ok ? '✓' : '✗'}</span>
                      <span className="badge badge-group" style={{ fontSize: 10 }}>{run.trigger || 'manual'}</span>
                      <span style={{ color: 'var(--text-3)' }}>{run.started_at ? new Date(run.started_at + 'Z').toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '—'}</span>
                    </div>
                    <span style={{ color: run.ok ? 'var(--text-2)' : 'var(--lose)', fontSize: 11 }}>
                      {run.ok ? `${run.updated} seleções` : run.errors?.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Apostas ──────────────────────────────── */}
      {tab === 'bets' && (
        <div className="adm-pane fade-in-1">
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Apostas Recentes</span>
              <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                {allBets && <span className="badge badge-group">{allBets.length}</span>}
                <button onClick={loadBets} className="btn btn-ghost btn-sm" disabled={betsLoading}>{betsLoading ? '⏳' : '↻ Atualizar'}</button>
              </div>
            </div>

            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>Partida</th>
                    <th className="adm-table__num">Palpite</th>
                    <th className="adm-table__num">Pts</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {betsLoading && <tr><td colSpan={5} className="adm-table__empty">Carregando...</td></tr>}
                  {!betsLoading && allBets?.length === 0 && <tr><td colSpan={5} className="adm-table__empty">Nenhuma aposta ainda.</td></tr>}
                  {allBets?.map(b => (
                    <tr key={b.id}>
                      <td className="adm-table__email">{b.user_email?.split('@')[0]}</td>
                      <td style={{ fontFamily: 'var(--font-cond)', fontWeight: 600 }}>{b.team_a} × {b.team_b}</td>
                      <td className="adm-table__num" style={{ fontFamily: 'var(--font-data)', fontWeight: 700 }}>{b.score_a}–{b.score_b}</td>
                      <td className="adm-table__num">
                        <span style={{ color: b.result === 'exact' ? 'var(--win)' : b.result === 'correct' ? 'var(--accent)' : b.result === 'wrong' ? 'var(--lose)' : 'var(--text-4)', fontWeight: 700 }}>
                          {b.result === 'exact' ? '+3' : b.result === 'correct' ? '+1' : b.result === 'wrong' ? '0' : '⏳'}
                        </span>
                      </td>
                      <td className="adm-table__date">{b.created_at ? fmtShort(b.created_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Cobertura ────────────────────────────── */}
      {tab === 'coverage' && (
        <div className="adm-pane fade-in-1">
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Cobertura por Jogo</span>
              <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                {['scheduled', 'finished', 'all'].map(s => (
                  <button key={s} onClick={() => loadCoverage(s)} className={`btn btn-sm ${coverageStatus === s ? 'btn-primary' : 'btn-ghost'}`} disabled={coverageLoading}>
                    {s === 'scheduled' ? 'Abertos' : s === 'finished' ? 'Finalizados' : 'Todos'}
                  </button>
                ))}
              </div>
            </div>

            {coverageLoading && <p style={{ padding: 'var(--s5)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando cobertura...</p>}
            {!coverageLoading && !betCoverage?.matches?.length && (
              <p style={{ padding: 'var(--s5)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Sem partidas para este filtro.</p>
            )}

            {betCoverage?.matches?.map(match => (
              <div key={match.match_id} className="adm-coverage-row">
                <div className="adm-coverage-row__head">
                  <div>
                    <div className="adm-coverage-row__teams">{match.team_a_code} × {match.team_b_code}</div>
                    <div className="adm-coverage-row__meta">
                      G{match.group_name || '—'} · #{match.match_id} · {match.match_date ? new Date(match.match_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Sem data'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                    <span className="badge badge-win">{match.bettors_count} apostaram</span>
                    <span className="badge badge-group">{match.missing_count} faltando</span>
                  </div>
                </div>
                <div className="adm-coverage-row__body">
                  <div className="adm-coverage-col">
                    <div className="adm-coverage-col__label" style={{ color: 'var(--win)' }}>Apostaram</div>
                    {match.bettors.length === 0
                      ? <div className="adm-table__empty" style={{ padding: 'var(--s2) 0' }}>Ninguém ainda.</div>
                      : match.bettors.map(b => (
                        <div key={`${match.match_id}-${b.user_id}`} className="adm-coverage-person">
                          <span>{b.name}</span>
                          <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700 }}>{b.score_a}–{b.score_b}</span>
                        </div>
                      ))}
                  </div>
                  <div className="adm-coverage-col">
                    <div className="adm-coverage-col__label" style={{ color: 'var(--lose)' }}>Faltam</div>
                    {match.missing_users.length === 0
                      ? <div className="adm-table__empty" style={{ padding: 'var(--s2) 0' }}>Cobertura completa.</div>
                      : match.missing_users.map(m => (
                        <div key={`${match.match_id}-miss-${m.user_id}`} className="adm-coverage-person">
                          <span>{m.name}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
