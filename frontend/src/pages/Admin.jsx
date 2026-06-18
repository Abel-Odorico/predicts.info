import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

function formatDateTime(value) {
  if (!value) return '—'
  const normalized = value.endsWith('Z') ? value : `${value}Z`
  return new Date(normalized).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCountdown(value, nowMs) {
  if (!value) return '—'
  const normalized = value.endsWith('Z') ? value : `${value}Z`
  const diff = new Date(normalized).getTime() - nowMs
  if (diff <= 0) return 'Executando agora'

  const totalSeconds = Math.floor(diff / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export default function Admin() {
  const { user, token } = useAuth()
  const navigate = useNavigate()

  const [matches, setMatches]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState(null)   // match being scored
  const [score, setScore]           = useState({ a: '', b: '', xg_a: '', xg_b: '' })
  const [resultMsg, setResultMsg]   = useState('')
  const [cacheMsg, setCacheMsg]     = useState('')
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncPolling, setSyncPolling] = useState(false)
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [userQuery, setUserQuery] = useState('')
  const [userMsg, setUserMsg] = useState('')
  const [savingUserId, setSavingUserId] = useState(null)
  const [allBets, setAllBets]         = useState(null)
  const [betsLoading, setBetsLoading] = useState(false)
  const [betCoverage, setBetCoverage] = useState(null)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [coverageStatus, setCoverageStatus] = useState('scheduled')
  const [nowMs, setNowMs] = useState(Date.now())

  async function loadSyncStatus() {
    try {
      const data = await api.get('/admin/sync-status', token)
      setSyncStatus(data)
      return data
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (!user || user.role !== 'admin') { navigate('/'); return }
    api.get('/matches?status=scheduled&limit=100')
      .then(setMatches)
      .catch(console.error)
      .finally(() => setLoading(false))
    loadSyncStatus()
    loadUsers()
    loadBets()
    loadCoverage('scheduled')
  }, [user, token])

  useEffect(() => {
    if (!token || !user || user.role !== 'admin') return
    const iv = setInterval(() => {
      loadSyncStatus()
    }, 30000)
    return () => clearInterval(iv)
  }, [token, user])

  useEffect(() => {
    const iv = setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  async function loadBets() {
    setBetsLoading(true)
    try {
      const data = await api.get('/admin/bets/all?limit=50', token)
      setAllBets(data)
    } catch { /* ignore */ }
    finally { setBetsLoading(false) }
  }

  async function loadUsers(query = userQuery) {
    setUsersLoading(true)
    try {
      const suffix = query?.trim() ? `?q=${encodeURIComponent(query.trim())}&limit=100` : '?limit=100'
      const data = await api.get(`/admin/users${suffix}`, token)
      setUsers(data)
    } catch {
      setUsers([])
    } finally {
      setUsersLoading(false)
    }
  }

  async function loadCoverage(status = coverageStatus) {
    setCoverageLoading(true)
    try {
      const data = await api.get(`/admin/bets/coverage?status=${status}&limit=50`, token)
      setBetCoverage(data)
      setCoverageStatus(status)
    } catch { /* ignore */ }
    finally { setCoverageLoading(false) }
  }

  async function submitResult(e) {
    e.preventDefault()
    setResultMsg('')
    const sa = parseInt(score.a)
    const sb = parseInt(score.b)
    if (isNaN(sa) || isNaN(sb)) { setResultMsg('Preencha o placar'); return }
    try {
      const res = await api.post('/admin/results', {
        match_id: selected.id,
        score_a: sa,
        score_b: sb,
        xg_a: score.xg_a ? parseFloat(score.xg_a) : null,
        xg_b: score.xg_b ? parseFloat(score.xg_b) : null,
      }, token)
      const eloLines = Object.entries(res.elo_update)
        .map(([code, e]) => `${code}: ${e.before.toFixed(0)} → ${e.after.toFixed(0)} (${e.delta > 0 ? '+' : ''}${e.delta})`)
        .join(' | ')
      setResultMsg(`✓ ${res.result} — ${res.outcome.toUpperCase()} | Elo: ${eloLines}`)
      setSelected(null)
      setScore({ a: '', b: '', xg_a: '', xg_b: '' })
      setMatches(m => m.filter(x => x.id !== selected.id))
    } catch (e) {
      setResultMsg(`✗ ${e.message}`)
    }
  }

  async function updateUserRole(userId, role) {
    setUserMsg('')
    setSavingUserId(userId)
    try {
      const res = await api.patch(`/admin/users/${userId}`, { role }, token)
      setUsers(list => list.map(item => item.id === userId ? { ...item, role: res.role } : item))
      setUserMsg(`✓ ${res.email} atualizado para ${res.role}`)
    } catch (e) {
      setUserMsg(`✗ ${e.message}`)
    } finally {
      setSavingUserId(null)
    }
  }

  async function startSync() {
    setSyncStatus({ running: true, log: [], updated: 0, errors: [] })
    setSyncPolling(true)
    try {
      await api.post('/admin/sync-elo', {}, token)
    } catch (e) {
      setSyncStatus(s => ({ ...s, running: false, error: e.message }))
      setSyncPolling(false)
      return
    }
    // Poll status every 2s
    const iv = setInterval(async () => {
      try {
        const st = await loadSyncStatus()
        setSyncStatus(st)
        if (!st?.running) {
          clearInterval(iv)
          setSyncPolling(false)
        }
      } catch {
        clearInterval(iv)
        setSyncPolling(false)
      }
    }, 2000)
  }

  async function clearCache() {
    setCacheMsg('')
    try {
      const res = await api.post('/admin/recalculate', {}, token)
      setCacheMsg(`✓ Cache limpo — ${res.keys_removed} chaves removidas`)
    } catch (e) {
      setCacheMsg(`✗ ${e.message}`)
    }
  }

  if (!user) return null
  if (user.role !== 'admin') return (
    <div className="page" style={{ textAlign: 'center', padding: 'var(--s16)' }}>
      <p style={{ color: 'var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 18 }}>
        Acesso negado — apenas admins
      </p>
    </div>
  )
  if (loading) return <Spinner text="Carregando partidas..." />

  const scheduler = syncStatus?.scheduler
  const lastHistoryEntry = syncStatus?.history?.[0] || null
  const autoSyncHours = syncStatus?.auto_sync_interval_hours
  const adminUsersCount = users.filter(item => item.role === 'admin').length
  const usersWithoutBets = users.filter(item => !item.bets_count).length
  const totalUserPoints = users.reduce((sum, item) => sum + (item.bets_points || 0), 0)

  return (
    <div className="page">
      <div className="fade-in-1">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">PAINEL ADMIN</h1>
            <p className="page-subtitle">Resultados · Elo · Cache · Usuários</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <a href="/admin/analytics" className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
              📊 Analytics
            </a>
            <a href="/admin/options" className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
              ⚙️ Configurações
            </a>
          </div>
        </div>
      </div>

      <div className="card card--accent fade-in-2 mt-8">
        <div className="card__header">
          <div>
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              Gestão de Usuários
            </span>
            <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)' }}>
              Busque, acompanhe atividade e altere permissões sem sair do painel.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="badge badge-group">{users.length} visíveis</span>
            <button onClick={() => loadUsers()} className="btn btn-ghost btn-sm" disabled={usersLoading}>
              {usersLoading ? '⏳ Atualizando' : '↻ Atualizar'}
            </button>
          </div>
        </div>
        <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <div className="admin-users-overview">
            <div className="admin-users-metric">
              <div className="admin-users-metric__label">Usuários listados</div>
              <div className="admin-users-metric__value">{users.length}</div>
            </div>
            <div className="admin-users-metric">
              <div className="admin-users-metric__label">Admins</div>
              <div className="admin-users-metric__value">{adminUsersCount}</div>
            </div>
            <div className="admin-users-metric">
              <div className="admin-users-metric__label">Sem apostas</div>
              <div className="admin-users-metric__value">{usersWithoutBets}</div>
            </div>
            <div className="admin-users-metric">
              <div className="admin-users-metric__label">Pontos somados</div>
              <div className="admin-users-metric__value">{totalUserPoints}</div>
            </div>
          </div>

          <div className="admin-users-toolbar">
            <input
              type="text"
              className="form-input"
              placeholder="Buscar por nome ou e-mail"
              value={userQuery}
              onChange={e => setUserQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') loadUsers()
              }}
            />
            <button type="button" className="btn btn-primary" onClick={() => loadUsers()}>
              Buscar
            </button>
          </div>

          {userMsg && (
            <p style={{
              fontFamily: 'var(--font-data)', fontSize: 12,
              color: userMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)',
              textAlign: 'center'
            }}>
              {userMsg}
            </p>
          )}

          {usersLoading && (
            <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)' }}>Carregando usuários...</p>
          )}
          {!usersLoading && users.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)' }}>Nenhum usuário encontrado.</p>
          )}
          {!usersLoading && users.length > 0 && (
            <div className="admin-users-list">
              {users.map(item => (
                <div key={item.id} className="admin-user-card">
                  <div className="admin-user-card__main">
                    <div className="admin-user-card__name">{item.name}</div>
                    <div className="admin-user-card__email">{item.email}</div>
                    <div className="admin-user-card__meta">
                      <span>ID {item.id}</span>
                      <span>Cadastro {formatDateTime(item.created_at)}</span>
                      <span>{item.bets_count} apostas</span>
                      <span>{item.bets_points} pontos</span>
                    </div>
                  </div>
                  <div className="admin-user-card__side">
                    <span className={`badge ${item.role === 'admin' ? 'badge-live' : 'badge-group'}`}>
                      {item.role}
                    </span>
                    <button
                      type="button"
                      className={`btn btn-sm ${item.role === 'admin' ? 'btn-ghost' : 'btn-primary'}`}
                      disabled={savingUserId === item.id || (item.id === user.id && item.role === 'admin')}
                      onClick={() => updateUserRole(item.id, item.role === 'admin' ? 'user' : 'admin')}
                    >
                      {savingUserId === item.id ? 'Salvando...' : item.role === 'admin' ? 'Remover admin' : 'Tornar admin'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="admin-grid mt-8">
        <div className="stack gap-6">
          <div className="card fade-in-2">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                Inserir Resultado
              </span>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>
                {matches.length} partidas abertas
              </span>
            </div>

            <div className="admin-list">
              {matches.length === 0 ? (
                <p style={{ padding: 'var(--s6)', color: 'var(--text-3)', textAlign: 'center', fontFamily: 'var(--font-cond)' }}>
                  Todas as partidas finalizadas
                </p>
              ) : matches.map(m => (
                <div
                  key={m.id}
                  onClick={() => { setSelected(m); setScore({ a: '', b: '', xg_a: '', xg_b: '' }); setResultMsg('') }}
                  className={`admin-match-row${selected?.id === m.id ? ' admin-match-row--active' : ''}`}
                >
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', minWidth: 28 }}>
                    G{m.group_name}
                  </span>
                  <span className="admin-match-row__teams">
                    {m.team_a.code} vs {m.team_b.code}
                  </span>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                    #{m.id}
                  </span>
                </div>
              ))}
            </div>

            {selected && (
              <form onSubmit={submitResult} className="admin-score-form">
                <div className="admin-score-match">
                  {selected.team_a.code} × {selected.team_b.code}
                </div>

                <div className="admin-score-grid">
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>
                      {selected.team_a.code}
                    </div>
                    <input
                      type="number" min="0" max="20"
                      className="score-input"
                      value={score.a}
                      onChange={e => setScore(s => ({ ...s, a: e.target.value }))}
                      placeholder="0"
                      autoFocus
                    />
                  </div>
                  <span className="score-sep" style={{ textAlign: 'center' }}>×</span>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', marginBottom: 4 }}>
                      {selected.team_b.code}
                    </div>
                    <input
                      type="number" min="0" max="20"
                      className="score-input"
                      value={score.b}
                      onChange={e => setScore(s => ({ ...s, b: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="admin-xg-grid">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">xG {selected.team_a.code} (opt.)</label>
                    <input
                      type="number" step="0.01" min="0" max="10"
                      className="form-input"
                      value={score.xg_a}
                      onChange={e => setScore(s => ({ ...s, xg_a: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">xG {selected.team_b.code} (opt.)</label>
                    <input
                      type="number" step="0.01" min="0" max="10"
                      className="form-input"
                      value={score.xg_b}
                      onChange={e => setScore(s => ({ ...s, xg_b: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="admin-score-actions">
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                    Registrar Resultado
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => { setSelected(null); setResultMsg('') }}
                  >
                    Cancelar
                  </button>
                </div>

                {resultMsg && (
                  <p style={{
                    fontFamily: 'var(--font-data)', fontSize: 12,
                    color: resultMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)',
                    textAlign: 'center', padding: 'var(--s2)'
                  }}>
                    {resultMsg}
                  </p>
                )}
              </form>
            )}

            {resultMsg && !selected && (
              <div style={{
                padding: 'var(--s4) var(--s5)', borderTop: '1px solid var(--border)',
                fontFamily: 'var(--font-data)', fontSize: 12,
                color: resultMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)',
              }}>
                {resultMsg}
              </div>
            )}
          </div>
        </div>

        <div className="stack gap-6">
          <div className="card card--accent fade-in-2">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                🔄 Sincronizar Dados Reais
              </span>
              <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                {autoSyncHours && (
                  <span className="badge badge-live">⏱ auto {autoSyncHours}h</span>
                )}
                {syncStatus?.finished_at && !syncStatus.running && (
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                    {syncStatus.updated}/48 atualizados
                  </span>
                )}
              </div>
            </div>
            <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)' }}>
                Reimporta grupos, calendário, placares já disputados e convocados atuais da Copa 2026, depois recalcula Elo, gols médios e forma recente (~30s).
                {autoSyncHours && (
                  <> Auto-sync ativo a cada <strong>{autoSyncHours}h</strong> — botão para forçar imediatamente.</>
                )}
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 'var(--s3)',
                fontSize: 12,
                fontFamily: 'var(--font-cond)',
              }}>
                <div className="pill-list__item" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--accent)' }}>●</span>
                  <div>
                    <div style={{ color: 'var(--text-3)' }}>Servidor iniciado</div>
                    <div>{formatDateTime(scheduler?.server_started_at)}</div>
                  </div>
                </div>
                <div className="pill-list__item" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--accent)' }}>●</span>
                  <div>
                    <div style={{ color: 'var(--text-3)' }}>Último auto-sync</div>
                    <div>{formatDateTime(scheduler?.last_auto_finished_at)}</div>
                  </div>
                </div>
                <div className="pill-list__item" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--accent)' }}>●</span>
                  <div>
                    <div style={{ color: 'var(--text-3)' }}>Próximo auto-sync</div>
                    <div>{syncStatus?.running && syncStatus?.trigger === 'auto' ? 'Executando agora' : formatDateTime(scheduler?.next_auto_run_at)}</div>
                  </div>
                </div>
                <div className="pill-list__item" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: 'var(--accent)' }}>●</span>
                  <div>
                    <div style={{ color: 'var(--text-3)' }}>Contagem regressiva</div>
                    <div>{syncStatus?.running && syncStatus?.trigger === 'auto' ? 'Executando agora' : formatCountdown(scheduler?.next_auto_run_at, nowMs)}</div>
                  </div>
                </div>
                <div className="pill-list__item" style={{ alignItems: 'flex-start' }}>
                  <span style={{ color: scheduler?.last_auto_ok === false ? 'var(--lose)' : 'var(--win)' }}>
                    {scheduler?.last_auto_ok === false ? '✗' : '✓'}
                  </span>
                  <div>
                    <div style={{ color: 'var(--text-3)' }}>Status do cron</div>
                    <div>
                      {scheduler?.last_auto_ok === false
                        ? 'Último auto-sync falhou'
                        : scheduler?.last_auto_finished_at
                          ? 'Auto-sync operacional'
                          : 'Aguardando primeira execução'}
                    </div>
                  </div>
                </div>
              </div>
              {lastHistoryEntry && (
                <p style={{ margin: 0, fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                  Última sincronização: {lastHistoryEntry.trigger || 'manual'} em {formatDateTime(lastHistoryEntry.finished_at || lastHistoryEntry.started_at)}.
                </p>
              )}
              <button
                onClick={startSync}
                disabled={syncPolling}
                className="btn btn-primary w-full"
              >
                {syncPolling ? '⏳ Sincronizando...' : '↓ Atualizar Dados Reais'}
              </button>

              {syncStatus && (
                <div className="admin-log">
                  {syncStatus.log?.slice(-20).map((line, i) => (
                    <div key={i} style={{ color: line.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                      {line}
                    </div>
                  ))}
                  {syncStatus.running && (
                    <div style={{ color: 'var(--accent)', marginTop: 4 }}>
                      ● {syncStatus.updated}/48 atualizados...
                    </div>
                  )}
                  {!syncStatus.running && syncStatus.finished_at && (
                    <div style={{ color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                      ✓ Concluído — {syncStatus.updated} times com estatísticas atualizadas
                      {syncStatus.errors?.length > 0 && ` | Erros: ${syncStatus.errors.join(', ')}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="card fade-in-2">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                Cache Redis
              </span>
            </div>
            <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)' }}>
                Limpa todas as simulações em cache — a próxima chamada recomputa do zero.
              </p>
              <button onClick={clearCache} className="btn btn-ghost w-full">
                Limpar Cache
              </button>
              {cacheMsg && (
                <p style={{
                  fontFamily: 'var(--font-data)', fontSize: 12,
                  color: cacheMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)',
                  textAlign: 'center'
                }}>
                  {cacheMsg}
                </p>
              )}
            </div>
          </div>

          <div className="card fade-in-4">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                Lógica de Resultado
              </span>
            </div>
            <div className="card__body pill-list" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
              {[
                'Elo atualizado (K=32) automaticamente',
                'Apostas avaliadas: exato=3pts, resultado=1pt',
                'Cache de simulação invalidado',
                'xG usado para refinar o modelo nas próximas sims',
              ].map((line, i) => (
                <div key={i} className="pill-list__item">
                  <span style={{ color: 'var(--win)', marginTop: 2 }}>✓</span>
                  {line}
                </div>
              ))}
            </div>
          </div>

          {/* Sync history */}
          {syncStatus?.history?.length > 0 && (
            <div className="card fade-in-4">
              <div className="card__header">
                <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                  Histórico de Sincronizações
                </span>
                <span className="badge badge-group">{syncStatus.history.length} runs</span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {syncStatus.history.map((run, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 'var(--s2) 0',
                    borderBottom: i < syncStatus.history.length - 1 ? '1px solid var(--border)' : 'none',
                    fontSize: 12, fontFamily: 'var(--font-cond)',
                  }}>
                    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                      <span style={{ color: run.ok ? 'var(--win)' : 'var(--lose)' }}>{run.ok ? '✓' : '✗'}</span>
                      <span className="badge badge-group" style={{ fontSize: 10 }}>{run.trigger || 'manual'}</span>
                      <span style={{ color: 'var(--text-3)' }}>
                        {run.started_at ? new Date(run.started_at + 'Z').toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '—'}
                      </span>
                    </div>
                    <span style={{ color: run.ok ? 'var(--text-2)' : 'var(--lose)', fontSize: 11 }}>
                      {run.ok ? `${run.updated} seleções` : run.errors?.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All bets log */}
          <div className="card fade-in-4">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                Apostas Recentes
              </span>
              <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                {allBets && <span className="badge badge-group">{allBets.length}</span>}
                <button onClick={loadBets} className="btn btn-ghost btn-sm" disabled={betsLoading}>
                  {betsLoading ? '⏳' : '↻'}
                </button>
              </div>
            </div>
            <div className="card__body" style={{ paddingTop: 'var(--s2)', paddingBottom: 'var(--s2)' }}>
              {betsLoading && <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)', padding: 'var(--s3) 0' }}>Carregando...</p>}
              {!betsLoading && allBets?.length === 0 && (
                <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)', padding: 'var(--s3) 0' }}>Nenhuma aposta ainda.</p>
              )}
              {allBets?.map((b, i) => (
                <div key={b.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto auto auto',
                  gap: 'var(--s3)', alignItems: 'center',
                  padding: 'var(--s2) 0',
                  borderBottom: i < allBets.length - 1 ? '1px solid var(--border)' : 'none',
                  fontSize: 12, fontFamily: 'var(--font-cond)',
                }}>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{b.user_email?.split('@')[0]}</span>
                    <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{b.team_a} × {b.team_b}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700 }}>{b.score_a}–{b.score_b}</span>
                  <span style={{
                    color: b.result === 'exact' ? 'var(--win)' : b.result === 'correct' ? 'var(--accent)' : b.result === 'wrong' ? 'var(--lose)' : 'var(--text-4)',
                    fontWeight: 600, minWidth: 52, textAlign: 'right'
                  }}>
                    {b.result === 'exact' ? '+3' : b.result === 'correct' ? '+1' : b.result === 'wrong' ? '0' : '⏳'}
                  </span>
                  <span style={{ color: 'var(--text-4)', fontSize: 10 }}>
                    {b.created_at ? new Date(b.created_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card fade-in-4">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                Cobertura por Jogo
              </span>
              <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                {['scheduled', 'finished', 'all'].map(status => (
                  <button
                    key={status}
                    onClick={() => loadCoverage(status)}
                    className={`btn btn-sm ${coverageStatus === status ? 'btn-primary' : 'btn-ghost'}`}
                    disabled={coverageLoading}
                  >
                    {status === 'scheduled' ? 'Abertos' : status === 'finished' ? 'Finalizados' : 'Todos'}
                  </button>
                ))}
              </div>
            </div>
            <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
              {coverageLoading && <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)', padding: 'var(--s3) 0' }}>Carregando cobertura...</p>}
              {!coverageLoading && !betCoverage?.matches?.length && (
                <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'var(--font-cond)', padding: 'var(--s3) 0' }}>Sem partidas para este filtro.</p>
              )}
              {betCoverage?.matches?.map(match => (
                <div key={match.match_id} style={{
                  padding: 'var(--s4) 0',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--s3)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
                        {match.team_a_code} × {match.team_b_code}
                      </div>
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                        G{match.group_name || '—'} · #{match.match_id} · {match.match_date ? new Date(match.match_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Sem data'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                      <span className="badge badge-win">{match.bettors_count} apostaram</span>
                      <span className="badge badge-group">{match.missing_count} faltando</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s3)' }}>
                    <div style={{ padding: 'var(--s3)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', background: 'var(--bg-overlay)' }}>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--win)', marginBottom: 'var(--s2)' }}>
                        Já apostaram
                      </div>
                      {match.bettors.length === 0 ? (
                        <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Ninguém ainda.</div>
                      ) : (
                        match.bettors.map(bettor => (
                          <div key={`${match.match_id}-${bettor.user_id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s2)', fontSize: 12, padding: '4px 0' }}>
                            <span style={{ color: 'var(--text-2)' }}>{bettor.name}</span>
                            <span style={{ color: 'var(--text-1)', fontFamily: 'var(--font-data)' }}>{bettor.score_a}–{bettor.score_b}</span>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ padding: 'var(--s3)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', background: 'var(--bg-overlay)' }}>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--lose)', marginBottom: 'var(--s2)' }}>
                        Ainda não apostaram
                      </div>
                      {match.missing_users.length === 0 ? (
                        <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Cobertura completa.</div>
                      ) : (
                        match.missing_users.map(missing => (
                          <div key={`${match.match_id}-missing-${missing.user_id}`} style={{ fontSize: 12, color: 'var(--text-2)', padding: '4px 0' }}>
                            {missing.name} <span style={{ color: 'var(--text-4)' }}>({missing.email})</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
