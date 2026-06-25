import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { toPng } from 'html-to-image'
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

function TgIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#229ED9" style={{ verticalAlign: '-3px' }} aria-label="Telegram">
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
    </svg>
  )
}

const TABS = [
  { id: 'growth',      label: 'Crescimento',  icon: '📈' },
  { id: 'engagement',  label: 'Engajamento',  icon: '🔥' },
  { id: 'users',       label: 'Usuários',     icon: '👥' },
  { id: 'grupos',      label: 'Grupos',       icon: '👫' },
  { id: 'results',     label: 'Resultados',   icon: '⚽' },
  { id: 'sync',        label: 'Sincronização', icon: '🔄' },
  { id: 'bets',        label: 'Apostas',      icon: '🎯' },
  { id: 'coverage',    label: 'Cobertura',    icon: '📋' },
  { id: 'poll',        label: 'Pesquisa',     icon: '📊' },
  { id: 'versions',   label: 'Versões',      icon: '🔖' },
  { id: 'pwa',        label: 'Ícone PWA',    icon: '🖼' },
  { id: 'knockout',   label: 'Mata-Mata',    icon: '⚔️' },
  { id: 'analyses',   label: 'Análises IA',  icon: '🤖' },
  { id: 'bot',        label: 'Oráculo Predictor', icon: '🔮' },
  { id: 'report',     label: 'Relatório',    icon: <TgIcon size={20} /> },
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
  const [betsTotal, setBetsTotal] = useState(0)
  const [betsLoading, setBetsLoading] = useState(false)
  const [betFilters, setBetFilters] = useState({ user: '', match_id: '', status: '', date_from: '', date_to: '' })
  const [userSuggest, setUserSuggest] = useState([])
  const [showSuggest, setShowSuggest] = useState(false)
  const suggestTimer = useRef(null)

  function onUserType(value) {
    setBetFilters(f => ({ ...f, user: value }))
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    const term = value.trim()
    if (term.length < 2) { setUserSuggest([]); setShowSuggest(false); return }
    suggestTimer.current = setTimeout(async () => {
      try {
        const rows = await api.get(`/admin/users?q=${encodeURIComponent(term)}&limit=8`, token)
        setUserSuggest(rows || [])
        setShowSuggest(true)
      } catch { setUserSuggest([]) }
    }, 250)
  }

  function pickUser(u) {
    setBetFilters(f => ({ ...f, user: u.name || u.email }))
    setShowSuggest(false)
    setUserSuggest([])
    loadBets({ ...betFilters, user: String(u.id) })
  }

  // ── Exportar / compartilhar apostas ──────────────────────────
  const betsExportRef = useRef(null)
  const [betsExportMsg, setBetsExportMsg] = useState('')

  function _sitLabel(r) {
    return r === 'exact' ? '🎯 Placar exato' : r === 'correct' ? '✅ Acertou' : r === 'wrong' ? '❌ Errou' : '⏳ Pendente'
  }

  function _betsText() {
    if (!allBets?.length) return ''
    const head = '🏆 Apostas — predicts.info\n' + (betsTotal ? `${allBets.length}/${betsTotal} apostas\n` : '')
    const lines = allBets.map(b => {
      const real = b.result_a != null ? `${b.result_a}-${b.result_b}` : '—'
      const pts = b.result === 'pending' ? '' : ` (+${b.points_earned})`
      return `• ${b.user_name || b.user_email?.split('@')[0]} | ${b.team_a}×${b.team_b} | palpite ${b.score_a}-${b.score_b} · real ${real} | ${_sitLabel(b.result)}${pts}`
    })
    return head + '\n' + lines.join('\n')
  }

  async function _toPng() {
    const node = betsExportRef.current
    if (!node) return null
    const bg = getComputedStyle(document.body).backgroundColor || '#0f1115'
    const w = node.scrollWidth
    const h = node.scrollHeight
    return toPng(node, {
      backgroundColor: bg,
      pixelRatio: 2,
      cacheBust: true,
      width: w,
      height: h,
      style: { overflow: 'visible', width: `${w}px`, height: `${h}px`, maxHeight: 'none' },
    })
  }

  async function exportBetsImage() {
    setBetsExportMsg('Gerando…')
    try {
      const url = await _toPng()
      const a = document.createElement('a')
      a.href = url
      a.download = `apostas-${new Date().toISOString().slice(0, 10)}.png`
      a.click()
      setBetsExportMsg('✓ Imagem baixada')
    } catch { setBetsExportMsg('Erro ao gerar imagem') }
    setTimeout(() => setBetsExportMsg(''), 3000)
  }

  async function copyBetsImage() {
    setBetsExportMsg('Copiando…')
    try {
      const url = await _toPng()
      const blob = await (await fetch(url)).blob()
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })])
      setBetsExportMsg('✓ Imagem copiada — cole no WhatsApp')
    } catch {
      try { await navigator.clipboard.writeText(_betsText()); setBetsExportMsg('✓ Texto copiado (imagem indisponível)') }
      catch { setBetsExportMsg('Erro ao copiar') }
    }
    setTimeout(() => setBetsExportMsg(''), 3500)
  }

  function shareBetsWhatsApp() {
    const txt = _betsText()
    if (!txt) { setBetsExportMsg('Nada para enviar'); setTimeout(() => setBetsExportMsg(''), 2500); return }
    window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, '_blank')
  }

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
  const [groupsData, setGroupsData] = useState(null)
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [security, setSecurity] = useState(null)
  const [securityLoading, setSecurityLoading] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [groupSort, setGroupSort] = useState({ key: 'members_count', dir: 'desc' })
  const [expandedGroup, setExpandedGroup] = useState(null)
  const [groupMembers, setGroupMembers] = useState({})
  const [membersLoading, setMembersLoading] = useState(null)
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

  // ── Bot / Oráculo Predictor ──────────────────────────────────────────────────
  const [botStatus,       setBotStatus]       = useState(null)
  const [botBets,         setBotBets]         = useState(null)
  const [botLoading,      setBotLoading]      = useState(false)
  const [botMsg,          setBotMsg]          = useState('')
  const [botBetPhase,     setBotBetPhase]     = useState('all')
  const [botBetLoading,   setBotBetLoading]   = useState(false)
  const [botChampLoading, setBotChampLoading] = useState(false)
  const [botLogs,         setBotLogs]         = useState([])
  const [botPredLoading,  setBotPredLoading]  = useState(false)
  const [oracleCfg,       setOracleCfg]       = useState(null)
  const [oracleForm,      setOracleForm]      = useState(null)
  const [oracleSaving,    setOracleSaving]    = useState(false)

  // ── Relatório ────────────────────────────────────────────────────────────────
  const [report,        setReport]        = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportSending, setReportSending] = useState(false)
  const [reportMsg,     setReportMsg]     = useState('')
  const [reportCopied,  setReportCopied]  = useState(false)

  // ── Análises IA ──────────────────────────────────────────────────────────────
  const [analysisConfig, setAnalysisConfig]   = useState(null)
  const [analysisStatus, setAnalysisStatus]   = useState(null)
  const [analysisSaving, setAnalysisSaving]   = useState(false)
  const [analysisMsg, setAnalysisMsg]         = useState('')
  const [generatingId, setGeneratingId]       = useState(null)
  const [generatingAll, setGeneratingAll]     = useState(false)
  const [generatingForce, setGeneratingForce] = useState(false)
  const [analysisLogs, setAnalysisLogs]       = useState(null)
  const [logsLoading, setLogsLoading]         = useState(false)
  const [genProgress, setGenProgress]         = useState(null)
  const [onlyFuture, setOnlyFuture]           = useState(false)
  const analysisMsgTimerRef  = useRef(null)
  const progressIntervalRef  = useRef(null)
  const [viewingAnalysis, setViewingAnalysis] = useState(null)  // { match_id, content, model_used }
  const [promptOpen, setPromptOpen]           = useState(false)
  const [aForm, setAForm] = useState({
    provider: 'openrouter',
    openrouter_key: '', openrouter_model: '',
    gemini_key: '', gemini_key_2: '', gemini_model: '',
    openai_key: '', openai_model: 'gpt-4o-mini',
    prompt_template: '',
  })

  async function fetchProgress() {
    try {
      const data = await api.get('/admin/analysis/progress', token)
      setGenProgress(data)
      if (data.status !== 'running') {
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current)
          progressIntervalRef.current = null
        }
      }
    } catch {}
  }

  function startProgressPolling() {
    fetchProgress()
    if (!progressIntervalRef.current) {
      progressIntervalRef.current = setInterval(fetchProgress, 3000)
    }
  }

  function setAnalysisMsgTimed(msg, ms = 6000) {
    setAnalysisMsg(msg)
    if (analysisMsgTimerRef.current) clearTimeout(analysisMsgTimerRef.current)
    if (msg) analysisMsgTimerRef.current = setTimeout(() => setAnalysisMsg(''), ms)
  }

  async function loadAnalysisConfig() {
    try {
      const cfg = await api.get('/admin/analysis/config', token)
      setAnalysisConfig(cfg)
      setAForm(f => ({
        ...f,
        provider: cfg.provider,
        openrouter_model: cfg.openrouter_model,
        gemini_model: cfg.gemini_model,
        openai_model: cfg.openai_model || 'gpt-4o-mini',
        prompt_template: cfg.prompt_template || '',
      }))
    } catch {}
  }

  async function viewAnalysis(matchId) {
    try {
      const d = await api.get(`/admin/analysis/${matchId}/content`, token)
      setViewingAnalysis({ match_id: matchId, ...d })
    } catch (err) { alert(err.message) }
  }

  async function loadAnalysisStatus() {
    try { setAnalysisStatus(await api.get('/admin/analysis/status', token)) } catch {}
  }

  async function saveAnalysisConfig(e) {
    e.preventDefault()
    setAnalysisSaving(true); setAnalysisMsg('')
    try {
      await api.post('/admin/analysis/config', aForm, token)
      setAnalysisMsgTimed('✓ Configuração salva com sucesso!')
      loadAnalysisConfig()
    } catch(err) { setAnalysisMsgTimed('✗ Erro ao salvar: ' + (err?.message || 'falha')) }
    finally { setAnalysisSaving(false) }
  }

  async function generateOne(matchId) {
    setGeneratingId(matchId); setAnalysisMsg('')
    try {
      await api.post(`/admin/analysis/${matchId}/generate`, {}, token)
      setAnalysisMsgTimed(`✓ Análise gerada — partida #${matchId}`)
      loadAnalysisStatus()
    } catch (err) { setAnalysisMsgTimed(`✗ Erro: ${err?.message || 'falha'}`) }
    finally { setGeneratingId(null) }
  }

  async function generateAll(force = false) {
    if (force) { setGeneratingForce(true) } else { setGeneratingAll(true) }
    setAnalysisMsg('')
    try {
      await api.post('/admin/analysis/generate-all', {
        only_pending: !force,
        only_future: onlyFuture,
      }, token)
      setAnalysisMsgTimed(force
        ? '✓ Regeneração iniciada! Acompanhe o progresso abaixo.'
        : '✓ Geração de pendentes iniciada! Acompanhe o progresso abaixo.')
      setTimeout(startProgressPolling, 500)
    } catch(err) {
      setAnalysisMsgTimed('✗ Erro: ' + (err?.message || 'falha ao iniciar geração'))
    }
    finally { setGeneratingAll(false); setGeneratingForce(false) }
  }

  async function loadAnalysisLogs() {
    setLogsLoading(true)
    try { setAnalysisLogs(await api.get('/admin/analysis/logs?limit=100', token)) }
    catch { setAnalysisLogs(null) }
    finally { setLogsLoading(false) }
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

  async function loadBot() {
    setBotLoading(true)
    try {
      const [status, bets, logs, ocfg] = await Promise.all([
        api.get('/admin/bot/status', token),
        api.get('/admin/bot/bets', token),
        api.get('/admin/bot/logs?limit=80', token).catch(() => ({ items: [] })),
        api.get('/admin/bot/oracle-config', token).catch(() => null),
      ])
      setBotStatus(status)
      setBotBets(bets)
      setBotLogs(logs?.items || [])
      setOracleCfg(ocfg)
      if (ocfg && !oracleForm) setOracleForm({
        provider: ocfg.provider || 'gemini',
        gemini_key: '', gemini_model: ocfg.gemini_model,
        openrouter_key: '', openrouter_model: ocfg.openrouter_model,
        openai_key: '', openai_model: ocfg.openai_model,
      })
    } catch {}
    finally { setBotLoading(false) }
  }

  async function runBotPrediction() {
    setBotPredLoading(true); setBotMsg('')
    try {
      const r = await api.post('/admin/bot/run-prediction', {}, token)
      setBotMsg(`✓ Oráculo: ${r.processed} partida(s) · ${r.changed} alterados · ${r.kept} mantidos · ${r.created} criados · 📲 ${r.telegram_sent} no Telegram (IA: ${r.llm || '—'})`)
      loadBot()
    } catch (e) { setBotMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setBotPredLoading(false) }
  }

  async function saveOracleConfig() {
    setOracleSaving(true); setBotMsg('')
    try {
      await api.post('/admin/bot/oracle-config', oracleForm, token)
      setBotMsg('✓ Configuração do Oráculo salva')
      loadBot()
    } catch (e) { setBotMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setOracleSaving(false) }
  }

  async function createBot() {
    setBotMsg('')
    try {
      const r = await api.post('/admin/bot/create', {}, token)
      setBotMsg(r.status === 'created' ? `✓ Bot criado — ID ${r.user_id}` : '⚠ Bot já existe')
      loadBot()
    } catch (e) { setBotMsg(`✗ ${e?.message || 'erro'}`) }
  }

  async function runBotBet() {
    setBotBetLoading(true); setBotMsg('')
    try {
      const phase = botBetPhase === 'all' ? undefined : botBetPhase
      const qs = phase ? `?phase=${phase}` : ''
      const r = await api.post(`/admin/bot/bet${qs}`, {}, token)
      setBotMsg(`✓ ${r.created} palpites criados · ${r.skipped_exists} já existentes · ${r.skipped_closed} encerradas`)
      loadBot()
    } catch (e) { setBotMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setBotBetLoading(false) }
  }

  async function runBotChampion() {
    setBotChampLoading(true); setBotMsg('')
    try {
      const r = await api.post('/admin/bot/pick-champion', {}, token)
      setBotMsg(`✓ Campeão: ${r.champion?.name} · Vice: ${r.vice?.name} (fonte: ${r.source})`)
      loadBot()
    } catch (e) { setBotMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setBotChampLoading(false) }
  }

  async function loadReport() {
    setReportLoading(true); setReportMsg('')
    try { setReport(await api.get('/admin/daily-report', token)) }
    catch (e) { setReportMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setReportLoading(false) }
  }

  function copyReport() {
    if (!report?.text) return
    navigator.clipboard.writeText(report.text).then(() => {
      setReportCopied(true); setTimeout(() => setReportCopied(false), 2500)
    })
  }

  async function sendReport() {
    setReportSending(true); setReportMsg('')
    try {
      const r = await api.post('/admin/daily-report/send', {}, token)
      setReportMsg(`✓ Enviado! message_id: ${r.message_id}`)
    } catch (e) { setReportMsg(`✗ ${e?.message || 'erro'}`) }
    finally { setReportSending(false) }
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
    if (tab === 'grupos' && !groupsData && !groupsLoading) { loadGroupsAdmin(); loadSecurity() }
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
    if (tab === 'analyses') fetchProgress()
    if (tab === 'bot' && !botStatus && !botLoading) loadBot()
    if (tab === 'report' && !report && !reportLoading) loadReport()
  }, [tab])

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000)
    return () => {
      clearInterval(iv)
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current)
    }
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

  async function loadBets(filters = betFilters) {
    setBetsLoading(true)
    try {
      const p = new URLSearchParams({ limit: '200' })
      if (filters.user)       p.set('user', filters.user)
      if (filters.match_id)   p.set('match_id', filters.match_id)
      if (filters.status)     p.set('status', filters.status)
      if (filters.date_from)  p.set('date_from', filters.date_from)
      if (filters.date_to)    p.set('date_to', filters.date_to)
      const res = await api.get(`/admin/bets/all?${p.toString()}`, token)
      setAllBets(res.bets ?? [])
      setBetsTotal(res.total ?? 0)
    }
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

  async function loadGroupsAdmin() {
    setGroupsLoading(true)
    try { setGroupsData(await api.get('/admin/groups', token)) } catch {}
    finally { setGroupsLoading(false) }
  }

  async function loadSecurity() {
    setSecurityLoading(true)
    try { setSecurity(await api.get('/admin/security-summary', token)) } catch {}
    finally { setSecurityLoading(false) }
  }

  async function toggleGroup(id) {
    if (expandedGroup === id) { setExpandedGroup(null); return }
    setExpandedGroup(id)
    if (!groupMembers[id]) {
      setMembersLoading(id)
      try {
        const data = await api.get(`/admin/groups/${id}/members`, token)
        setGroupMembers(prev => ({ ...prev, [id]: data }))
      } catch {}
      finally { setMembersLoading(null) }
    }
  }

  function sortGroupsBy(key) {
    setGroupSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
    }))
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
          <a href="/apostas"         className="btn btn-ghost btn-sm">🎯 Apostas</a>
          <a href="/resultados"      className="btn btn-ghost btn-sm">📋 Resultados</a>
          <a href="/admin/analytics" className="btn btn-ghost btn-sm">📊 Analytics</a>
          <a href="/admin/analytics?tab=audit" className="btn btn-ghost btn-sm">🔐 Auditoria</a>
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
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <a
                          href={`/usuarios/${u.id}/historico`}
                          className="btn btn-ghost btn-sm"
                          title="Ver apostas deste usuário"
                        >
                          📜 Histórico
                        </a>
                        <button
                          className={`btn btn-sm ${u.role === 'admin' ? 'btn-ghost' : 'btn-primary'}`}
                          disabled={savingUserId === u.id || (u.id === user.id && u.role === 'admin')}
                          onClick={() => updateUserRole(u.id, u.role === 'admin' ? 'user' : 'admin')}
                        >
                          {savingUserId === u.id ? '...' : u.role === 'admin' ? '− Admin' : '+ Admin'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Grupos ───────────────────────────────── */}
      {tab === 'grupos' && (
        <div className="adm-pane fade-in-1">
          <div className="adm-pane__toolbar">
            <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>👫 Bolões & Gestores</span>
            <button className="btn btn-ghost btn-sm" onClick={() => { loadGroupsAdmin(); loadSecurity() }} disabled={groupsLoading || securityLoading}>
              {(groupsLoading || securityLoading) ? '⏳' : '↻'}
            </button>
          </div>

          <div className="adm-kpi-strip">
            <div className="adm-kpi">
              <div className="adm-kpi__val">{groupsData?.total_groups ?? '—'}</div>
              <div className="adm-kpi__label">Grupos</div>
            </div>
            <div className="adm-kpi">
              <div className="adm-kpi__val" style={{ color: 'var(--accent)' }}>{groupsData?.total_grouped_users ?? '—'}</div>
              <div className="adm-kpi__label">Usuários em grupos</div>
            </div>
            <div className="adm-kpi">
              <div className="adm-kpi__val" style={{ color: 'var(--win)' }}>{security?.password_changes?.total ?? '—'}</div>
              <div className="adm-kpi__label">Trocas de senha</div>
            </div>
            <div className="adm-kpi">
              <div className="adm-kpi__val">{security?.password_changes?.last_7d ?? '—'}</div>
              <div className="adm-kpi__label">Trocas (7 dias)</div>
            </div>
          </div>

          {/* ── Cards informativos ──────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 8 }}>
            {/* Destaques */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>🏅 Destaques</div>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <div>🥇 Maior: <b>{groupsData?.highlights?.biggest?.name || '—'}</b> {groupsData?.highlights?.biggest && <span style={{ color: 'var(--text-3)' }}>({groupsData.highlights.biggest.members} membros)</span>}</div>
                <div>🔥 Mais ativo: <b>{groupsData?.highlights?.most_active?.name || '—'}</b> {groupsData?.highlights?.most_active && <span style={{ color: 'var(--text-3)' }}>({groupsData.highlights.most_active.bets} palpites)</span>}</div>
                <div>👑 Top gestor: <b>{groupsData?.highlights?.top_owner?.name || '—'}</b> {groupsData?.highlights?.top_owner && <span style={{ color: 'var(--text-3)' }}>({groupsData.highlights.top_owner.groups} grupos)</span>}</div>
              </div>
            </div>
            {/* Saúde */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>🩺 Saúde</div>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <div>Vazios (só dono): <b style={{ color: (groupsData?.health?.empty_count ? 'var(--lose)' : 'var(--text-1)') }}>{groupsData?.health?.empty_count ?? '—'}</b></div>
                <div>Sem palpites: <b style={{ color: (groupsData?.health?.inactive_count ? 'var(--lose)' : 'var(--text-1)') }}>{groupsData?.health?.inactive_count ?? '—'}</b></div>
                <div>Média de membros: <b>{groupsData?.health?.avg_members ?? '—'}</b></div>
              </div>
            </div>
            {/* Convites */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>✉️ Convites</div>
              <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
                <div>Pendentes: <b>{groupsData?.invites?.pending ?? '—'}</b></div>
                <div>Aceitos / Recusados: <b style={{ color: 'var(--win)' }}>{groupsData?.invites?.accepted ?? '—'}</b> / <b style={{ color: 'var(--lose)' }}>{groupsData?.invites?.rejected ?? '—'}</b></div>
                <div>Taxa de aceitação: <b>{groupsData?.invites?.acceptance_rate ?? '—'}%</b></div>
              </div>
            </div>
            {/* Crescimento */}
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>📈 Grupos criados</div>
              {groupsData?.growth?.length ? (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 60 }}>
                  {(() => {
                    const max = Math.max(...groupsData.growth.map(p => p.count), 1)
                    return groupsData.growth.map((p, i) => (
                      <div key={i} title={`${p.label}: ${p.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <div style={{ width: '100%', height: `${(p.count / max) * 44}px`, minHeight: 2, background: 'var(--accent)', borderRadius: 2 }} />
                        <span style={{ fontSize: 9, color: 'var(--text-3)' }}>{p.label}</span>
                      </div>
                    ))
                  })()}
                </div>
              ) : <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Sem dados.</div>}
            </div>
          </div>

          {/* ── Toolbar: busca + filtros ────────────────── */}
          <div className="adm-pane__toolbar" style={{ marginTop: 16, flexWrap: 'wrap', gap: 8 }}>
            <input
              type="text"
              className="form-input"
              style={{ maxWidth: 260 }}
              placeholder="Buscar grupo ou gestor…"
              value={groupSearch}
              onChange={e => setGroupSearch(e.target.value)}
            />
            {[
              { id: 'all', label: 'Todos' },
              { id: 'active', label: 'Ativos' },
              { id: 'empty', label: 'Vazios' },
              { id: 'pending', label: 'Com convites' },
            ].map(f => (
              <button
                key={f.id}
                className={`btn btn-sm ${groupFilter === f.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setGroupFilter(f.id)}
              >{f.label}</button>
            ))}
          </div>

          {/* ── Tabela ordenável + expansível ───────────── */}
          <div className="adm-table-wrap" style={{ marginTop: 8 }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Gestor</th>
                  <th className="adm-table__num" style={{ cursor: 'pointer' }} onClick={() => sortGroupsBy('members_count')}>
                    Membros {groupSort.key === 'members_count' ? (groupSort.dir === 'desc' ? '▼' : '▲') : ''}
                  </th>
                  <th className="adm-table__num" style={{ cursor: 'pointer' }} onClick={() => sortGroupsBy('bets_count')}>
                    Palpites {groupSort.key === 'bets_count' ? (groupSort.dir === 'desc' ? '▼' : '▲') : ''}
                  </th>
                  <th className="adm-table__num">Conv.</th>
                  <th style={{ cursor: 'pointer' }} onClick={() => sortGroupsBy('created_at')}>
                    Criado {groupSort.key === 'created_at' ? (groupSort.dir === 'desc' ? '▼' : '▲') : ''}
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groupsLoading && (
                  <tr><td colSpan={7} className="adm-table__empty">Carregando...</td></tr>
                )}
                {!groupsLoading && (() => {
                  const term = groupSearch.trim().toLowerCase()
                  let list = (groupsData?.groups || [])
                    .filter(g => {
                      if (groupFilter === 'active') return g.bets_count > 0
                      if (groupFilter === 'empty') return g.members_count <= 1
                      if (groupFilter === 'pending') return (g.pending_invites || 0) > 0
                      return true
                    })
                    .filter(g => !term || g.name.toLowerCase().includes(term) || (g.owner && (g.owner.name.toLowerCase().includes(term) || g.owner.email.toLowerCase().includes(term))))
                  list = [...list].sort((a, b) => {
                    const k = groupSort.key
                    let av = a[k], bv = b[k]
                    if (k === 'created_at') { av = new Date(av).getTime(); bv = new Date(bv).getTime() }
                    return groupSort.dir === 'desc' ? bv - av : av - bv
                  })
                  if (list.length === 0) {
                    return <tr><td colSpan={7} className="adm-table__empty">Nenhum grupo encontrado.</td></tr>
                  }
                  return list.map(g => (
                    <Fragment key={g.id}>
                      <tr style={{ cursor: 'pointer' }} onClick={() => toggleGroup(g.id)}>
                        <td>
                          <div className="adm-table__name">{expandedGroup === g.id ? '▼ ' : '▶ '}{g.name}</div>
                          <div className="adm-table__id">ID {g.id}</div>
                        </td>
                        <td>
                          {g.owner ? (
                            <>
                              <div className="adm-table__name">{g.owner.name}</div>
                              <div className="adm-table__id">{g.owner.email}</div>
                            </>
                          ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                        </td>
                        <td className="adm-table__num">{g.members_count}</td>
                        <td className="adm-table__num">{g.bets_count}</td>
                        <td className="adm-table__num">{g.pending_invites || 0}</td>
                        <td>{g.created_at ? new Date(g.created_at).toLocaleDateString('pt-BR') : '—'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--accent)', fontSize: 12 }}>{expandedGroup === g.id ? 'Fechar' : 'Ranking'}</td>
                      </tr>
                      {expandedGroup === g.id && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--bg-overlay)', padding: 12 }}>
                            {membersLoading === g.id && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Carregando membros...</div>}
                            {membersLoading !== g.id && groupMembers[g.id] && (
                              <table className="adm-table" style={{ margin: 0 }}>
                                <thead>
                                  <tr>
                                    <th className="adm-table__num">#</th>
                                    <th>Membro</th>
                                    <th className="adm-table__num">Pontos</th>
                                    <th className="adm-table__num">Palpites</th>
                                    <th>Campeão</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {groupMembers[g.id].members.map(m => (
                                    <tr key={m.user_id}>
                                      <td className="adm-table__num">{m.position}</td>
                                      <td>
                                        <div className="adm-table__name">{m.name} {m.is_owner && <span className="badge badge-group" style={{ marginLeft: 4 }}>gestor</span>}</div>
                                        <div className="adm-table__id">{m.email}</div>
                                      </td>
                                      <td className="adm-table__num"><b>{m.total_points}</b></td>
                                      <td className="adm-table__num">{m.bets_count}</td>
                                      <td>{m.champion_pick || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))
                })()}
              </tbody>
            </table>
          </div>

          <div className="adm-pane__toolbar" style={{ marginTop: 20 }}>
            <span className="section-title" style={{ margin: 0, border: 0, padding: 0 }}>🔑 Trocas de senha recentes</span>
          </div>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Tipo</th>
                  <th>IP</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {securityLoading && (
                  <tr><td colSpan={4} className="adm-table__empty">Carregando...</td></tr>
                )}
                {!securityLoading && security?.recent_password_changes?.length === 0 && (
                  <tr><td colSpan={4} className="adm-table__empty">Nenhuma troca de senha registrada.</td></tr>
                )}
                {!securityLoading && security?.recent_password_changes?.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <div className="adm-table__name">{r.user_name || '—'}</div>
                      <div className="adm-table__id">{r.user_email || `ID ${r.user_id}`}</div>
                    </td>
                    <td>{r.action === 'password.reset' ? 'Reset por e-mail' : 'Troca no perfil'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.ip || '—'}</td>
                    <td>{r.created_at ? new Date(r.created_at).toLocaleString('pt-BR') : '—'}</td>
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
              <span className="adm-card__title">Apostas {betsTotal ? `· ${allBets?.length}/${betsTotal}` : ''}</span>
              <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                {betsExportMsg && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: betsExportMsg.startsWith('✓') ? 'var(--win)' : 'var(--text-3)' }}>{betsExportMsg}</span>}
                <button onClick={exportBetsImage} className="btn btn-ghost btn-sm" disabled={!allBets?.length} title="Baixar tabela como imagem PNG">📷 Imagem</button>
                <button onClick={copyBetsImage} className="btn btn-ghost btn-sm" disabled={!allBets?.length} title="Copiar imagem (colar no WhatsApp)">📋 Copiar</button>
                <button onClick={shareBetsWhatsApp} className="btn btn-sm" disabled={!allBets?.length} style={{ background: '#25D366', color: '#073' }} title="Enviar resumo no WhatsApp">🟢 WhatsApp</button>
                <button onClick={() => loadBets()} className="btn btn-ghost btn-sm" disabled={betsLoading}>{betsLoading ? '⏳' : '↻'}</button>
              </div>
            </div>

            {/* Filtros */}
            <div className="adm-bet-filters">
              <label className="adm-bet-filters__field adm-bet-filters__field--user" style={{ position: 'relative' }}>
                <span>Usuário (nome / email / id)</span>
                <input value={betFilters.user}
                  onChange={e => onUserType(e.target.value)}
                  onFocus={() => userSuggest.length && setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  onKeyDown={e => { if (e.key === 'Enter') { setShowSuggest(false); loadBets() } }}
                  placeholder="ex: Wesley" className="form-input" autoComplete="off" />
                {showSuggest && userSuggest.length > 0 && (
                  <div className="adm-suggest">
                    {userSuggest.map(u => (
                      <button type="button" key={u.id} className="adm-suggest__item"
                        onMouseDown={e => { e.preventDefault(); pickUser(u) }}>
                        <span className="adm-suggest__name">{u.name || '—'}</span>
                        <span className="adm-suggest__meta">{u.email} · #{u.id} · {u.bets_count} aposta{u.bets_count !== 1 ? 's' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showSuggest && userSuggest.length === 0 && betFilters.user.trim().length >= 2 && (
                  <div className="adm-suggest"><div className="adm-suggest__empty">Nenhum usuário</div></div>
                )}
              </label>
              <label className="adm-bet-filters__field adm-bet-filters__field--mid">
                <span>Jogo (match_id)</span>
                <input value={betFilters.match_id} onChange={e => setBetFilters(f => ({ ...f, match_id: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && loadBets()} placeholder="ex: 756" className="form-input" inputMode="numeric" />
              </label>
              <label className="adm-bet-filters__field">
                <span>De</span>
                <input type="date" value={betFilters.date_from} onChange={e => setBetFilters(f => ({ ...f, date_from: e.target.value }))} className="form-input" />
              </label>
              <label className="adm-bet-filters__field">
                <span>Até</span>
                <input type="date" value={betFilters.date_to} onChange={e => setBetFilters(f => ({ ...f, date_to: e.target.value }))} className="form-input" />
              </label>
              <label className="adm-bet-filters__field">
                <span>Status</span>
                <select value={betFilters.status} onChange={e => setBetFilters(f => ({ ...f, status: e.target.value }))} className="form-input">
                  <option value="">Todos</option>
                  <option value="evaluated">✔️ Com resultado</option>
                  <option value="exact">🎯 Placar exato</option>
                  <option value="correct">✅ Resultado certo</option>
                  <option value="wrong">❌ Errado</option>
                  <option value="pending">⏳ Pendente</option>
                </select>
              </label>
              <div className="adm-bet-filters__actions">
                <button onClick={() => { const f = { ...betFilters, date_to: new Date().toISOString().slice(0, 10) }; setBetFilters(f); loadBets(f) }} className="btn btn-ghost btn-sm" title="Filtra jogos até hoje">📅 Até hoje</button>
                <button onClick={() => loadBets()} className="btn btn-sm" style={{ background: 'var(--accent)', color: '#fff' }} disabled={betsLoading}>{betsLoading ? '⏳' : 'Buscar'}</button>
                <button onClick={() => { const f = { user: '', match_id: '', status: '', date_from: '', date_to: '' }; setBetFilters(f); loadBets(f) }} className="btn btn-ghost btn-sm">Limpar</button>
              </div>
            </div>

            <div className="adm-table-wrap" ref={betsExportRef}>
              <div className="adm-bets-export-head">
                <strong>🏆 Apostas · predicts.info</strong>
                <span>{betFilters.user ? `Usuário: ${betFilters.user} · ` : ''}{betFilters.match_id ? `Jogo #${betFilters.match_id} · ` : ''}{allBets?.length || 0} apostas · {new Date().toLocaleDateString('pt-BR')}</span>
              </div>
              <table className="adm-table adm-table--bets">
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>Partida</th>
                    <th className="adm-table__num">Palpite</th>
                    <th className="adm-table__num">Real</th>
                    <th>Situação</th>
                    <th className="adm-table__num">Pts</th>
                    <th>Data jogo</th>
                  </tr>
                </thead>
                <tbody>
                  {betsLoading && <tr><td colSpan={7} className="adm-table__empty">Carregando...</td></tr>}
                  {!betsLoading && allBets?.length === 0 && <tr><td colSpan={7} className="adm-table__empty">Nenhuma aposta encontrada.</td></tr>}
                  {!betsLoading && allBets?.map(b => {
                    const sit = b.result === 'exact'   ? { label: '🎯 Placar exato',    color: 'var(--win)' }
                              : b.result === 'correct' ? { label: '✅ Acertou resultado', color: 'var(--accent)' }
                              : b.result === 'wrong'   ? { label: '❌ Errou',            color: 'var(--lose)' }
                              :                          { label: '⏳ Pendente',         color: 'var(--text-4)' }
                    return (
                    <tr key={b.id}>
                      <td className="adm-table__email" title={b.user_email}>{b.user_name || b.user_email?.split('@')[0]}</td>
                      <td style={{ fontFamily: 'var(--font-cond)', fontWeight: 600 }}>
                        {b.team_a} × {b.team_b}
                        <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 6 }}>#{b.match_id}</span>
                      </td>
                      <td className="adm-table__num" style={{ fontFamily: 'var(--font-data)', fontWeight: 700 }}>{b.score_a}–{b.score_b}</td>
                      <td className="adm-table__num" style={{ fontFamily: 'var(--font-data)', color: 'var(--text-3)' }}>
                        {b.result_a != null ? `${b.result_a}–${b.result_b}` : (b.match_status === 'scheduled' ? '—' : '⏳')}
                      </td>
                      <td>
                        <span style={{ color: sit.color, fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{sit.label}</span>
                      </td>
                      <td className="adm-table__num">
                        <span style={{ color: sit.color, fontWeight: 800, fontFamily: 'var(--font-data)' }}>
                          {b.result === 'pending' ? '—' : `+${b.points_earned}`}
                        </span>
                      </td>
                      <td className="adm-table__date">{b.match_date ? fmtShort(b.match_date) : '—'}</td>
                    </tr>
                  )})}
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
                <div style={{ border: `1px solid var(--border)`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 10 }}>
                    🔀 OPENROUTER
                    {analysisConfig?.openrouter_has_key && <span style={{ color: 'var(--win)', marginLeft: 8 }}>✓ {analysisConfig.openrouter_key_masked}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input type="password"
                      placeholder={analysisConfig?.openrouter_has_key ? '••• (vazio = manter)' : 'sk-or-v1-...'}
                      value={aForm.openrouter_key}
                      onChange={e => setAForm(f => ({ ...f, openrouter_key: e.target.value }))}
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%' }}
                    />
                    <div>
                      <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', display: 'block', marginBottom: 4 }}>🆓 MODELOS GRATUITOS</label>
                      <select value={analysisConfig?.openrouter_free_models?.find(m => m.id === aForm.openrouter_model) ? aForm.openrouter_model : ''}
                        onChange={e => e.target.value && setAForm(f => ({ ...f, openrouter_model: e.target.value }))}
                        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13, width: '100%' }}>
                        <option value="">— selecionar —</option>
                        {(analysisConfig?.openrouter_free_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', display: 'block', marginBottom: 4 }}>💎 MODELOS PAGOS</label>
                      <select value={analysisConfig?.openrouter_paid_models?.find(m => m.id === aForm.openrouter_model) ? aForm.openrouter_model : ''}
                        onChange={e => e.target.value && setAForm(f => ({ ...f, openrouter_model: e.target.value }))}
                        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13, width: '100%' }}>
                        <option value="">— selecionar —</option>
                        {(analysisConfig?.openrouter_paid_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)', background: 'var(--bg-base)', borderRadius: 6, padding: '6px 10px' }}>
                      Modelo ativo: <span style={{ color: 'var(--accent)' }}>{aForm.openrouter_model || '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Gemini section */}
                <div style={{ border: `1px solid ${aForm.provider === 'gemini' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 10 }}>
                    ✦ GEMINI (GOOGLE AI)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', display: 'block', marginBottom: 4 }}>
                        CHAVE 1 {analysisConfig?.gemini_has_key && <span style={{ color: 'var(--win)' }}>✓ {analysisConfig.gemini_key_masked}</span>}
                      </label>
                      <input type="password"
                        placeholder={analysisConfig?.gemini_has_key ? '••• (vazio = manter)' : 'AIzaSy...'}
                        value={aForm.gemini_key}
                        onChange={e => setAForm(f => ({ ...f, gemini_key: e.target.value }))}
                        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', display: 'block', marginBottom: 4 }}>
                        CHAVE 2 (fallback) {analysisConfig?.gemini_has_key_2 && <span style={{ color: 'var(--win)' }}>✓ {analysisConfig.gemini_key_2_masked}</span>}
                      </label>
                      <input type="password"
                        placeholder={analysisConfig?.gemini_has_key_2 ? '••• (vazio = manter)' : 'AIzaSy... (segunda conta Google AI Studio)'}
                        value={aForm.gemini_key_2}
                        onChange={e => setAForm(f => ({ ...f, gemini_key_2: e.target.value }))}
                        style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%' }}
                      />
                    </div>
                    <select value={aForm.gemini_model} onChange={e => setAForm(f => ({ ...f, gemini_model: e.target.value }))}
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                      {(analysisConfig?.gemini_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* OpenAI Direct section */}
                <div style={{ border: `1px solid var(--border)`, borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 10 }}>
                    🤖 OPENAI (DIRETO)
                    {analysisConfig?.openai_has_key && <span style={{ color: 'var(--win)', marginLeft: 8 }}>✓ {analysisConfig.openai_key_masked}</span>}
                    <span style={{ fontWeight: 400, color: 'var(--text-4)', marginLeft: 8 }}>entra na cadeia após Gemini</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input type="password"
                      placeholder={analysisConfig?.openai_has_key ? '••• (vazio = manter)' : 'sk-...'}
                      value={aForm.openai_key}
                      onChange={e => setAForm(f => ({ ...f, openai_key: e.target.value }))}
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 12, width: '100%' }}
                    />
                    <select value={aForm.openai_model} onChange={e => setAForm(f => ({ ...f, openai_model: e.target.value }))}
                      style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                      {(analysisConfig?.openai_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Fallback chain preview */}
                {analysisConfig?.provider_chain?.length > 0 && (
                  <div style={{ padding: '10px 14px', background: 'rgba(15,122,120,0.06)', border: '1px solid rgba(15,122,120,0.2)', borderRadius: 8 }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.07em', marginBottom: 6 }}>CADEIA DE FALLBACK ATIVA</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {analysisConfig.provider_chain.map((p, i) => (
                        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--accent)', background: 'rgba(15,122,120,0.12)', border: '1px solid rgba(15,122,120,0.3)', borderRadius: 4, padding: '2px 8px' }}>
                            {i + 1}. {p.label}
                          </span>
                          {i < analysisConfig.provider_chain.length - 1 && (
                            <span style={{ color: 'var(--text-4)', fontSize: 12 }}>→</span>
                          )}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 6 }}>
                      Quando quota/429 no provider atual, avança automaticamente para o próximo.
                    </div>
                  </div>
                )}

                {/* Metodologia — dados injetados no prompt */}
                <AnalysisMethodologyCard />

                {/* Prompt editor */}
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <button type="button"
                    onClick={() => setPromptOpen(v => !v)}
                    style={{ width: '100%', background: 'var(--bg-overlay)', border: 'none', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-2)' }}>
                    <span>📝 Editor de Prompt</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {!aForm.prompt_template && (
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--win)', background: 'rgba(46,201,128,0.1)', border: '1px solid rgba(46,201,128,0.25)', borderRadius: 4, padding: '1px 6px' }}>
                          ✓ usando padrão
                        </span>
                      )}
                      {aForm.prompt_template && (
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--amber)', background: 'rgba(232,196,74,0.1)', border: '1px solid rgba(232,196,74,0.25)', borderRadius: 4, padding: '1px 6px' }}>
                          ✎ customizado
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{promptOpen ? '▲ fechar' : '▼ editar'}</span>
                    </div>
                  </button>
                  {promptOpen && (
                    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', lineHeight: 1.5 }}>
                        Customize o prompt enviado ao modelo. Variáveis disponíveis: <code style={{ background: 'var(--bg-overlay)', padding: '1px 4px', borderRadius: 3 }}>{'{{team_a_name}}'}</code>, <code style={{ background: 'var(--bg-overlay)', padding: '1px 4px', borderRadius: 3 }}>{'{{team_b_name}}'}</code>, <code style={{ background: 'var(--bg-overlay)', padding: '1px 4px', borderRadius: 3 }}>{'{{team_a_elo}}'}</code>, <code style={{ background: 'var(--bg-overlay)', padding: '1px 4px', borderRadius: 3 }}>{'{{mc_probs}}'}</code>, etc. Deixe vazio para usar o prompt padrão.
                      </div>
                      <textarea
                        rows={14}
                        value={aForm.prompt_template}
                        onChange={e => setAForm(f => ({ ...f, prompt_template: e.target.value }))}
                        placeholder="Deixe vazio para usar prompt padrão…"
                        style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-1)', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => setAForm(f => ({ ...f, prompt_template: analysisConfig?.default_prompt || '' }))}>
                          📋 Copiar prompt padrão
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => setAForm(f => ({ ...f, prompt_template: '' }))}>
                          🔄 Resetar (usar padrão)
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn btn-primary btn-sm" disabled={analysisSaving} type="submit">
                    {analysisSaving ? 'Salvando…' : '💾 Salvar config'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { loadAnalysisConfig(); loadAnalysisStatus(); setAnalysisMsgTimed('✓ Atualizado!') }}>↻ Atualizar</button>
                </div>

                {/* Ações de geração */}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)' }}>GERAR ANÁLISES:</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => generateAll(false)} disabled={generatingAll || generatingForce}>
                      {generatingAll ? '⏳ Iniciando…' : '⚡ Gerar pendentes'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => generateAll(true)} disabled={generatingAll || generatingForce}>
                      {generatingForce ? '⏳ Iniciando…' : '🔄 Regenerar todas'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={loadAnalysisLogs} disabled={logsLoading}>
                      {logsLoading ? '⏳ Carregando…' : '📊 Ver logs'}
                    </button>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                    <input type="checkbox" checked={onlyFuture} onChange={e => setOnlyFuture(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                    Somente jogos ainda não realizados (ignora partidas passadas)
                  </label>
                </div>

                {/* Feedback sempre visível perto dos botões */}
                {analysisMsg && (
                  <div style={{
                    marginTop: 10, padding: '8px 12px', borderRadius: 8,
                    background: analysisMsg.startsWith('✓') || analysisMsg.startsWith('↻')
                      ? 'rgba(46,201,128,0.15)' : 'rgba(232,82,82,0.15)',
                    color: analysisMsg.startsWith('✓') || analysisMsg.startsWith('↻')
                      ? 'var(--win)' : 'var(--lose)',
                    fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600,
                    border: '1px solid currentColor',
                  }}>
                    {analysisMsg}
                  </div>
                )}
              </form>
            </div>
          </div>

          {/* Progress card */}
          {genProgress && genProgress.status !== 'idle' && (
            <AnalysisProgressCard progress={genProgress} nowMs={nowMs} onClose={() => setGenProgress(null)} />
          )}

          {/* Logs de geração IA */}
          {analysisLogs && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>📊 Logs de Geração IA</div>
                <button type="button" onClick={() => setAnalysisLogs(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16 }}>✕</button>
              </div>
              {/* Totais */}
              {analysisLogs.totals && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 14 }}>
                  {[
                    { label: '✓ Geradas', val: analysisLogs.totals.ok },
                    { label: '✗ Erros', val: analysisLogs.totals.error },
                    { label: 'Tokens entrada', val: (analysisLogs.totals.tokens_in ?? 0).toLocaleString() },
                    { label: 'Tokens saída', val: (analysisLogs.totals.tokens_out ?? 0).toLocaleString() },
                    { label: 'Custo total', val: '$' + (analysisLogs.totals.cost_usd || 0).toFixed(4) },
                    { label: 'Tempo total', val: analysisLogs.totals.duration_ms >= 60000
                        ? Math.floor(analysisLogs.totals.duration_ms/60000) + 'm ' + Math.floor((analysisLogs.totals.duration_ms%60000)/1000) + 's'
                        : (analysisLogs.totals.duration_ms/1000).toFixed(1) + 's' },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ background: 'var(--bg-base)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}
              {/* Tabela logs */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-4)', borderBottom: '1px solid var(--border)' }}>
                      {['Gerado em', 'Tipo', 'Jogo', 'Modelo', 'Status', 'T.In', 'T.Out', 'Custo', 'Tempo'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analysisLogs.items.map(item => (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', color: item.status === 'error' ? 'var(--lose)' : 'var(--text-2)' }}>
                        <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{item.created_at?.slice(0,16).replace('T',' ')}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <span style={{
                            fontSize: 9, padding: '2px 5px', borderRadius: 4, fontWeight: 700,
                            background: item.trigger === 'auto' ? 'rgba(100,160,255,0.15)' : 'rgba(15,122,120,0.15)',
                            color: item.trigger === 'auto' ? '#6fa0f0' : 'var(--accent)',
                          }}>
                            {item.trigger === 'auto' ? 'AUTO' : 'MANUAL'}
                          </span>
                        </td>
                        <td style={{ padding: '4px 8px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.team_a && item.team_b ? `${item.team_a} × ${item.team_b}` : item.match_id ? `#${item.match_id}` : '—'}
                        </td>
                        <td style={{ padding: '4px 8px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.model_used?.split('/').pop() || '—'}</td>
                        <td style={{ padding: '4px 8px' }}>{item.status === 'ok' ? '✓' : '✗ ' + (item.error_msg?.slice(0,30) || 'erro')}</td>
                        <td style={{ padding: '4px 8px' }}>{item.tokens_in ? item.tokens_in.toLocaleString() : '—'}</td>
                        <td style={{ padding: '4px 8px' }}>{item.tokens_out ? item.tokens_out.toLocaleString() : '—'}</td>
                        <td style={{ padding: '4px 8px' }}>{item.cost_usd > 0 ? '$' + item.cost_usd.toFixed(5) : 'free'}</td>
                        <td style={{ padding: '4px 8px' }}>{item.duration_ms ? (item.duration_ms/1000).toFixed(1) + 's' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modal: visualizar análise */}
          {viewingAnalysis && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, overflowY: 'auto', padding: '24px 16px' }}
              onClick={e => { if (e.target === e.currentTarget) setViewingAnalysis(null) }}>
              <div style={{ maxWidth: 720, margin: '0 auto', background: 'var(--bg-card)', borderRadius: 12, padding: 24, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 16, color: 'var(--text-1)' }}>Análise — Partida #{viewingAnalysis.match_id}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>{viewingAnalysis.model_used} · {viewingAnalysis.generated_at?.slice(0,19)}</div>
                  </div>
                  <button type="button" onClick={() => setViewingAnalysis(null)}
                    style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-3)' }}>✕</button>
                </div>
                {viewingAnalysis.content && (() => {
                  const c = viewingAnalysis.content
                  const sH = { fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, marginTop: 14 }
                  const sT = { fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }
                  return (
                    <div>
                      {c.verdict && <div style={{ background: 'rgba(15,122,120,0.12)', border: '1px solid rgba(15,122,120,0.35)', borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--accent)', marginBottom: 12 }}>{c.verdict}</div>}
                      {c.overview && <><div style={sH}>📋 Panorama</div><div style={sT}>{c.overview}</div></>}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
                        {[['team_a', 'Time A'], ['team_b', 'Time B']].map(([key, label]) => c[key] ? (
                          <div key={key} style={{ background: 'var(--bg-overlay)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                            <div style={{ ...sH, marginTop: 0 }}>{label}</div>
                            {c[key].tactical && <><div style={{ ...sH, fontSize: 10 }}>Tática</div><div style={sT}>{c[key].tactical}</div></>}
                            {c[key].strengths && <><div style={{ ...sH, fontSize: 10 }}>✅ Forças</div><div style={sT}>{c[key].strengths}</div></>}
                            {c[key].weaknesses && <><div style={{ ...sH, fontSize: 10 }}>⚠️ Fraquezas</div><div style={sT}>{c[key].weaknesses}</div></>}
                            {c[key].form && <><div style={{ ...sH, fontSize: 10 }}>📈 Forma</div><div style={sT}>{c[key].form}</div></>}
                            {c[key].key_players?.length > 0 && <>
                              <div style={{ ...sH, fontSize: 10 }}>⭐ Jogadores-chave</div>
                              <ul style={{ margin: 0, paddingLeft: 16 }}>
                                {c[key].key_players.map((p, i) => <li key={i} style={sT}>{p}</li>)}
                              </ul>
                            </>}
                          </div>
                        ) : null)}
                      </div>
                      {c.matchup && <><div style={sH}>⚔️ Confronto tático</div><div style={sT}>{c.matchup}</div></>}
                      {c.prediction && <><div style={sH}>🔮 Predição</div><div style={sT}>{c.prediction}</div></>}
                    </div>
                  )
                })()}
              </div>
            </div>
          )}

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
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(analysisStatus || []).map(r => (
                    <tr key={r.match_id} style={{ cursor: r.has_analysis ? 'pointer' : 'default' }}
                      onClick={() => r.has_analysis && viewAnalysis(r.match_id)}>
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
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.model_used?.split('/').pop() || '—'}
                      </td>
                      <td onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                          disabled={generatingId === r.match_id || !(analysisConfig?.openrouter_has_key || analysisConfig?.gemini_has_key)}
                          onClick={() => generateOne(r.match_id)}
                        >
                          {generatingId === r.match_id ? '…' : r.has_analysis ? '↻' : '⚡'}
                        </button>
                        {r.has_analysis && (
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={() => viewAnalysis(r.match_id)}>
                            👁
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── 🔮 Oráculo Predictor ─────────────────────────────────────────────── */}
      {tab === 'bot' && (
        <div className="adm-pane fade-in-1">

          {/* Status card */}
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title">🔮 Oráculo Predictor — Status</span>
              <button className="btn btn-sm" onClick={loadBot} disabled={botLoading}>
                {botLoading ? '…' : '↻ Atualizar'}
              </button>
            </div>
            <div className="adm-card__body">
              {!botStatus ? (
                <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando…</div>
              ) : !botStatus.exists ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)' }}>Bot ainda não criado.</div>
                  <button className="btn btn-primary" onClick={createBot}>🔮 Criar Oráculo Predictor</button>
                </div>
              ) : (
                <div>
                  {/* KPIs */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
                    {[
                      { label: 'Pontos', val: botStatus.total_points, color: 'var(--accent)' },
                      { label: 'Posição', val: botStatus.ranking_position ? `#${botStatus.ranking_position}` : '—', color: 'var(--text-1)' },
                      { label: 'Palpites', val: botStatus.total_bets, color: 'var(--text-1)' },
                      { label: 'Avaliados', val: botStatus.evaluated, color: 'var(--text-1)' },
                      { label: '🎯 Exatos', val: botStatus.exatos, color: 'var(--accent)' },
                      { label: '✅ Certos', val: botStatus.certos, color: 'var(--win)' },
                      { label: '❌ Erros', val: botStatus.erros, color: 'var(--lose)' },
                      { label: '% Aproveit.', val: botStatus.evaluated > 0 ? `${Math.round(botStatus.total_points / (botStatus.evaluated * 25) * 100)}%` : '—', color: 'var(--accent)' },
                    ].map(k => (
                      <div key={k.label} style={{ background: 'var(--bg-overlay)', borderRadius: 10, padding: '10px 12px', border: '1px solid var(--border)' }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: k.color, lineHeight: 1 }}>{k.val}</div>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Champion picks */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    {botStatus.champion && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--accent-dim)', borderRadius: 8, padding: '8px 14px', border: '1px solid var(--accent)' }}>
                        {botStatus.champion.flag && <img src={botStatus.champion.flag} alt="" style={{ width: 24, height: 17, objectFit: 'cover', borderRadius: 2 }} />}
                        <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13 }}>🏆 {botStatus.champion.name}</span>
                      </div>
                    )}
                    {botStatus.vice && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-overlay)', borderRadius: 8, padding: '8px 14px', border: '1px solid var(--border)' }}>
                        {botStatus.vice.flag && <img src={botStatus.vice.flag} alt="" style={{ width: 24, height: 17, objectFit: 'cover', borderRadius: 2 }} />}
                        <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13 }}>🥈 {botStatus.vice.name}</span>
                      </div>
                    )}
                    {!botStatus.champion && !botStatus.vice && (
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Campeão/vice ainda não escolhidos</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          {botStatus?.exists && (
            <div className="adm-card">
              <div className="adm-card__header">
                <span className="adm-card__title">⚡ Ações</span>
              </div>
              <div className="adm-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Re-análise pré-jogo (Oráculo) */}
                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Re-análise pré-jogo (IA)
                  </div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
                    Roda automaticamente ~1h antes de cada jogo: a IA reavalia dados e cenários, confirma ou altera o palpite e dispara a análise no Telegram. Use o botão para rodar agora (ignora a janela).
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={runBotPrediction}
                    disabled={botPredLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {botPredLoading ? '⏳ Analisando…' : '🔮 Rodar Re-análise Agora'}
                  </button>
                </div>

                {/* Gerar palpites */}
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Fase dos palpites
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {[
                      { id: 'all', label: 'Todas' },
                      { id: 'group', label: 'Fase de Grupos' },
                      { id: 'r32', label: 'Round of 32' },
                      { id: 'r16', label: 'Oitavas' },
                      { id: 'qf', label: 'Quartas' },
                      { id: 'sf', label: 'Semifinal' },
                      { id: 'final', label: 'Final' },
                    ].map(p => (
                      <button
                        key={p.id}
                        className={`btn btn-sm${botBetPhase === p.id ? ' btn-primary' : ''}`}
                        onClick={() => setBotBetPhase(p.id)}
                        style={{ fontSize: 11 }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={runBotBet}
                    disabled={botBetLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {botBetLoading ? '⏳ Gerando…' : '🎯 Gerar Palpites'}
                  </button>
                </div>

                {/* Escolher campeão */}
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Palpite de Campeão/Vice
                  </div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
                    Usa simulação Monte Carlo mais recente. Fallback: Elo das seleções.
                  </div>
                  <button
                    className="btn"
                    onClick={runBotChampion}
                    disabled={botChampLoading}
                    style={{ background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    {botChampLoading ? '⏳ Escolhendo…' : '🏆 Escolher Campeão/Vice pelo Modelo'}
                  </button>
                </div>

                {botMsg && (
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: botMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)', background: 'var(--bg-overlay)', borderRadius: 8, padding: '8px 12px', border: `1px solid ${botMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)'}` }}>
                    {botMsg}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* IA dedicada do Oráculo */}
          {botStatus?.exists && oracleCfg && oracleForm && (
            <div className="adm-card">
              <div className="adm-card__header">
                <span className="adm-card__title">🧠 IA do Oráculo (dedicada)</span>
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: oracleCfg.active_llm ? 'var(--win)' : 'var(--lose)' }}>
                  {oracleCfg.active_llm ? `Ativa: ${oracleCfg.active_llm} · ${oracleCfg.llm_origin}` : 'Nenhuma IA disponível'}
                </span>
              </div>
              <div className="adm-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                  IA exclusiva do Oráculo, separada da análise de partidas. Se nenhuma chave for definida aqui, ele herda a IA da aba Análises. Cadeia de fallback: Gemini → OpenAI → OpenRouter.
                </div>

                {/* Provider preferido */}
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Provider preferido</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[{ id: 'gemini', l: 'Gemini' }, { id: 'openai', l: 'OpenAI' }, { id: 'openrouter', l: 'OpenRouter' }].map(p => (
                      <button key={p.id} className={`btn btn-sm${oracleForm.provider === p.id ? ' btn-primary' : ''}`} onClick={() => setOracleForm({ ...oracleForm, provider: p.id })} style={{ fontSize: 11 }}>{p.l}</button>
                    ))}
                  </div>
                </div>

                {/* Gemini */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                    Gemini — chave {oracleCfg.gemini_has_key && <span style={{ color: 'var(--win)' }}>({oracleCfg.gemini_key_masked})</span>}
                    <input className="form-input" type="password" placeholder="AIzaSy…" value={oracleForm.gemini_key} onChange={e => setOracleForm({ ...oracleForm, gemini_key: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                    Gemini — modelo
                    <select className="form-input" value={oracleForm.gemini_model} onChange={e => setOracleForm({ ...oracleForm, gemini_model: e.target.value })}>
                      {oracleCfg.gemini_models?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                    OpenAI — chave {oracleCfg.openai_has_key && <span style={{ color: 'var(--win)' }}>({oracleCfg.openai_key_masked})</span>}
                    <input className="form-input" type="password" placeholder="sk-…" value={oracleForm.openai_key} onChange={e => setOracleForm({ ...oracleForm, openai_key: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                    OpenAI — modelo
                    <select className="form-input" value={oracleForm.openai_model} onChange={e => setOracleForm({ ...oracleForm, openai_model: e.target.value })}>
                      {oracleCfg.openai_models?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                    OpenRouter — chave {oracleCfg.openrouter_has_key && <span style={{ color: 'var(--win)' }}>({oracleCfg.openrouter_key_masked})</span>}
                    <input className="form-input" type="password" placeholder="sk-or-v1-…" value={oracleForm.openrouter_key} onChange={e => setOracleForm({ ...oracleForm, openrouter_key: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                    OpenRouter — modelo
                    <select className="form-input" value={oracleForm.openrouter_model} onChange={e => setOracleForm({ ...oracleForm, openrouter_model: e.target.value })}>
                      <optgroup label="Grátis">{oracleCfg.openrouter_free_models?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
                      <optgroup label="Pagos">{oracleCfg.openrouter_paid_models?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
                    </select>
                  </label>
                </div>

                <div>
                  <button className="btn btn-primary" onClick={saveOracleConfig} disabled={oracleSaving}>
                    {oracleSaving ? '⏳ Salvando…' : '💾 Salvar IA do Oráculo'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Logs de decisão do Oráculo */}
          {botStatus?.exists && (
            <div className="adm-card">
              <div className="adm-card__header">
                <span className="adm-card__title">📜 Logs do Oráculo</span>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>{botLogs.length} registros</span>
              </div>
              <div className="adm-card__body" style={{ padding: botLogs.length ? 0 : undefined }}>
                {botLogs.length === 0 ? (
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Sem decisões registradas ainda. A re-análise roda ~1h antes de cada jogo.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {botLogs.map(l => {
                      const c = l.action === 'changed' ? 'var(--amber)' : l.action === 'created' ? 'var(--accent)' : l.action === 'kept' ? 'var(--win)' : 'var(--text-4)'
                      const actLabel = l.action === 'changed' ? '🔁 Alterou' : l.action === 'created' ? '🆕 Criou' : l.action === 'kept' ? '✅ Manteve' : '⏭ Pulou'
                      const isLLM = (l.source || '').startsWith('llm/')
                      const modelTag = isLLM ? l.source.split('/').slice(2).join('/') || l.source.replace('llm/', '') : null
                      return (
                        <div key={l.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6, borderLeft: l.ai_overrode ? '3px solid var(--amber)' : '3px solid transparent' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {l.team_a_flag && <img src={l.team_a_flag} alt="" style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 1 }} />}
                            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12 }}>{l.team_a_code} × {l.team_b_code}</span>
                            {l.team_b_flag && <img src={l.team_b_flag} alt="" style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 1 }} />}
                            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 11, color: c }}>{actLabel}</span>
                            {l.confidence != null && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>🎯 {l.confidence}%</span>}
                            {l.telegram_sent && <span title="Enviado no Telegram" style={{ fontSize: 11 }}>📲</span>}
                            {l.slack_sent && <span title="Enviado no Slack" style={{ fontSize: 11 }}>💬</span>}
                            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>{l.created_at?.slice(0, 16).replace('T', ' ')}</span>
                          </div>
                          {/* Modelo → IA: deixa explícito onde a IA atuou sobre o baseline estatístico */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--font-data)', fontSize: 12 }}>
                            {l.baseline && (
                              <span style={{ color: 'var(--text-4)' }}>
                                Modelo <b style={{ color: 'var(--text-3)' }}>{l.baseline}</b>
                              </span>
                            )}
                            <span style={{ color: 'var(--text-4)' }}>→</span>
                            <span style={{ color: l.ai_overrode ? 'var(--amber)' : 'var(--win)', fontWeight: 700 }}>
                              IA {l.new}
                            </span>
                            {l.ai_overrode
                              ? <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: 'var(--amber)', background: 'var(--bg-overlay)', border: '1px solid var(--amber)', borderRadius: 6, padding: '1px 6px' }}>🔥 IA MUDOU</span>
                              : <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', border: '1px solid var(--border)', borderRadius: 6, padding: '1px 6px' }}>= confirmou modelo</span>}
                          </div>
                          {l.reason && <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.4 }}>💬 {l.reason}</div>}
                          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>
                            {modelTag ? `🧠 ${modelTag}` : (l.source || '')} · {l.trigger}{l.prob_a != null ? ` · MC ${l.prob_a.toFixed(0)}%/${l.prob_draw.toFixed(0)}%/${l.prob_b.toFixed(0)}%` : ''}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Performance por fase */}
          {botBets?.by_phase && Object.keys(botBets.by_phase).length > 0 && (
            <div className="adm-card">
              <div className="adm-card__header">
                <span className="adm-card__title">📊 Performance por Fase</span>
              </div>
              <div className="adm-card__body" style={{ padding: 0 }}>
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Fase</th>
                      <th className="adm-table__num">Apostas</th>
                      <th className="adm-table__num">Avaliados</th>
                      <th className="adm-table__num" style={{ color: 'var(--accent)' }}>🎯 Exatos</th>
                      <th className="adm-table__num" style={{ color: 'var(--win)' }}>✅ Certos</th>
                      <th className="adm-table__num" style={{ color: 'var(--lose)' }}>❌ Erros</th>
                      <th className="adm-table__num">Pontos</th>
                      <th className="adm-table__num">Aproveito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(botBets.by_phase).map(([phase, p]) => {
                      const aprov = p.evaluated > 0 ? Math.round(p.points / (p.evaluated * 25) * 100) : null
                      return (
                        <tr key={phase}>
                          <td style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12 }}>
                            {phase === 'group' ? 'Grupos' : phase === 'r32' ? 'R32' : phase === 'r16' ? 'Oitavas' : phase === 'qf' ? 'Quartas' : phase === 'sf' ? 'Semi' : phase === 'final' ? 'Final' : phase}
                          </td>
                          <td className="adm-table__num">{p.total}</td>
                          <td className="adm-table__num">{p.evaluated}</td>
                          <td className="adm-table__num" style={{ color: 'var(--accent)', fontWeight: 700 }}>{p.exatos}</td>
                          <td className="adm-table__num" style={{ color: 'var(--win)' }}>{p.certos}</td>
                          <td className="adm-table__num" style={{ color: 'var(--lose)' }}>{p.erros}</td>
                          <td className="adm-table__num" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>{p.points}</td>
                          <td className="adm-table__num" style={{ color: aprov >= 60 ? 'var(--win)' : aprov >= 30 ? 'var(--accent)' : 'var(--text-3)', fontWeight: 700 }}>
                            {aprov !== null ? `${aprov}%` : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Bets list */}
          {botBets?.bets?.length > 0 && (
            <div className="adm-card">
              <div className="adm-card__header">
                <span className="adm-card__title">📋 Palpites do Bot</span>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>
                  {botBets.bets.length} palpites
                </span>
              </div>
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Partida</th>
                      <th>Fase</th>
                      <th className="adm-table__num">Bot</th>
                      <th className="adm-table__num">Oficial</th>
                      <th className="adm-table__num">Pts</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {botBets.bets.map(b => (
                      <tr key={b.id} style={{ opacity: b.outcome === null ? 0.7 : 1 }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {b.team_a_flag && <img src={b.team_a_flag} alt="" style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1 }} />}
                            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12 }}>{b.team_a_code}</span>
                            <span style={{ color: 'var(--text-4)', fontSize: 11 }}>×</span>
                            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12 }}>{b.team_b_code}</span>
                            {b.team_b_flag && <img src={b.team_b_flag} alt="" style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1 }} />}
                          </div>
                        </td>
                        <td style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                          {b.phase === 'group' ? 'Grupos' : b.phase === 'r32' ? 'R32' : b.phase === 'r16' ? 'Oitavas' : b.phase === 'qf' ? 'Quartas' : b.phase === 'sf' ? 'Semi' : b.phase === 'final' ? 'Final' : b.phase}
                        </td>
                        <td className="adm-table__num" style={{ fontFamily: 'var(--font-data)', fontWeight: 700 }}>
                          {b.predicted_a}×{b.predicted_b}
                        </td>
                        <td className="adm-table__num" style={{ fontFamily: 'var(--font-data)', color: 'var(--text-3)' }}>
                          {b.official_a !== null ? `${b.official_a}×${b.official_b}` : '—'}
                        </td>
                        <td className="adm-table__num" style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>
                          {b.points ?? '—'}
                        </td>
                        <td>
                          {b.outcome === 'exact'   && <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700 }}>🎯 Exato</span>}
                          {b.outcome === 'correct' && <span style={{ color: 'var(--win)',    fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700 }}>✅ Certo</span>}
                          {b.outcome === 'wrong'   && <span style={{ color: 'var(--lose)',   fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700 }}>❌ Errou</span>}
                          {b.outcome === null      && <span style={{ color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 11 }}>Aguardando</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
      {/* ── Relatório ─────────────────────────────────────────────────────── */}
      {tab === 'report' && (
        <div className="adm-pane fade-in-1">
          <div className="adm-card">
            <div className="adm-card__header">
              <span className="adm-card__title"><TgIcon /> Relatório da Plataforma</span>
              <button className="btn btn-sm" onClick={loadReport} disabled={reportLoading}>
                {reportLoading ? '…' : '↻ Gerar'}
              </button>
            </div>

            {reportLoading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>Coletando dados…</div>}

            {report && !reportLoading && (
              <>
                {/* KPI strip */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10, marginBottom: 16 }}>
                  {[
                    { label: 'Usuários', value: report.data.users.total, sub: `+${report.data.users.new_today} hoje` },
                    { label: 'Views hoje', value: report.data.views.today, sub: `${report.data.views.unique_today} únicos` },
                    { label: 'Apostas hoje', value: report.data.bets.today, sub: `${report.data.bets.bettors_today} apostadores` },
                    { label: 'Total apostas', value: report.data.bets.total, sub: `${report.data.bets.week} na semana` },
                  ].map(k => (
                    <div key={k.label} style={{ background: 'var(--bg-overlay)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)' }}>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{k.label}</div>
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>{(k.value ?? 0).toLocaleString('pt-BR')}</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{k.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Ranking top 10 */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>🏆 Ranking Geral — Top 10</div>
                  <table className="adm-table" style={{ fontSize: 13 }}>
                    <thead><tr><th>#</th><th>Nome</th><th>Pts</th><th>Exatos</th></tr></thead>
                    <tbody>
                      {report.data.ranking_top10.map(r => (
                        <tr key={r.pos}>
                          <td style={{ fontFamily: 'var(--font-data)', color: r.pos <= 3 ? 'var(--accent)' : 'var(--text-3)' }}>
                            {r.pos === 1 ? '🥇' : r.pos === 2 ? '🥈' : r.pos === 3 ? '🥉' : r.pos}
                          </td>
                          <td style={{ fontWeight: r.pos <= 3 ? 700 : 400 }}>{r.name}</td>
                          <td style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)', fontWeight: 700 }}>{r.pts}</td>
                          <td style={{ fontFamily: 'var(--font-data)', color: 'var(--text-3)' }}>{r.exact}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Ranking do dia */}
                {report.data.ranking_day?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>🌟 Destaque do Dia</div>
                    <table className="adm-table" style={{ fontSize: 13 }}>
                      <thead><tr><th>#</th><th>Nome</th><th>Pts</th></tr></thead>
                      <tbody>
                        {report.data.ranking_day.map(r => (
                          <tr key={r.pos}>
                            <td style={{ fontFamily: 'var(--font-data)', color: r.pos <= 3 ? 'var(--accent)' : 'var(--text-3)' }}>
                              {r.pos === 1 ? '🥇' : r.pos === 2 ? '🥈' : r.pos === 3 ? '🥉' : r.pos}
                            </td>
                            <td style={{ fontWeight: r.pos <= 3 ? 700 : 400 }}>{r.name}</td>
                            <td style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)', fontWeight: 700 }}>{r.pts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Preview do texto */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Preview do texto (Telegram MarkdownV2)</div>
                  <pre style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 280, overflowY: 'auto', margin: 0 }}>
                    {report.text}
                  </pre>
                </div>

                {/* Ações */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={copyReport}
                    style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: reportCopied ? 'var(--win)' : 'transparent', color: reportCopied ? '#fff' : 'var(--text-1)', transition: 'all .2s' }}
                  >
                    {reportCopied ? '✓ Copiado!' : '📋 Copiar texto'}
                  </button>
                  <button
                    type="button"
                    onClick={sendReport}
                    disabled={reportSending || !report.telegram_configured}
                    title={!report.telegram_configured ? 'Configure o Telegram em Admin → Configurações' : ''}
                    style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: report.telegram_configured ? 'pointer' : 'not-allowed', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: report.telegram_configured ? 'var(--accent)' : 'var(--bg-overlay)', color: report.telegram_configured ? '#fff' : 'var(--text-4)', opacity: reportSending ? 0.6 : 1, transition: 'all .2s' }}
                  >
                    {reportSending ? '⏳ Enviando…' : '📤 Enviar Telegram'}
                  </button>
                </div>

                {!report.telegram_configured && (
                  <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(232,196,74,0.1)', border: '1px solid rgba(232,196,74,0.3)', borderRadius: 8, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--amber)' }}>
                    ⚠ Telegram não configurado. Acesse <strong>Admin → Configurações → card Telegram</strong> e salve o token e chat_id.
                  </div>
                )}
              </>
            )}

            {reportMsg && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, fontFamily: 'var(--font-cond)', fontSize: 12, background: reportMsg.startsWith('✓') ? 'rgba(46,201,128,0.1)' : 'rgba(232,82,82,0.1)', color: reportMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                {reportMsg}
              </div>
            )}
          </div>

          {/* Instruções Telegram */}
          <div className="adm-card" style={{ marginTop: 16 }}>
            <div className="adm-card__header">
              <span className="adm-card__title">🤖 Como configurar o Bot Telegram</span>
            </div>
            <ol style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 2, paddingLeft: 20, margin: 0 }}>
              <li>Abra <strong>@BotFather</strong> no Telegram e envie <code>/newbot</code></li>
              <li>Dê um nome e username ao bot (ex: <code>PredictsPeepBot</code>)</li>
              <li>Copie o <strong>token</strong> gerado (formato <code>123456:ABC-DEF...</code>)</li>
              <li>Adicione o bot no grupo/canal e envie uma mensagem</li>
              <li>Acesse <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> para pegar o <strong>chat_id</strong></li>
              <li>Edite <code>/opt/predicts/.env</code> e adicione as variáveis</li>
              <li>Execute <code>docker compose up -d api</code> para recarregar</li>
            </ol>
          </div>
        </div>
      )}

    </div>
  )
}

// ── Analysis Methodology Card ────────────────────────────────────────────────

function AnalysisMethodologyCard() {
  const [open, setOpen] = useState(false)
  const h4 = { fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6, marginTop: 12 }
  const pill = { display: 'inline-block', background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 7px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-2)', marginRight: 4, marginBottom: 4 }
  const row = { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--border)' }
  const label = { fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--text-1)', minWidth: 160 }
  const desc = { fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <button type="button"
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', background: 'var(--bg-overlay)', border: 'none', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-2)' }}>
        <span>📊 Metodologia — Como os Dados São Gerados</span>
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{open ? '▲ fechar' : '▼ ver'}</span>
      </button>
      {open && (
        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 12 }}>
            Para cada partida, o sistema coleta os dados abaixo e monta um prompt estruturado enviado ao modelo de IA selecionado.
            O modelo retorna um JSON com análise tática completa.
          </div>

          <div style={h4}>Dados Injetados no Prompt</div>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {[
              ['Elo Rating', 'Classificação Elo de cada seleção — calculada via histórico de resultados internacionais com fator K ajustado por importância da competição'],
              ['Forma Recente', 'Sequência V/E/D dos últimos 5 e 10 jogos — extraída do histórico de partidas registradas no banco'],
              ['Médias de Gol', 'avg_goals_for e avg_goals_against por jogo — calculadas sobre os últimos 20 jogos da seleção'],
              ['Expected Goals (xG/xGA)', 'Gols esperados marcados e sofridos — proxy baseado na qualidade das finalizações (dados Football-Data.org via sync)'],
              ['Convocação', 'Até 16 jogadores por posição (GOL / DEF / MEI / ATA) — sincronizados da Wikipedia via world_cup_sync.py no startup e a cada 1h'],
              ['Resultados nesta Copa', 'Últimos 5 jogos do torneio atual com placar real — extraídos da tabela match_results'],
              ['Monte Carlo', '1.000.000 simulações Poisson + Elo → prob_a / prob_draw / prob_b em % — lidas direto da tabela simulations_cache'],
              ['Fase / Grupo / Data', 'Contexto da partida: fase (group/R32/oitavas/quartas/semi/final), grupo e data (UTC)'],
            ].map(([l, d]) => (
              <div key={l} style={row}>
                <span style={label}>{l}</span>
                <span style={desc}>{d}</span>
              </div>
            ))}
          </div>

          <div style={h4}>Estrutura de Saída (JSON)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {[
              ['overview', '3 parágrafos: contexto, histórico Copa, momento atual'],
              ['team_a / team_b', 'tactical · key_players[] · form · strengths · weaknesses'],
              ['matchup', '2 parágrafos: batalha tática + fator X'],
              ['prediction', '2 parágrafos: desenvolvimento do jogo + placar provável'],
              ['verdict', 'Frase-síntese opinativa sobre o favorito'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{k}</span>
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', marginLeft: 8 }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={h4}>Variáveis Disponíveis no Template</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {[
              '{team_a_name}', '{team_b_name}', '{team_a_code}', '{team_b_code}',
              '{team_a_elo}', '{team_b_elo}', '{team_a_form5}', '{team_b_form5}',
              '{team_a_form10}', '{team_b_form10}', '{team_a_avg_gf}', '{team_b_avg_gf}',
              '{team_a_avg_ga}', '{team_b_avg_ga}', '{team_a_xg}', '{team_b_xg}',
              '{team_a_xga}', '{team_b_xga}', '{team_a_players}', '{team_b_players}',
              '{team_a_results}', '{team_b_results}', '{team_a_wc_apps}', '{team_b_wc_apps}',
              '{team_a_best}', '{team_b_best}', '{phase}', '{group_name}', '{match_date}', '{mc_probs}',
            ].map(v => <span key={v} style={pill}>{v}</span>)}
          </div>

          <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(15,122,120,0.08)', border: '1px solid rgba(15,122,120,0.2)', borderRadius: 8, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--accent)' }}>Fluxo:</strong> Sync Wikipedia (1h) → atualiza times/convocados/placares → Simulação Monte Carlo → cache em simulations_cache → Geração de análise IA (admin manual ou "Gerar todas") → cache em match_analyses → Exibição pública em /sim/:id e no painel de odds de cada jogo.
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


// ─── Analysis Progress Card ───────────────────────────────────────────────────

function AnalysisProgressCard({ progress, nowMs, onClose }) {
  const itemsRef = useRef(null)

  // auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (itemsRef.current) {
      itemsRef.current.scrollTop = itemsRef.current.scrollHeight
    }
  }, [progress.items?.length])

  const isRunning = progress.status === 'running'
  const isDone    = progress.status === 'done'
  const isError   = progress.status === 'error'

  const startedMs = progress.started_at ? new Date(progress.started_at + 'Z').getTime() : null
  const endedMs   = progress.ended_at   ? new Date(progress.ended_at + 'Z').getTime()   : null
  const elapsedMs = isRunning && startedMs ? nowMs - startedMs
    : (endedMs && startedMs) ? endedMs - startedMs : 0
  const elapsedStr = elapsedMs < 60000
    ? (elapsedMs / 1000).toFixed(0) + 's'
    : Math.floor(elapsedMs / 60000) + 'm ' + Math.floor((elapsedMs % 60000) / 1000) + 's'

  const items    = progress.items || []
  const okCount  = items.filter(i => i.status === 'ok').length
  const errCount = items.filter(i => i.status === 'error').length

  // pct: se total=0 e running → indeterminate (shimmer full), else % real
  const hasTotal = progress.total > 0
  const pct = hasTotal ? Math.round((progress.done / progress.total) * 100) : (isDone ? 100 : 0)
  const indeterminate = isRunning && !hasTotal

  const headerColor = isRunning ? 'var(--accent)'
    : isDone  ? 'var(--win)'
    : isError ? 'var(--lose)'
    : 'var(--text-3)'

  const headerTitle = isRunning && hasTotal
    ? `⚙️ Gerando… ${progress.done} de ${progress.total}`
    : isRunning
    ? '⚙️ Preparando geração…'
    : isDone
    ? `✓ Concluído — ${progress.done} de ${progress.total} análises`
    : isError ? '✗ Erro na geração'
    : 'Última geração'

  return (
    <div style={{
      background: 'var(--bg-card)', border: `1px solid ${headerColor}40`,
      borderRadius: 10, marginBottom: 20,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px',
        background: `${headerColor}10`,
        borderBottom: `1px solid ${headerColor}30`,
        borderRadius: '10px 10px 0 0',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: headerColor }}>
            {headerTitle}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>
            {progress.trigger === 'auto' ? '🤖 auto' : '👤 manual'}
            {progress.only_future ? ' · só futuros' : ''}
            {' · '}⏱ {elapsedStr}
            {isRunning && <span style={{ marginLeft: 6, color: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite' }}>● ao vivo</span>}
          </div>
        </div>
        {hasTotal && (
          <div style={{ textAlign: 'right', minWidth: 44 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: headerColor, lineHeight: 1 }}>{pct}%</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>{progress.done}/{progress.total}</div>
          </div>
        )}
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 16, padding: 4 }}>✕</button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: 'var(--bg-overlay)', position: 'relative', overflow: 'hidden' }}>
        {indeterminate ? (
          <div style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            background: `linear-gradient(90deg, transparent 0%, ${headerColor} 40%, transparent 100%)`,
            animation: 'progressSweep 1.5s ease-in-out infinite',
          }} />
        ) : (
          <>
            <div style={{
              height: '100%', background: headerColor,
              width: `${pct}%`, transition: 'width 800ms cubic-bezier(.4,0,.2,1)',
              borderRadius: '0 3px 3px 0',
            }} />
            {isRunning && pct > 0 && (
              <div style={{
                position: 'absolute', top: 0,
                left: `${Math.max(0, pct - 15)}%`, width: '15%', height: '100%',
                background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)`,
                animation: 'shimmer 1.5s ease-in-out infinite',
              }} />
            )}
          </>
        )}
      </div>

      {/* Currently processing row */}
      {isRunning && progress.current && (
        <div style={{
          padding: '7px 16px', fontFamily: 'var(--font-cond)', fontSize: 12,
          color: 'var(--text-3)', background: 'var(--bg-overlay)',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulse 1s ease-in-out infinite', display: 'inline-block' }} />
          <span style={{ color: 'var(--text-4)' }}>Gerando agora:</span>
          <strong style={{ color: 'var(--text-1)' }}>{progress.current}</strong>
        </div>
      )}

      {/* Items list — grows downward, newest at bottom, auto-scroll */}
      {items.length > 0 && (
        <div
          ref={itemsRef}
          style={{ maxHeight: 300, overflowY: 'auto', overflowAnchor: 'none' }}
        >
          {items.map((item, i) => (
            <div key={item.match_id || i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '8px 16px',
              borderBottom: '1px solid var(--border)',
              animation: 'slideIn 250ms ease',
            }}>
              <span style={{
                fontSize: 14, flexShrink: 0, marginTop: 1,
                color: item.status === 'ok' ? 'var(--win)' : 'var(--lose)',
              }}>
                {item.status === 'ok' ? '✓' : '✗'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 13,
                  color: item.status === 'ok' ? 'var(--text-1)' : 'var(--lose)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {item.teams || `#${item.match_id}`}
                </div>
                {item.status === 'error' && item.error && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--lose)', marginTop: 2 }}>
                    {item.error.slice(0, 100)}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>
                  {(item.model || '').split('/').pop()?.replace(':free', '') || '—'}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)' }}>
                  {item.duration_ms ? (item.duration_ms / 1000).toFixed(1) + 's' : '—'}
                </div>
              </div>
            </div>
          ))}
          {/* anchor div for auto-scroll */}
          <div id="progress-items-bottom" />
        </div>
      )}

      {/* Footer summary */}
      <div style={{
        display: 'flex', gap: 12, padding: '8px 16px', flexWrap: 'wrap',
        borderTop: items.length > 0 ? '1px solid var(--border)' : undefined,
        background: 'var(--bg-overlay)',
        borderRadius: '0 0 10px 10px',
        fontFamily: 'var(--font-cond)', fontSize: 12,
      }}>
        {okCount > 0  && <span style={{ color: 'var(--win)' }}>✓ {okCount} geradas</span>}
        {errCount > 0 && <span style={{ color: 'var(--lose)' }}>✗ {errCount} erros</span>}
        {!okCount && !errCount && isRunning && <span style={{ color: 'var(--text-4)' }}>Aguardando primeira análise…</span>}
        <span style={{ color: 'var(--text-4)', marginLeft: 'auto' }}>⏱ {elapsedStr}</span>
      </div>
    </div>
  )
}
