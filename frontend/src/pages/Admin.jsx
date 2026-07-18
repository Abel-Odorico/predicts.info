import { useState, useEffect, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { toPng } from 'html-to-image'
import {
  ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'
import { toast } from '../toast'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import ImageEditorModal from '../components/ImageEditorModal'
import TeamCrestFlag from '../components/TeamCrestFlag'

// Metadados de exibição dos 4 slots de provider da cadeia de Análise IA
// (espelha routers/analysis.py::PROVIDER_SLOT_LABELS / DEFAULT_PROVIDER_ORDER).
const PROVIDER_SLOT_META = {
  gemini:     { icon: '✦',  name: 'Gemini',     sub: 'chave 1' },
  gemini2:    { icon: '✦',  name: 'Gemini',     sub: 'chave 2 · fallback' },
  openai:     { icon: '⬡',  name: 'OpenAI',      sub: 'direto' },
  openrouter: { icon: '🔀', name: 'OpenRouter', sub: 'multi-modelo' },
}

function StatusDot({ color, title }) {
  return <span title={title} style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}

// Switch liga/desliga reutilizável (redesign LLM iteração 2, 2026-07-18) —
// nunca chama API sozinho, só reporta a mudança pro state via onChange.
function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`llm-switch${checked ? ' llm-switch--on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className="llm-switch__knob" />
    </button>
  )
}

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

function WaIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="#25D366" style={{ verticalAlign: '-2px' }} aria-label="WhatsApp">
      <path d="M16.04 2.67C8.65 2.67 2.65 8.67 2.65 16.05c0 2.37.62 4.68 1.8 6.72L2.53 29.33l6.73-1.87a13.36 13.36 0 006.77 1.85h.01c7.39 0 13.39-6 13.39-13.38 0-3.57-1.39-6.93-3.92-9.46a13.28 13.28 0 00-9.47-3.8zm0 24.48h-.01a11.1 11.1 0 01-5.67-1.55l-.41-.24-4 1.1 1.07-3.9-.26-.4a11.1 11.1 0 01-1.71-5.9c0-6.14 5-11.14 11.15-11.14 2.98 0 5.78 1.16 7.88 3.27a11.06 11.06 0 013.26 7.88c0 6.14-5.01 11.14-11.15 11.14v.01zm6.11-8.35c-.33-.17-1.97-.97-2.28-1.08-.31-.11-.53-.17-.75.17-.22.33-.86 1.08-1.06 1.31-.19.22-.39.25-.72.08-.33-.17-1.4-.51-2.66-1.63-.98-.88-1.65-1.96-1.84-2.29-.19-.33-.02-.51.15-.68.15-.15.33-.39.5-.58.17-.2.22-.33.33-.55.11-.22.06-.42-.03-.58-.08-.17-.75-1.8-1.03-2.47-.27-.65-.55-.56-.75-.57-.19-.01-.42-.01-.64-.01-.22 0-.58.08-.89.42-.31.33-1.17 1.14-1.17 2.79 0 1.64 1.2 3.22 1.37 3.45.17.22 2.36 3.6 5.71 5.05.8.34 1.42.55 1.9.71.8.25 1.53.22 2.11.13.64-.1 1.97-.8 2.25-1.58.28-.77.28-1.44.2-1.58-.08-.14-.31-.22-.64-.39z" />
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
  { id: 'bot',         label: 'Oráculo Predictor', icon: '🔮' },
  { id: 'report',      label: 'Relatório',    icon: <TgIcon size={20} /> },
  { id: 'competition', label: 'Competição',   icon: '⚡' },
  { id: 'news',        label: 'Notícias',     icon: '📰' },
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

function AdminModalShell({ onClose, children, maxWidth = 420 }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9800,
        background: 'rgba(3,8,14,0.75)', backdropFilter: 'blur(5px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in-1"
        style={{
          width: '100%', maxWidth, maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          padding: 'var(--s5)',
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

function EditUserModal({ editUser, setEditUser, editErr, saving, onSave, onClose }) {
  const field = (label, key, type = 'text') => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', marginBottom: 4 }}>
        {label}
      </label>
      <input
        type={type}
        className="form-input"
        value={editUser[key]}
        onChange={e => setEditUser(u => ({ ...u, [key]: e.target.value }))}
      />
    </div>
  )

  return (
    <AdminModalShell onClose={onClose}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-1)', margin: '0 0 4px' }}>
        Editar usuário
      </h3>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', marginBottom: 16 }}>
        ID {editUser.id}
      </div>
      {field('Nome', 'name')}
      {field('@Username', 'username')}
      {field('WhatsApp', 'phone')}
      {field('E-mail', 'email', 'email')}
      {editErr && (
        <div style={{ color: 'var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 13, marginBottom: 12 }}>
          {editErr}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onClose} disabled={saving}>
          Cancelar
        </button>
        <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={onSave} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </AdminModalShell>
  )
}

function ConfirmDeactivateModal({ targetUser, saving, onConfirm, onClose }) {
  return (
    <AdminModalShell onClose={onClose}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-1)', margin: '0 0 10px' }}>
        Desativar usuário
      </h3>
      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.5, margin: '0 0 8px' }}>
        <strong>{targetUser.name}</strong> ({targetUser.email}) perde acesso imediatamente. Nome, e-mail, @username e telefone são anonimizados — não dá pra desfazer nem recuperar esses dados depois.
      </p>
      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12.5, color: 'var(--text-4)', lineHeight: 1.5, margin: '0 0 16px' }}>
        Apostas, pontuação e histórico de ranking continuam intactos.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={onClose} disabled={saving}>
          Cancelar
        </button>
        <button
          className="btn btn-sm"
          style={{ flex: 1, background: 'var(--lose)', color: '#fff', border: 'none' }}
          onClick={onConfirm}
          disabled={saving}
        >
          {saving ? 'Desativando...' : 'Desativar'}
        </button>
      </div>
    </AdminModalShell>
  )
}

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
  const [emailMenu, setEmailMenu] = useState(null) // { userId, top, left }
  const [sendingEmailAction, setSendingEmailAction] = useState(null)
  const [editUser, setEditUser] = useState(null) // { id, name, username, phone, email }
  const [editSaving, setEditSaving] = useState(false)
  const [editErr, setEditErr] = useState('')
  const [confirmDeactivate, setConfirmDeactivate] = useState(null) // user row
  const [deactivatingId, setDeactivatingId] = useState(null)

  // Results
  const [matches, setMatches] = useState([])
  const [finishedMatches, setFinishedMatches] = useState([])
  const [matchesLoading, setMatchesLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [score, setScore] = useState({ a: '', b: '', xg_a: '', xg_b: '' })
  const [resultMsg, setResultMsg] = useState('')
  const [cacheMsg, setCacheMsg] = useState('')

  // Sync
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncPolling, setSyncPolling] = useState(false)
  const [syncReport, setSyncReport] = useState(null)
  const [syncReportLoading, setSyncReportLoading] = useState(false)

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

  // Notícias
  const [newsConfig, setNewsConfig] = useState(null)
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsRegenLoading, setNewsRegenLoading] = useState(false)
  const [newsMsg, setNewsMsg] = useState('')
  const [newSourceInput, setNewSourceInput] = useState('')

  function loadNewsConfig() {
    setNewsLoading(true)
    api.get('/admin/news/config', token)
      .then(setNewsConfig)
      .catch(() => setNewsMsg('Erro ao carregar configuração.'))
      .finally(() => setNewsLoading(false))
  }

  async function saveNewsSources(nextSources) {
    setNewsMsg('')
    try {
      const data = await api.put('/admin/news/config', { excluded_sources: nextSources }, token)
      setNewsConfig(data)
    } catch (e) {
      setNewsMsg(e.message || 'Erro ao salvar.')
    }
  }

  function removeExcludedSource(source) {
    saveNewsSources((newsConfig?.excluded_sources || []).filter(s => s !== source))
  }

  function addExcludedSource() {
    const v = newSourceInput.trim()
    if (!v) return
    const current = newsConfig?.excluded_sources || []
    if (current.includes(v)) { setNewSourceInput(''); return }
    saveNewsSources([...current, v])
    setNewSourceInput('')
  }

  async function regenerateNews() {
    setNewsRegenLoading(true)
    setNewsMsg('')
    try {
      const data = await api.post('/admin/news/regenerate', null, token)
      setNewsConfig(data)
      setNewsMsg('✓ Página de notícias regenerada.')
    } catch (e) {
      setNewsMsg(e.message || 'Erro ao regenerar.')
    } finally {
      setNewsRegenLoading(false)
    }
  }

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
  // WhatsApp — só o status pro badge do header; resto vive em AdminWhatsapp.jsx (/admin/whatsapp)
  const [waStatus, setWaStatus] = useState(null)

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
  const [analysisStats, setAnalysisStats]     = useState(null)
  const [statsLoading, setStatsLoading]       = useState(false)
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
    provider_order: ['gemini', 'gemini2', 'openai', 'openrouter'],
    fallback_enabled: true,
    paid_fallback_model: '',
    paid_fallback_enabled: true,
    daily_budget_usd: 1.5,
    disabled_slots: [],
    free_fallbacks_enabled: true,
  })
  // Saúde da cadeia (POST /admin/llm/test) — compartilhada entre o card de
  // Análise e o card do Oráculo (mesmo endpoint, cache 5min no backend).
  const [llmHealth, setLlmHealth]               = useState(null)
  const [llmHealthLoading, setLlmHealthLoading] = useState(false)

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
        provider_order: cfg.provider_order || ['gemini', 'gemini2', 'openai', 'openrouter'],
        fallback_enabled: cfg.fallback_enabled !== false,
        paid_fallback_model: cfg.paid_fallback_model || '',
        paid_fallback_enabled: cfg.paid_fallback_enabled !== false,
        daily_budget_usd: cfg.llm_daily_budget_usd ?? 1.5,
        disabled_slots: cfg.disabled_slots || [],
        free_fallbacks_enabled: cfg.free_fallbacks_enabled !== false,
      }))
    } catch {}
  }

  // Reordena a cadeia (troca posição idx com idx+dir). Opera sobre os 4 slots
  // (gemini/gemini2/openai/openrouter) — providers sem chave também podem ser
  // reordenados (útil pra já deixar pronto antes de configurar a chave).
  function moveProviderSlot(idx, dir) {
    setAForm(f => {
      const order = [...(f.provider_order || [])]
      const j = idx + dir
      if (j < 0 || j >= order.length) return f
      ;[order[idx], order[j]] = [order[j], order[idx]]
      return { ...f, provider_order: order }
    })
  }

  async function testLlmChain() {
    setLlmHealthLoading(true)
    try { setLlmHealth(await api.post('/admin/llm/test', {}, token)) }
    catch (e) { toast.error('Erro ao testar cadeia: ' + (e?.message || 'falha')) }
    finally { setLlmHealthLoading(false) }
  }

  // Entrada da cadeia real (analysisConfig.provider_chain, já na ordem de
  // produção) correspondente a 1 slot — usada pra casar com llmHealth.providers
  // pelo mesmo campo `label` (backend usa o mesmo texto nas duas respostas).
  function findChainEntry(slotId) {
    const chain = analysisConfig?.provider_chain || []
    if (slotId === 'gemini')     return chain.find(p => p.label === 'Gemini key1')
    if (slotId === 'gemini2')    return chain.find(p => p.label === 'Gemini key2')
    if (slotId === 'openai')     return chain.find(p => p.type === 'openai')
    if (slotId === 'openrouter') return chain.find(p => p.type === 'openrouter' && !p.paid && p.model === aForm.openrouter_model)
    return null
  }

  function slotStatusDot(slotId) {
    const entry = findChainEntry(slotId)
    const h = entry && llmHealth?.providers ? llmHealth.providers.find(p => p.label === entry.label) : null
    if (!h) return { color: 'var(--text-4)', title: 'Ainda não testado — clique em "Testar cadeia"' }
    return h.ok
      ? { color: 'var(--win)', title: `✓ ok · ${h.latency_ms}ms` }
      : { color: 'var(--lose)', title: `✗ ${h.error || 'falhou'}` }
  }

  // Latência do último teste de cadeia (POST /admin/llm/test) pro slot, ou
  // null se ainda não testado / sem entrada correspondente — usada no chip
  // de latência ao lado do StatusDot.
  function slotLatency(slotId) {
    const entry = findChainEntry(slotId)
    const h = entry && llmHealth?.providers ? llmHealth.providers.find(p => p.label === entry.label) : null
    return h?.ok ? h.latency_ms : null
  }

  // Liga/desliga um slot (aForm.disabled_slots) — só mexe no state local,
  // não salva sozinho (só ao clicar em "💾 Salvar config").
  function toggleSlotDisabled(slotId) {
    setAForm(f => {
      const cur = f.disabled_slots || []
      const next = cur.includes(slotId) ? cur.filter(s => s !== slotId) : [...cur, slotId]
      return { ...f, disabled_slots: next }
    })
  }

  // Posição efetiva na cadeia: pula slots sem chave (mesma regra do backend
  // _get_provider_chain) — o 1º slot COM CHAVE E HABILITADO na ordem é o
  // PRINCIPAL de fato. `position` é 1-based, só conta habilitados+com-chave,
  // e vem null quando `muted` (SEM CHAVE ou DESLIGADO) — usado no círculo ①②③.
  function slotPositionBadge(slotId) {
    const hasKey = analysisConfig?.provider_slots?.find(s => s.id === slotId)?.has_key
    const isDisabled = (aForm.disabled_slots || []).includes(slotId)
    if (isDisabled) return { label: 'DESLIGADO', muted: true, disabledSlot: true, position: null }
    if (!hasKey) return { label: 'SEM CHAVE', muted: true, position: null }
    const activeOrder = (aForm.provider_order || []).filter(
      id => analysisConfig?.provider_slots?.find(s => s.id === id)?.has_key
        && !(aForm.disabled_slots || []).includes(id)
    )
    const idx = activeOrder.indexOf(slotId)
    return idx === 0
      ? { label: 'PRINCIPAL', primary: true, position: 1 }
      : { label: `FALLBACK ${idx}`, muted: false, position: idx + 1 }
  }

  // ── Oráculo: mesmo padrão visual, mas primário = oracleForm.provider (fixo,
  // sem reordenar — a ordem interna de fallback do Oráculo é OR→OpenAI→Gemini,
  // decisão do backend, não editável aqui) ──────────────────────────────────
  function oracleSlotBadge(slotId) {
    const hasKey = slotId === 'gemini' ? oracleCfg?.gemini_has_key
      : slotId === 'openai' ? oracleCfg?.openai_has_key
      : oracleCfg?.openrouter_has_key
    if (oracleForm?.provider === slotId) return { label: 'PRINCIPAL', primary: true }
    return { label: 'FALLBACK', primary: false, dim: !hasKey }
  }

  function oracleSlotStatusDot(slotId) {
    // /admin/llm/test testa a config de ANÁLISE — só é fiel ao Oráculo quando
    // ele HERDA essa config (sem chave própria). Com chave dedicada, não dá
    // pra saber pelo teste global — mostra neutro em vez de arriscar falso ok/erro.
    if (oracleCfg?.llm_origin !== 'herdado (análise geral)') {
      return { color: 'var(--text-4)', title: 'Oráculo usa credencial própria — teste específico não disponível' }
    }
    return slotStatusDot(slotId)
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
    setAnalysisSaving(true)
    try {
      await api.post('/admin/analysis/config', { ...aForm, daily_budget_usd: Number(aForm.daily_budget_usd) || 0 }, token)
      toast.success('Configuração de IA salva com sucesso!')
      loadAnalysisConfig()
    } catch(err) { toast.error('Erro ao salvar: ' + (err?.message || 'falha')) }
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

  async function loadAnalysisStats() {
    setStatsLoading(true)
    try { setAnalysisStats(await api.get('/admin/analysis/stats', token)) } catch {}
    finally { setStatsLoading(false) }
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
        fallback_enabled: ocfg.fallback_enabled !== false,
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
    setOracleSaving(true)
    try {
      await api.post('/admin/bot/oracle-config', oracleForm, token)
      toast.success('Configuração do Oráculo salva')
      loadBot()
    } catch (e) { toast.error(e?.message || 'erro ao salvar') }
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

  async function loadWaStatus() {
    try { setWaStatus(await api.get('/admin/whatsapp/status', token)) }
    catch { /* badge só some/mostra "desconhecido", sem bloquear o resto do admin */ }
  }

  function toggleSeries(key) {
    setHiddenSeries(prev => ({ ...prev, [key]: !prev[key] }))
  }

  useEffect(() => {
    if (!user || user.role !== 'admin') { navigate('/'); return }
    loadUsers()
    loadSyncStatus()
    loadWaStatus()
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
    if (tab === 'analyses' && !analysisStats) loadAnalysisStats()
    if (tab === 'analyses') fetchProgress()
    if (tab === 'bot' && !botStatus && !botLoading) loadBot()
    if (tab === 'report' && !report && !reportLoading) loadReport()
    if (tab === 'sync' && !syncReport && !syncReportLoading) loadSyncReport()
    if (tab === 'news' && !newsConfig && !newsLoading) loadNewsConfig()
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

  useEffect(() => {
    if (!token || !user || user.role !== 'admin') return
    const iv = setInterval(loadWaStatus, 60000)
    return () => clearInterval(iv)
  }, [token, user])

  async function loadSyncStatus() {
    try { setSyncStatus(await api.get('/admin/sync-status', token)) } catch {}
  }

  async function loadSyncReport() {
    setSyncReportLoading(true)
    try { setSyncReport(await api.get('/admin/sync-report', token)) } catch {}
    setSyncReportLoading(false)
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
    try {
      // scheduled + live — não só scheduled: um jogo que já iniciou (status
      // live, por sync manual do football-data ou outra fonte) ainda precisa
      // aparecer aqui pro admin lançar o resultado quando acabar.
      const all = await api.get('/matches?limit=300')
      setMatches(all.filter(m => m.status !== 'finished'))
      setFinishedMatches(
        all.filter(m => m.status === 'finished' && m.result)
           .sort((a, b) => new Date(b.match_date) - new Date(a.match_date))
      )
    }
    catch { setMatches([]); setFinishedMatches([]) }
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
      const finishedMatch = selected
      setSelected(null)
      setScore({ a: '', b: '', xg_a: '', xg_b: '' })
      setMatches(m => m.filter(x => x.id !== finishedMatch.id))
      setFinishedMatches(f => [{ ...finishedMatch, status: 'finished', result: { score_a: sa, score_b: sb, xg_a: score.xg_a ? parseFloat(score.xg_a) : null, xg_b: score.xg_b ? parseFloat(score.xg_b) : null } }, ...f])
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

  async function sendAccountEmail(userId, action) {
    setUserMsg('')
    setSendingEmailAction(`${userId}:${action}`)
    setEmailMenu(null)
    try {
      const res = await api.post(`/admin/users/${userId}/send-account-email`, { action }, token)
      setUserMsg(`✓ ${res.message}`)
    } catch (e) { setUserMsg(`✗ ${e.message}`) }
    finally { setSendingEmailAction(null) }
  }

  function openEditUser(u) {
    setEditErr('')
    setEditUser({ id: u.id, name: u.name || '', username: u.username || '', phone: u.phone || '', email: u.email || '' })
  }

  async function saveEditUser() {
    if (!editUser) return
    setEditSaving(true)
    setEditErr('')
    try {
      const res = await api.patch(`/admin/users/${editUser.id}`, {
        name: editUser.name.trim(),
        username: editUser.username.trim(),
        phone: editUser.phone.trim(),
        email: editUser.email.trim(),
      }, token)
      setUsers(list => list.map(item => item.id === editUser.id ? { ...item, ...res } : item))
      setUserMsg(`✓ Usuário #${res.id} atualizado`)
      setEditUser(null)
    } catch (e) { setEditErr(e.message || 'Erro ao salvar') }
    finally { setEditSaving(false) }
  }

  async function deactivateUser(u) {
    setDeactivatingId(u.id)
    try {
      await api.post(`/admin/users/${u.id}/deactivate`, {}, token)
      setUsers(list => list.map(item => item.id === u.id
        ? { ...item, is_active: false, name: `Usuário removido #${u.id}`, email: `deleted_${u.id}@predicts.local`, username: null, phone: null }
        : item))
      setUserMsg(`✓ Usuário #${u.id} desativado`)
      setConfirmDeactivate(null)
    } catch (e) { setUserMsg(`✗ ${e.message}`) }
    finally { setDeactivatingId(null) }
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
          <button
            className="btn-ghost btn-sm"
            title={waStatus?.webhook && !waStatus.webhook.healthy ? 'Webhook com problema — aposta por WhatsApp pode não responder' : 'Status da conexão WhatsApp'}
            onClick={() => navigate('/admin/whatsapp')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, alignSelf: 'flex-start', padding: '4px 10px' }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
              background: waStatus?.instance?.state === 'open' ? 'var(--win)' : (waStatus?.instance?.state === 'connecting' ? '#f59e0b' : 'var(--lose)'),
            }} />
            WhatsApp {waStatus?.instance?.state === 'open' ? 'conectado' : waStatus?.instance?.state === 'connecting' ? 'conectando' : waStatus ? 'desconectado' : '…'}
            {waStatus?.webhook && !waStatus.webhook.healthy && <span title="Webhook com problema">⚠️</span>}
          </button>
        </div>
        <div className="adm-header__actions">
          <a href="/apostas"         className="btn btn-ghost btn-sm">🎯 Apostas</a>
          <a href="/resultados"      className="btn btn-ghost btn-sm">📋 Resultados</a>
          <a href="/admin/whatsapp"  className="btn btn-ghost btn-sm"><WaIcon /> WhatsApp</a>
          <a href="/admin/analytics" className="btn btn-ghost btn-sm">📊 Analytics</a>
          <a href="/admin/analytics?tab=audit" className="btn btn-ghost btn-sm">🔐 Auditoria</a>
          <a href="/admin/options"   className="btn btn-ghost btn-sm">⚙️ Config</a>
          <a href="/admin/sistema"   className="btn btn-ghost btn-sm">🧬 Sistema</a>
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
                  <tr key={u.id} className={u.role === 'admin' ? 'adm-table__row--admin' : ''} style={!u.is_active ? { opacity: 0.5 } : undefined}>
                    <td>
                      <div className="adm-table__name">
                        {u.name}
                        {!u.is_active && (
                          <span className="badge" style={{ marginLeft: 6, background: 'var(--bg-overlay)', color: 'var(--text-4)' }}>
                            desativado
                          </span>
                        )}
                      </div>
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
                          disabled={savingUserId === u.id || !u.is_active || (u.id === user.id && u.role === 'admin')}
                          onClick={() => updateUserRole(u.id, u.role === 'admin' ? 'user' : 'admin')}
                        >
                          {savingUserId === u.id ? '...' : u.role === 'admin' ? '− Admin' : '+ Admin'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Enviar e-mail de recuperação/troca"
                          disabled={!u.is_active}
                          onClick={(e) => {
                            if (emailMenu?.userId === u.id) { setEmailMenu(null); return }
                            const r = e.currentTarget.getBoundingClientRect()
                            setEmailMenu({ userId: u.id, top: r.bottom + 4, left: Math.max(8, r.right - 210) })
                          }}
                        >
                          ✉️
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Editar dados"
                          disabled={!u.is_active}
                          onClick={() => openEditUser(u)}
                        >
                          ✏️
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Desativar usuário"
                          disabled={!u.is_active || u.id === user.id}
                          onClick={() => setConfirmDeactivate(u)}
                          style={{ color: u.is_active ? 'var(--lose)' : undefined }}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {emailMenu && (
            <>
              <div
                onClick={() => setEmailMenu(null)}
                style={{ position: 'fixed', inset: 0, zIndex: 999 }}
              />
              <div style={{
                position: 'fixed', top: emailMenu.top, left: emailMenu.left, zIndex: 1000,
                background: 'var(--bg-raised, #111e2e)', border: '1px solid var(--border)',
                borderRadius: 6, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}>
                {[
                  ['password', '🔑 Recuperar senha'],
                  ['email',    '📧 Trocar e-mail'],
                  ['phone',    '📱 Trocar telefone'],
                ].map(([action, label]) => (
                  <button
                    key={action}
                    className="btn btn-ghost btn-sm"
                    style={{ justifyContent: 'flex-start', borderRadius: 0, textAlign: 'left' }}
                    disabled={sendingEmailAction === `${emailMenu.userId}:${action}`}
                    onClick={() => sendAccountEmail(emailMenu.userId, action)}
                  >
                    {sendingEmailAction === `${emailMenu.userId}:${action}` ? 'Enviando...' : label}
                  </button>
                ))}
              </div>
            </>
          )}

          {editUser && (
            <EditUserModal
              editUser={editUser}
              setEditUser={setEditUser}
              editErr={editErr}
              saving={editSaving}
              onSave={saveEditUser}
              onClose={() => setEditUser(null)}
            />
          )}

          {confirmDeactivate && (
            <ConfirmDeactivateModal
              targetUser={confirmDeactivate}
              saving={deactivatingId === confirmDeactivate.id}
              onConfirm={() => deactivateUser(confirmDeactivate)}
              onClose={() => setConfirmDeactivate(null)}
            />
          )}
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
          {/* Match list + finalizadas — juntas na coluna 1 */}
          <div className="stack">
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
                    {m.phase && m.phase !== 'group' ? (PHASE_LABELS_ADMIN[m.phase] || m.phase) : `G${m.group_name || '?'}`}
                  </span>
                  <span className="admin-match-row__teams">{m.team_a.code} vs {m.team_b.code}</span>
                  {m.status === 'live' && <span className="badge badge-live" style={{ fontSize: 9 }}>AO VIVO</span>}
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

          {/* Partidas já finalizadas */}
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Partidas Finalizadas</span>
              <span className="adm-card__meta">{finishedMatches.length} jogos</span>
            </div>
            <div className="admin-list" style={{ maxHeight: 420, overflowY: 'auto' }}>
              {!matchesLoading && finishedMatches.length === 0 && (
                <p style={{ padding: 'var(--s6)', color: 'var(--text-3)', textAlign: 'center', fontFamily: 'var(--font-cond)' }}>
                  Nenhuma partida finalizada ainda
                </p>
              )}
              {finishedMatches.map(m => (
                <div key={m.id} className="admin-match-row" style={{ cursor: 'default' }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', minWidth: 46 }}>
                    {m.phase && m.phase !== 'group' ? (PHASE_LABELS_ADMIN[m.phase] || m.phase) : `G${m.group_name || '?'}`}
                  </span>
                  <span className="admin-match-row__teams">{m.team_a.code} vs {m.team_b.code}</span>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>
                    {m.result?.score_a} × {m.result?.score_b}
                  </span>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>#{m.id}</span>
                </div>
              ))}
            </div>
          </div>
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
              {['Elo atualizado (K=32) automaticamente', 'Sistema Precisão: exato = 25 pts · resultado certo = 10 a 18 pts', 'Cache invalidado após resultado', 'xG refina simulações futuras'].map((l, i) => (
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

          {/* ── Relatório de sincronização ── */}
          <div className="adm-card" style={{ marginTop: 'var(--s4)' }}>
            <div className="adm-card__head">
              <span className="adm-card__title">📊 Relatório de Sincronização</span>
              <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
                {syncReport && (
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                    {new Date(syncReport.generated_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}
                  </span>
                )}
                <button className="btn btn-ghost btn-sm" onClick={loadSyncReport} disabled={syncReportLoading}>
                  {syncReportLoading ? '⏳' : '↻'}
                </button>
              </div>
            </div>
            <div style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
              {syncReportLoading && <div style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Carregando…</div>}

              {syncReport && (() => {
                const ch = syncReport.cron_health || {}
                const cronOk = ch.available && ch.on_schedule && !ch.last_run_errors?.length
                const cronWarn = ch.available && (!ch.on_schedule || ch.last_run_errors?.length > 0)

                const fmtTs = ts => ts
                  ? new Date(ts).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
                  : '—'

                const r32 = syncReport.phase_stats?.find(p => p.phase === 'r32')
                const r32Done = r32?.with_result === r32?.total && r32?.total > 0

                return (
                  <>
                    {/* ── Saúde do Cron ── */}
                    <div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 'var(--s2)' }}>Saúde do Cron</div>
                      {!ch.available ? (
                        <div style={{ color: 'var(--lose)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>✗ Log indisponível</div>
                      ) : (
                        <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          <div className="adm-sync-item">
                            <div className="adm-sync-item__label">Status</div>
                            <div className="adm-sync-item__val" style={{ color: cronOk ? 'var(--win)' : cronWarn ? 'var(--accent)' : 'var(--lose)' }}>
                              {cronOk ? '✓ Operacional' : cronWarn ? '⚠ Atenção' : '✗ Falha'}
                            </div>
                          </div>
                          <div className="adm-sync-item">
                            <div className="adm-sync-item__label">Último run</div>
                            <div className="adm-sync-item__val">{ch.last_run_ts ? fmtTs(ch.last_run_ts) : `arquivo: ${ch.last_modified_minutes_ago}min atrás`}</div>
                          </div>
                          <div className="adm-sync-item">
                            <div className="adm-sync-item__label">Atraso</div>
                            <div className="adm-sync-item__val" style={{ color: ch.on_schedule ? 'var(--win)' : 'var(--lose)' }}>
                              {ch.last_modified_minutes_ago?.toFixed(1)}min {ch.on_schedule ? '(≤10min ✓)' : '(atrasado ✗)'}
                            </div>
                          </div>
                          {ch.last_run_errors?.length > 0 && (
                            <div className="adm-sync-item" style={{ flexBasis: '100%' }}>
                              <div className="adm-sync-item__label">Erros no último run</div>
                              {ch.last_run_errors.map((e, i) => (
                                <div key={i} style={{ color: 'var(--lose)', fontFamily: 'var(--font-data)', fontSize: 11 }}>{e}</div>
                              ))}
                            </div>
                          )}
                          {ch.permission_error_ever && (
                            <div style={{ color: 'var(--accent)', fontFamily: 'var(--font-cond)', fontSize: 12, flexBasis: '100%' }}>
                              ⚠ Erro de permissão detectado no início do log (pode ter sido corrigido)
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Partidas de hoje ── */}
                    <div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 'var(--s2)' }}>
                        Hoje · {syncReport.today_matches?.length ?? 0} partida(s) eliminatória(s)
                      </div>
                      {syncReport.today_matches?.length === 0 ? (
                        <div style={{ color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>Nenhuma partida eliminatória hoje</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                          {syncReport.today_matches.map(m => {
                            const done = m.score !== null
                            const timeStr = m.match_date
                              ? new Date(m.match_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
                              : '—'
                            return (
                              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s2) var(--s3)', borderRadius: 6, background: 'var(--surface-2)', border: `1px solid ${done ? 'var(--win)' : 'var(--border)'}` }}>
                                <span style={{ color: done ? 'var(--win)' : 'var(--text-4)', fontSize: 14 }}>{done ? '✓' : '○'}</span>
                                <TeamCrestFlag src={m.team_a.flag_url} alt={m.team_a.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
                                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', minWidth: 32 }}>{m.team_a.code}</span>
                                {done
                                  ? <span style={{ fontFamily: 'var(--font-data)', fontSize: 15, color: 'var(--win)', fontWeight: 700, padding: '0 var(--s2)' }}>{m.score.a}–{m.score.b}</span>
                                  : <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: 'var(--text-4)', padding: '0 var(--s2)' }}>{timeStr}</span>
                                }
                                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', minWidth: 32, textAlign: 'right' }}>{m.team_b.code}</span>
                                <TeamCrestFlag src={m.team_b.flag_url} alt={m.team_b.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
                                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>#{m.match_number} · {m.phase}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* ── Anomalias ── */}
                    <div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 'var(--s2)' }}>Anomalias</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                        {syncReport.anomalies?.map((a, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', padding: 'var(--s2) var(--s3)', borderRadius: 6, background: 'var(--surface-2)', fontFamily: 'var(--font-cond)', fontSize: 13, color: a.level === 'error' ? 'var(--lose)' : a.level === 'warning' ? 'var(--accent)' : 'var(--win)' }}>
                            <span>{a.level === 'error' ? '✗' : a.level === 'warning' ? '⚠' : '✓'}</span>
                            <span style={{ color: a.level === 'ok' ? 'var(--text-3)' : undefined }}>{a.msg}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── R32 grid ── */}
                    <div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 'var(--s2)' }}>
                        R32 — {r32?.with_result ?? 0}/{r32?.total ?? 16} com resultado
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 'var(--s2)' }}>
                        {syncReport.r32_matches?.map(m => {
                          const done = m.score !== null
                          return (
                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', padding: 'var(--s2) var(--s3)', borderRadius: 6, background: 'var(--surface-2)', border: `1px solid ${done ? 'var(--win)' : 'var(--border)'}`, fontSize: 12, fontFamily: 'var(--font-cond)' }}>
                              <span style={{ color: done ? 'var(--win)' : 'var(--text-4)', fontSize: 11, minWidth: 10 }}>{done ? '✓' : '○'}</span>
                              <TeamCrestFlag src={m.team_a.flag_url} alt="" style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />
                              <span style={{ color: 'var(--text-2)', flex: 1 }}>{m.team_a.code} × {m.team_b.code}</span>
                              <TeamCrestFlag src={m.team_b.flag_url} alt="" style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />
                              {done
                                ? <span style={{ color: 'var(--win)', fontFamily: 'var(--font-data)', whiteSpace: 'nowrap', fontWeight: 700 }}>{m.score.a}–{m.score.b}</span>
                                : <span style={{ color: 'var(--text-4)', fontSize: 10 }}>#{m.match_number}</span>
                              }
                              {m.bets > 0 && <span style={{ color: 'var(--text-4)', fontSize: 10, marginLeft: 'var(--s1)' }}>{m.bets}ap</span>}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* ── Log cron ── */}
                    {syncReport.cron_log?.length > 0 && (
                      <div>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 'var(--s2)' }}>
                          Log Cron {ch.last_run_ts ? `· ${fmtTs(ch.last_run_ts)}` : ''}
                        </div>
                        <div className="admin-log" style={{ maxHeight: 220 }}>
                          {syncReport.cron_log.map((line, i) => (
                            <div key={i} style={{ color: line.startsWith('===') ? 'var(--accent)' : line.startsWith('✓') ? 'var(--win)' : line.startsWith('✗') ? 'var(--lose)' : line.startsWith('⚠') ? 'var(--accent)' : 'var(--text-3)' }}>{line}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
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

      {/* ── Tab: Notícias ─────────────────────────────── */}
      {tab === 'news' && (
        <div className="adm-pane fade-in-1">
          <div className="adm-card">
            <div className="adm-card__head">
              <span className="adm-card__title">Notícias &amp; Trending — /noticias</span>
              <a href="/noticias" target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Ver página →</a>
            </div>
            <div style={{ padding: 'var(--s5)', display: 'grid', gap: 'var(--s5)' }}>

              {newsLoading && !newsConfig ? (
                <Spinner text="Carregando..." />
              ) : (
                <>
                  {/* Status */}
                  <div style={{ display: 'flex', gap: 'var(--s5)', flexWrap: 'wrap' }}>
                    <div>
                      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.06em', margin: 0 }}>ÚLTIMA GERAÇÃO</p>
                      <p style={{ fontFamily: 'var(--font-data)', fontSize: 14, color: 'var(--text-1)', margin: '4px 0 0' }}>
                        {newsConfig?.last_generated ? new Date(newsConfig.last_generated).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.06em', margin: 0 }}>NOTÍCIAS</p>
                      <p style={{ fontFamily: 'var(--font-data)', fontSize: 14, color: 'var(--accent)', margin: '4px 0 0' }}>{newsConfig?.news_count ?? '—'}</p>
                    </div>
                    <div>
                      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.06em', margin: 0 }}>TRENDING TOPICS</p>
                      <p style={{ fontFamily: 'var(--font-data)', fontSize: 14, color: 'var(--accent)', margin: '4px 0 0' }}>{newsConfig?.trends_count ?? '—'}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ justifySelf: 'start' }}
                    onClick={regenerateNews}
                    disabled={newsRegenLoading}
                  >
                    {newsRegenLoading ? 'Regenerando...' : '🔄 Regenerar agora'}
                  </button>

                  {/* Fontes excluídas */}
                  <div>
                    <p style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-1)', marginBottom: 8 }}>
                      Fontes excluídas (bloqueadas)
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {(newsConfig?.excluded_sources || []).length === 0 ? (
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>Nenhuma fonte bloqueada.</span>
                      ) : newsConfig.excluded_sources.map(s => (
                        <span key={s} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 999,
                          padding: '4px 6px 4px 12px', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)',
                        }}>
                          {s}
                          <button
                            type="button"
                            onClick={() => removeExcludedSource(s)}
                            style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--bg-3, rgba(255,255,255,0.08))', color: 'var(--text-3)', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}
                            title="Remover bloqueio"
                          >✕</button>
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={newSourceInput}
                        onChange={e => setNewSourceInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addExcludedSource() }}
                        placeholder="Nome exato da fonte (ex: UOL, Rádio Itatiaia)"
                        style={{ flex: 1, maxWidth: 320, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13 }}
                      />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={addExcludedSource}>+ Bloquear</button>
                    </div>
                    <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 8 }}>
                      O nome deve bater exatamente com o exibido na pílula da notícia (ex: "UOL", "O Globo").
                      Aplica na próxima geração — use "Regenerar agora" pra ver o efeito na hora.
                    </p>
                  </div>

                  {newsMsg && <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: newsMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>{newsMsg}</p>}
                </>
              )}
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
                            <TeamCrestFlag src={s.flag} alt={s.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
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
                              <TeamCrestFlag src={p.champion.flag} alt={p.champion.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
                              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600 }}>{p.champion.name}</span>
                            </div>
                          ) : <span style={{ fontSize: 11, color: 'var(--text-4)' }}>não escolheu</span>}
                        </td>
                        <td style={{ padding: '9px 16px' }}>
                          {p.runner_up ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <TeamCrestFlag src={p.runner_up.flag} alt={p.runner_up.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
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
          {/* Cadeia de Análise IA (redesign 2026-07-18) */}
          <div className="adm-card">
            <div className="adm-card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span className="adm-card__title">🧠 Cadeia de Análise IA</span>
              <button type="button" className="btn btn-sm" onClick={testLlmChain} disabled={llmHealthLoading}>
                {llmHealthLoading ? '… testando' : '▶ Testar cadeia'}
              </button>
            </div>
            <div className="adm-card__body">
              <form onSubmit={saveAnalysisConfig} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Modo de operação: principal+fallback ou somente principal */}
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    MODO DE OPERAÇÃO
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button"
                      className={`btn btn-sm${aForm.fallback_enabled ? ' btn-primary' : ' btn-ghost'}`}
                      onClick={() => setAForm(f => ({ ...f, fallback_enabled: true }))}
                    >🔗 Principal + fallbacks</button>
                    <button type="button"
                      className={`btn btn-sm${!aForm.fallback_enabled ? ' btn-primary' : ' btn-ghost'}`}
                      onClick={() => setAForm(f => ({ ...f, fallback_enabled: false }))}
                    >1️⃣ Somente principal</button>
                  </div>
                  {!aForm.fallback_enabled && (
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--lose)', marginTop: 6 }}>
                      ⚠️ Se o provider principal falhar (quota/erro), a geração falha direto — não tenta os demais.
                    </div>
                  )}
                </div>

                {/* Linhas da cadeia, na ordem configurada — reordenável */}
                <div className="llm-chain">
                  {(aForm.provider_order || []).map((slotId, idx) => {
                    const meta = PROVIDER_SLOT_META[slotId] || { icon: '❓', name: slotId, sub: '' }
                    const iconClass = slotId.startsWith('gemini') ? 'gemini' : slotId
                    const badge = slotPositionBadge(slotId)
                    const dot = slotStatusDot(slotId)
                    const lat = slotLatency(slotId)
                    const isDisabled = (aForm.disabled_slots || []).includes(slotId)
                    const dimmed = (!aForm.fallback_enabled && !badge.primary) || isDisabled
                    const hasKey = analysisConfig?.provider_slots?.find(s => s.id === slotId)?.has_key
                    return (
                      <Fragment key={slotId}>
                        {idx > 0 && <div className="llm-connector" />}
                        <div className="llm-node" style={{
                          border: `1px solid ${badge.primary ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 10, padding: '14px 16px',
                          opacity: dimmed ? 0.45 : 1, transition: 'opacity 150ms',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                          <span className={`llm-node__num${badge.primary ? ' llm-node__num--primary' : ''}`}>
                            {badge.position ?? ''}
                          </span>
                          <span className={`llm-node__icon llm-node__icon--${iconClass}`}>{meta.icon}</span>
                          <span className="badge" style={{
                            background: badge.primary ? 'var(--accent)' : 'var(--bg-overlay)',
                            color: badge.primary ? 'var(--on-accent)' : 'var(--text-3)',
                            border: `1px solid ${badge.primary ? 'var(--accent)' : 'var(--border-strong)'}`,
                          }}>{badge.label}</span>
                          <StatusDot color={dot.color} title={dot.title} />
                          {lat != null && <span className="llm-latency-chip">{lat}ms</span>}
                          <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-2)' }}>
                            {meta.name} <span style={{ fontWeight: 400, color: 'var(--text-4)', fontSize: 11 }}>({meta.sub})</span>
                          </span>
                          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Switch checked={!isDisabled} onChange={() => toggleSlotDisabled(slotId)} label={`Ligar/desligar ${meta.name} (${meta.sub})`} />
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}
                                disabled={idx === 0} onClick={() => moveProviderSlot(idx, -1)} title="Mover para cima">↑</button>
                              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}
                                disabled={idx === (aForm.provider_order.length - 1)} onClick={() => moveProviderSlot(idx, 1)} title="Mover para baixo">↓</button>
                            </div>
                          </div>
                        </div>

                        {slotId === 'gemini' && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Chave {analysisConfig?.gemini_has_key && <span style={{ color: 'var(--win)' }}>✓ {analysisConfig.gemini_key_masked}</span>}
                              <input className="form-input" type="password"
                                placeholder={analysisConfig?.gemini_has_key ? '••• (vazio = manter)' : 'AIzaSy...'}
                                value={aForm.gemini_key}
                                onChange={e => setAForm(f => ({ ...f, gemini_key: e.target.value }))}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Modelo (compartilhado entre as 2 chaves)
                              <select className="form-input" value={aForm.gemini_model} onChange={e => setAForm(f => ({ ...f, gemini_model: e.target.value }))}>
                                {(analysisConfig?.gemini_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                            </label>
                          </div>
                        )}

                        {slotId === 'gemini2' && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Chave {analysisConfig?.gemini_has_key_2 && <span style={{ color: 'var(--win)' }}>✓ {analysisConfig.gemini_key_2_masked}</span>}
                              <input className="form-input" type="password"
                                placeholder={analysisConfig?.gemini_has_key_2 ? '••• (vazio = manter)' : 'AIzaSy... (segunda conta Google AI Studio)'}
                                value={aForm.gemini_key_2}
                                onChange={e => setAForm(f => ({ ...f, gemini_key_2: e.target.value }))}
                              />
                            </label>
                            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', alignSelf: 'end' }}>
                              Usa o mesmo modelo da chave 1, quota separada (2ª conta Google AI Studio).
                            </div>
                          </div>
                        )}

                        {slotId === 'openai' && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Chave {analysisConfig?.openai_has_key && <span style={{ color: 'var(--win)' }}>✓ {analysisConfig.openai_key_masked}</span>}
                              <input className="form-input" type="password"
                                placeholder={analysisConfig?.openai_has_key ? '••• (vazio = manter)' : 'sk-...'}
                                value={aForm.openai_key}
                                onChange={e => setAForm(f => ({ ...f, openai_key: e.target.value }))}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Modelo
                              <select className="form-input" value={aForm.openai_model} onChange={e => setAForm(f => ({ ...f, openai_model: e.target.value }))}>
                                {(analysisConfig?.openai_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                            </label>
                          </div>
                        )}

                        {slotId === 'openrouter' && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Chave {analysisConfig?.openrouter_has_key && <span style={{ color: 'var(--win)' }}>✓ {analysisConfig.openrouter_key_masked}</span>}
                              <input className="form-input" type="password"
                                placeholder={analysisConfig?.openrouter_has_key ? '••• (vazio = manter)' : 'sk-or-v1-...'}
                                value={aForm.openrouter_key}
                                onChange={e => setAForm(f => ({ ...f, openrouter_key: e.target.value }))}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              🆓 Modelo principal (grátis)
                              <select className="form-input"
                                value={analysisConfig?.openrouter_free_models?.find(m => m.id === aForm.openrouter_model) ? aForm.openrouter_model : ''}
                                onChange={e => e.target.value && setAForm(f => ({ ...f, openrouter_model: e.target.value }))}>
                                <option value="">— selecionar —</option>
                                {(analysisConfig?.openrouter_free_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              💎 Ou modelo pago como principal
                              <select className="form-input"
                                value={analysisConfig?.openrouter_paid_models?.find(m => m.id === aForm.openrouter_model) ? aForm.openrouter_model : ''}
                                onChange={e => e.target.value && setAForm(f => ({ ...f, openrouter_model: e.target.value }))}>
                                <option value="">— selecionar —</option>
                                {(analysisConfig?.openrouter_paid_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                            </label>
                          </div>
                        )}

                        {!hasKey && (
                          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 8 }}>
                            Sem chave configurada — este provider é pulado automaticamente na cadeia.
                          </div>
                        )}
                        </div>
                      </Fragment>
                    )
                  })}
                </div>

                {/* Rede de segurança — fallbacks free/pago do OpenRouter */}
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.07em', marginBottom: 10 }}>
                    🛟 REDE DE SEGURANÇA (OPENROUTER)
                  </div>
                  <div style={{ opacity: aForm.fallback_enabled ? 1 : 0.45, transition: 'opacity 150ms', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="llm-node llm-node--safety">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                        <span className="llm-node__icon llm-node__icon--free">🆓</span>
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', flex: '1 1 200px' }}>
                          Fallbacks gratuitos automáticos (tentados em sequência se o principal falhar)
                        </span>
                        <Switch checked={aForm.free_fallbacks_enabled}
                          onChange={v => setAForm(f => ({ ...f, free_fallbacks_enabled: v }))}
                          label="Ligar/desligar fallbacks gratuitos" />
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: aForm.free_fallbacks_enabled ? 1 : 0.45, transition: 'opacity 150ms' }}>
                        {analysisConfig?.openrouter_has_key ? (
                          (analysisConfig?.provider_chain || [])
                            .filter(p => p.type === 'openrouter' && !p.paid && p.model !== aForm.openrouter_model)
                            .map((p, i) => (
                              <span key={i} className="badge" style={{ background: 'var(--bg-overlay)', color: 'var(--text-3)', border: '1px solid var(--border-strong)' }}>
                                {p.model.split('/').pop()}
                              </span>
                            ))
                        ) : (
                          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>Configure a chave OpenRouter acima para ativar.</span>
                        )}
                      </div>
                    </div>

                    <div className="llm-node llm-node--safety">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                        <span className="llm-node__icon llm-node__icon--paid">💎</span>
                        <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--text-2)', flex: '1 1 200px' }}>
                          Fallback pago (último recurso da cadeia)
                        </span>
                        <Switch checked={aForm.paid_fallback_enabled}
                          onChange={v => setAForm(f => ({ ...f, paid_fallback_enabled: v }))}
                          label="Ligar/desligar fallback pago" />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, opacity: aForm.paid_fallback_enabled ? 1 : 0.5 }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                          Modelo pago
                          <select className="form-input" disabled={!aForm.paid_fallback_enabled}
                            value={aForm.paid_fallback_model}
                            onChange={e => setAForm(f => ({ ...f, paid_fallback_model: e.target.value }))}>
                            {(analysisConfig?.openrouter_paid_models || []).map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                          Budget diário (US$)
                          <input className="form-input" type="number" step="0.1" min="0" disabled={!aForm.paid_fallback_enabled}
                            value={aForm.daily_budget_usd}
                            onChange={e => setAForm(f => ({ ...f, daily_budget_usd: e.target.value }))} />
                        </label>
                      </div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 8 }}>
                        Ao estourar o budget do dia (UTC), o pago é pulado — a cadeia segue só com os gratuitos e um alerta é enviado (Telegram).
                      </div>
                    </div>
                  </div>
                </div>

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
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { loadAnalysisConfig(); loadAnalysisStatus(); loadAnalysisStats(); toast.info('Atualizado!') }}>↻ Atualizar</button>
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
                      {logsLoading ? '⏳ Carregando…' : '📋 Ver logs detalhados'}
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

          {/* ── Painel de Consumo IA ── */}
          {(analysisStats || statsLoading) && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>📊 Consumo IA</div>
                <button type="button" onClick={loadAnalysisStats} disabled={statsLoading}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                  {statsLoading ? '⏳' : '↻ atualizar'}
                </button>
              </div>

              {analysisStats && (<>
                {/* Cards de totais */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 20 }}>
                  {[
                    { label: 'Geradas (ok)', val: analysisStats.totals.ok, color: 'var(--win)' },
                    { label: 'Erros', val: analysisStats.totals.error, color: analysisStats.totals.error > 0 ? 'var(--lose)' : 'var(--text-3)' },
                    { label: 'Taxa sucesso', val: analysisStats.totals.ok + analysisStats.totals.error > 0
                        ? Math.round(100 * analysisStats.totals.ok / (analysisStats.totals.ok + analysisStats.totals.error)) + '%'
                        : '—', color: 'var(--accent)' },
                    { label: 'Tokens entrada', val: (analysisStats.totals.tokens_in ?? 0).toLocaleString() },
                    { label: 'Tokens saída', val: (analysisStats.totals.tokens_out ?? 0).toLocaleString() },
                    { label: 'Custo total', val: '$' + (analysisStats.totals.cost_usd || 0).toFixed(4) },
                    { label: 'Tempo médio', val: analysisStats.totals.avg_ms >= 60000
                        ? Math.floor(analysisStats.totals.avg_ms/60000) + 'm'
                        : (analysisStats.totals.avg_ms/1000).toFixed(1) + 's' },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ background: 'var(--bg-base)', borderRadius: 8, padding: '8px 10px', border: '1px solid var(--border)' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: color || 'var(--text-1)' }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Gráfico diário (últimos 14 dias) */}
                {analysisStats.by_day?.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 8 }}>Atividade — últimos 14 dias</div>
                    <ResponsiveContainer width="100%" height={130}>
                      <ComposedChart data={analysisStats.by_day} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--text-4)', fontFamily: 'var(--font-mono)' }}
                          tickFormatter={v => v?.slice(5)} />
                        <YAxis yAxisId="cnt" tick={{ fontSize: 9, fill: 'var(--text-4)' }} width={22} allowDecimals={false} />
                        <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 9, fill: 'var(--text-4)' }} width={38}
                          tickFormatter={v => v > 0 ? '$' + v.toFixed(3) : '0'} />
                        <Tooltip
                          contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                          formatter={(v, name) => name === 'Custo' ? ['$' + Number(v).toFixed(4), name] : [v, name]}
                          labelFormatter={l => 'Dia ' + l}
                        />
                        <Bar yAxisId="cnt" dataKey="ok" name="Geradas" fill="var(--accent)" radius={[3,3,0,0]} maxBarSize={28} />
                        <Bar yAxisId="cnt" dataKey="error" name="Erros" fill="var(--lose)" radius={[3,3,0,0]} maxBarSize={28} />
                        <Area yAxisId="cost" type="monotone" dataKey="cost_usd" name="Custo" stroke="#f5a623" fill="rgba(245,166,35,0.12)" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Tabela por provider/modelo */}
                {analysisStats.by_provider?.length > 0 && (
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', marginBottom: 8 }}>Por provider/modelo</div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                        <thead>
                          <tr style={{ color: 'var(--text-4)', borderBottom: '1px solid var(--border)' }}>
                            {['Modelo', 'Provider', '✓ Ok', '✗ Err', '%', 'T.In', 'T.Out', 'Custo', 'T.Médio'].map(h => (
                              <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600, fontSize: 10 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {analysisStats.by_provider.map((p, i) => {
                            const total = p.ok + p.error
                            const rate = total > 0 ? Math.round(100 * p.ok / total) : null
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}>
                                <td style={{ padding: '5px 8px', fontWeight: 600 }}>{p.model}</td>
                                <td style={{ padding: '5px 8px' }}>
                                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                                    background: p.provider === 'gemini' ? 'rgba(66,133,244,0.15)' : p.provider === 'openai' ? 'rgba(16,163,127,0.15)' : 'rgba(245,166,35,0.15)',
                                    color: p.provider === 'gemini' ? '#4285f4' : p.provider === 'openai' ? '#10a37f' : '#f5a623',
                                  }}>{p.provider}</span>
                                </td>
                                <td style={{ padding: '5px 8px', color: 'var(--win)' }}>{p.ok}</td>
                                <td style={{ padding: '5px 8px', color: p.error > 0 ? 'var(--lose)' : 'var(--text-4)' }}>{p.error}</td>
                                <td style={{ padding: '5px 8px', color: rate >= 80 ? 'var(--win)' : rate >= 50 ? '#f5a623' : 'var(--lose)' }}>
                                  {rate !== null ? rate + '%' : '—'}
                                </td>
                                <td style={{ padding: '5px 8px' }}>{p.tokens_in ? p.tokens_in.toLocaleString() : '—'}</td>
                                <td style={{ padding: '5px 8px' }}>{p.tokens_out ? p.tokens_out.toLocaleString() : '—'}</td>
                                <td style={{ padding: '5px 8px', fontWeight: p.cost_usd > 0 ? 600 : 400, color: p.cost_usd > 0 ? 'var(--text-1)' : 'var(--win)' }}>
                                  {p.cost_usd > 0 ? '$' + p.cost_usd.toFixed(4) : 'free'}
                                </td>
                                <td style={{ padding: '5px 8px' }}>{p.avg_ms >= 1000 ? (p.avg_ms/1000).toFixed(1) + 's' : p.avg_ms + 'ms'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>)}
            </div>
          )}

          {/* Logs de geração IA (detalhados, sob demanda) */}
          {analysisLogs && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 20px', marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>📋 Logs Detalhados (últimas 100 gerações)</div>
                <button type="button" onClick={() => setAnalysisLogs(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 16 }}>✕</button>
              </div>
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
                        <td style={{ padding: '4px 8px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.model_used || '—'}</td>
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
                        {botStatus.champion.flag && <TeamCrestFlag src={botStatus.champion.flag} alt="" style={{ width: 24, height: 17, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />}
                        <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13 }}>🏆 {botStatus.champion.name}</span>
                      </div>
                    )}
                    {botStatus.vice && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-overlay)', borderRadius: 8, padding: '8px 14px', border: '1px solid var(--border)' }}>
                        {botStatus.vice.flag && <TeamCrestFlag src={botStatus.vice.flag} alt="" style={{ width: 24, height: 17, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />}
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

          {/* IA dedicada do Oráculo (redesign 2026-07-18 — mesmo padrão do card de Análise) */}
          {botStatus?.exists && oracleCfg && oracleForm && (
            <div className="adm-card">
              <div className="adm-card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <span className="adm-card__title">🧠 IA do Oráculo (dedicada)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: oracleCfg.active_llm ? 'var(--win)' : 'var(--lose)' }}>
                    {oracleCfg.active_llm ? `Ativa: ${oracleCfg.active_llm} · ${oracleCfg.llm_origin}` : 'Nenhuma IA disponível'}
                  </span>
                  <button type="button" className="btn btn-sm" onClick={testLlmChain} disabled={llmHealthLoading}>
                    {llmHealthLoading ? '… testando' : '▶ Testar'}
                  </button>
                </div>
              </div>
              <div className="adm-card__body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                  IA exclusiva do Oráculo, separada da análise de partidas. Se nenhuma chave for definida aqui, ele herda a IA da aba Análises.
                </div>

                {/* Modo de operação */}
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    MODO DE OPERAÇÃO
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Switch checked={oracleForm.fallback_enabled}
                      onChange={v => setOracleForm({ ...oracleForm, fallback_enabled: v })}
                      label="Ligar/desligar fallback do Oráculo" />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>
                      {oracleForm.fallback_enabled ? '🔗 Principal + fallback' : '1️⃣ Somente principal'}
                    </span>
                  </div>
                  {!oracleForm.fallback_enabled && (
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--lose)', marginTop: 6 }}>
                      ⚠️ Se {oracleForm.provider} falhar, o Oráculo cai pro modelo estatístico (Monte Carlo/Elo) — não tenta outra IA.
                    </div>
                  )}
                </div>

                {/* Linhas de provider — clique na linha define o primário (oracle_provider) */}
                <div className="llm-chain">
                  {['gemini', 'openai', 'openrouter'].map((slotId, idx) => {
                    const meta = PROVIDER_SLOT_META[slotId]
                    const iconClass = slotId.startsWith('gemini') ? 'gemini' : slotId
                    const badge = oracleSlotBadge(slotId)
                    const dot = oracleSlotStatusDot(slotId)
                    const lat = slotLatency(slotId)
                    const dimmed = !oracleForm.fallback_enabled && !badge.primary
                    return (
                      <Fragment key={slotId}>
                        {idx > 0 && <div className="llm-connector" />}
                        <div className="llm-node" style={{
                          border: `1px solid ${badge.primary ? 'var(--accent)' : 'var(--border)'}`,
                          borderRadius: 10, padding: '14px 16px',
                          opacity: dimmed ? 0.45 : 1, transition: 'opacity 150ms',
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                          <span className={`llm-node__icon llm-node__icon--${iconClass}`}>{meta.icon}</span>
                          <button type="button" className="badge" style={{
                            background: badge.primary ? 'var(--accent)' : 'var(--bg-overlay)',
                            color: badge.primary ? 'var(--on-accent)' : 'var(--text-3)',
                            border: `1px solid ${badge.primary ? 'var(--accent)' : 'var(--border-strong)'}`,
                            cursor: 'pointer',
                          }} onClick={() => setOracleForm({ ...oracleForm, provider: slotId })}
                             title="Tornar este o provider principal do Oráculo">
                            {badge.primary ? 'PRINCIPAL' : 'FALLBACK · tornar principal'}
                          </button>
                          <StatusDot color={dot.color} title={dot.title} />
                          {lat != null && <span className="llm-latency-chip">{lat}ms</span>}
                          <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-2)' }}>
                            {meta.name}
                          </span>
                        </div>

                        {slotId === 'gemini' && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Chave {oracleCfg.gemini_has_key && <span style={{ color: 'var(--win)' }}>✓ {oracleCfg.gemini_key_masked}</span>}
                              <input className="form-input" type="password" placeholder="AIzaSy…" value={oracleForm.gemini_key} onChange={e => setOracleForm({ ...oracleForm, gemini_key: e.target.value })} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Modelo
                              <select className="form-input" value={oracleForm.gemini_model} onChange={e => setOracleForm({ ...oracleForm, gemini_model: e.target.value })}>
                                {oracleCfg.gemini_models?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                            </label>
                          </div>
                        )}

                        {slotId === 'openai' && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Chave {oracleCfg.openai_has_key && <span style={{ color: 'var(--win)' }}>✓ {oracleCfg.openai_key_masked}</span>}
                              <input className="form-input" type="password" placeholder="sk-…" value={oracleForm.openai_key} onChange={e => setOracleForm({ ...oracleForm, openai_key: e.target.value })} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Modelo
                              <select className="form-input" value={oracleForm.openai_model} onChange={e => setOracleForm({ ...oracleForm, openai_model: e.target.value })}>
                                {oracleCfg.openai_models?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                              </select>
                            </label>
                          </div>
                        )}

                        {slotId === 'openrouter' && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Chave {oracleCfg.openrouter_has_key && <span style={{ color: 'var(--win)' }}>✓ {oracleCfg.openrouter_key_masked}</span>}
                              <input className="form-input" type="password" placeholder="sk-or-v1-…" value={oracleForm.openrouter_key} onChange={e => setOracleForm({ ...oracleForm, openrouter_key: e.target.value })} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
                              Modelo
                              <select className="form-input" value={oracleForm.openrouter_model} onChange={e => setOracleForm({ ...oracleForm, openrouter_model: e.target.value })}>
                                <optgroup label="Grátis">{oracleCfg.openrouter_free_models?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
                                <optgroup label="Pagos">{oracleCfg.openrouter_paid_models?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
                              </select>
                            </label>
                          </div>
                        )}
                        </div>
                      </Fragment>
                    )
                  })}
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
                            {l.team_a_flag && <TeamCrestFlag src={l.team_a_flag} alt="" style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 1 }} crestStyle={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
                            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12 }}>{l.team_a_code} × {l.team_b_code}</span>
                            {l.team_b_flag && <TeamCrestFlag src={l.team_b_flag} alt="" style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 1 }} crestStyle={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 3, background: 'var(--bg-overlay)' }} />}
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
                            {b.team_a_flag && <TeamCrestFlag src={b.team_a_flag} alt="" style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1 }} crestStyle={{ width: 18, height: 18, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />}
                            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12 }}>{b.team_a_code}</span>
                            <span style={{ color: 'var(--text-4)', fontSize: 11 }}>×</span>
                            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12 }}>{b.team_b_code}</span>
                            {b.team_b_flag && <TeamCrestFlag src={b.team_b_flag} alt="" style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1 }} crestStyle={{ width: 18, height: 18, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />}
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
      {/* ── Tab: Competição ──────────────────────────────── */}
      {tab === 'competition' && <CompetitionTab token={token} />}

    </div>
  )
}

// ── CompetitionTab ─────────────────────────────────────────────────────────
const ORACULO_ID = 34

function CompetitionTab({ token }) {
  const [comps,     setComps]     = useState([])
  const [editing,   setEditing]   = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [msg,       setMsg]       = useState('')
  const [phaseRank, setPhaseRank] = useState([])
  const [rankLoad,  setRankLoad]  = useState(false)
  const [blasting,  setBlasting]  = useState(false)
  const [blastMsg,  setBlastMsg]  = useState('')

  const EMPTY = { name: '', description: '', start_date: '', end_date: '', active: true, promo_text: '' }

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const data = await api.get('/admin/competitions', token)
      setComps(data)
      const active = data.find(c => c.active)
      if (active) loadRanking(active)
    } catch {}
  }

  async function loadRanking(comp) {
    if (!comp?.start_date) return
    setRankLoad(true)
    try {
      const start = comp.start_date.slice(0, 10)
      const qs    = `date_from=${start}${comp.end_date ? `&date_to=${comp.end_date.slice(0,10)}` : ''}&limit=200`
      const rows  = await api.get(`/ranking?${qs}`)
      setPhaseRank(rows || [])
    } catch { setPhaseRank([]) }
    finally { setRankLoad(false) }
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setMsg('')
    try {
      if (editing.id) await api.patch(`/admin/competition/${editing.id}`, editing, token)
      else             await api.post('/admin/competition', editing, token)
      setMsg('✓ Salvo'); setEditing(null); load()
    } catch (err) { setMsg(`✗ ${err?.message || 'Erro'}`) }
    finally { setSaving(false) }
  }

  async function del(id) {
    if (!window.confirm('Excluir esta competição?')) return
    try { await api.delete(`/admin/competition/${id}`, token); load() } catch {}
  }

  async function blast(comp) {
    if (!window.confirm(`Enviar push para TODOS os usuários sobre "${comp.name}"?`)) return
    setBlasting(true); setBlastMsg('')
    try {
      const r = await api.post('/admin/push/send', {
        title: `⚡ ${comp.name}`,
        body: comp.promo_text || 'Nova fase! Pontuação zerada — todos partem do mesmo ponto.',
        url: '/ranking',
      }, token)
      setBlastMsg(`✓ Push enviado (${r?.sent ?? '—'} dispositivos)`)
    } catch (e) { setBlastMsg(`✗ ${e?.message || 'Erro ao enviar'}`) }
    finally { setBlasting(false); setTimeout(() => setBlastMsg(''), 6000) }
  }

  const active   = comps.find(c => c.active)
  const oraculo  = phaseRank.find(r => r.user_id === ORACULO_ID)
  const oraculoPos = oraculo ? phaseRank.findIndex(r => r.user_id === ORACULO_ID) + 1 : null

  return (
    <div className="adm-pane fade-in-1">
      <div className="adm-card" style={{ marginBottom: 16 }}>
        <div className="adm-card__header">
          <span className="adm-card__title">⚡ Competição Ativa</span>
          <button className="btn btn-sm btn-primary" onClick={() => setEditing({ ...EMPTY })}>+ Nova</button>
        </div>
        {active ? (
          <div style={{ padding: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--accent)', marginBottom: 4 }}>{active.name}</div>
            {active.description && <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginBottom: 8 }}>{active.description}</div>}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)' }}>
              <span>Início: {active.start_date ? new Date(active.start_date + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</span>
              {active.end_date && <span>Fim: {new Date(active.end_date + 'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>}
            </div>
            {active.promo_text && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(15,122,120,0.08)', border: '1px solid rgba(15,122,120,0.2)', borderRadius: 8, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>
                "{active.promo_text}"
              </div>
            )}
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...active, start_date: active.start_date?.slice(0,16)||'', end_date: active.end_date?.slice(0,16)||'' })}>
                ✏️ Editar
              </button>
              <button
                className="btn btn-sm"
                disabled={blasting}
                onClick={() => blast(active)}
                style={{ background: 'rgba(232,196,74,0.15)', color: '#e8c44a', border: '1px solid rgba(232,196,74,0.3)' }}
              >
                {blasting ? '📣 Enviando…' : '📣 Notificar todos'}
              </button>
              {blastMsg && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: blastMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>{blastMsg}</span>}
            </div>
          </div>
        ) : (
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)', padding: '12px 0' }}>
            Nenhuma competição ativa. Crie uma para exibir no Ranking e Dashboard.
          </div>
        )}
      </div>

      {editing && (
        <div className="adm-card" style={{ marginBottom: 16 }}>
          <div className="adm-card__header">
            <span className="adm-card__title">{editing.id ? 'Editar' : 'Nova Competição'}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => { setEditing(null); setMsg('') }}>✕</button>
          </div>
          <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="form-label">Nome *</label>
              <input className="form-input" value={editing.name} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} placeholder="ex: Fase Eliminatória — Copa 2026" required />
            </div>
            <div>
              <label className="form-label">Descrição</label>
              <input className="form-input" value={editing.description || ''} onChange={e => setEditing(p => ({ ...p, description: e.target.value }))} placeholder="Breve descrição exibida no ranking" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="form-label">Data início * (UTC)</label>
                <input className="form-input" type="datetime-local" value={editing.start_date} onChange={e => setEditing(p => ({ ...p, start_date: e.target.value }))} required />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>BRT = UTC-3 · ex: 29/06 17h BRT → 29/06T20:00</div>
              </div>
              <div>
                <label className="form-label">Data fim (opcional)</label>
                <input className="form-input" type="datetime-local" value={editing.end_date || ''} onChange={e => setEditing(p => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label">Texto promo (compartilhamento)</label>
              <input className="form-input" value={editing.promo_text || ''} onChange={e => setEditing(p => ({ ...p, promo_text: e.target.value }))} placeholder="ex: A Copa entrou na fase decisiva! Comece do zero agora →" />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.active} onChange={e => setEditing(p => ({ ...p, active: e.target.checked }))} />
              Ativa (exibir no site)
            </label>
            {msg && <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: msg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>{msg}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? '…' : 'Salvar'}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(null); setMsg('') }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Oráculo Predictor ── */}
      {active && (
        <div className="adm-card" style={{ marginBottom: 16, border: oraculo ? '1px solid rgba(15,122,120,0.3)' : '1px solid rgba(255,80,80,0.2)' }}>
          <div className="adm-card__header">
            <span className="adm-card__title">🔮 Oráculo Predictor</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: oraculo ? 'var(--win)' : 'var(--lose)' }}>
              {oraculo ? '● na competição' : '○ sem palpites'}
            </span>
          </div>
          {oraculo ? (
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '8px 0' }}>
              {[
                ['Posição', `#${oraculoPos}`],
                ['Pontos', oraculo.total_points],
                ['Palpites', oraculo.total_bets],
                ['Exatos', oraculo.exact_scores],
                ['Aproveit.', oraculo.total_bets > 0 ? `${Math.round(oraculo.total_points / (oraculo.total_bets * 25) * 100)}%` : '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase' }}>{k}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--accent)' }}>{v}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)', padding: '8px 0' }}>
              Oráculo não tem palpites na fase atual. Verifique se a data de início está correta.
            </div>
          )}
        </div>
      )}

      {/* ── Ranking da Fase ── */}
      {active && (
        <div className="adm-card" style={{ marginBottom: 16 }}>
          <div className="adm-card__header">
            <span className="adm-card__title">📊 Ranking da Fase</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)' }}>
                {phaseRank.length} participante{phaseRank.length !== 1 ? 's' : ''}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => loadRanking(active)} disabled={rankLoad}>
                {rankLoad ? '…' : '↻'}
              </button>
            </div>
          </div>
          {rankLoad ? (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)', padding: '12px 0' }}>Carregando…</div>
          ) : phaseRank.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)', padding: '12px 0' }}>
              Nenhum palpite registrado nesta fase ainda.
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 56px 48px 48px 56px', gap: 8, padding: '4px 0 8px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
                <span>#</span><span>Predictor</span><span style={{ textAlign: 'right' }}>Pts</span><span style={{ textAlign: 'right' }}>Palp</span><span style={{ textAlign: 'right' }}>Ex</span><span style={{ textAlign: 'right' }}>Aprov</span>
              </div>
              {phaseRank.map((r, i) => {
                const isOraculo = r.user_id === ORACULO_ID
                const aprov = r.total_bets > 0 ? `${Math.round(r.total_points / (r.total_bets * 25) * 100)}%` : '—'
                return (
                  <div key={r.user_id} style={{
                    display: 'grid', gridTemplateColumns: '32px 1fr 56px 48px 48px 56px', gap: 8,
                    padding: '7px 0', borderBottom: '1px solid var(--border)',
                    background: isOraculo ? 'rgba(15,122,120,0.06)' : 'transparent',
                    fontFamily: 'var(--font-cond)', fontSize: 13,
                  }}>
                    <span style={{ color: i < 3 ? 'var(--accent)' : 'var(--text-4)', fontWeight: 700 }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    <span style={{ color: isOraculo ? 'var(--accent)' : 'var(--text-1)', fontWeight: isOraculo ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}{isOraculo ? ' ✦' : ''}
                    </span>
                    <span style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 700 }}>{r.total_points}</span>
                    <span style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.total_bets}</span>
                    <span style={{ textAlign: 'right', color: 'var(--text-3)' }}>{r.exact_scores}</span>
                    <span style={{ textAlign: 'right', color: 'var(--text-3)' }}>{aprov}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {comps.length > 0 && (
        <div className="adm-card">
          <div className="adm-card__header"><span className="adm-card__title">Histórico</span></div>
          {comps.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{c.name}</span>
                  {c.active && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, background: 'rgba(15,122,120,0.15)', color: 'var(--accent)', borderRadius: 4, padding: '2px 6px' }}>ATIVA</span>}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>
                  {c.start_date ? new Date(c.start_date + 'Z').toLocaleDateString('pt-BR') : '—'}
                  {c.end_date && ` → ${new Date(c.end_date + 'Z').toLocaleDateString('pt-BR')}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...c, start_date: c.start_date?.slice(0,16)||'', end_date: c.end_date?.slice(0,16)||'' })}>Editar</button>
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--lose)' }} onClick={() => del(c.id)}>✕</button>
              </div>
            </div>
          ))}
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
