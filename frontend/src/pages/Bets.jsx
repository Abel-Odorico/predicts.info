import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import MyChampionCard from '../components/MyChampionCard'
import TitleEvolutionChart from '../components/TitleEvolutionChart'
import BrTitleEvolutionChart from '../components/BrTitleEvolutionChart'
import { PT_NAMES } from '../utils/teamNames'
import { COMPETITIONS as ALL_COMPETITIONS } from '../utils/competitions'

const PHASE_LABELS = {
  r32:   'Round of 32',
  r16:   'Oitavas de Final',
  qf:    'Quartas de Final',
  sf:    'Semifinal',
  '3rd': '3º Lugar',
  final: 'Final',
}

function PhaseBadge({ phase, groupName, matchNumber }) {
  const isKnockout = phase && phase !== 'group'
  // Brasileirão: phase='group' mas sem group_name (times não têm grupo) — match_number é a rodada.
  const label = isKnockout
    ? (PHASE_LABELS[phase] || phase)
    : groupName ? `Grupo ${groupName}` : (matchNumber ? `Rodada ${matchNumber}` : null)
  if (!label) return null
  return (
    <span className={`badge ${isKnockout ? 'badge-knockout' : 'badge-group'}`}>
      {isKnockout ? '⚔️ ' : ''}{label}
    </span>
  )
}

function TeamLabel({ code, name, flagUrl, compact = false }) {
  const label = compact ? code : (PT_NAMES[code] || name || code)
  return (
    <span className="team-label">
      {flagUrl && <img src={flagUrl} alt={code} className="match-card__flag" />}
      <span className="team-label__text">{label}</span>
    </span>
  )
}

// ── Segmented tab control ─────────────────────────────────────────────────────
const TAB_ITEMS = [
  { id: 'open', label: 'Abertas', icon: '⚡' },
  { id: 'mine', label: 'Meus Palpites', icon: '🎯' },
  { id: 'past', label: 'Anteriores', icon: '🏁' },
]

