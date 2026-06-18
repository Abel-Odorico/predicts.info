import { useState, useEffect, useCallback } from 'react'
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

  const load = useCallback(() => {
    const reqs = [api.get('/matches?status=scheduled&limit=200')]
    if (token) reqs.push(api.get('/bets', token))
    Promise.all(reqs)
      .then(([m, b]) => { setMatches(m); if (b) setBets(b) })
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [token])

  useEffect(() => { load() }, [load])

  // Update clock every second for countdowns
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Re-fetch when a match might have just started (every 60s)
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

  const openMatches = matches.filter(m => isMatchOpen(m, now))
  const betsByMatchId = Object.fromEntries(bets.map(b => [b.match_id, b]))

  if (loading) return <Spinner text="Carregando apostas..." />

  if (!token) {
    return (
      <div className="page">
        <GuideBanner onShare={handleShare} shareMsg={shareMsg} />
        <div className="fade-in-1 bet-empty">
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: 'var(--accent)', marginBottom: 'var(--s4)' }}>🎯</div>
          <h1 className="page-title" style={{ marginBottom: 'var(--s4)' }}>APOSTAS</h1>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 15, color: 'var(--text-3)', marginBottom: 'var(--s6)' }}>Faça login para apostar nos placares</p>
          <Link to="/login" className="btn btn-primary btn-lg">Entrar</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">APOSTAS</h1>
        <p className="page-subtitle">Aposte até o apito inicial · ao iniciar, a aposta encerra automaticamente</p>
      </div>

      <GuideBanner onShare={handleShare} shareMsg={shareMsg} />

      <div className="tabs mt-6">
        {[
          { id: 'open',  label: `Partidas Abertas${openMatches.length ? ` (${openMatches.length})` : ''}` },
          { id: 'mine',  label: `Minhas Apostas${bets.length ? ` (${bets.length})` : ''}` },
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
                <BettableMatchRow
                  key={m.id}
                  match={m}
                  existingBet={betsByMatchId[m.id]}
                  token={token}
                  now={now}
                  index={i}
                  onBetPlaced={onBetPlaced}
                  onOpenSimulation={() => navigate(`/partida/${m.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div className="fade-in-1">
          <div className="bet-summary-grid mt-6">
            <SummaryCard label="Abertas Agora"  value={openMatches.length} tone="accent" />
            <SummaryCard label="Minhas Apostas" value={bets.length} />
            <SummaryCard label="Já Pontuadas"   value={bets.filter(b => b.result !== null).length} tone="win" />
          </div>
          {bets.length === 0 ? (
            <div className="bet-empty mt-6" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
              <p>Sem apostas ainda.</p>
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
function BettableMatchRow({ match, existingBet, token, now, index, onBetPlaced, onOpenSimulation }) {
  const [open, setOpen]     = useState(false)
  const [sa, setSa]         = useState(existingBet?.score_a ?? 0)
  const [sb, setSb]         = useState(existingBet?.score_b ?? 0)
  const [msg, setMsg]       = useState('')
  const [saving, setSaving] = useState(false)

  const msBefore  = parseUtcMatchDate(match.match_date).getTime() - now
  const stillOpen = match.is_open !== undefined ? match.is_open : msBefore > 0

  // Close the inline form if match just started
  useEffect(() => {
    if (!stillOpen && open) setOpen(false)
  }, [stillOpen, open])

  async function placeBet() {
    const scoreA = parseInt(sa)
    const scoreB = parseInt(sb)
    if (isNaN(scoreA) || isNaN(sb === '' ? NaN : parseInt(sb))) { setMsg('Preencha o placar completo'); return }
    if (isNaN(scoreA) || isNaN(scoreB)) { setMsg('Preencha o placar completo'); return }
    if (scoreA < 0 || scoreB < 0) { setMsg('Placar inválido'); return }
    setSaving(true)
    setMsg('')
    try {
      const data = await api.post('/bets', { match_id: match.id, score_a: scoreA, score_b: scoreB }, token)
      setMsg(`✓ ${scoreA}×${scoreB} registrado!`)
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
    } catch (e) {
      setMsg(e.message)
    } finally {
      setSaving(false)
    }
  }

  const hasBet    = !!existingBet
  const urgentMs  = 30 * 60 * 1000
  const isUrgent  = msBefore > 0 && msBefore < urgentMs

  return (
    <div className={`bet-card bet-card--open fade-in${isUrgent ? ' bet-card--urgent' : ''}`} style={{ animationDelay: `${index * 30}ms` }}>
      <div className="bet-card__top">
        <span className="badge badge-group">Grupo {match.group_name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
          {stillOpen && <Countdown ms={msBefore} />}
          <span className="bet-card__time">{formatMatchDate(match.match_date)}</span>
        </div>
      </div>

      <div className="bet-card__match" style={{ marginTop: 'var(--s4)' }}>
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
      </div>

      <button
        type="button"
        className="bet-card__simulation-link"
        onClick={onOpenSimulation}
      >
        Ver simulação da partida
      </button>

      {hasBet && (
        <div className="bet-placed-label">
          <span style={{ color: 'var(--win)' }}>✓</span> Aposta registrada
        </div>
      )}

      <div className="bet-card__footer" style={{ marginTop: 'var(--s4)' }}>
        <span className="bet-card__hint">
          {stillOpen
            ? hasBet ? 'Toque em Alterar para atualizar seu placar' : `Aposte até ${formatKickoffTime(match.match_date)}`
            : 'Apostas encerradas — partida iniciou'
          }
        </span>
        <div className="bet-card__actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onOpenSimulation}
          >
            Ver Simulação
          </button>
          {stillOpen && (
            <button
              type="button"
              className={`btn btn-sm ${open ? 'btn-ghost' : hasBet ? 'btn-ghost' : 'btn-primary'}`}
              onClick={() => { setOpen(v => !v); setMsg('') }}
            >
              {open ? 'Cancelar' : hasBet ? 'Alterar' : 'Apostar'}
            </button>
          )}
        </div>
      </div>

      {open && stillOpen && (
        <div className="bet-inline-form fade-in-1">
          <div className="bet-inline-teams">
            <span>{match.team_a?.code}</span>
            <div className="bet-inline-inputs">
              <input
                type="number" min="0" max="20"
                className="score-input"
                value={sa}
                onChange={e => setSa(e.target.value)}
                placeholder="0"
                autoFocus
              />
              <span className="score-sep">×</span>
              <input
                type="number" min="0" max="20"
                className="score-input"
                value={sb}
                onChange={e => setSb(e.target.value)}
                placeholder="0"
              />
            </div>
            <span style={{ textAlign: 'right' }}>{match.team_b?.code}</span>
          </div>
          <button
            type="button"
            className="btn btn-primary w-full"
            onClick={placeBet}
            disabled={saving}
          >
            {saving ? 'Salvando...' : hasBet ? 'Atualizar Aposta' : 'Confirmar Aposta'}
          </button>
          {msg && (
            <p className="bet-inline-msg" style={{ color: msg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
              {msg}
            </p>
          )}
        </div>
      )}
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
  const statusColor = bet.result === 'exact'   ? 'var(--accent)'
                    : bet.result === 'correct'  ? 'var(--win)'
                    : bet.result === 'wrong'    ? 'var(--lose)'
                    : 'var(--text-3)'

  const statusLabel = bet.result === 'exact'   ? 'Placar exato'
                    : bet.result === 'correct'  ? 'Resultado correto'
                    : bet.result === 'wrong'    ? 'Sem acerto'
                    : bet.is_open ? 'Pendente' : 'Aguardando avaliação'

  const pointsLabel = bet.result === null ? '—' : `${bet.points_earned ?? 0} pt${bet.points_earned === 1 ? '' : 's'}`
  const officialScore = bet.official_score_a != null && bet.official_score_b != null
    ? `${bet.official_score_a} – ${bet.official_score_b}` : 'Aguardando resultado'

  return (
    <div className="bet-card fade-in" style={{ animationDelay: `${index * 30}ms` }}>
      <div className="bet-card__top">
        <span className="badge badge-group">Grupo {bet.group_name}</span>
        <span className="bet-card__time">{formatMatchDate(bet.match_date)}</span>
      </div>
      <div className="bet-card__match" style={{ marginTop: 'var(--s3)' }}>
        <div className="bet-card__team">{bet.team_a_code}</div>
        <div className="bet-card__score">{bet.score_a} – {bet.score_b}</div>
        <div className="bet-card__team bet-card__team--right">{bet.team_b_code}</div>
      </div>
      <button
        type="button"
        className="bet-card__simulation-link"
        onClick={onOpenSimulation}
      >
        Ver simulação da partida
      </button>
      <div className="bet-card__meta" style={{ marginTop: 'var(--s3)' }}>
        <Metric label="Resultado oficial" value={officialScore} />
        <Metric label="Pontuação" value={pointsLabel} accent={bet.result !== null} />
      </div>
      <div className="bet-card__footer" style={{ marginTop: 'var(--s3)' }}>
        <span className="bet-card__status" style={{ color: statusColor }}>{statusLabel}</span>
        <div className="bet-card__actions">
          <span className="bet-card__hint">
            {bet.result === null
              ? 'Pontuação aparece após o resultado oficial'
              : 'Ranking atualizado'}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onOpenSimulation}
          >
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
          <div className="bet-guide-minimal__title">Regras do bolao</div>
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

function Metric({ label, value, accent }) {
  return (
    <div className="bet-metric">
      <div className="bet-metric__label">{label}</div>
      <div className={`bet-metric__value${accent ? ' bet-metric__value--accent' : ''}`}>{value}</div>
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
