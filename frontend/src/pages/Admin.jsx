import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import ImageEditorModal from '../components/ImageEditorModal'

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
    timeZone: 'America/Sao_Paulo',
  })
}

function fmtShort(value) {
  if (!value) return '—'
  return new Date(normalizeDate(value)).toLocaleString('pt-BR', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
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
  { id: 'growth',      label: 'Crescimento',  icon: '📈' },
  { id: 'engagement',  label: 'Engajamento',  icon: '🔥' },
  { id: 'users',       label: 'Usuários',     icon: '👥' },
  { id: 'results',     label: 'Resultados',   icon: '⚽' },
  { id: 'sync',        label: 'Sincronização', icon: '🔄' },
  { id: 'bets',        label: 'Apostas',      icon: '🎯' },
  { id: 'coverage',    label: 'Cobertura',    icon: '📋' },
  { id: 'poll',        label: 'Pesquisa',     icon: '📊' },
  { id: 'versions',   label: 'Versões',      icon: '🔖' },
  { id: 'pwa',        label: 'Ícone PWA',    icon: '🖼' },
  { id: 'knockout',   label: 'Mata-Mata',    icon: '⚔️' },
  { id: 'analyses',   label: 'Análises IA',  icon: '🤖' },
]

const PHASE_LABELS_ADMIN = {
  r32: 'Round of 32', r16: 'Oitavas', qf: 'Quartas', sf: 'Semifinal', '3rd': '3º Lugar', final: 'Final',
}

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

  // Versions
  const [versions, setVersions]           = useState(null)
  const [versionsLoading, setVLoading]    = useState(false)
  const [versionMsg, setVersionMsg]       = useState('')
  const [vForm, setVForm]                 = useState({ version: '', title: '', description: '', changes: '' })

  // Poll
  const [poll, setPoll] = useState(null)
  const [pollLoading, setPollLoading] = useState(false)
  const [pollMsg, setPollMsg] = useState('')
  const [suggestions, setSuggestions] = useState(null)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)

  // Engagement
  const [engagement, setEngagement] = useState(null)
  const [engagementLoading, setEngagementLoading] = useState(false)
  const [engSegment, setEngSegment] = useState(null) // 'period'|'never'|'inactive'|'top'
  const [engPeriod, setEngPeriod] = useState('7d')   // today|7d|30d|all

  const [iconUploading, setIconUploading] = useState(false)
  const [iconMsg, setIconMsg] = useState('')
  const [iconPreview, setIconPreview] = useState(null)
  const [iconEditorSrc, setIconEditorSrc] = useState(null)
  const [iconTimestamp, setIconTimestamp] = useState(Date.now())

  // Knockout
  const [knockoutMatches, setKnockoutMatches] = useState(null)
  const [knockoutLoading, setKnockoutLoading] = useState(false)
  const [knockoutMsg, setKnockoutMsg] = useState('')
  const [knockoutSyncing, setKnockoutSyncing] = useState(false)
  const [allTeams, setAllTeams] = useState([])
  const [knockoutForm, setKnockoutForm] = useState({ phase: 'r32', team_a_id: '', team_b_id: '', match_date: '', venue: '', city: '', match_number: '' })
  const [editMatch, setEditMatch] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [awardStatus, setAwardStatus] = useState(null)
  const [awardForm, setAwardForm] = useState({ champion_team_id: '', runner_up_team_id: '' })
  const [awardMsg, setAwardMsg] = useState('')
  const [awarding, setAwarding] = useState(false)
  const [champAllPicks, setChampAllPicks] = useState(null)
  const [champStats, setChampStats] = useState(null)

  // ── Análises IA ──────────────────────────────────────────────────────────────
  const [analysisConfig, setAnalysisConfig]   = useState(null)
  const [analysisStatus, setAnalysisStatus]   = useState(null)
  const [analysisSaving, setAnalysisSaving]   = useState(false)
  const [analysisMsg, setAnalysisMsg]         = useState('')
  const [generatingId, setGeneratingId]       = useState(null)
  const [generatingAll, setGeneratingAll]     = useState(false)
  const [aForm, setAForm] = useState({
    provider: 'openrouter',
    openrouter_key: '', openrouter_model: '',
    gemini_key: '',     gemini_model: '',
  })

  async function loadAnalysisConfig() {
    try {
      const cfg = await api.get('/admin/analysis/config', token)
      setAnalysisConfig(cfg)
      setAForm(f => ({ ...f, provider: cfg.provider, openrouter_model: cfg.openrouter_model, gemini_model: cfg.gemini_model }))
    } catch {}
  }

  async function loadAnalysisStatus() {
    try { setAnalysisStatus(await api.get('/admin/analysis/status', token)) } catch {}
  }

  async function saveAnalysisConfig(e) {
    e.preventDefault()
    setAnalysisSaving(true); setAnalysisMsg('')
    try {
      await api.post('/admin/analysis/config', aForm, token)
      setAnalysisMsg('✓ Configuração salva')
      loadAnalysisConfig()
    } catch { setAnalysisMsg('Erro ao salvar') }
    finally { setAnalysisSaving(false) }
  }

  async function generateOne(matchId) {
    setGeneratingId(matchId); setAnalysisMsg('')
    try {
      await api.post(`/admin/analysis/${matchId}/generate`, {}, token)
      setAnalysisMsg(`✓ Análise gerada — partida #${matchId}`)
      loadAnalysisStatus()
    } catch (err) { setAnalysisMsg(`Erro: ${err.message || 'falha'}`) }
    finally { setGeneratingId(null) }
  }

  async function generateAll() {
    setGeneratingAll(true); setAnalysisMsg('')
    try {
      await api.post('/admin/analysis/generate-all', { only_pending: true }, token)
      setAnalysisMsg('✓ Background iniciado — atualize a lista em alguns minutos.')
    } catch { setAnalysisMsg('Erro ao iniciar geração') }
    finally { setGeneratingAll(false) }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  async function loadAwardStatus() {
    try { setAwardStatus(await api.get('/admin/champion/award', token)) } catch {}
  }

  async function loadChampPicks() {
    try {
      const [picks, stats] = await Promise.all([
        api.get('/champion/picks/all'),
        api.get('/champion/picks/stats'),
      ])
      setChampAllPicks(picks)
      setChampStats(stats)
    } catch {}
  }

  async function submitAward(e) {
    e.preventDefault()
    if (!awardForm.champion_team_id || !awardForm.runner_up_team_id) return
    setAwarding(true); setAwardMsg('')
    try {
      const r = await api.post('/admin/champion/award', {
        champion_team_id: parseInt(awardForm.champion_team_id),
        runner_up_team_id: parseInt(awardForm.runner_up_team_id),
      }, token)
      setAwardMsg(`✓ Campeão: ${r.champion_bonus.name} (${r.champion_bonus.users} usuários +${r.champion_bonus.pts_each}pts) · Vice: ${r.runner_up_bonus.name} (${r.runner_up_bonus.users} usuários +${r.runner_up_bonus.pts_each}pts)`)
      loadAwardStatus()
    } catch (e) {
      const msg = e?.body?.detail || e?.message || 'Erro'
      setAwardMsg(`✗ ${msg}`)
    } finally { setAwarding(false) }
  }

  async function loadKnockout() {
    setKnockoutLoading(true)
    try { setKnockoutMatches(await api.get('/admin/knockout/matches', token)) }
    catch { setKnockoutMatches([]) }
    finally { setKnockoutLoading(false) }
  }

  async function loadAllTeams() {
    try { setAllTeams(await api.get('/teams')) } catch {}
  }

  async function syncKnockout() {
    setKnockoutSyncing(true); setKnockoutMsg('')
    try {
      const r = await api.post('/admin/knockout/sync', {}, token)
      setKnockoutMsg(`✓ Criadas: ${r.created} · Atualizadas: ${r.updated} · Pendentes: ${r.pending}`)
      loadKnockout()
    } catch (e) {
      setKnockoutMsg(`✗ Erro: ${e?.message || 'falha'}`)
    } finally { setKnockoutSyncing(false) }
  }

  async function createKnockoutMatch(e) {
    e.preventDefault()
    const payload = {
      phase: knockoutForm.phase,
      team_a_id: parseInt(knockoutForm.team_a_id),
      team_b_id: parseInt(knockoutForm.team_b_id),
      match_date: knockoutForm.match_date || null,
      venue: knockoutForm.venue || null,
      city: knockoutForm.city || null,
      match_number: knockoutForm.match_number ? parseInt(knockoutForm.match_number) : null,
    }
    try {
      await api.post('/admin/matches', payload, token)
      setKnockoutMsg('✓ Partida criada')
      setKnockoutForm({ phase: 'r32', team_a_id: '', team_b_id: '', match_date: '', venue: '', city: '', match_number: '' })
      loadKnockout()
    } catch { setKnockoutMsg('✗ Erro ao criar') }
  }

  async function saveEditMatch(e) {
    e.preventDefault()
    const payload = {}
    if (editForm.team_a_id) payload.team_a_id = parseInt(editForm.team_a_id)
    if (editForm.team_b_id) payload.team_b_id = parseInt(editForm.team_b_id)
    if (editForm.match_date) payload.match_date = editForm.match_date
    if (editForm.venue) payload.venue = editForm.venue
    if (editForm.city) payload.city = editForm.city
    try {
      await api.patch(`/admin/matches/${editMatch.id}`, payload, token)
      setKnockoutMsg('✓ Partida atualizada')
      setEditMatch(null)
      loadKnockout()
    } catch { setKnockoutMsg('✗ Erro ao atualizar') }
  }

  function openIconEditor(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const url = URL.createObjectURL(file)
    setIconEditorSrc(url)
    setIconMsg('')
  }

  async function saveIcon(blob) {
    setIconUploading(true)
    setIconMsg('')
    try {
      const fd = new FormData()
      fd.append('file', new File([blob], 'icon.png', { type: 'image/png' }))
      const res = await fetch('/api/admin/pwa/icon', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (res.ok) {
        setIconMsg(`✓ Ícone salvo — ${data.sizes?.length || 0} arquivos gerados`)
        setIconPreview(URL.createObjectURL(blob))
        setIconTimestamp(Date.now())
      } else {
        setIconMsg(`Erro: ${data.detail || 'falha no upload'}`)
      }
    } catch {
      setIconMsg('Erro ao enviar arquivo')
    } finally {
      setIconUploading(false)
      setIconEditorSrc(null)
    }
  }

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
    if (tab === 'growth')      loadGrowth(growthPeriod)
    if (tab === 'engagement' && !engagement && !engagementLoading) loadEngagement()
    if (tab === 'results' && matches.length === 0 && !matchesLoading) loadMatches()
    if (tab === 'bets' && !allBets && !betsLoading) loadBets()
    if (tab === 'coverage' && !betCoverage && !coverageLoading) loadCoverage('scheduled')
    if (tab === 'poll' && !poll && !pollLoading) loadPoll()
    if (tab === 'versions' && !versions && !versionsLoading) loadVersions()
    if (tab === 'knockout' && !knockoutMatches && !knockoutLoading) loadKnockout()
    if (tab === 'knockout' && allTeams.length === 0) loadAllTeams()
    if (tab === 'knockout' && !awardStatus) loadAwardStatus()
    if (tab === 'knockout' && !champAllPicks) loadChampPicks()
    if (tab === 'analyses' && !analysisConfig) loadAnalysisConfig()
    if (tab === 'analyses' && !analysisStatus) loadAnalysisStatus()
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

  async function loadPoll() {
    setPollLoading(true)
    try { setPoll(await api.get('/poll/active')) } catch {}
    finally { setPollLoading(false) }
  }

  async function loadEngagement(period = engPeriod) {
    setEngagementLoading(true)
    setEngSegment(null)
    try {
      const data = await api.get(`/admin/engagement?period=${period}`, token)
      setEngagement(data)
      setEngPeriod(period)
    } catch {}
    finally { setEngagementLoading(false) }
  }

  async function loadSuggestions() {
    setSuggestionsLoading(true)
    try { setSuggestions(await api.get('/admin/poll/suggestions', token)) } catch {}
    finally { setSuggestionsLoading(false) }
  }

  async function loadVersions() {
    setVLoading(true)
    try { setVersions(await api.get('/version/list')) } catch {}
    finally { setVLoading(false) }
  }

  async function createVersion() {
    const changes = vForm.changes.split('\n').map(s => s.trim()).filter(Boolean)
    if (!vForm.version.trim() || !vForm.title.trim()) { setVersionMsg('Versão e título obrigatórios'); return }
    setVersionMsg('')
    try {
      const v = await api.post('/admin/version', {
        version: vForm.version.trim(),
        title: vForm.title.trim(),
        description: vForm.description.trim() || null,
        changes,
      }, token)
      setVersionMsg(`✓ v${v.version} criada`)
      setVForm({ version: '', title: '', description: '', changes: '' })
      setVersions(null)
      loadVersions()
    } catch (e) { setVersionMsg(e.message || 'Erro ao criar versão') }
  }

  async function notifyVersion(id) {
    setVersionMsg('')
    try {
      const r = await api.post(`/admin/version/${id}/notify`, {}, token)
      setVersionMsg(`✓ ${r.sent} notificação${r.sent !== 1 ? 'ões' : ''} enviada${r.sent !== 1 ? 's' : ''} (v${r.version})`)
      loadVersions()
    } catch (e) { setVersionMsg(e.message || 'Erro ao notificar') }
  }

  async function notifyPollPending() {
    if (!poll) return
    setPollMsg('')
    try {
      const r = await api.post('/admin/poll/notify-pending', {}, token)
      setPollMsg(`✓ ${r.sent} notificação${r.sent !== 1 ? 'ões' : ''} enviada${r.sent !== 1 ? 's' : ''} (${r.total_pending} pendentes)`)
    } catch (e) { setPollMsg(e.message || 'Erro ao notificar') }
  }

  async function closePoll() {
    if (!poll || !window.confirm('Encerrar a pesquisa agora?')) return
    setPollMsg('')
    try {
      await api.post(`/admin/poll/close/${poll.id}`, {}, token)
      setPollMsg('✓ Pesquisa encerrada com sucesso')
      await loadPoll()
    } catch (e) { setPollMsg(`✗ ${e.message}`) }
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
            <div style={{ padding: 'var(--s8)', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
              Carregando...
            </div>
          )}

          {!growthLoading && growth && (
            <>
              {/* ── KPI Cards ─────────────────────────── */}
              <div className="adm-growth-cards">
                {[
                  { label: 'Total Usuários',     val: growth.summary.total_users,       accent: false },
                  { label: 'Novos Hoje',         val: growth.summary.new_today,         accent: 'win' },
                  { label: 'Novos na Semana',    val: growth.summary.new_week,          accent: 'win' },
                  { label: 'Novos no Mês',       val: growth.summary.new_month,         accent: 'teal' },
                  { label: 'Total Apostas',      val: growth.summary.total_bets,        accent: false },
                  { label: 'Apostas Hoje',       val: growth.summary.bets_today,        accent: 'win' },
                  { label: 'Apostadores Únicos', val: growth.summary.unique_bettors,    accent: 'teal' },
                  { label: 'Média Apostas/User', val: growth.summary.avg_bets_per_user, accent: false },
                ].map(card => (
                  <div key={card.label} className={`adm-growth-card${card.accent ? ` adm-growth-card--${card.accent}` : ''}`}>
                    <div className="adm-growth-card__val">{card.val}</div>
                    <div className="adm-growth-card__label">{card.label}</div>
                  </div>
                ))}
                {growth.summary.most_active_user && (
                  <div className="adm-growth-card adm-growth-card--wide adm-growth-card--teal">
                    <div className="adm-growth-card__badge">Usuário Mais Ativo</div>
                    <div className="adm-growth-card__name">{growth.summary.most_active_user}</div>
                    <div className="adm-growth-card__label">{growth.summary.most_active_bets} apostas realizadas</div>
                  </div>
                )}
                {growth.summary.most_bet_match && (
                  <div className="adm-growth-card adm-growth-card--wide">
                    <div className="adm-growth-card__badge">Jogo Mais Apostado</div>
                    <div className="adm-growth-card__name">{growth.summary.most_bet_match}</div>
                    <div className="adm-growth-card__label">{growth.summary.most_bet_match_cnt} apostas</div>
                  </div>
                )}
              </div>

              {/* ── Chart: Usuários ───────────────────── */}
              <GrowthChart
                title="Crescimento de Usuários"
                subtitle="Novos por período · linha = acumulado"
                data={growth.users_series}
                barKey="new"
                barName="Novos usuários"
                barGrad="gradTeal"
                barColor="#0f7a78"
                areaKey="cumulative"
                areaName="Acumulado"
                areaColor="#e8c44a"
                hiddenSeries={hiddenSeries}
                onToggle={toggleSeries}
                emptyMsg="Nenhum registro neste período."
              />

              {/* ── Chart: Apostas ────────────────────── */}
              <GrowthChart
                title="Volume de Apostas"
                subtitle="Total por período · linha = apostadores únicos"
                data={growth.bets_series}
                barKey="bets"
                barName="Apostas"
                barGrad="gradGreen"
                barColor="#2ec980"
                areaKey="unique_users"
                areaName="Apostadores únicos"
                areaColor="#9b5de8"
                hiddenSeries={hiddenSeries}
                onToggle={toggleSeries}
                emptyMsg="Nenhuma aposta neste período."
              />
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
              <div style={{ padding: 'var(--s2) 0', maxHeight: 320, overflowY: 'auto' }}>
                {syncStatus.history.map((run, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--s2) var(--s4)', borderBottom: i < syncStatus.history.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 12, fontFamily: 'var(--font-cond)' }}>
                    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                      <span style={{ color: run.ok ? 'var(--win)' : 'var(--lose)' }}>{run.ok ? '✓' : '✗'}</span>
                      <span className="badge badge-group" style={{ fontSize: 10 }}>{run.trigger || 'manual'}</span>
                      <span style={{ color: 'var(--text-3)' }}>{run.started_at ? new Date(run.started_at + 'Z').toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' }) : '—'}</span>
                    </div>
                    <span style={{ color: run.ok ? 'var(--text-2)' : 'var(--lose)', fontSize: 11 }} title={!run.ok && run.summary ? run.summary : undefined}>
                      {run.ok ? `${run.updated} seleções` : (run.summary?.replace(/^[✗●]\s*/, '') || run.errors?.join(', '))}
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

      {/* ── Tab: Pesquisa ─────────────────────────────── */}
      {tab === 'poll' && (
        <div className="adm-pane fade-in-1">
          {pollLoading && <p style={{ padding: 'var(--s5)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando...</p>}
          {!pollLoading && !poll && <p style={{ padding: 'var(--s5)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Nenhuma pesquisa encontrada.</p>}
          {poll && (
            <>
              <div className="adm-card">
                <div className="adm-card__head">
                  <div>
                    <span className="adm-card__title">{poll.title}</span>
                    <span style={{ marginLeft: 'var(--s3)', fontFamily: 'var(--font-cond)', fontSize: 11, letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 4, background: poll.status === 'active' ? 'rgba(15,122,120,0.15)' : 'rgba(100,100,100,0.15)', color: poll.status === 'active' ? 'var(--accent)' : 'var(--text-3)' }}>
                      {poll.status === 'active' ? '● ATIVA' : '■ ENCERRADA'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn btn-ghost btn-sm" onClick={loadPoll}>↻</button>
                    {poll.status === 'active' && poll.is_open && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }} onClick={notifyPollPending} title="Notificar quem ainda não respondeu">
                        🔔 Notificar pendentes
                      </button>
                    )}
                    {poll.status === 'active' && (
                      <button className="btn btn-sm" style={{ background: 'var(--lose)', color: '#fff' }} onClick={closePoll}>
                        Encerrar
                      </button>
                    )}
                  </div>
                </div>

                {pollMsg && <p style={{ padding: 'var(--s3) var(--s5)', fontFamily: 'var(--font-cond)', fontSize: 13, color: pollMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>{pollMsg}</p>}

                <div style={{ padding: 'var(--s4) var(--s5)' }}>
                  <div style={{ display: 'flex', gap: 'var(--s6)', marginBottom: 'var(--s5)', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Votos', value: poll.total_votes },
                      { label: 'Usuários', value: poll.total_users },
                      { label: 'Participação', value: poll.total_users > 0 ? `${Math.round(poll.total_votes / poll.total_users * 100)}%` : '0%' },
                      { label: 'Sugestões', value: poll.suggestion_count },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, color: 'var(--accent)', lineHeight: 1 }}>{value}</div>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>{label}</div>
                      </div>
                    ))}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.4 }}>
                        {poll.opens_at ? new Date(poll.opens_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'} →{' '}
                        {poll.closes_at ? new Date(poll.closes_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}
                      </div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>Período</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
                    {poll.options.map((opt, i) => {
                      const maxCount = Math.max(...poll.options.map(o => o.count), 1)
                      const isWinner = opt.count === maxCount && opt.count > 0
                      return (
                        <div key={opt.id}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: isWinner ? 'var(--win)' : 'var(--text-1)', fontWeight: isWinner ? 700 : 400 }}>
                              {isWinner && '🏆 '}{opt.label}
                            </span>
                            <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: 'var(--text-2)', whiteSpace: 'nowrap', marginLeft: 'var(--s3)' }}>
                              {opt.count} votos · {opt.pct}%
                            </span>
                          </div>
                          <div style={{ height: 10, background: 'var(--bg-overlay)', borderRadius: 5, overflow: 'hidden' }}>
                            <div style={{
                              width: `${opt.pct}%`, height: '100%', borderRadius: 5, transition: 'width 500ms',
                              background: isWinner ? 'var(--win)' : 'var(--accent)',
                            }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="adm-card" style={{ marginTop: 'var(--s4)' }}>
                <div className="adm-card__head">
                  <span className="adm-card__title">Sugestões ({poll.suggestion_count})</span>
                  <button className="btn btn-ghost btn-sm" onClick={loadSuggestions} disabled={suggestionsLoading}>
                    {suggestionsLoading ? '⏳' : 'Carregar'}
                  </button>
                </div>
                {suggestions === null && !suggestionsLoading && (
                  <p style={{ padding: 'var(--s4) var(--s5)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Clique em "Carregar" para ver as sugestões dos usuários.</p>
                )}
                {suggestionsLoading && <p style={{ padding: 'var(--s4) var(--s5)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando...</p>}
                {suggestions?.length === 0 && <p style={{ padding: 'var(--s4) var(--s5)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Nenhuma sugestão enviada.</p>}
                {suggestions?.length > 0 && (
                  <div style={{ padding: '0 var(--s5) var(--s4)' }}>
                    {suggestions.map((s, i) => (
                      <div key={i} style={{ borderBottom: '1px solid var(--border)', padding: 'var(--s3) 0', display: 'flex', gap: 'var(--s3)', alignItems: 'flex-start' }}>
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', minWidth: 24 }}>#{i + 1}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)', margin: 0 }}>{s.suggestion}</p>
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginTop: 4 }}>
                            user #{s.user_id} · opção #{s.option_id} · {s.updated_at ? new Date(s.updated_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Versões ─────────────────────────────── */}
      {tab === 'versions' && (
        <div className="adm-pane fade-in-1">
          {/* Form: Nova versão */}
          <div className="adm-card" style={{ marginBottom: 'var(--s4)' }}>
            <div className="adm-card__head"><span className="adm-card__title">Nova versão</span></div>
            <div style={{ padding: 'var(--s4)', display: 'grid', gap: 'var(--s3)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 'var(--s3)' }}>
                <div>
                  <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>VERSÃO</label>
                  <input
                    className="form-input"
                    placeholder="ex: 1.5.0"
                    value={vForm.version}
                    onChange={e => setVForm(f => ({ ...f, version: e.target.value }))}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>TÍTULO DA ATUALIZAÇÃO</label>
                  <input
                    className="form-input"
                    placeholder="ex: Forma recente das seleções"
                    value={vForm.title}
                    onChange={e => setVForm(f => ({ ...f, title: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>DESCRIÇÃO (opcional)</label>
                <input
                  className="form-input"
                  placeholder="Breve descrição da melhoria"
                  value={vForm.description}
                  onChange={e => setVForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', display: 'block', marginBottom: 4 }}>MUDANÇAS (uma por linha)</label>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder={"Últimos jogos das seleções no painel de apostas\nFiltros por período no engajamento\nBadge de resultado no dashboard"}
                  value={vForm.changes}
                  onChange={e => setVForm(f => ({ ...f, changes: e.target.value }))}
                  style={{ resize: 'vertical', fontFamily: 'var(--font-cond)', fontSize: 13 }}
                />
              </div>
              {versionMsg && (
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: versionMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)', margin: 0 }}>{versionMsg}</p>
              )}
              <button className="btn btn-primary btn-sm" style={{ width: 'fit-content' }} onClick={createVersion}>
                + Registrar versão
              </button>
            </div>
          </div>

          {/* Histórico */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Histórico de versões</span>
              <button className="btn btn-ghost btn-sm" onClick={loadVersions}>↻</button>
            </div>
            {versionsLoading && <p style={{ padding: 'var(--s4)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando...</p>}
            {!versionsLoading && versions?.length === 0 && (
              <p style={{ padding: 'var(--s4)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Nenhuma versão registrada.</p>
            )}
            {versions?.map((v, i) => (
              <div key={v.id} style={{
                padding: 'var(--s4) var(--s5)',
                borderBottom: i < versions.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s3)', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--accent)', background: 'rgba(15,122,120,0.12)', border: '1px solid rgba(15,122,120,0.25)', padding: '2px 8px', borderRadius: 4 }}>
                        v{v.version}
                      </span>
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{v.title}</span>
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                        {v.created_at ? new Date(v.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                      </span>
                    </div>
                    {v.description && (
                      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', margin: '0 0 6px' }}>{v.description}</p>
                    )}
                    {v.changes?.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18, listStyle: 'none' }}>
                        {v.changes.map((c, j) => (
                          <li key={j} style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 2 }}>
                            <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}>›</span>{c}
                          </li>
                        ))}
                      </ul>
                    )}
                    {v.notified_at && (
                      <div style={{ marginTop: 6, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--win)' }}>
                        ✓ Notificado em {new Date(v.notified_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s2)', flexShrink: 0, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => window.open('/changelog', '_blank')}
                    >
                      🔗 Compartilhar
                    </button>
                    {!v.notified_at && (
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--accent)' }}
                        onClick={() => notifyVersion(v.id)}
                      >
                        🔔 Notificar usuários
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Ícone PWA ───────────────────────────── */}
      {tab === 'pwa' && (
        <div className="adm-pane fade-in-1">
          {iconEditorSrc && (
            <ImageEditorModal
              src={iconEditorSrc}
              loading={iconUploading}
              onConfirm={saveIcon}
              onClose={() => { setIconEditorSrc(null); setIconMsg('') }}
            />
          )}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Ícone — PWA, favicon e logo</span>
            </div>
            <div style={{ padding: 'var(--s5)', display: 'grid', gap: 'var(--s5)' }}>

              {/* Previews */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s5)', flexWrap: 'wrap' }}>
                {[
                  { label: 'PWA 192px', size: 96, radius: 20, src: `/icon-192.png?t=${iconTimestamp}` },
                  { label: 'iOS 180px', size: 80, radius: 18, src: `/apple-touch-icon.png?t=${iconTimestamp}` },
                  { label: 'Favicon 32px', size: 48, radius: 6, src: `/favicon-32x32.png?t=${iconTimestamp}` },
                  { label: 'Favicon 16px', size: 32, radius: 4, src: `/favicon-16x16.png?t=${iconTimestamp}` },
                ].map(({ label, size, radius, src }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <p style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</p>
                    <img src={src} alt={label}
                      style={{ width: size, height: size, borderRadius: radius, border: '1px solid var(--border)', display: 'block', background: 'var(--bg-2)' }} />
                  </div>
                ))}
                {iconPreview && (
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.06em', marginBottom: 6 }}>✓ NOVO</p>
                    <img src={iconPreview} alt="Novo ícone"
                      style={{ width: 96, height: 96, borderRadius: 20, border: '2px solid var(--accent)', display: 'block' }} />
                  </div>
                )}
              </div>

              {/* Arquivos gerados */}
              <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '10px 14px' }}>
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', margin: 0, lineHeight: 1.7 }}>
                  Um upload gera automaticamente:{' '}
                  {['icon-192.png', 'apple-touch-icon.png', 'favicon-32x32.png', 'favicon-16x16.png', 'favicon.ico'].map((f, i, arr) => (
                    <span key={f}>
                      <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{f}</code>
                      {i < arr.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </p>
              </div>

              {/* Ações */}
              <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: 'var(--accent)', color: 'var(--on-accent)',
                  fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13,
                  padding: '10px 20px', borderRadius: 8,
                  cursor: iconUploading ? 'wait' : 'pointer', opacity: iconUploading ? 0.7 : 1,
                }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={openIconEditor} disabled={iconUploading} />
                  ✂️ Selecionar e editar imagem
                </label>

                <a href={`/icon-192.png?t=${iconTimestamp}`} download="icon-192.png"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'var(--bg-2)', color: 'var(--text-2)',
                    fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 13,
                    padding: '10px 20px', borderRadius: 8, textDecoration: 'none',
                    border: '1px solid var(--border)',
                  }}>
                  ⬇ Baixar modelo atual
                </a>
              </div>

              {iconMsg && (
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, margin: 0,
                  color: iconMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                  {iconMsg}
                </p>
              )}

              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', margin: 0 }}>
                Após salvar, remova e adicione o app novamente na tela inicial para o iOS limpar o cache do ícone.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Mata-Mata ───────────────────────────── */}
      {tab === 'knockout' && (
        <div className="adm-pane fade-in-1">
          {knockoutMsg && (
            <div className="adm-feedback" style={{ color: knockoutMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)', marginBottom: 'var(--s4)' }}>
              {knockoutMsg}
            </div>
          )}

          {/* Sync + criar */}
          <div className="adm-pane--two-col" style={{ gap: 'var(--s5)', marginBottom: 'var(--s5)' }}>

            {/* Sincronizar */}
            <div className="adm-card">
              <div className="adm-card__head"><span className="adm-card__title">Sincronizar via Wikipedia</span></div>
              <div style={{ padding: 'var(--s5)' }}>
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
                  Busca o calendário oficial do mata-mata e tenta resolver os times pelas classificações dos grupos.
                </p>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={syncKnockout}
                  disabled={knockoutSyncing}
                >
                  {knockoutSyncing ? '⏳ Sincronizando...' : '🔄 Sincronizar Agora'}
                </button>
              </div>
            </div>

            {/* Criar manual */}
            <div className="adm-card">
              <div className="adm-card__head"><span className="adm-card__title">Criar Partida Manual</span></div>
              <form onSubmit={createKnockoutMatch} style={{ padding: 'var(--s5)', display: 'grid', gap: 'var(--s3)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
                  <select
                    className="form-input"
                    value={knockoutForm.phase}
                    onChange={e => setKnockoutForm(f => ({ ...f, phase: e.target.value }))}
                  >
                    {Object.entries(PHASE_LABELS_ADMIN).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input
                    className="form-input"
                    placeholder="Nº da partida"
                    value={knockoutForm.match_number}
                    onChange={e => setKnockoutForm(f => ({ ...f, match_number: e.target.value }))}
                  />
                </div>
                <select
                  className="form-input"
                  value={knockoutForm.team_a_id}
                  onChange={e => setKnockoutForm(f => ({ ...f, team_a_id: e.target.value }))}
                  required
                >
                  <option value="">Time A</option>
                  {allTeams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                </select>
                <select
                  className="form-input"
                  value={knockoutForm.team_b_id}
                  onChange={e => setKnockoutForm(f => ({ ...f, team_b_id: e.target.value }))}
                  required
                >
                  <option value="">Time B</option>
                  {allTeams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                </select>
                <input
                  className="form-input"
                  type="datetime-local"
                  value={knockoutForm.match_date}
                  onChange={e => setKnockoutForm(f => ({ ...f, match_date: e.target.value }))}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
                  <input className="form-input" placeholder="Estádio" value={knockoutForm.venue} onChange={e => setKnockoutForm(f => ({ ...f, venue: e.target.value }))} />
                  <input className="form-input" placeholder="Cidade" value={knockoutForm.city} onChange={e => setKnockoutForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <button type="submit" className="btn btn-primary btn-sm">➕ Criar</button>
              </form>
            </div>
          </div>

          {/* Lista de partidas */}
          <div className="adm-card">
            <div className="adm-card__head"><span className="adm-card__title">Partidas Mata-Mata</span></div>
            {knockoutLoading && <div style={{ padding: 'var(--s5)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>Carregando...</div>}
            {!knockoutLoading && knockoutMatches?.length === 0 && (
              <div style={{ padding: 'var(--s5)', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                Nenhuma partida criada ainda. Use "Sincronizar" ou "Criar Manual".
              </div>
            )}
            {!knockoutLoading && knockoutMatches?.length > 0 && (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Nº</th><th>Fase</th><th>Time A</th><th>Time B</th><th>Data (BRT)</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {knockoutMatches.map(m => (
                      <tr key={m.id}>
                        <td style={{ fontFamily: 'var(--font-data)', fontSize: 12 }}>{m.match_number || '—'}</td>
                        <td><span className="badge badge-knockout">{m.phase_label}</span></td>
                        <td style={{ fontFamily: 'var(--font-cond)', fontWeight: 600 }}>{m.team_a ? `${m.team_a.code}` : <span style={{ color: 'var(--lose)' }}>Pendente</span>}</td>
                        <td style={{ fontFamily: 'var(--font-cond)', fontWeight: 600 }}>{m.team_b ? `${m.team_b.code}` : <span style={{ color: 'var(--lose)' }}>Pendente</span>}</td>
                        <td style={{ fontFamily: 'var(--font-data)', fontSize: 11 }}>{m.match_date ? new Date(m.match_date + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'}</td>
                        <td><span style={{ color: m.status === 'finished' ? 'var(--win)' : m.status === 'live' ? 'var(--amber)' : 'var(--text-3)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{m.status}</span></td>
                        <td>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => { setEditMatch(m); setEditForm({ team_a_id: m.team_a?.id || '', team_b_id: m.team_b?.id || '', match_date: m.match_date ? m.match_date.slice(0, 16) : '', venue: m.venue || '', city: m.city || '' }) }}
                          >✏️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Bônus Campeão/Vice */}
          <div className="adm-card" style={{ marginTop: 'var(--s5)' }}>
            <div className="adm-card__head"><span className="adm-card__title">🏆 Bônus Campeão / Vice-Campeão</span></div>
            <div style={{ padding: 'var(--s5)' }}>
              {awardMsg && (
                <div className="adm-feedback" style={{ color: awardMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)', marginBottom: 'var(--s4)' }}>
                  {awardMsg}
                </div>
              )}
              {awardStatus?.awarded ? (
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--win)' }}>
                  ✓ Bônus já creditado em {awardStatus.awarded_at ? new Date(awardStatus.awarded_at + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}
                  <br />🏆 {awardStatus.champion?.name} — {awardStatus.champion_users} usuário(s) +100pts
                  <br />🥈 {awardStatus.runner_up?.name} — {awardStatus.runner_up_users} usuário(s) +50pts
                </div>
              ) : (
                <form onSubmit={submitAward} style={{ display: 'grid', gap: 'var(--s3)', maxWidth: 360 }}>
                  <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
                    Credita +100pts para quem acertou o campeão e +50pts para quem acertou o vice. Operação irreversível.
                  </p>
                  <select className="form-input" value={awardForm.champion_team_id} onChange={e => setAwardForm(f => ({ ...f, champion_team_id: e.target.value }))} required>
                    <option value="">🏆 Selecione o Campeão</option>
                    {allTeams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                  </select>
                  <select className="form-input" value={awardForm.runner_up_team_id} onChange={e => setAwardForm(f => ({ ...f, runner_up_team_id: e.target.value }))} required>
                    <option value="">🥈 Selecione o Vice-Campeão</option>
                    {allTeams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                  </select>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={awarding}>
                    {awarding ? '⏳ Creditando...' : '🏆 Creditar Bônus'}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Palpites de Campeão — admin view */}
          {champAllPicks && (
            <div className="adm-card" style={{ marginTop: 'var(--s5)' }}>
              <div className="adm-card__head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="adm-card__title">🏆 Palpites de Campeão — {champAllPicks.length} participante{champAllPicks.length !== 1 ? 's' : ''}</span>
                <button className="btn btn-ghost btn-sm" onClick={loadChampPicks} style={{ fontSize: 11 }}>↻ Atualizar</button>
              </div>

              {/* Estatísticas */}
              {champStats && (
                <div style={{ padding: 'var(--s4) var(--s5)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)' }}>
                    {[
                      { label: '🏆 Campeão — distribuição', data: champStats.champion },
                      { label: '🥈 Vice — distribuição',    data: champStats.runner_up },
                    ].map(({ label, data }) => (
                      <div key={label}>
                        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 8 }}>{label.toUpperCase()}</p>
                        {(data || []).slice(0, 8).map(s => (
                          <div key={s.team_id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                            <img src={s.flag} alt={s.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} />
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600, color: 'var(--text-1)', minWidth: 32 }}>{s.code}</span>
                            <div style={{ flex: 1, height: 6, background: 'var(--bg-overlay)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${s.pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', minWidth: 42, textAlign: 'right' }}>{s.pct}% ({s.count})</span>
                          </div>
                        ))}
                        {!(data?.length) && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Sem palpites ainda</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Lista completa */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Participante', '🏆 Campeão', '🥈 Vice-Campeão'].map(h => (
                        <th key={h} style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.08em', textAlign: 'left', padding: '8px 16px', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {champAllPicks.map((p, i) => (
                      <tr key={p.user_id} style={{ borderBottom: i < champAllPicks.length - 1 ? '1px solid var(--border)' : 'none' }}>
                        <td style={{ padding: '9px 16px', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>{p.user_name}</td>
                        <td style={{ padding: '9px 16px' }}>
                          {p.champion ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <img src={p.champion.flag} alt={p.champion.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} />
                              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600 }}>{p.champion.name}</span>
                            </div>
                          ) : <span style={{ fontSize: 11, color: 'var(--text-4)' }}>não escolheu</span>}
                        </td>
                        <td style={{ padding: '9px 16px' }}>
                          {p.runner_up ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <img src={p.runner_up.flag} alt={p.runner_up.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} />
                              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600 }}>{p.runner_up.name}</span>
                            </div>
                          ) : <span style={{ fontSize: 11, color: 'var(--text-4)' }}>não escolheu</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Edit modal */}
          {editMatch && (
            <div className="modal-backdrop" onClick={() => setEditMatch(null)}>
              <div className="modal-box" onClick={e => e.stopPropagation()}>
                <div className="modal-box__head">
                  <span>Editar Partida #{editMatch.id}</span>
                  <button onClick={() => setEditMatch(null)}>✕</button>
                </div>
                <form onSubmit={saveEditMatch} style={{ display: 'grid', gap: 'var(--s3)', padding: 'var(--s5)' }}>
                  <select className="form-input" value={editForm.team_a_id} onChange={e => setEditForm(f => ({ ...f, team_a_id: e.target.value }))}>
                    <option value="">Time A</option>
                    {allTeams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                  </select>
                  <select className="form-input" value={editForm.team_b_id} onChange={e => setEditForm(f => ({ ...f, team_b_id: e.target.value }))}>
                    <option value="">Time B</option>
                    {allTeams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
                  </select>
                  <input className="form-input" type="datetime-local" value={editForm.match_date} onChange={e => setEditForm(f => ({ ...f, match_date: e.target.value }))} />
                  <input className="form-input" placeholder="Estádio" value={editForm.venue} onChange={e => setEditForm(f => ({ ...f, venue: e.target.value }))} />
                  <input className="form-input" placeholder="Cidade" value={editForm.city} onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 'var(--s3)' }}>
                    <button type="submit" className="btn btn-primary btn-sm">✓ Salvar</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditMatch(null)}>Cancelar</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Engajamento ─────────────────────────── */}
      {tab === 'engagement' && (
        <div className="adm-pane fade-in-1">

          {/* Period selector */}
          <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
            {[
              { id: 'today', label: 'Hoje' },
              { id: '7d',    label: '7 dias' },
              { id: '30d',   label: '30 dias' },
              { id: 'all',   label: 'Tudo' },
            ].map(p => (
              <button
                key={p.id}
                className={`btn btn-sm ${engPeriod === p.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => loadEngagement(p.id)}
                disabled={engagementLoading}
              >{p.label}</button>
            ))}
            {engagementLoading && <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>Carregando...</span>}
            {!engagementLoading && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => loadEngagement(engPeriod)}>↻</button>}
          </div>

          {!engagementLoading && engagement && (() => {
            const s   = engagement.summary
            const seg = engSegment
            const segUsers = {
              period:   engagement.bettors_period,
              never:    engagement.never_bet,
              inactive: engagement.inactive,
              top:      engagement.top_bettors,
            }
            const segList = seg ? (segUsers[seg] || []) : []

            function UserRow({ u, extra }) {
              return (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--s2) var(--s4)', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--font-cond)' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{u.name}</span>
                    {u.username && <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>@{u.username}</span>}
                    <span style={{ color: 'var(--text-3)', marginLeft: 6, fontSize: 11 }}>{u.email}</span>
                  </div>
                  {extra && <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{extra}</span>}
                </div>
              )
            }

            const periodLabel = engagement.period_label || engPeriod
            const KPIS = [
              { label: 'Total usuários',            val: s.total_users,      seg: null,       color: 'var(--text-1)' },
              { label: `Ativos — ${periodLabel}`,   val: s.bettors_period,   seg: 'period',   color: 'var(--win)' },
              { label: `Palpites — ${periodLabel}`, val: s.bets_period,      seg: null,       color: 'var(--accent)' },
              { label: 'Apostaram hoje',            val: s.bettors_today,    seg: null,       color: 'var(--accent)' },
              { label: 'Nunca apostaram',           val: s.never_bet,        seg: 'never',    color: 'var(--lose)' },
              { label: 'Views hoje',                val: s.page_views_today, seg: null,       color: 'var(--amber)' },
            ]

            return (
              <>
                {/* Most engaged hero */}
                {engagement.most_engaged && (
                  <div className="adm-card" style={{ marginBottom: 'var(--s4)', background: 'linear-gradient(135deg, rgba(15,122,120,0.12) 0%, rgba(15,122,120,0.04) 100%)', border: '1px solid rgba(15,122,120,0.3)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--s4)' }}>
                      <div>
                        <div style={{ fontSize: 10, fontFamily: 'var(--font-cond)', color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 4 }}>🏆 MAIS ENGAJADO — {periodLabel.toUpperCase()}</div>
                        <div style={{ fontSize: 20, fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>{engagement.most_engaged.name}</div>
                        {engagement.most_engaged.username && <div style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>@{engagement.most_engaged.username}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--s5)', textAlign: 'center' }}>
                        <div>
                          <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', color: 'var(--win)', lineHeight: 1 }}>
                            {engagement.most_engaged.current_streak > 0 ? `🔥${engagement.most_engaged.current_streak}` : engagement.most_engaged.max_streak}
                          </div>
                          <div style={{ fontSize: 10, fontFamily: 'var(--font-cond)', color: 'var(--text-3)', letterSpacing: '0.06em' }}>
                            {engagement.most_engaged.current_streak > 0 ? 'DIAS SEGUIDOS' : 'STREAK MÁX'}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 28, fontFamily: 'var(--font-display)', color: 'var(--accent)', lineHeight: 1 }}>{engagement.most_engaged.period_bets}</div>
                          <div style={{ fontSize: 10, fontFamily: 'var(--font-cond)', color: 'var(--text-3)', letterSpacing: '0.06em' }}>PALPITES</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* KPI Strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
                  {KPIS.map(k => (
                    <div
                      key={k.label}
                      className="adm-card"
                      onClick={() => k.seg ? setEngSegment(seg === k.seg ? null : k.seg) : null}
                      style={{ cursor: k.seg ? 'pointer' : 'default', padding: 'var(--s4)', outline: seg === k.seg ? '2px solid var(--accent)' : 'none', transition: 'outline 0.15s' }}
                    >
                      <div style={{ fontSize: 26, fontFamily: 'var(--font-display)', color: k.color, lineHeight: 1 }}>{k.val}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-cond)', color: 'var(--text-3)', marginTop: 4, letterSpacing: '0.04em' }}>{k.label.toUpperCase()}</div>
                      {k.seg && <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>→ ver lista</div>}
                    </div>
                  ))}
                </div>

                {/* Expanded segment */}
                {seg && (
                  <div className="adm-card" style={{ marginBottom: 'var(--s4)' }}>
                    <div className="adm-card__head">
                      <span className="adm-card__title">
                        {seg === 'period'   && `Ativos — ${periodLabel} (${segList.length})`}
                        {seg === 'never'    && `Nunca apostaram (${segList.length})`}
                        {seg === 'inactive' && `Inativos — ${periodLabel} (${segList.length})`}
                        {seg === 'top'      && `Top apostadores — ${periodLabel} (${segList.length})`}
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEngSegment(null)}>✕</button>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {segList.length === 0 && <p style={{ padding: 'var(--s4)', color: 'var(--text-3)', fontSize: 13, fontFamily: 'var(--font-cond)' }}>Nenhum usuário.</p>}
                      {seg === 'period'   && segList.map(u => <UserRow key={u.id} u={u} />)}
                      {seg === 'never'    && segList.map(u => <UserRow key={u.id} u={u} extra={`cadastro: ${u.joined_at ? fmtShort(u.joined_at) : '—'}`} />)}
                      {seg === 'inactive' && segList.map(u => <UserRow key={u.id} u={u} extra={`última aposta há ${u.days_inactive}d · ${u.bets_count} palpites`} />)}
                      {seg === 'top'      && segList.map(u => <UserRow key={u.id} u={u} extra={`${u.bets_count} palpites · ${u.points} pts`} />)}
                    </div>
                  </div>
                )}

                {/* Streaks de dias consecutivos */}
                {engagement.streaks?.length > 0 && (
                  <div className="adm-card" style={{ marginBottom: 'var(--s4)' }}>
                    <div className="adm-card__head">
                      <span className="adm-card__title">🔥 Dias consecutivos com palpites</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>streak atual / recorde</span>
                    </div>
                    <div className="adm-table-wrap">
                      <table className="adm-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Usuário</th>
                            <th className="adm-table__num">🔥 Atual</th>
                            <th className="adm-table__num">🏅 Recorde</th>
                            <th>Último dia ativo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {engagement.streaks.slice(0, 10).map((u, i) => (
                            <tr key={u.id}>
                              <td style={{ color: i < 3 ? 'var(--amber)' : 'var(--text-3)', fontWeight: 700 }}>{i + 1}</td>
                              <td>
                                <div style={{ fontWeight: 600 }}>{u.name}</div>
                                {u.username && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>@{u.username}</div>}
                              </td>
                              <td className="adm-table__num">
                                {u.current_streak > 0
                                  ? <span style={{ color: 'var(--win)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>🔥 {u.current_streak}d</span>
                                  : <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>—</span>
                                }
                              </td>
                              <td className="adm-table__num" style={{ fontFamily: 'var(--font-mono)', color: 'var(--amber)' }}>{u.max_streak}d</td>
                              <td style={{ color: 'var(--text-3)', fontSize: 11 }}>
                                {u.last_active_day ? new Date(u.last_active_day + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Activity series + Inativos */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)', marginBottom: 'var(--s4)' }}>
                  <div className="adm-card">
                    <div className="adm-card__head"><span className="adm-card__title">Apostas — {periodLabel}</span></div>
                    <div style={{ height: 160 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={engagement.activity_series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} tickLine={false} axisLine={false} />
                          <Tooltip contentStyle={{ background: '#0d1b2a', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--font-mono)' }} />
                          <Bar dataKey="bets" name="Apostas" fill="var(--accent)" radius={[3,3,0,0]} />
                          <Area dataKey="unique_users" name="Usuários únicos" stroke="var(--win)" fill="rgba(46,201,128,0.08)" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="adm-card" style={{ cursor: engagement.inactive?.length > 0 ? 'pointer' : 'default' }}
                       onClick={() => engagement.inactive?.length > 0 && setEngSegment(seg === 'inactive' ? null : 'inactive')}>
                    <div className="adm-card__head">
                      <span className="adm-card__title" style={{ color: engagement.inactive?.length > 0 ? 'var(--amber)' : 'var(--text-1)' }}>
                        Inativos — {periodLabel}
                      </span>
                      <span className="badge" style={{ background: 'rgba(232,196,74,0.15)', color: 'var(--amber)' }}>{engagement.inactive?.length ?? '—'}</span>
                    </div>
                    <div style={{ maxHeight: 130, overflowY: 'auto' }}>
                      {(engagement.inactive || []).slice(0, 5).map(u => (
                        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--s1) var(--s4)', fontSize: 12, fontFamily: 'var(--font-cond)', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ color: 'var(--text-2)' }}>{u.name}</span>
                          <span style={{ color: 'var(--text-3)' }}>há {u.days_inactive}d</span>
                        </div>
                      ))}
                      {(engagement.inactive?.length || 0) > 5 && (
                        <div style={{ padding: 'var(--s2) var(--s4)', fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-cond)' }}>
                          + {engagement.inactive.length - 5} mais
                        </div>
                      )}
                      {engPeriod === 'all' && <p style={{ padding: 'var(--s3) var(--s4)', fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>Inativos não se aplica ao modo "Tudo"</p>}
                    </div>
                  </div>
                </div>

                {/* Última / próxima partida */}
                {engagement.last_finished_match && (
                  <div className="adm-card" style={{ marginBottom: 'var(--s4)' }}>
                    <div className="adm-card__head">
                      <div>
                        <span className="adm-card__title">Última partida finalizada</span>
                        <span style={{ marginLeft: 8, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                          {engagement.last_finished_match.label} · G{engagement.last_finished_match.group}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                        <span className="badge badge-win">{engagement.last_finished_match.total_bets} apostas</span>
                        <span className="badge badge-group">{engagement.last_finished_match.coverage_pct}%</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
                      <div>
                        <div style={{ padding: 'var(--s2) var(--s4)', fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-cond)', letterSpacing: '0.06em' }}>APOSTARAM ({engagement.last_finished_match.bettors.length})</div>
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {engagement.last_finished_match.bettors.map(b => (
                            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--s1) var(--s4)', fontSize: 12, fontFamily: 'var(--font-cond)', borderBottom: '1px solid var(--border)' }}>
                              <span style={{ color: 'var(--text-2)' }}>{b.name}</span>
                              <span style={{ color: b.points === 3 ? 'var(--win)' : b.points === 1 ? 'var(--accent)' : b.evaluated ? 'var(--lose)' : 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                                {b.score_a}–{b.score_b} {b.evaluated ? `(${b.points === 3 ? '+3🎯' : b.points === 1 ? '+1✅' : '0❌'})` : '⏳'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ padding: 'var(--s2) var(--s4)', fontSize: 11, color: 'var(--lose)', fontFamily: 'var(--font-cond)', letterSpacing: '0.06em' }}>NÃO APOSTARAM ({engagement.last_finished_match.non_bettors.length})</div>
                        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                          {engagement.last_finished_match.non_bettors.map(u => (
                            <div key={u.id} style={{ padding: 'var(--s1) var(--s4)', fontSize: 12, fontFamily: 'var(--font-cond)', borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>{u.name}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {engagement.next_match && (
                  <div className="adm-card" style={{ marginBottom: 'var(--s4)' }}>
                    <div className="adm-card__head">
                      <div>
                        <span className="adm-card__title">Próxima partida</span>
                        <span style={{ marginLeft: 8, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                          {engagement.next_match.label} · {engagement.next_match.match_date ? fmtShort(engagement.next_match.match_date) : '—'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--s2)' }}>
                        <span className="badge badge-win">{engagement.next_match.total_bets} apostas</span>
                        <span className="badge badge-group">{engagement.next_match.coverage_pct}%</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
                      <div>
                        <div style={{ padding: 'var(--s2) var(--s4)', fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-cond)', letterSpacing: '0.06em' }}>JÁ APOSTARAM ({engagement.next_match.bettors.length})</div>
                        <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                          {engagement.next_match.bettors.map(b => (
                            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--s1) var(--s4)', fontSize: 12, fontFamily: 'var(--font-cond)', borderBottom: '1px solid var(--border)' }}>
                              <span style={{ color: 'var(--text-2)' }}>{b.name}</span>
                              <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{b.score_a}–{b.score_b}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div style={{ padding: 'var(--s2) var(--s4)', fontSize: 11, color: 'var(--amber)', fontFamily: 'var(--font-cond)', letterSpacing: '0.06em' }}>AGUARDANDO PALPITE ({engagement.next_match.non_bettors.length})</div>
                        <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                          {engagement.next_match.non_bettors.map(u => (
                            <div key={u.id} style={{ padding: 'var(--s1) var(--s4)', fontSize: 12, fontFamily: 'var(--font-cond)', borderBottom: '1px solid var(--border)', color: 'var(--text-3)' }}>{u.name}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Top bettors */}
                <div className="adm-card" style={{ cursor: 'pointer' }} onClick={() => setEngSegment(seg === 'top' ? null : 'top')}>
                  <div className="adm-card__head">
                    <span className="adm-card__title">Top Apostadores — {periodLabel}</span>
                    <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-cond)' }}>clique para lista completa</span>
                  </div>
                  <div className="adm-table-wrap">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Nome</th>
                          <th className="adm-table__num">Palpites</th>
                          <th className="adm-table__num">Pts</th>
                          <th>Último</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engagement.top_bettors.slice(0, 8).map((u, i) => (
                          <tr key={u.id}>
                            <td style={{ color: i < 3 ? 'var(--amber)' : 'var(--text-3)', fontWeight: 700 }}>{i + 1}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{u.name}</div>
                              {u.username && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>@{u.username}</div>}
                            </td>
                            <td className="adm-table__num" style={{ fontFamily: 'var(--font-mono)' }}>{u.bets_count}</td>
                            <td className="adm-table__num" style={{ fontFamily: 'var(--font-mono)', color: 'var(--win)' }}>{u.points}</td>
                            <td style={{ color: 'var(--text-3)', fontSize: 11 }}>{u.last_bet_at ? fmtShort(u.last_bet_at) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )
          })()}
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
                      G{match.group_name || '—'} · #{match.match_id} · {match.match_date ? new Date(match.match_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : 'Sem data'}
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
      {/* ── Análises IA ──────────────────────────────────────────────────── */}
      {tab === 'analyses' && (
        <div className="adm-pane">
          {/* Config card */}
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title">🤖 Configuração Provedores IA</span>
            </div>
            <div className="adm-card__body">
              {analysisMsg && (
                <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12,
                  background: analysisMsg.startsWith('✓') ? 'rgba(46,201,128,0.12)' : 'rgba(232,82,82,0.12)',
                  color: analysisMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)',
                  fontFamily: 'var(--font-cond)', fontSize: 13,
                }}>
                  {analysisMsg}
                </div>
              )}
              <form onSubmit={saveAnalysisConfig} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Provider selector */}
                <div>
                  <label style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', display: 'block', marginBottom: 6 }}>PROVEDOR ATIVO</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[{ id: 'openrouter', label: '🔀 OpenRouter (free)' }, { id: 'gemini', label: '✦ Gemini (Google)' }].map(p => (
                      <button type="button" key={p.id}
                        onClick={() => setAForm(f => ({ ...f, provider: p.id }))}
                        style={{
                          flex: 1, padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                          fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13,
                          border: `2px solid ${aForm.provider === p.id ? 'var(--accent)' : 'var(--border)'}`,
                          background: aForm.provider === p.id ? 'rgba(15,122,120,0.12)' : 'var(--bg-overlay)',
                          color: aForm.provider === p.id ? 'var(--accent)' : 'var(--text-3)',
                        }}
                      >{p.label}</button>
                    ))}
                  </div>
                </div>

                {/* OpenRouter section */}
                <div style={{ border: `1px solid ${aForm.provider === 'openrouter' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 10 }}>
                    🔀 OPENROUTER
                    {analysisConfig?.openrouter_has_key && <span style={{ color: 'var(--win)', marginLeft: 8 }}>✓ key: {analysisConfig.openrouter_key_masked}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input type="password"
                      placeholder={analysisConfig?.openrouter_has_key ? '••• (vazio = manter)' : 'sk-or-v1-...'}
                      value={aForm.openrouter_key}
                      onChange={e => setAForm(f => ({ ...f, openrouter_key: e.target.value }))}
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%' }}
                    />
                    <select value={aForm.openrouter_model} onChange={e => setAForm(f => ({ ...f, openrouter_model: e.target.value }))}
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                      {(analysisConfig?.openrouter_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Gemini section */}
                <div style={{ border: `1px solid ${aForm.provider === 'gemini' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 10 }}>
                    ✦ GEMINI (GOOGLE AI)
                    {analysisConfig?.gemini_has_key && <span style={{ color: 'var(--win)', marginLeft: 8 }}>✓ key: {analysisConfig.gemini_key_masked}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input type="password"
                      placeholder={analysisConfig?.gemini_has_key ? '••• (vazio = manter)' : 'AIzaSy...'}
                      value={aForm.gemini_key}
                      onChange={e => setAForm(f => ({ ...f, gemini_key: e.target.value }))}
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%' }}
                    />
                    <select value={aForm.gemini_model} onChange={e => setAForm(f => ({ ...f, gemini_model: e.target.value }))}
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                      {(analysisConfig?.gemini_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" disabled={analysisSaving} type="submit">
                    {analysisSaving ? 'Salvando…' : '💾 Salvar'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { loadAnalysisConfig(); loadAnalysisStatus() }}>↻ Atualizar</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={generateAll} disabled={generatingAll}>
                    {generatingAll ? 'Iniciando…' : '⚡ Gerar todas pendentes'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Status table */}
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title">📋 Partidas — Status das Análises</span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>
                {analysisStatus ? `${analysisStatus.filter(r => r.has_analysis).length}/${analysisStatus.length} geradas` : ''}
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="adm-table" style={{ minWidth: 600 }}>
                <thead>
                  <tr>
                    <th>Partida</th>
                    <th>Data</th>
                    <th>Fase</th>
                    <th>Status</th>
                    <th>Modelo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisStatus || []).map(r => (
                    <tr key={r.match_id}>
                      <td style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {r.team_a_code} × {r.team_b_code}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                        {r.match_date ? new Date(r.match_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'}
                      </td>
                      <td>
                        <span className="badge badge-group" style={{ fontSize: 10 }}>{r.phase}</span>
                      </td>
                      <td>
                        {r.has_analysis
                          ? <span style={{ color: 'var(--win)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>✓ gerada</span>
                          : <span style={{ color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 12 }}>pendente</span>
                        }
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.model_used?.split('/').pop() || '—'}
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                          disabled={generatingId === r.match_id || !analysisConfig?.has_key}
                          onClick={() => generateOne(r.match_id)}
                        >
                          {generatingId === r.match_id ? '…' : r.has_analysis ? '↻' : '⚡'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Chart sub-components ────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip__label">{label}</div>
      {payload.filter(p => !p.hide).map(p => (
        <div key={p.dataKey} className="chart-tip__row">
          <span className="chart-tip__dot" style={{ background: p.color }} />
          <span className="chart-tip__name">{p.name}</span>
          <span className="chart-tip__val">{Number(p.value).toLocaleString('pt-BR')}</span>
        </div>
      ))}
    </div>
  )
}

function ChartLegend({ payload, hiddenSeries, onToggle }) {
  if (!payload?.length) return null
  return (
    <div className="chart-legend">
      {payload.map(entry => {
        const hidden = hiddenSeries[entry.dataKey]
        return (
          <button
            key={entry.dataKey}
            className={`chart-legend__item${hidden ? ' chart-legend__item--off' : ''}`}
            onClick={() => onToggle(entry.dataKey)}
          >
            <span className="chart-legend__dot" style={{ background: hidden ? 'var(--text-4)' : entry.color }} />
            {entry.value}
          </button>
        )
      })}
    </div>
  )
}

function GrowthChart({ title, subtitle, data, barKey, barName, barGrad, barColor, areaKey, areaName, areaColor, hiddenSeries, onToggle, emptyMsg }) {
  const gradAreaId = `${barGrad}-area`
  return (
    <div className="adm-chart-card">
      <div className="adm-chart-card__head">
        <div>
          <div className="adm-chart-card__title">{title}</div>
          <div className="adm-chart-card__sub">{subtitle}</div>
        </div>
      </div>

      {!data?.length ? (
        <div className="adm-table__empty">{emptyMsg}</div>
      ) : (
        <div className="adm-chart-body">
          <ChartLegend
            payload={[
              { dataKey: barKey,  value: barName,  color: barColor  },
              { dataKey: areaKey, value: areaName, color: areaColor },
            ]}
            hiddenSeries={hiddenSeries}
            onToggle={onToggle}
          />
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id={barGrad} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={barColor}  stopOpacity={0.9} />
                  <stop offset="100%" stopColor={barColor}  stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id={gradAreaId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={areaColor} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={areaColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                vertical={false}
                stroke="rgba(41,75,107,0.1)"
                strokeDasharray="0"
              />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fill: '#5f7790' }}
                dy={8}
              />
              <YAxis
                yAxisId="bar"
                axisLine={false}
                tickLine={false}
                tick={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fill: '#5f7790' }}
                width={36}
              />
              <YAxis
                yAxisId="area"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={false}
                width={0}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: 'rgba(41,75,107,0.06)' }}
              />

              <Bar
                yAxisId="bar"
                dataKey={barKey}
                name={barName}
                fill={`url(#${barGrad})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
                hide={hiddenSeries[barKey]}
                isAnimationActive
              />
              <Area
                yAxisId="area"
                dataKey={areaKey}
                name={areaName}
                stroke={areaColor}
                strokeWidth={2.5}
                fill={`url(#${gradAreaId})`}
                dot={false}
                activeDot={{ r: 5, fill: areaColor, stroke: 'var(--bg-overlay)', strokeWidth: 2 }}
                hide={hiddenSeries[areaKey]}
                isAnimationActive
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