function BetTabs({ tab, setTab, counts }) {
  const activeIndex = Math.max(0, TAB_ITEMS.findIndex(t => t.id === tab))
  return (
    <div className="bet-segctrl mt-6" role="tablist" aria-label="Navegação de palpites" style={{ '--active-index': activeIndex }}>
      <div className="bet-segctrl__thumb" aria-hidden="true" />
      {TAB_ITEMS.map(t => {
        const count = counts[t.id] || 0
        const active = tab === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`bet-segctrl__item${active ? ' bet-segctrl__item--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="bet-segctrl__icon" aria-hidden="true">{t.icon}</span>
            <span className="bet-segctrl__label">{t.label}</span>
            {count > 0 && <span className="bet-segctrl__badge">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}

// ── Fullscreen icon (expand action) ───────────────────────────────────────────
function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

// ── Match detail modal (fullscreen desktop / bottom sheet mobile) ────────────
function MatchDetailModal({ onClose, teamA, teamB, phase, groupName, matchDate, msBefore, score, official, statusLabel, statusColor, pointsEarned, canEdit, onEdit, onSimulate }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const showBetScore = score != null
  const showOfficial = official != null && official.a != null

  return createPortal(
    <div className="match-modal-backdrop" onClick={onClose}>
      <div className="match-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Detalhes da partida">
        <div className="match-modal__grabber" />
        <div className="match-modal__head">
          <span className="match-modal__title">Detalhes da Partida</span>
          <button type="button" className="match-modal__close" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <div className="match-modal__body">
          <div className="match-modal__meta">
            <PhaseBadge phase={phase} groupName={groupName} />
            <span className="bet-card__time">{formatMatchDate(matchDate)}</span>
          </div>

          {msBefore != null && msBefore > 0 && (
            <div className="match-modal__countdown"><Countdown ms={msBefore} /></div>
          )}

          <div className="match-modal__hero">
            <div className="match-modal__team">
              {teamA?.flag_url && <img src={teamA.flag_url} alt={teamA.code} />}
              <span className="match-modal__team-name">{PT_NAMES[teamA?.code] || teamA?.name || teamA?.code}</span>
            </div>
            <div className="match-modal__score-wrap">
              {showBetScore ? (
                <div className="match-modal__score">{score.a} – {score.b}</div>
              ) : showOfficial ? (
                <div className="match-modal__score">{official.a} – {official.b}</div>
              ) : (
                <div className="match-modal__vs">vs</div>
              )}
              {showBetScore && showOfficial && (
                <div className="match-modal__official">oficial: {official.a}–{official.b}</div>
              )}
            </div>
            <div className="match-modal__team">
              {teamB?.flag_url && <img src={teamB.flag_url} alt={teamB.code} />}
              <span className="match-modal__team-name">{PT_NAMES[teamB?.code] || teamB?.name || teamB?.code}</span>
            </div>
          </div>

          <div className="match-modal__status">
            <span className="match-modal__status-label" style={{ color: statusColor }}>{statusLabel}</span>
            {pointsEarned != null && (
              <span className="pts-badge" style={{ color: statusColor, borderColor: statusColor }}>
                {pointsEarned >= 0 ? `+${pointsEarned}` : pointsEarned}
              </span>
            )}
          </div>

          <div className="match-modal__actions">
            <button type="button" className="btn btn-ghost" onClick={onSimulate}>Simulação</button>
            {canEdit && <button type="button" className="btn btn-primary" onClick={onEdit}>Alterar</button>}
          </div>

          <div className="match-modal__rules">
            <strong>Sistema Precisão:</strong> 🎯 Placar exato <strong>+25 pts</strong> · ✅ Vencedor exato <strong>+18</strong> · Saldo <strong>+15</strong> · Gols perdedor <strong>+12</strong> · Resultado <strong>+10</strong>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}


// Bets não tem aba "Geral" (aposta é sempre numa competição específica) — reusa
// a fonte única de competições, só sem a entrada "geral".
const COMPETITIONS = ALL_COMPETITIONS.filter(c => c.id !== 'geral').map(c => ({ id: c.id, label: `${c.emoji} ${c.label}` }))

export default function Bets() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [bets, setBets]             = useState([])
  const [matches, setMatches]       = useState([])
  const [finished, setFinished]     = useState([])
  const [loading, setLoad]          = useState(true)
  const [tab, setTab]               = useState('open')
  const [comp, setComp]             = useState('copa2026')
  const [shareMsg, setShareMsg] = useState('')
  const [now, setNow]         = useState(Date.now())
  const [pendingOpenId, setPendingOpenId] = useState(null)
  const [visibleCount, setVisibleCount]   = useState(30)
  const matchRefs = useRef({})

  // Brasileirão sozinho já devolve ~200 partidas agendadas — montar 200 cards
  // animados de uma vez (+ re-render de todos a cada tick do relógio) trava
  // Safari mobile (memória mais curta que desktop). Pagina + reseta ao trocar aba.
  useEffect(() => { setVisibleCount(30) }, [comp])

  const load = useCallback(() => {
    setLoad(true)
    const reqs = [
      api.get(`/matches?status=scheduled&competition=${comp}&limit=200`),
      api.get(`/matches?status=finished&competition=${comp}&limit=100`),
    ]
    if (token) reqs.push(api.get(`/bets/mine?competition=${comp}`, token))
    // allSettled: one failure doesn't wipe the other data
    Promise.allSettled(reqs)
      .then(([mRes, fRes, bRes]) => {
        if (mRes.status === 'fulfilled') setMatches(mRes.value)
        if (fRes.status === 'fulfilled') setFinished(Array.isArray(fRes.value) ? fRes.value : [])
        if (token && bRes?.status === 'fulfilled' && bRes.value) setBets(bRes.value)
      })
      .finally(() => setLoad(false))
  }, [token, comp])


  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setInterval(() => load(), 60_000)
    return () => clearInterval(t)
  }, [load])

  async function handleShare() {
    const url = `${window.location.origin}/login`
    try {
      const compLabel = COMPETITIONS.find(c => c.id === comp)?.label.replace(/^\S+\s/, '') || 'Predicts'
      if (navigator.share) { await navigator.share({ title: `Bolão ${compLabel}`, text: 'Aposte nos placares e dispute o ranking.', url }); setShareMsg('Link compartilhado.'); return }
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); setShareMsg('Link copiado.'); return }
      setShareMsg(`Compartilhe: ${url}`)
    } catch (e) { if (e?.name !== 'AbortError') setShareMsg('Não foi possível compartilhar.') }
  }

  function onBetPlaced(matchId, betData) {
    setBets(prev => {
      const existing = prev.findIndex(b => b.match_id === matchId)
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = { ...next[existing], ...betData }
        return next
      }
      return [...prev, betData]
    })
  }

  function goToNextMatch(nextId) {
    setTab('open')
    setPendingOpenId(nextId)
    setTimeout(() => {
      matchRefs.current[nextId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)
  }

  const openMatches = [...matches.filter(m => isMatchOpen(m, now))]
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
  const betsByMatchId = Object.fromEntries(bets.map(b => [b.match_id, b]))

  function matchLocalDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
  }
  function formatDateSep(dateStr) {
    const d = new Date(dateStr)
    const weekday = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' })
    const date    = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long' })
    return { weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1), date }
  }

  if (loading) return <Spinner text="Carregando palpites..." />

  if (!token) {
    return (
      <div className="page">
        <GuideBanner onShare={handleShare} shareMsg={shareMsg} />
        <div className="fade-in-1 bet-empty">
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: 'var(--accent)', marginBottom: 'var(--s4)' }}>🎯</div>
          <h1 className="page-title" style={{ marginBottom: 'var(--s4)' }}>PALPITES</h1>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 15, color: 'var(--text-3)', marginBottom: 'var(--s6)' }}>Faça login para dar seus palpites</p>
          <Link to="/login" className="btn btn-primary btn-lg">Entrar</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">PALPITES</h1>
        <p className="page-subtitle">Palpite até o apito inicial · ao iniciar, o palpite encerra automaticamente</p>
      </div>

      <div className="phase-nav" style={{ marginBottom: 'var(--s5)' }}>
        {COMPETITIONS.map(c => (
          <button
            key={c.id}
            type="button"
            className={`phase-nav__tab ${comp === c.id ? 'active' : ''}`}
            onClick={() => setComp(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {comp === 'copa2026' && <MyChampionCard />}

      <div className="card mt-6">
        <div className="card__header">
          <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
            📈 Evolução da Chance de Título
          </span>
        </div>
        <div className="card__body" style={{ paddingTop: 'var(--s4)' }}>
          {comp === 'copa2026' ? <TitleEvolutionChart /> : <BrTitleEvolutionChart />}
        </div>
      </div>

      {/* Bracket CTA */}
      {comp === 'copa2026' && <Link to="/torneio" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--s3) var(--s4)',
        background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-card))',
        border: '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)',
        borderRadius: 8, marginTop: 'var(--s5)',
        textDecoration: 'none', color: 'inherit',
        transition: 'border-color 150ms',
      }}>
        <span style={{ fontFamily:'var(--font-cond)', fontWeight:700, fontSize:14, color:'var(--text-1)', display:'flex', alignItems:'center', gap:'var(--s2)' }}>
          <span>⚔️</span> Ver Chaveamento Completo
        </span>
        <span style={{ fontFamily:'var(--font-cond)', fontSize:13, color:'var(--accent)', fontWeight:700 }}>→</span>
      </Link>}

      {/* Resultados CTA */}
      {comp === 'copa2026' && <Link to="/resultados" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--s3) var(--s4)',
        background: 'color-mix(in srgb, var(--accent) 7%, var(--bg-card))',
        border: '1.5px solid color-mix(in srgb, var(--accent) 30%, transparent)',
        borderRadius: 8, marginTop: 'var(--s3)',
        textDecoration: 'none', color: 'inherit',
        transition: 'border-color 150ms',
      }}>
        <span style={{ fontFamily:'var(--font-cond)', fontWeight:700, fontSize:14, color:'var(--text-1)', display:'flex', alignItems:'center', gap:'var(--s2)' }}>
          <span>📋</span> Consultar Resultados
        </span>
        <span style={{ fontFamily:'var(--font-cond)', fontSize:13, color:'var(--accent)', fontWeight:700 }}>→</span>
      </Link>}

      <GuideBanner onShare={handleShare} shareMsg={shareMsg} />

      <BetTabs
        tab={tab}
        setTab={setTab}
        counts={{ open: openMatches.length, mine: bets.length, past: finished.length }}
      />

      {tab === 'open' && (
        <div className="fade-in-1">
          {openMatches.length === 0 ? (
            <div className="bet-empty mt-6" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
              Sem partidas abertas no momento
            </div>
          ) : (
            <div className="bets-list mt-6">
              {openMatches.slice(0, visibleCount).map((m, i, visible) => {
                const curDate  = matchLocalDate(m.match_date)
                const prevDate = i > 0 ? matchLocalDate(visible[i - 1].match_date) : null
                const showSep  = curDate !== prevDate
                const { weekday, date } = formatDateSep(m.match_date)
                return (
                  <Fragment key={m.id}>
                    {showSep && (
                      <div className="bets-list__sep" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: i === 0 ? '0 0 10px' : '18px 0 10px' }}>
                        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent)' }}>{weekday}</span>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>{date}</span>
                        </div>
                        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                      </div>
                    )}
                    <div ref={el => { matchRefs.current[m.id] = el }}>
                      <BettableMatchRow
                        match={m}
                        existingBet={betsByMatchId[m.id]}
                        token={token}
                        now={now}
                        index={i}
                        onBetPlaced={onBetPlaced}
                        onOpenSimulation={() => navigate(`/partida/${m.id}`)}
                        nextMatch={visible[i + 1] || null}
                        onGoToNextMatch={goToNextMatch}
                        autoOpen={pendingOpenId === m.id}
                        onAutoOpenDone={() => setPendingOpenId(null)}
                        recentMatches={finished}
                      />
                    </div>
                  </Fragment>
                )
              })}
              {openMatches.length > visibleCount && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-4"
                  style={{ width: '100%' }}
                  onClick={() => setVisibleCount(v => v + 30)}
                >
                  Carregar mais ({openMatches.length - visibleCount} restantes)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div className="fade-in-1">
          <div className="bet-summary-grid mt-6">
            <SummaryCard label="Abertas Agora"  value={openMatches.length} tone="accent" />
            <SummaryCard label="Meus Palpites"  value={bets.length} />
            <SummaryCard label="Já Pontuados"   value={bets.filter(b => b.result !== null).length} tone="win" />
          </div>
          {bets.length === 0 ? (
            <div className="bet-empty mt-6" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
              <p>Sem palpites ainda.</p>
              <button type="button" className="btn btn-primary btn-sm mt-4" onClick={() => setTab('open')}>Ver Partidas Abertas</button>
            </div>
          ) : (
            <div className="bets-list mt-6">
              {bets.map((b, i) => (
                <BetRow
                  key={b.id}
                  bet={b}
                  index={i}
                  onOpenSimulation={() => navigate(`/partida/${b.match_id}`)}
                  onEditBet={goToNextMatch}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'past' && (
        <div className="fade-in-1">
          {finished.length === 0 ? (
            <div className="bet-empty mt-6" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
              Sem partidas finalizadas ainda.
            </div>
          ) : (
            <div className="bets-list mt-6">
              {[...finished]
                .sort((a, b) => new Date(b.match_date || 0) - new Date(a.match_date || 0))
                .map((m, i) => {
                  const bet = betsByMatchId[m.id]
                  return bet
                    ? <BetRow key={m.id} bet={bet} index={i} onOpenSimulation={() => navigate(`/partida/${m.id}`)} onEditBet={goToNextMatch} />
                    : <FinishedNoBetRow key={m.id} match={m} index={i} onOpenSimulation={() => navigate(`/partida/${m.id}`)} />
                })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Inline bettable match card ────────────────────────────────────────────────
function BettableMatchRow({ match, existingBet, token, now, index, onBetPlaced, onOpenSimulation, nextMatch, onGoToNextMatch, autoOpen, onAutoOpenDone, recentMatches }) {
  const initStillOpen = existingBet ? false : (match.is_open !== undefined
    ? match.is_open
    : (() => {
        if (!match.match_date) return true
        const d = match.match_date.endsWith('Z') ? match.match_date : `${match.match_date}Z`
        return new Date(d).getTime() > Date.now()
      })())

  const [open, setOpen]         = useState(initStillOpen)
  // autoFocus só quando o usuário abre a linha (clique/autoOpen). No load
  // inicial todas as linhas abrem expandidas; sem este guard, o último input
  // com autoFocus rouba o foco e rola a página até o fim da lista.
  const [focusScore, setFocusScore] = useState(false)
  const [sa, setSa]             = useState(existingBet?.score_a ?? 0)
  const [sb, setSb]             = useState(existingBet?.score_b ?? 0)
  const [etWinnerPick, setEtWinnerPick] = useState(existingBet?.et_winner_pick ?? null)
  const [msg, setMsg]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [confirmed, setConfirmed]       = useState(false)
  const [showNextCard, setShowNextCard] = useState(false)

  const [showDetail, setShowDetail]     = useState(false)
  const [showOdds, setShowOdds]         = useState(false)
  const [odds, setOdds]                 = useState(null)
  const [oddsLoading, setOddsLoading]   = useState(false)
  const [communityBets, setCommunityBets]     = useState(null)
  const [communityLoading, setCommunityLoading] = useState(false)
  const [analysis, setAnalysis]         = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(true)

  const msBefore  = parseUtcMatchDate(match.match_date).getTime() - now
  const stillOpen = match.is_open !== undefined ? match.is_open : msBefore > 0

  useEffect(() => {
    if (!stillOpen && open) setOpen(false)
  }, [stillOpen, open])

  useEffect(() => {
    if (autoOpen) {
      setOpen(true)
      setFocusScore(true)
      onAutoOpenDone?.()
    }
  }, [autoOpen])

  // Sync form values with the actually-saved bet whenever the bet changes or form closes.
  // Prevents stale values (cancelled edits / post-confirm state) from leaking into next open.
  useEffect(() => {
    if (existingBet && !open) {
      setSa(existingBet.score_a)
      setSb(existingBet.score_b)
      setEtWinnerPick(existingBet.et_winner_pick ?? null)
    }
  }, [existingBet?.score_a, existingBet?.score_b, existingBet?.et_winner_pick, open])

  async function fetchOdds() {
    if (odds || oddsLoading) return
    setOddsLoading(true)
    try {
      const data = await api.post(`/matches/${match.id}/simulate?n=100000`, null, token)
      setOdds(data)
    } catch (_) {}
    finally { setOddsLoading(false) }
  }

  async function fetchCommunityBets() {
    if (communityBets || communityLoading) return
    setCommunityLoading(true)
    try {
      const data = await api.get(`/matches/${match.id}/live-bets`)
      setCommunityBets(data)
    } catch (_) {}
    finally { setCommunityLoading(false) }
  }

  async function fetchAnalysis() {
    if (analysis || analysisLoading) return
    setAnalysisLoading(true)
    try {
      const data = await api.get(`/matches/${match.id}/analysis`)
      setAnalysis(data.content)
    } catch (_) { setAnalysis(null) }
    finally { setAnalysisLoading(false) }
  }

  function toggleExpand() {
    const next = !showOdds
    setShowOdds(next)
    if (next) {
      fetchOdds()
      fetchCommunityBets()
      fetchAnalysis()
      if (stillOpen && !confirmed) setOpen(true)
    }
  }

  async function placeBet() {
    const scoreA = Number(sa)
    const scoreB = Number(sb)
    if (isNaN(scoreA) || isNaN(scoreB)) { setMsg('Preencha o placar completo'); return }
    if (scoreA < 0 || scoreB < 0) { setMsg('Placar inválido'); return }
    setSaving(true)
    setMsg('')
    try {
      const payload = { match_id: match.id, score_a: scoreA, score_b: scoreB }
      if (match.phase !== 'group' && etWinnerPick) payload.et_winner_pick = etWinnerPick
      const data = await api.post('/bets', payload, token)
      onBetPlaced(match.id, {
        ...data,
        match_id: match.id,
        team_a_code: match.team_a?.code,
        team_b_code: match.team_b?.code,
        team_a_flag: match.team_a?.flag_url,
        team_b_flag: match.team_b?.flag_url,
        match_date: match.match_date,
        group_name: match.group_name,
        match_status: match.status,
        is_open: true,
        official_score_a: null,
        official_score_b: null,
        result: null,
        et_winner_pick: match.phase !== 'group' ? etWinnerPick : null,
      })
      setConfirmed(true)
      setOpen(false)
      if (nextMatch) setShowNextCard(true)
      setCommunityBets(null)
      if (showOdds) fetchCommunityBets()
    } catch (e) {
      setMsg(e.message)
    } finally {
      setSaving(false)
    }
  }

  const hasBet   = !!existingBet
  const urgentMs = 30 * 60 * 1000
  const isUrgent = msBefore > 0 && msBefore < urgentMs

  const communityStats = communityBets && communityBets.total_bets > 0
    ? computeCommunityStats(communityBets.bets)
    : null

  return (
    <div className={`bet-card bet-card--open fade-in${isUrgent ? ' bet-card--urgent' : ''}`} style={{ animationDelay: `${index * 30}ms` }}>
      <div className="bet-card__top">
        <PhaseBadge phase={match.phase} groupName={match.group_name} matchNumber={match.match_number} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          {stillOpen && <Countdown ms={msBefore} />}
          <span className="bet-card__time">{formatMatchDate(match.match_date)}</span>
          <button type="button" className="bet-card__expand" onClick={() => setShowDetail(true)} aria-label="Expandir detalhes da partida" title="Expandir">
            <ExpandIcon />
          </button>
        </div>
      </div>

      {/* Clickable match row → expand odds + form */}
      <button
        type="button"
        className="bet-card__match bet-card__match--clickable"
        style={{ marginTop: 'var(--s4)' }}
        onClick={toggleExpand}
        title="Ver probabilidades e dar palpite"
      >
        <div className="bet-card__team">
          <TeamLabel code={match.team_a?.code} name={match.team_a?.name} flagUrl={match.team_a?.flag_url} />
        </div>
        {hasBet
          ? <div className="bet-current-score">{existingBet.score_a} – {existingBet.score_b}</div>
          : <div className="bet-card__versus">vs</div>
        }
        <div className="bet-card__team bet-card__team--right">
          <TeamLabel code={match.team_b?.code} name={match.team_b?.name} flagUrl={match.team_b?.flag_url} />
        </div>
        <span className="odds-toggle-icon">{showOdds ? '▲' : '▼'}</span>
      </button>

      {/* Odds + community stats panel */}
      {showOdds && (
        <div className="odds-panel fade-in-1">
          {/* Statistical odds */}
          {oddsLoading ? (
            <div className="odds-panel__loading">Calculando probabilidades...</div>
          ) : odds ? (
            <>
              <div className="odds-section-label">Probabilidade estatística</div>
              <div className="odds-bar">
                <div className="odds-bar__segment odds-bar__segment--win"  style={{ flex: odds.prob_a }}   title={`${match.team_a?.code} ${odds.prob_a}%`} />
                <div className="odds-bar__segment odds-bar__segment--draw" style={{ flex: odds.prob_draw }} title={`Empate ${odds.prob_draw}%`} />
                <div className="odds-bar__segment odds-bar__segment--lose" style={{ flex: odds.prob_b }}   title={`${match.team_b?.code} ${odds.prob_b}%`} />
              </div>
              <div className="odds-bar__labels">
                <span className="odds-label odds-label--win">
                  <span className="odds-label__team"><TeamLabel code={match.team_a?.code} flagUrl={match.team_a?.flag_url} compact /></span>
                  <span className="odds-label__pct">{odds.prob_a}%</span>
                </span>
                <span className="odds-label odds-label--draw">
                  <span className="odds-label__team">Empate</span>
                  <span className="odds-label__pct">{odds.prob_draw}%</span>
                </span>
                <span className="odds-label odds-label--lose">
                  <span className="odds-label__team"><TeamLabel code={match.team_b?.code} flagUrl={match.team_b?.flag_url} compact /></span>
                  <span className="odds-label__pct">{odds.prob_b}%</span>
                </span>
              </div>
            </>
          ) : null}

          {/* Community sentiment */}
          {communityLoading ? (
            <div className="community-bets__loading">Carregando palpites do bolão...</div>
          ) : communityStats ? (
            <div className="community-bets">
              <div className="community-bets__header">
                Tendência do bolão
                <span className="community-bets__count">{communityBets.total_bets} palpite{communityBets.total_bets !== 1 ? 's' : ''}</span>
              </div>
              {/* Sentiment bar */}
              <div className="odds-bar">
                <div className="odds-bar__segment odds-bar__segment--win"  style={{ flex: communityStats.pct_a }}    title={`${match.team_a?.code} ${communityStats.pct_a}%`} />
                <div className="odds-bar__segment odds-bar__segment--draw" style={{ flex: communityStats.pct_draw }} title={`Empate ${communityStats.pct_draw}%`} />
                <div className="odds-bar__segment odds-bar__segment--lose" style={{ flex: communityStats.pct_b }}    title={`${match.team_b?.code} ${communityStats.pct_b}%`} />
              </div>
              <div className="odds-bar__labels">
                <span className="odds-label odds-label--win">
                  <span className="odds-label__team"><TeamLabel code={match.team_a?.code} flagUrl={match.team_a?.flag_url} compact /></span>
                  <span className="odds-label__pct">{communityStats.pct_a}%</span>
                </span>
                <span className="odds-label odds-label--draw">
                  <span className="odds-label__team">Empate</span>
                  <span className="odds-label__pct">{communityStats.pct_draw}%</span>
                </span>
                <span className="odds-label odds-label--lose">
                  <span className="odds-label__team"><TeamLabel code={match.team_b?.code} flagUrl={match.team_b?.flag_url} compact /></span>
                  <span className="odds-label__pct">{communityStats.pct_b}%</span>
                </span>
              </div>
              {/* Top scores */}
              <div className="community-top-scores">
                <span className="community-top-scores__label">Placares mais votados</span>
                <div className="community-top-scores__chips">
                  {communityStats.topScores.map(({ score, pct }) => (
                    <span key={score} className="community-score-chip">
                      <span className="community-score-chip__score">{score.replace('x', ' × ')}</span>
                      <span className="community-score-chip__pct">{pct}%</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : communityBets && communityBets.total_bets === 0 ? (
            <div className="community-bets__empty">Nenhum palpite registrado ainda</div>
          ) : null}

          {/* Forma recente das seleções */}
          <TeamFormSection
            teamA={match.team_a}
            teamB={match.team_b}
            recentMatches={recentMatches}
          />

          {/* Scoring hint */}
          <div style={{ margin: '8px 0 0', padding: '8px 12px', background: 'rgba(15,122,120,0.08)', borderRadius: 8, borderLeft: '3px solid var(--accent)' }}>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--accent)' }}>Sistema Precisão:</strong>{' '}
              🎯 Placar exato <strong>+25 pts</strong> · ✅ Vencedor exato <strong>+18</strong> · Saldo <strong>+15</strong> · Gols perdedor <strong>+12</strong> · Resultado <strong>+10</strong>
            </span>
          </div>

          {/* Análise IA */}
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            {analysisLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>
                <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span> Carregando análise IA…
              </div>
            ) : analysis ? (
              <MatchAnalysisCard analysis={analysis} teamA={match.team_a} teamB={match.team_b} show={showAnalysis} onToggle={() => setShowAnalysis(v => !v)} />
            ) : (
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                🤖 <span>Análise IA não disponível para esta partida</span>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmed && (
        <div className="confirmed-badge fade-in-1">
          <span className="confirmed-badge__icon">✓</span>
          <span className="confirmed-badge__text">Palpite confirmado!</span>
          <span className="confirmed-badge__flag">🚩</span>
        </div>
      )}

      {!confirmed && hasBet && (
        <div className="bet-placed-label">
          <span style={{ color: 'var(--win)' }}>✓</span> Palpite registrado
        </div>
      )}

      <div className="bet-card__footer" style={{ marginTop: 'var(--s4)' }}>
        <span className="bet-card__hint" style={confirmed ? { color: 'var(--win)' } : undefined}>
          {confirmed
            ? `✓ Palpite salvo: ${Number(sa)}×${Number(sb)}`
            : stillOpen
              ? hasBet ? 'Toque em Alterar para atualizar seu palpite' : `Palpite até ${formatKickoffTime(match.match_date)}`
              : 'Palpites encerrados — partida iniciou'
          }
        </span>
        <div className="bet-card__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenSimulation}>
            Simulação
          </button>
          {stillOpen && (
            <button
              type="button"
              className={`btn btn-sm ${open ? 'btn-ghost' : hasBet ? 'btn-ghost' : 'btn-primary'}`}
              onClick={() => { setOpen(v => { if (!v) setFocusScore(true); return !v }); setMsg('') }}
            >
              {open ? 'Cancelar' : hasBet ? 'Alterar' : 'Dar Palpite'}
            </button>
          )}
        </div>
      </div>

      {open && stillOpen && (
        <div className="bet-inline-form fade-in-1">
          <div className="bet-inline-teams">
            <TeamLabel code={match.team_a?.code} name={match.team_a?.name} flagUrl={match.team_a?.flag_url} compact />
            <div className="bet-inline-inputs">
              <ScoreInput value={sa} onChange={setSa} autoFocus={focusScore} />
              <span className="score-sep">×</span>
              <ScoreInput value={sb} onChange={setSb} />
            </div>
            <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <TeamLabel code={match.team_b?.code} name={match.team_b?.name} flagUrl={match.team_b?.flag_url} compact />
            </span>
          </div>

          {match.phase !== 'group' && (
            <div
              style={{
                marginTop: 'var(--s3)',
                background: 'linear-gradient(135deg, var(--accent-glow) 0%, transparent 100%)',
                border: '1.5px dashed var(--accent)',
                borderRadius: 10,
                padding: 'var(--s3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 'var(--s2)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16 }}>🥅</span>
                <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 800, fontSize: 13, color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Prorrogação / Pênaltis
                </span>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 800, color: 'var(--win)', border: '1px solid var(--win)', borderRadius: 999, padding: '2px 9px' }}>
                  +10 pts
                </span>
              </div>
              <p style={{ textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', marginBottom: 'var(--s3)' }}>
                Se empatar no tempo normal, quem avança? <span style={{ color: 'var(--text-4)' }}>(opcional)</span>
              </p>
              <div style={{ display: 'flex', gap: 'var(--s3)' }}>
                {[['a', match.team_a], ['b', match.team_b]].map(([side, team]) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setEtWinnerPick(p => p === side ? null : side)}
                    style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '10px 8px', borderRadius: 8, cursor: 'pointer',
                      border: etWinnerPick === side ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                      background: etWinnerPick === side ? 'var(--accent-glow)' : 'var(--bg-raised)',
                    }}
                  >
                    {team?.flag_url && <img src={team.flag_url} alt={team.code} style={{ width: 30, height: 21, objectFit: 'cover', borderRadius: 2 }} />}
                    <span style={{ fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 14, color: etWinnerPick === side ? 'var(--accent)' : 'var(--text-2)' }}>
                      {team?.code}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary w-full"
            style={{ marginTop: 'var(--s3)' }}
            onClick={placeBet}
            disabled={saving}
          >
            {saving ? 'Salvando...' : hasBet ? 'Atualizar Palpite' : 'Confirmar Palpite'}
          </button>
          {msg && (
            <p className="bet-inline-msg" style={{ color: msg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
              {msg}
            </p>
          )}
        </div>
      )}

      {showNextCard && nextMatch && (
        <NextMatchCard
          match={nextMatch}
          onYes={() => {
            setShowNextCard(false)
            onGoToNextMatch(nextMatch.id)
          }}
          onNo={() => setShowNextCard(false)}
        />
      )}

      {showDetail && (
        <MatchDetailModal
          onClose={() => setShowDetail(false)}
          teamA={match.team_a}
          teamB={match.team_b}
          phase={match.phase}
          groupName={match.group_name}
          matchDate={match.match_date}
          msBefore={stillOpen ? msBefore : null}
          score={hasBet ? { a: existingBet.score_a, b: existingBet.score_b } : null}
          official={null}
          statusLabel={hasBet ? 'Palpite registrado' : stillOpen ? 'Sem palpite ainda' : 'Encerrado sem palpite'}
          statusColor={hasBet ? 'var(--win)' : 'var(--text-3)'}
          pointsEarned={null}
          canEdit={stillOpen}
          onEdit={() => { setShowDetail(false); setOpen(true); setFocusScore(true) }}
          onSimulate={() => { setShowDetail(false); onOpenSimulation() }}
        />
      )}
    </div>
  )
}

// ── Score stepper input ───────────────────────────────────────────────────────
function ScoreInput({ value, onChange, autoFocus }) {
  const v = Number(value) || 0
  return (
    <div className="score-stepper">
      <button type="button" className="score-stepper__btn" onClick={() => onChange(Math.max(0, v - 1))}>−</button>
      <input
        type="number" min="0" max="20"
        className="score-input"
        value={v}
        onChange={e => onChange(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
        autoFocus={autoFocus}
      />
      <button type="button" className="score-stepper__btn score-stepper__btn--plus" onClick={() => onChange(Math.min(20, v + 1))}>+</button>
    </div>
  )
}

// ── Community stats helper ────────────────────────────────────────────────────
function computeCommunityStats(bets) {
  const total = bets.length
  if (!total) return null
  const winA = bets.filter(b => b.score_a > b.score_b).length
  const draw = bets.filter(b => b.score_a === b.score_b).length
  const winB = bets.filter(b => b.score_b > b.score_a).length

  const scoreCount = {}
  bets.forEach(b => {
    const k = `${b.score_a}x${b.score_b}`
    scoreCount[k] = (scoreCount[k] || 0) + 1
  })
  const topScores = Object.entries(scoreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([score, count]) => ({ score, count, pct: Math.round(count / total * 100) }))

  return {
    pct_a:    Math.round(winA / total * 100),
    pct_draw: Math.round(draw / total * 100),
    pct_b:    Math.round(winB / total * 100),
    topScores,
  }
}

// ── Next match suggestion card ────────────────────────────────────────────────
function NextMatchCard({ match, onYes, onNo }) {
  return (
    <div className="next-match-card fade-in-1">
      <div className="next-match-card__label">Próximo jogo</div>
      <div className="next-match-card__teams">
        <span className="next-match-card__code">
          <TeamLabel code={match.team_a?.code} name={match.team_a?.name} flagUrl={match.team_a?.flag_url} />
        </span>
        <span className="next-match-card__vs">vs</span>
        <span className="next-match-card__code">
          <TeamLabel code={match.team_b?.code} name={match.team_b?.name} flagUrl={match.team_b?.flag_url} />
        </span>
      </div>
      <p className="next-match-card__question">Deseja dar palpite neste jogo?</p>
      <div className="next-match-card__actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onYes}>Sim, próximo jogo</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onNo}>Agora não</button>
      </div>
    </div>
  )
}

// ── Countdown badge ───────────────────────────────────────────────────────────
function Countdown({ ms }) {
  if (ms <= 0) return null
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  const urgent = ms < 30 * 60 * 1000
  const label  = h > 0
    ? `${h}h ${String(m).padStart(2,'0')}m`
    : m > 0
    ? `${m}m ${String(s).padStart(2,'0')}s`
    : `${s}s`

  return (
    <span className={`bet-countdown${urgent ? ' bet-countdown--urgent' : ''}`}>
      ⏱ {label}
    </span>
  )
}

// ── Share modal ───────────────────────────────────────────────────────────────
function BetShareModal({ bet, onClose }) {
  const [copied, setCopied] = useState(false)

  const teamA = bet.team_a_name || bet.team_a_code || 'Time A'
  const teamB = bet.team_b_name || bet.team_b_code || 'Time B'
  const flagA = bet.team_a_flag ? `<img src="${bet.team_a_flag}" style="width:20px;vertical-align:middle" /> ` : ''
  const flagB = bet.team_b_flag ? ` <img src="${bet.team_b_flag}" style="width:20px;vertical-align:middle" />` : ''

  const resultLine = bet.result === 'exact'   ? `🎯 Placar exato! +${bet.points_earned ?? 25} pts`
                   : bet.result === 'correct'  ? `✅ Resultado correto! +${bet.points_earned ?? 10} pts`
                   : bet.result === 'wrong'    ? `❌ Sem acerto desta vez.`
                   : '⏳ Aguardando resultado...'

  const shareText = [
    `🏆 Meu palpite no Predicts`,
    ``,
    `⚽ ${teamA} × ${teamB}`,
    `🎯 Meu palpite: ${bet.score_a}–${bet.score_b}`,
    bet.official_score_a != null ? `📊 Resultado: ${bet.official_score_a}–${bet.official_score_b}` : null,
    bet.result ? resultLine : null,
    ``,
    `📱 predicts.info`,
  ].filter(Boolean).join('\n')

  async function copy() {
    await navigator.clipboard.writeText(shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: 'Meu palpite — Predicts', text: shareText })
    } else {
      copy()
    }
  }

  return (
    <div className="bet-share-backdrop" onClick={onClose}>
      <div className="bet-share-modal" onClick={e => e.stopPropagation()}>
        <div className="bet-share-modal__header">
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, letterSpacing: '0.06em' }}>Compartilhar Palpite</span>
          <button onClick={onClose} className="notif-close">✕</button>
        </div>
        <div className="bet-share-modal__card">
          <div className="bet-share-modal__match">
            {bet.team_a_flag && <img src={bet.team_a_flag} alt={teamA} style={{ width: 28, borderRadius: 2 }} />}
            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15 }}>{teamA}</span>
            <span style={{ fontFamily: 'var(--font-data)', fontWeight: 900, fontSize: 22 }}>{bet.score_a}–{bet.score_b}</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15 }}>{teamB}</span>
            {bet.team_b_flag && <img src={bet.team_b_flag} alt={teamB} style={{ width: 28, borderRadius: 2 }} />}
          </div>
          {bet.official_score_a != null && (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginTop: 4 }}>
              Resultado oficial: {bet.official_score_a}–{bet.official_score_b}
            </div>
          )}
          {bet.result && (
            <div className="bet-share-modal__result">{resultLine}</div>
          )}
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', textAlign: 'center', marginTop: 8, letterSpacing: '0.08em' }}>predicts.info</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s3)', padding: 'var(--s4)' }}>
          <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={copy}>
            {copied ? '✓ Copiado!' : '📋 Copiar texto'}
          </button>
          <button className="btn btn-primary btn-sm" style={{ flex: 1, background: 'var(--accent)' }} onClick={share}>
            📤 Compartilhar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Placed bet row (Mine tab) ─────────────────────────────────────────────────
function BetRow({ bet, index, onOpenSimulation, onEditBet }) {
  const [showShare, setShowShare] = useState(false)
  const [showDetail, setShowDetail] = useState(false)

  const resultClass = bet.result === 'exact'   ? 'bet-card--result-exact'
                    : bet.result === 'correct'  ? 'bet-card--result-correct'
                    : bet.result === 'wrong'    ? 'bet-card--result-wrong'
                    : ''

  const statusColor = bet.result === 'exact'   ? 'var(--accent)'
                    : bet.result === 'correct'  ? 'var(--win)'
                    : bet.result === 'wrong'    ? 'var(--lose)'
                    : 'var(--text-3)'

  const statusLabel = bet.result === 'exact'   ? 'Placar exato'
                    : bet.result === 'correct'  ? 'Resultado correto'
                    : bet.result === 'wrong'    ? 'Sem acerto'
                    : bet.is_open ? 'Pendente' : 'Aguardando avaliação'

  const ptsVariant = bet.result === 'exact'   ? 'pts-badge--exact'
                   : bet.result === 'correct'  ? 'pts-badge--correct'
                   : bet.result === 'wrong'    ? 'pts-badge--wrong'
                   : 'pts-badge--pending'

  const ptsValue = bet.result === null ? '—' : `+${bet.points_earned ?? 0}`

  const hasOfficial = bet.official_score_a != null && bet.official_score_b != null

  return (
    <>
    <div className={`bet-card fade-in ${resultClass}`} style={{ animationDelay: `${index * 30}ms` }}>
      <div className="bet-card__top">
        <PhaseBadge phase={bet.match_phase} groupName={bet.group_name} matchNumber={bet.match_number} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          <span className="bet-card__time">{formatMatchDate(bet.match_date)}</span>
          <span className={`pts-badge ${ptsVariant}`}>{ptsValue}</span>
          <button type="button" className="bet-card__expand" onClick={() => setShowDetail(true)} aria-label="Expandir detalhes da partida" title="Expandir">
            <ExpandIcon />
          </button>
        </div>
      </div>

      <div className="bet-card__match" style={{ marginTop: 'var(--s4)' }}>
        <div className="bet-card__team">
          <TeamLabel code={bet.team_a_code} flagUrl={bet.team_a_flag} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div className="bet-card__score">{bet.score_a} – {bet.score_b}</div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-4)', textTransform: 'uppercase' }}>
            seu palpite
          </div>
        </div>
        <div className="bet-card__team bet-card__team--right">
          <TeamLabel code={bet.team_b_code} flagUrl={bet.team_b_flag} />
        </div>
      </div>

      {hasOfficial && (
        <div className="score-compare">
          <div className="score-compare__block">
            <span className="score-compare__label">Seu palpite</span>
            <span className="score-compare__value" style={{ color: statusColor }}>
              {bet.score_a}–{bet.score_b}
            </span>
          </div>
          <div className="score-compare__divider" />
          <div className="score-compare__block">
            <span className="score-compare__label">Resultado oficial</span>
            <span className="score-compare__value" style={{ color: 'var(--text-2)' }}>
              {bet.official_score_a}–{bet.official_score_b}
            </span>
          </div>
          <div className="score-compare__divider" />
          <div className="score-compare__block">
            <span className="score-compare__label">Pontos</span>
            <span className="score-compare__value" style={{ color: statusColor, fontSize: 22 }}>
              {bet.points_earned ?? 0}
            </span>
          </div>
        </div>
      )}

      {bet.et_winner_pick && (
        <div style={{ marginTop: 'var(--s2)', textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
          🥅 Pênaltis: {bet.et_winner_pick === 'a' ? bet.team_a_code : bet.team_b_code}
          {hasOfficial && (
            bet.decided_by_penalties
              ? (bet.et_winner_pick === bet.et_winner
                  ? <span style={{ color: 'var(--win)' }}> · acertou (+{bet.et_points_earned ?? 0} pts)</span>
                  : <span style={{ color: 'var(--lose)' }}> · errou</span>)
              : <span style={{ color: 'var(--text-4)' }}> · não foi a pênaltis, não contou</span>
          )}
        </div>
      )}

      {!hasOfficial && (
        <div style={{ marginTop: 'var(--s3)', textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', letterSpacing: '0.06em' }}>
          {bet.result === null ? 'Aguardando resultado oficial' : 'Resultado registrado'}
        </div>
      )}

      <div className="bet-card__footer" style={{ marginTop: 'var(--s4)' }}>
        <span className="bet-card__status" style={{ color: statusColor }}>{statusLabel}</span>
        <div className="bet-card__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowShare(true)} title="Compartilhar">
            📤
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenSimulation}>
            Ver Simulação
          </button>
        </div>
      </div>
    </div>
    {showShare && <BetShareModal bet={bet} onClose={() => setShowShare(false)} />}
    {showDetail && (
      <MatchDetailModal
        onClose={() => setShowDetail(false)}
        teamA={{ code: bet.team_a_code, flag_url: bet.team_a_flag }}
        teamB={{ code: bet.team_b_code, flag_url: bet.team_b_flag }}
        phase={bet.match_phase}
        groupName={bet.group_name}
        matchDate={bet.match_date}
        msBefore={null}
        score={{ a: bet.score_a, b: bet.score_b }}
        official={hasOfficial ? { a: bet.official_score_a, b: bet.official_score_b } : null}
        statusLabel={statusLabel}
        statusColor={statusColor}
        pointsEarned={bet.result !== null ? (bet.points_earned ?? 0) : null}
        canEdit={!!bet.is_open}
        onEdit={() => { setShowDetail(false); onEditBet?.(bet.match_id) }}
        onSimulate={() => { setShowDetail(false); onOpenSimulation() }}
      />
    )}
    </>
  )
}

// ── Team recent form (inside odds panel) ─────────────────────────────────────
const _fRColor = r => r === 'V' ? 'var(--win)' : r === 'D' ? 'var(--lose)' : 'var(--text-3)'
const _fRBg    = r => r === 'V' ? 'rgba(46,201,128,0.18)' : r === 'D' ? 'rgba(232,82,82,0.18)' : 'rgba(255,255,255,0.07)'

function FormBlock({ team, games, role }) {
  return (
    <div>
      {/* Team header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
        {team?.flag_url && (
          <img src={team.flag_url} alt={team.code}
            style={{ width: 22, height: 15, objectFit: 'cover', borderRadius: 2, flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.45)' }}
          />
        )}
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>
          {PT_NAMES[team?.code] || team?.code}
        </span>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {role}
        </span>
      </div>

      {games.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-4)', fontFamily: 'var(--font-cond)', padding: '2px 0 4px' }}>Sem jogos recentes</div>
      ) : games.map((g, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '5px 6px',
          borderRadius: 6,
          background: i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'transparent',
          marginBottom: 2,
        }}>
          {/* V/E/D badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 5, flexShrink: 0,
            fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)',
            background: _fRBg(g.outcome), color: _fRColor(g.outcome),
          }}>{g.outcome}</span>

          {/* Opponent flag */}
          {g.opp?.flag_url ? (
            <img src={g.opp.flag_url} alt={g.opp.code}
              style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 2, flexShrink: 0, boxShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
            />
          ) : <span style={{ width: 18, flexShrink: 0 }} />}

          {/* Opponent name — full if fits, code fallback */}
          <span style={{
            fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600,
            color: 'var(--text-2)', flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {PT_NAMES[g.opp?.code] || g.opp?.code}
          </span>

          {/* Score — colored by outcome, pushed right */}
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
            color: _fRColor(g.outcome), flexShrink: 0, letterSpacing: '0.02em',
          }}>{g.my} – {g.them}</span>

          {/* Date muted */}
          {g.dateStr && (
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', flexShrink: 0, minWidth: 30, textAlign: 'right' }}>
              {g.dateStr}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function MatchAnalysisCard({ analysis, teamA, teamB, show, onToggle }) {
  if (!analysis) return null
  const s = { fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }
  const h = { fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, color: 'var(--accent)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 4 }
  return (
    <div>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
        cursor: 'pointer', padding: 0, fontFamily: 'var(--font-cond)', fontSize: 13,
        color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.04em',
      }}>
        🤖 Análise IA
        <span style={{ fontSize: 10, color: 'var(--text-4)', fontWeight: 400 }}>{show ? '▲ fechar' : '▼ ver análise'}</span>
      </button>

      {show && (
        <div className="fade-in-1" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Veredicto */}
          {analysis.verdict && (
            <div style={{ background: 'rgba(15,122,120,0.1)', border: '1px solid rgba(15,122,120,0.3)', borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>
              {analysis.verdict}
            </div>
          )}

          {/* Overview */}
          {analysis.overview && (
            <div>
              <div style={h}>📋 Panorama</div>
              <div style={s}>{analysis.overview}</div>
            </div>
          )}

          {/* 2-col teams */}
          {(analysis.team_a || analysis.team_b) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {[
                { team: teamA, data: analysis.team_a },
                { team: teamB, data: analysis.team_b },
              ].map(({ team, data }) => data ? (
                <div key={team?.code} style={{ background: 'var(--bg-overlay)', borderRadius: 10, padding: '12px 14px', border: '1px solid var(--border)', minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    {team?.flag_url && <img src={team.flag_url} alt={team.code} style={{ width: 28, height: 20, objectFit: 'cover', borderRadius: 2 }} />}
                    <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{team?.name || team?.code}</span>
                  </div>
                  {data.tactical && <><div style={h}>Tática</div><div style={{ ...s, marginBottom: 8 }}>{data.tactical}</div></>}
                  {data.strengths && <><div style={h}>✅ Forças</div><div style={{ ...s, marginBottom: 8 }}>{data.strengths}</div></>}
                  {data.weaknesses && <><div style={h}>⚠️ Vulnerabilidades</div><div style={{ ...s, marginBottom: 8 }}>{data.weaknesses}</div></>}
                  {data.form && <><div style={h}>📈 Forma</div><div style={{ ...s, marginBottom: 8 }}>{data.form}</div></>}
                  {data.key_players?.length > 0 && (
                    <>
                      <div style={h}>⭐ Jogadores-chave</div>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {data.key_players.map((p, i) => <li key={i} style={{ ...s, marginBottom: 3 }}>{p}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              ) : null)}
            </div>
          )}

          {/* Matchup + Prediction */}
          {analysis.matchup && (
            <div>
              <div style={h}>⚔️ Confronto</div>
              <div style={s}>{analysis.matchup}</div>
            </div>
          )}
          {analysis.prediction && (
            <div>
              <div style={h}>🔮 Predição</div>
              <div style={s}>{analysis.prediction}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TeamFormSection({ teamA, teamB, recentMatches }) {
  if (!recentMatches?.length) return null

  function getForm(teamCode) {
    return recentMatches
      .filter(m => m.team_a?.code === teamCode || m.team_b?.code === teamCode)
      .sort((a, b) => new Date(b.match_date || 0) - new Date(a.match_date || 0))
      .slice(0, 2)
      .map(m => {
        const isA     = m.team_a?.code === teamCode
        const opp     = isA ? m.team_b : m.team_a
        const my      = isA ? (m.result?.score_a ?? m.score_a) : (m.result?.score_b ?? m.score_b)
        const them    = isA ? (m.result?.score_b ?? m.score_b) : (m.result?.score_a ?? m.score_a)
        const outcome = my > them ? 'V' : my < them ? 'D' : 'E'
        const dateStr = m.match_date
          ? new Date(m.match_date.endsWith('Z') ? m.match_date : m.match_date + 'Z')
              .toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
          : null
        return { opp, my, them, outcome, dateStr }
      })
  }

  const formA = getForm(teamA?.code)
  const formB = getForm(teamB?.code)
  if (!formA.length && !formB.length) return null

  return (
    <div style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--border)' }}>
      <div style={{ fontSize: 9, fontFamily: 'var(--font-cond)', color: 'var(--text-4)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>
        Últimos jogos
      </div>
      <FormBlock team={teamA} games={formA} role="mandante" />
      <div style={{ height: 1, background: 'var(--border)', margin: '10px 0' }} />
      <FormBlock team={teamB} games={formB} role="visitante" />
    </div>
  )
}

// ── Finished match card (no bet placed) ──────────────────────────────────────
function FinishedNoBetRow({ match, index, onOpenSimulation }) {
  const [showDetail, setShowDetail] = useState(false)
  const sa = match.result?.score_a ?? match.score_a ?? '?'
  const sb = match.result?.score_b ?? match.score_b ?? '?'
  return (
    <div className="bet-card fade-in" style={{ animationDelay: `${index * 30}ms`, opacity: 0.65 }}>
      <div className="bet-card__top">
        <PhaseBadge phase={match.phase} groupName={match.group_name} matchNumber={match.match_number} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          <span className="bet-card__time">{formatMatchDate(match.match_date)}</span>
          <span className="pts-badge pts-badge--wrong">sem palpite</span>
          <button type="button" className="bet-card__expand" onClick={() => setShowDetail(true)} aria-label="Expandir detalhes da partida" title="Expandir">
            <ExpandIcon />
          </button>
        </div>
      </div>
      <div className="bet-card__match" style={{ marginTop: 'var(--s4)' }}>
        <div className="bet-card__team">
          <TeamLabel code={match.team_a?.code} name={match.team_a?.name} flagUrl={match.team_a?.flag_url} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div className="bet-card__score">{sa} – {sb}</div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-4)', textTransform: 'uppercase' }}>
            resultado
          </div>
        </div>
        <div className="bet-card__team bet-card__team--right">
          <TeamLabel code={match.team_b?.code} name={match.team_b?.name} flagUrl={match.team_b?.flag_url} />
        </div>
      </div>
      <div className="bet-card__footer" style={{ marginTop: 'var(--s4)' }}>
        <span className="bet-card__status" style={{ color: 'var(--text-4)' }}>Partida encerrada · palpite não registrado</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenSimulation}>Ver Simulação</button>
      </div>

      {showDetail && (
        <MatchDetailModal
          onClose={() => setShowDetail(false)}
          teamA={match.team_a}
          teamB={match.team_b}
          phase={match.phase}
          groupName={match.group_name}
          matchDate={match.match_date}
          msBefore={null}
          score={null}
          official={{ a: sa, b: sb }}
          statusLabel="Encerrada · sem palpite"
          statusColor="var(--text-4)"
          pointsEarned={null}
          canEdit={false}
          onSimulate={() => { setShowDetail(false); onOpenSimulation() }}
        />
      )}
    </div>
  )
}

// ── Small components ──────────────────────────────────────────────────────────
function GuideBanner({ onShare, shareMsg }) {
  return (
    <div className="card mt-6 fade-in-2 bet-guide bet-guide--minimal">
      <div className="bet-guide-minimal">
        <div className="bet-guide-minimal__main">
          <div className="bet-guide-minimal__title">Regras do bolão</div>
          <div className="bet-guide-minimal__chips">
            <span className="bet-guide-chip"><strong>25 pts</strong> Placar exato</span>
            <span className="bet-guide-chip"><strong>10–18 pts</strong> Resultado correto</span>
            <span className="bet-guide-chip"><strong>0 pt</strong> Sem acerto</span>
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onShare}>Compartilhar convite</button>
      </div>
      {shareMsg && <div className="bet-guide-minimal__msg">{shareMsg}</div>}
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className={`bet-summary-card${tone ? ` bet-summary-card--${tone}` : ''}`}>
      <div className="bet-summary-card__label">{label}</div>
      <div className="bet-summary-card__value">{value}</div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isMatchOpen(match, now = Date.now()) {
  if (match.is_open !== undefined) return match.is_open
  if (match.status !== 'scheduled') return false
  if (!match.match_date) return true
  return parseUtcMatchDate(match.match_date).getTime() > now
}

function parseUtcMatchDate(value) {
  if (!value) return new Date(0)
  return new Date(value.endsWith('Z') ? value : `${value}Z`)
}

function formatMatchDate(value) {
  if (!value) return 'Sem horário'
  return parseUtcMatchDate(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatKickoffTime(value) {
  if (!value) return 'o início'
  return parseUtcMatchDate(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
