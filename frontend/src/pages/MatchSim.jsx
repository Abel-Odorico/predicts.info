import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import ProbBar from '../components/ProbBar'
import SimAnalysisCard from '../components/SimAnalysisCard'
import ScoreGrid from '../components/ScoreGrid'
import Spinner from '../components/Spinner'
import { useAuth } from '../stores/authStore'
import MatchComments from '../components/MatchComments'

const WEIGHT_LABELS = {
  elo:          'Elo Rating (35%)',
  market_odds:  'Odds de Mercado (25%)',
  xg:           'xG — Expected Goals (15%)',
  form:         'Forma Recente (10%)',
  market_value: 'Valor de Mercado (5%)',
  wc_history:   'Histórico em Copas (5%)',
  ml_ensemble:  'ML Ensemble (5%)',
  h2h:          'Confrontos Diretos (5%)',
}

export default function MatchSim() {
  const { id } = useParams()
  const { token, user } = useAuth()
  const [match, setMatch]   = useState(null)
  const [sim, setSim]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [simRunning, setSimRunning] = useState(false)
  const [betScore, setBetScore] = useState({ a: 0, b: 0 })
  const [etWinnerPick, setEtWinnerPick] = useState(null)
  const [betMsg, setBetMsg] = useState('')
  const [existingBet, setExistingBet] = useState(null)
  const [n, setN] = useState(1000000)
  const [analysis, setAnalysis]         = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(true)
  const [showAnalysis, setShowAnalysis] = useState(true)
  const [generating, setGenerating]     = useState(false)
  const [genError, setGenError]         = useState('')
  const [participants, setParticipants] = useState(null)
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [showWeights, setShowWeights] = useState(false)
  const betRef = useRef(null)

  useEffect(() => { fetchAll() }, [id])

  // Palpites dos participantes — só após fechamento das apostas (jogo iniciado/finalizado)
  useEffect(() => {
    if (!id || !token || !match) { setParticipants(null); return }
    if (isBettingOpen(match)) { setParticipants(null); return }
    let alive = true
    const load = () =>
      api.get(`/matches/${id}/live-bets`, token)
        .then(d => { if (alive) setParticipants(d) })
        .catch(() => { if (alive) setParticipants(null) })
    setParticipantsLoading(true)
    load().finally(() => { if (alive) setParticipantsLoading(false) })
    if (match.status !== 'live') return () => { alive = false }
    const pid = window.setInterval(load, 15000)
    return () => { alive = false; window.clearInterval(pid) }
  }, [id, token, match?.status, match?.is_open])

  useEffect(() => {
    if (!id) return
    setAnalysisLoading(true)
    api.get(`/matches/${id}/analysis`)
      .then(d => setAnalysis(d.content))
      .catch(() => setAnalysis(null))
      .finally(() => setAnalysisLoading(false))
  }, [id])

  async function generateAnalysis() {
    setGenerating(true)
    setGenError('')
    try {
      const d = await api.post(`/admin/analysis/${id}/generate`, null, token)
      setAnalysis(d.content)
    } catch (e) {
      setGenError(e.message || 'Erro ao gerar análise')
    } finally {
      setGenerating(false)
    }
  }

  async function fetchAll() {
    setLoading(true)
    try {
      // allSettled: uma req opcional (bets/mine com token vencido → 401) NÃO pode
      // derrubar o carregamento da partida e disparar "Partida não encontrada".
      const reqs = [api.get(`/matches/${id}`), runSim(n, false)]
      if (token) reqs.push(api.get('/bets/mine', token))
      const [mRes, , betsRes] = await Promise.allSettled(reqs)
      if (mRes.status === 'fulfilled') setMatch(mRes.value)
      else console.error(mRes.reason)
      const betsData = betsRes?.status === 'fulfilled' ? betsRes.value : null
      if (betsData) {
        const found = betsData.find(b => b.match_id === Number(id))
        if (found) {
          setExistingBet(found)
          setBetScore({ a: String(found.score_a), b: String(found.score_b) })
          setEtWinnerPick(found.et_winner_pick || null)
        }
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function runSim(simN, force = false) {
    setSimRunning(true)
    try {
      const qs = force ? `?n=${simN}&force=true` : `?n=${simN}`
      const s = await api.post(`/matches/${id}/simulate${qs}`, null, token)
      setSim(s)
    } catch (e) {
      console.error(e)
    } finally {
      setSimRunning(false)
    }
  }

  async function placeBet() {
    if (!token) { setBetMsg('Faça login para apostar'); return }
    const sa = parseInt(betScore.a)
    const sb = parseInt(betScore.b)
    if (isNaN(sa) || isNaN(sb) || sa < 0 || sb < 0) { setBetMsg('Preencha o placar'); return }
    try {
      const payload = { match_id: Number(id), score_a: sa, score_b: sb }
      if (match?.phase !== 'group' && etWinnerPick) payload.et_winner_pick = etWinnerPick
      const data = await api.post('/bets', payload, token)
      setExistingBet(data)
      setBetMsg(`✓ Aposta ${sa}×${sb} ${data.updated ? 'atualizada' : 'registrada'}!`)
    } catch (e) {
      setBetMsg(e.message)
    }
  }

  const bettingOpen = isBettingOpen(match)

  function handleScoreSelect(score) {
    if (!token || !bettingOpen) return
    const [a, b] = score.split('x').map(Number)
    setBetScore({ a, b })
    setBetMsg('')
    setTimeout(() => betRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }

  const selectedScore = `${betScore.a}x${betScore.b}`

  if (loading) return <Spinner text="Simulando partida..." />
  if (!match) return <div className="page"><p className="text-3">Partida não encontrada.</p></div>

  return (
    <div className="page">
      <div className="match-breadcrumb">
        <Link to="/" className="match-breadcrumb__link">
          Dashboard
        </Link>
        <span className="match-breadcrumb__sep">›</span>
        <span className="badge badge-group">Grupo {match.group_name}</span>
        <span className="match-breadcrumb__meta">
          {match.team_a.code} vs {match.team_b.code}
        </span>
        {match.status === 'finished' && <span className="badge badge-done">FIM</span>}
        <Link
          to={`/partida/${id}/v2`}
          className="btn btn-ghost btn-sm"
          style={{ marginLeft: 'auto', fontFamily: 'var(--font-cond)', fontSize: 11, letterSpacing: '0.04em' }}
          title="Experimentar a proposta visual V2 desta tela"
        >
          ⚡ Testar V2
        </Link>
      </div>

      <div className="card card--accent fade-in-1">
        {simRunning
          ? <Spinner text="Rodando 1.000.000 simulações..." />
          : <ProbBar sim={sim} matchData={match} />
        }

        {!simRunning && sim?.recommended_score && (
          <div
            onClick={() => (token && bettingOpen) ? handleScoreSelect(sim.recommended_score.score) : undefined}
            className="pulse-accent"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'linear-gradient(135deg, var(--accent-glow) 0%, var(--accent-dim) 100%)',
              border: '1.5px solid var(--accent)', borderRadius: 10,
              padding: '12px 16px', marginTop: 'var(--s3)',
              cursor: (token && bettingOpen) ? 'pointer' : 'default',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700 }}>
                🔮 Palpite do Modelo
              </span>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 26, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '0.04em' }}>
                {match.team_a.code} {sim.recommended_score.score.replace('x', ' × ')} {match.team_b.code}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>
                {sim.recommended_score.prob.toFixed(1)}%
              </span>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>
                de probabilidade
              </div>
            </div>
          </div>
        )}

        {!simRunning && sim && (
          <div className="sim-toolbar">
            <div className="sim-toolbar__group">
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Simulações:
              </span>
              {[100000, 500000, 1000000].map(v => (
                <button
                  key={v}
                  onClick={() => { setN(v); runSim(v, false) }}
                  className={`btn btn-sm ${n === v ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {v >= 1000000 ? '1M' : `${v / 1000}K`}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
              <button
                onClick={() => runSim(n, true)}
                className="btn btn-ghost btn-sm"
                title="Rodar nova simulação (ignora cache)"
              >
                ↺ novo
              </button>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: sim.cached ? 'var(--text-4)' : 'var(--accent)' }}>
                {sim.cached ? '● cache' : `● ${sim.elapsed_ms}ms`}
              </span>
            </div>
          </div>
        )}
      </div>

      {match.status !== 'finished' && (
        <div className="card card--accent pulse-accent mt-6" ref={betRef}>
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              🎯 Apostar no Placar
            </span>
          </div>
          <div className="card__body">
            {!token ? (
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13, marginBottom: 'var(--s4)' }}>
                  Faça login para apostar
                </p>
                <Link to="/login" className="btn btn-primary btn-sm">Entrar</Link>
              </div>
            ) : !bettingOpen ? (
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                  Apostas encerradas — partida iniciou.
                </p>
              </div>
            ) : (
              <div>
                {existingBet && (
                  <div style={{ textAlign: 'center', marginBottom: 'var(--s3)', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--win)' }}>
                    ✓ Aposta atual: {existingBet.score_a} × {existingBet.score_b}
                    {existingBet.et_winner_pick && ` · pênaltis: ${existingBet.et_winner_pick === 'a' ? match.team_a.code : match.team_b.code}`}
                    {' '}— altere abaixo
                  </div>
                )}
                <div className="bet-form">
                  <div className="bet-form__team-label">{match.team_a.code}</div>
                  <div className="bet-form__score">
                    <ScoreInput value={betScore.a} onChange={v => setBetScore(s => ({ ...s, a: v }))} autoFocus />
                    <span className="score-sep">×</span>
                    <ScoreInput value={betScore.b} onChange={v => setBetScore(s => ({ ...s, b: v }))} />
                  </div>
                  <div className="bet-form__team-label">{match.team_b.code}</div>
                </div>

                {match.phase !== 'group' && (
                  <div
                    style={{
                      marginTop: 'var(--s4)',
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
                      Se empatar, quem avança? <span style={{ color: 'var(--text-4)' }}>(opcional)</span>
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
                          {team.flag_url && <img src={team.flag_url} alt={team.code} style={{ width: 30, height: 21, objectFit: 'cover', borderRadius: 2 }} />}
                          <span style={{ fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 14, color: etWinnerPick === side ? 'var(--accent)' : 'var(--text-2)' }}>
                            {team.code}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={placeBet} className="btn btn-primary w-full" style={{ marginTop: 'var(--s3)' }}>
                  {existingBet ? 'Atualizar Aposta' : 'Confirmar Aposta'}
                </button>
                {betMsg && (
                  <p style={{ marginTop: 'var(--s3)', textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 13, color: betMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                    {betMsg}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {sim?.h2h && (
        <div className="mt-6">
          <H2HCard h2h={sim.h2h} teamA={match.team_a} teamB={match.team_b} />
        </div>
      )}

      {/* ── Análise IA — logo após probabilidades ─────────────────────────── */}
      <div className="mt-6">
        {analysisLoading ? (
          <div className="card" style={{ padding: 'var(--s4)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)' }}>⏳ Carregando análise IA…</span>
          </div>
        ) : analysis ? (
          <SimAnalysisCard analysis={analysis} teamA={match.team_a} teamB={match.team_b} show={showAnalysis} onToggle={() => setShowAnalysis(v => !v)} />
        ) : (
          <div className="card" style={{ padding: 'var(--s4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)' }}>
              🤖 Análise IA não disponível para esta partida
            </span>
            {user?.role === 'admin' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                {genError && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)' }}>{genError}</span>}
                <button
                  onClick={generateAnalysis}
                  disabled={generating}
                  className="btn btn-primary btn-sm"
                >
                  {generating ? '⏳ Gerando…' : '⚡ Gerar Análise IA'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="matchsim-grid mt-6">
        <div className="card fade-in-2">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              20 Placares Mais Prováveis
            </span>
          </div>
          <div className="card__body">
            {sim ? (
              <>
                {token && bettingOpen && (
                  <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', marginBottom: 'var(--s3)', letterSpacing: '0.05em' }}>
                    Clique num placar para preencher sua aposta ↓
                  </p>
                )}
                <ScoreGrid
                  scores={sim.top_scores}
                  onSelect={token && bettingOpen ? handleScoreSelect : undefined}
                  selectedScore={token && bettingOpen ? selectedScore : undefined}
                  highlightScore={sim.recommended_score?.score}
                />
              </>
            ) : <Spinner />}
          </div>
        </div>

        <div className="stack">
          {sim?.model_weights && (
            <div className="card fade-in-3">
              <button onClick={() => setShowWeights(v => !v)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                background: 'none', border: 'none', cursor: 'pointer', padding: 'var(--s4)',
              }}>
                <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                  Pesos do Modelo
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{showWeights ? '▲ encolher' : '▼ expandir'}</span>
              </button>
              {showWeights && (
                <div className="card__body fade-in-1" style={{ paddingTop: 0 }}>
                  <div className="weights-grid">
                    {Object.entries(sim.model_weights).map(([k, v]) => (
                      <div key={k} className="weight-row">
                        <div>
                          <div className="weight-row__label">{WEIGHT_LABELS[k] || k}</div>
                          <div className="weight-row__bar">
                            <div className="weight-row__bar-fill" style={{ width: `${v}%` }} />
                          </div>
                        </div>
                        <span className="weight-row__pct">{v}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {token && !isBettingOpen(match) && (
            <ParticipantBets data={participants} loading={participantsLoading} myUserId={user?.id} teamA={match.team_a} teamB={match.team_b} />
          )}

          {match.result && (
            <div className="card fade-in-5" style={{ borderColor: 'var(--border-accent)' }}>
              <div className="card__body" style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  Resultado Final
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 52, color: 'var(--accent)', lineHeight: 1.1, marginTop: 'var(--s2)' }}>
                  {match.result.score_a} – {match.result.score_b}
                </div>
                {match.result.xg_a != null && (
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)', marginTop: 'var(--s2)' }}>
                    xG: {match.result.xg_a.toFixed(2)} – {match.result.xg_b.toFixed(2)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
      <MatchComments matchId={match?.id} />
    </div>
  )
}

function isBettingOpen(match) {
  if (!match) return false
  if (match.is_open !== undefined) return match.is_open
  if (match.status !== 'scheduled') return false
  if (!match.match_date) return true
  return parseUtcMatchDate(match.match_date).getTime() > Date.now()
}

function parseUtcMatchDate(value) {
  return new Date(value.endsWith('Z') ? value : `${value}Z`)
}

const BET_STATUS_META = {
  exact:   { icon: '🎯', label: 'Exato',     color: 'var(--win, #3fb950)' },
  correct: { icon: '✅', label: 'Acertando', color: 'var(--win, #3fb950)' },
  wrong:   { icon: '❌', label: 'Errando',   color: 'var(--lose, #e85252)' },
  pending: { icon: '⏳', label: 'Aguardando', color: 'var(--text-4, #777)' },
}

function ParticipantBets({ data, loading, myUserId, teamA, teamB }) {
  if (loading && !data) {
    return (
      <div className="card fade-in-3">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>🎲 Palpites dos Participantes</span>
        </div>
        <div className="card__body"><Spinner /></div>
      </div>
    )
  }
  if (!data || data.bets.length === 0) return null

  const exactCount   = data.bets.filter(b => b.status === 'exact').length
  const correctCount = data.bets.filter(b => b.status === 'correct').length

  return (
    <div className="card fade-in-3">
      <div className="card__header">
        <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>🎲 Palpites dos Participantes</span>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>{data.total_bets}</span>
      </div>
      <div className="card__body">
        {data.reference_score?.score_a != null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10, fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
            <span>Placar de referência:</span>
            <span style={{ fontFamily: 'var(--font-data)', fontWeight: 800, color: 'var(--text-1)' }}>
              {teamA?.code} {data.reference_score.score_a} × {data.reference_score.score_b} {teamB?.code}
            </span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 12, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
          <span>🎯 {exactCount} exato{exactCount === 1 ? '' : 's'}</span>
          <span>✅ {correctCount} acertando</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
          {data.bets.map(b => {
            const meta = BET_STATUS_META[b.status] || BET_STATUS_META.pending
            const mine = b.user_id === myUserId
            return (
              <div key={b.user_id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                    padding: '7px 10px', borderRadius: 8,
                    background: mine ? 'rgba(15,122,120,0.1)' : 'var(--bg-overlay, rgba(255,255,255,0.03))',
                    border: mine ? '1px solid var(--accent)' : '1px solid transparent',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {b.user_name}{mine ? ' (você)' : ''}
                  </span>
                  <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 13, color: 'var(--text-1)', flexShrink: 0 }}>
                    {b.score_a} × {b.score_b}
                  </span>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: meta.color, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
                    {meta.icon} {meta.label}
                  </span>
                  {b.points_earned != null && (
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 800, color: 'var(--accent)', flexShrink: 0, minWidth: 34, textAlign: 'right' }}>
                      +{b.points_earned}pts
                    </span>
                  )}
                </div>
                {b?.comment && (
                  <div className="bet-comment" style={{ padding: '0 10px', fontStyle: 'italic', fontSize: 11, color: 'var(--text-3)' }}>
                    "{b.comment}"
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function H2HCard({ h2h, teamA, teamB }) {
  const total = h2h.total || 1
  const pctA = (h2h.wins_a / total) * 100
  const pctD = (h2h.draws / total) * 100
  const pctB = (h2h.wins_b / total) * 100
  const seg = (pct, color, delayMs) => pct > 0 ? (
    <div
      className="h2h-bar-seg"
      style={{
        width: `${pct}%`, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 2, animationDelay: `${delayMs}ms`,
      }}
    >
      {pct >= 12 && <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 800, color: '#fff' }}>{pct.toFixed(0)}%</span>}
    </div>
  ) : null

  return (
    <div className="card card--accent fade-in-2">
      <div className="card__header">
        <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
          ⚔️ Confronto Direto — Histórico All-Time
        </span>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
          {h2h.total} jogo{h2h.total === 1 ? '' : 's'}
        </span>
      </div>
      <div className="card__body">
        <div className="h2h-bar-track" style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
          {seg(pctA, 'var(--win)', 0)}
          {seg(pctD, 'var(--text-4)', 120)}
          {seg(pctB, 'var(--lose)', 240)}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center', marginBottom: 'var(--s3)' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--win)' }}>
              {h2h.wins_a}<span style={{ fontSize: 13, opacity: 0.7 }}> ({pctA.toFixed(0)}%)</span>
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>{teamA?.code}</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--text-2)' }}>
              {h2h.draws}<span style={{ fontSize: 13, opacity: 0.7 }}> ({pctD.toFixed(0)}%)</span>
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>Empates</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--lose)' }}>
              {h2h.wins_b}<span style={{ fontSize: 13, opacity: 0.7 }}> ({pctB.toFixed(0)}%)</span>
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase' }}>{teamB?.code}</div>
          </div>
        </div>

        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', textAlign: 'center', margin: 0 }}>
          {h2h.summary || `${h2h.total} jogo${h2h.total === 1 ? '' : 's'} disputado${h2h.total === 1 ? '' : 's'} entre as seleções.`}
        </p>

        {h2h.recent_results?.length > 0 && (
          <div style={{ marginTop: 'var(--s3)', borderTop: '1px solid var(--border)', paddingTop: 'var(--s3)' }}>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--s2)' }}>
              Últimos confrontos
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {h2h.recent_results.map((r, i) => (
                <li key={i} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)',
                  display: 'flex', justifyContent: 'space-between', gap: 8,
                  background: 'var(--bg-overlay)', borderRadius: 6, padding: '6px 10px',
                }}>
                  <span style={{ color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{r.date}{r.competition ? ` · ${r.competition}` : ''}</span>
                  <span style={{ textAlign: 'right', fontWeight: 700 }}>{r.result}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

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

