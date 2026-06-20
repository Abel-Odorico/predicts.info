import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

export default function Bets() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [bets, setBets]       = useState([])
  const [matches, setMatches] = useState([])
  const [loading, setLoad]    = useState(true)
  const [tab, setTab]         = useState('open')
  const [shareMsg, setShareMsg] = useState('')
  const [now, setNow]         = useState(Date.now())
  const [pendingOpenId, setPendingOpenId] = useState(null)
  const matchRefs = useRef({})

  const load = useCallback(() => {
    const reqs = [api.get('/matches?status=scheduled&limit=200')]
    if (token) reqs.push(api.get('/bets/mine', token))
    Promise.all(reqs)
      .then(([m, b]) => { setMatches(m); if (b) setBets(b) })
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [token])

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
      if (navigator.share) { await navigator.share({ title: 'Bolão Copa 2026', text: 'Aposte nos placares e dispute o ranking.', url }); setShareMsg('Link compartilhado.'); return }
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
    setPendingOpenId(nextId)
    setTimeout(() => {
      matchRefs.current[nextId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 150)
  }

  const openMatches = matches.filter(m => isMatchOpen(m, now))
  const betsByMatchId = Object.fromEntries(bets.map(b => [b.match_id, b]))

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

      <GuideBanner onShare={handleShare} shareMsg={shareMsg} />

      <div className="tabs mt-6">
        {[
          { id: 'open',  label: `Partidas Abertas${openMatches.length ? ` (${openMatches.length})` : ''}` },
          { id: 'mine',  label: `Meus Palpites${bets.length ? ` (${bets.length})` : ''}` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? 'active' : ''}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'open' && (
        <div className="fade-in-1">
          {openMatches.length === 0 ? (
            <div className="bet-empty mt-6" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
              Sem partidas abertas no momento
            </div>
          ) : (
            <div className="bets-list mt-6">
              {openMatches.map((m, i) => (
                <div key={m.id} ref={el => { matchRefs.current[m.id] = el }}>
                  <BettableMatchRow
                    match={m}
                    existingBet={betsByMatchId[m.id]}
                    token={token}
                    now={now}
                    index={i}
                    onBetPlaced={onBetPlaced}
                    onOpenSimulation={() => navigate(`/partida/${m.id}`)}
                    nextMatch={openMatches[i + 1] || null}
                    onGoToNextMatch={goToNextMatch}
                    autoOpen={pendingOpenId === m.id}
                    onAutoOpenDone={() => setPendingOpenId(null)}
                  />
                </div>
              ))}
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
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Inline bettable match card ────────────────────────────────────────────────
function BettableMatchRow({ match, existingBet, token, now, index, onBetPlaced, onOpenSimulation, nextMatch, onGoToNextMatch, autoOpen, onAutoOpenDone }) {
  const isMobile = window.matchMedia('(max-width: 767px)').matches
  const initStillOpen = match.is_open !== undefined
    ? match.is_open
    : (() => {
        if (!match.match_date) return true
        const d = match.match_date.endsWith('Z') ? match.match_date : `${match.match_date}Z`
        return new Date(d).getTime() > Date.now()
      })()

  const [open, setOpen]         = useState(isMobile && initStillOpen)
  const [sa, setSa]             = useState(existingBet?.score_a ?? 0)
  const [sb, setSb]             = useState(existingBet?.score_b ?? 0)
  const [msg, setMsg]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [confirmed, setConfirmed]       = useState(false)
  const [showNextCard, setShowNextCard] = useState(false)

  const [showOdds, setShowOdds]         = useState(false)
  const [odds, setOdds]                 = useState(null)
  const [oddsLoading, setOddsLoading]   = useState(false)
  const [communityBets, setCommunityBets]     = useState(null)
  const [communityLoading, setCommunityLoading] = useState(false)

  const msBefore  = parseUtcMatchDate(match.match_date).getTime() - now
  const stillOpen = match.is_open !== undefined ? match.is_open : msBefore > 0

  useEffect(() => {
    if (!stillOpen && open) setOpen(false)
  }, [stillOpen, open])

  useEffect(() => {
    if (autoOpen) {
      setOpen(true)
      onAutoOpenDone?.()
    }
  }, [autoOpen])

  async function fetchOdds() {
    if (odds || oddsLoading) return
    setOddsLoading(true)
    try {
      const data = await api.post(`/matches/${match.id}/simulate?n=100000`, null)
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

  function toggleExpand() {
    const next = !showOdds
    setShowOdds(next)
    if (next) {
      fetchOdds()
      fetchCommunityBets()
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
      const data = await api.post('/bets', { match_id: match.id, score_a: scoreA, score_b: scoreB }, token)
      onBetPlaced(match.id, {
        ...data,
        match_id: match.id,
        team_a_code: match.team_a?.code,
        team_b_code: match.team_b?.code,
        match_date: match.match_date,
        group_name: match.group_name,
        match_status: match.status,
        is_open: true,
        official_score_a: null,
        official_score_b: null,
        result: null,
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
        <span className="badge badge-group">Grupo {match.group_name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          {stillOpen && <Countdown ms={msBefore} />}
          <span className="bet-card__time">{formatMatchDate(match.match_date)}</span>
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
          {match.team_a?.flag_url && <img src={match.team_a.flag_url} alt={match.team_a.code} className="match-card__flag" />}
          <span>{match.team_a?.code}</span>
        </div>
        {hasBet
          ? <div className="bet-current-score">{existingBet.score_a} – {existingBet.score_b}</div>
          : <div className="bet-card__versus">vs</div>
        }
        <div className="bet-card__team bet-card__team--right">
          {match.team_b?.flag_url && <img src={match.team_b.flag_url} alt={match.team_b.code} className="match-card__flag" />}
          <span>{match.team_b?.code}</span>
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
                  <span className="odds-label__team">{match.team_a?.code}</span>
                  <span className="odds-label__pct">{odds.prob_a}%</span>
                </span>
                <span className="odds-label odds-label--draw">
                  <span className="odds-label__team">Empate</span>
                  <span className="odds-label__pct">{odds.prob_draw}%</span>
                </span>
                <span className="odds-label odds-label--lose">
                  <span className="odds-label__team">{match.team_b?.code}</span>
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
                  <span className="odds-label__team">{match.team_a?.code}</span>
                  <span className="odds-label__pct">{communityStats.pct_a}%</span>
                </span>
                <span className="odds-label odds-label--draw">
                  <span className="odds-label__team">Empate</span>
                  <span className="odds-label__pct">{communityStats.pct_draw}%</span>
                </span>
                <span className="odds-label odds-label--lose">
                  <span className="odds-label__team">{match.team_b?.code}</span>
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
        <span className="bet-card__hint">
          {stillOpen
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
              onClick={() => { setOpen(v => !v); setMsg('') }}
            >
              {open ? 'Cancelar' : hasBet ? 'Alterar' : 'Dar Palpite'}
            </button>
          )}
        </div>
      </div>

      {open && stillOpen && (
        <div className="bet-inline-form fade-in-1">
          <div className="bet-inline-teams">
            <span>{match.team_a?.code}</span>
            <div className="bet-inline-inputs">
              <ScoreInput value={sa} onChange={setSa} autoFocus />
              <span className="score-sep">×</span>
              <ScoreInput value={sb} onChange={setSb} />
            </div>
            <span style={{ textAlign: 'right' }}>{match.team_b?.code}</span>
          </div>
          <button
            type="button"
            className="btn btn-primary w-full"
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
        {match.team_a?.flag_url && <img src={match.team_a.flag_url} alt={match.team_a.code} className="match-card__flag" />}
        <span className="next-match-card__code">{match.team_a?.code}</span>
        <span className="next-match-card__vs">vs</span>
        <span className="next-match-card__code">{match.team_b?.code}</span>
        {match.team_b?.flag_url && <img src={match.team_b.flag_url} alt={match.team_b.code} className="match-card__flag" />}
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

// ── Placed bet row (Mine tab) ─────────────────────────────────────────────────
function BetRow({ bet, index, onOpenSimulation }) {
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
    <div className={`bet-card fade-in ${resultClass}`} style={{ animationDelay: `${index * 30}ms` }}>
      <div className="bet-card__top">
        <span className="badge badge-group">Grupo {bet.group_name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          <span className="bet-card__time">{formatMatchDate(bet.match_date)}</span>
          <span className={`pts-badge ${ptsVariant}`}>{ptsValue}</span>
        </div>
      </div>

      <div className="bet-card__match" style={{ marginTop: 'var(--s4)' }}>
        <div className="bet-card__team">{bet.team_a_code}</div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div className="bet-card__score">{bet.score_a} – {bet.score_b}</div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-4)', textTransform: 'uppercase' }}>
            seu palpite
          </div>
        </div>
        <div className="bet-card__team bet-card__team--right">{bet.team_b_code}</div>
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

      {!hasOfficial && (
        <div style={{ marginTop: 'var(--s3)', textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', letterSpacing: '0.06em' }}>
          {bet.result === null ? 'Aguardando resultado oficial' : 'Resultado registrado'}
        </div>
      )}

      <div className="bet-card__footer" style={{ marginTop: 'var(--s4)' }}>
        <span className="bet-card__status" style={{ color: statusColor }}>{statusLabel}</span>
        <div className="bet-card__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenSimulation}>
            Ver Simulação
          </button>
        </div>
      </div>
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
            <span className="bet-guide-chip"><strong>3 pts</strong> Placar exato</span>
            <span className="bet-guide-chip"><strong>1 pt</strong> Resultado correto</span>
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
