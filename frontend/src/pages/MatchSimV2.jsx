import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useAuth } from '../stores/authStore'
import MatchComments from '../components/MatchComments'

const WEIGHT_LABELS = {
  elo:          'Elo Rating',
  market_odds:  'Odds de Mercado',
  xg:           'xG — Expected Goals',
  form:         'Forma Recente',
  market_value: 'Valor de Mercado',
  wc_history:   'Histórico em Copas',
  ml_ensemble:  'ML Ensemble',
  h2h:          'Confrontos Diretos',
}

export default function MatchSimV2() {
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

  if (loading) return <div className="v2-page"><Spinner text="Simulando partida..." /></div>
  if (!match) return <div className="v2-page"><p style={{ fontFamily: 'Chakra Petch, monospace', color: 'var(--v2-chalk-dim)' }}>Partida não encontrada.</p></div>

  const phaseLabel = { group: 'Fase de Grupos', r32: 'Rodada de 32', r16: 'Oitavas de Final', qf: 'Quartas de Final', sf: 'Semifinal', '3rd': 'Terceiro Lugar', final: 'Final' }[match.phase] || match.phase

  return (
    <div className="v2-page">
      <div className="v2-wrap">
        <Link to={`/partida/${id}`} className="v2-back">← Voltar pra V1 (oficial)</Link>

        <div className="v2-crumb">
          <Link to="/" style={{ color: 'inherit', textDecoration: 'none' }}>Dashboard</Link>
          <span>›</span>
          <b>{phaseLabel}</b>
          <span>›</span>
          <span>{match.team_a.code} vs {match.team_b.code}</span>
          <span className="v2-tag">V2 · PROPOSTA</span>
          {match.status === 'finished' && <span className="v2-tag" style={{ background: 'var(--v2-turf-dim)', color: 'var(--v2-turf)', borderColor: 'rgba(46,139,82,.3)' }}>FIM</span>}
        </div>

        <div className="v2-banner">
          <div className="v2-banner-row">
            <div className="v2-team-plate">
              <img src={match.team_a.flag_url} alt={match.team_a.code} />
              <div>
                <div className="v2-team-name">{match.team_a.name}</div>
                <div className="v2-team-meta">{match.team_a.confederation} · ELO {Math.round(match.team_a.elo_rating)}</div>
              </div>
            </div>
            <div className="v2-vs">
              <div className="v">VS</div>
              <div className="p">{phaseLabel}</div>
            </div>
            <div className="v2-team-plate right">
              <img src={match.team_b.flag_url} alt={match.team_b.code} />
              <div>
                <div className="v2-team-name">{match.team_b.name}</div>
                <div className="v2-team-meta">{match.team_b.confederation} · ELO {Math.round(match.team_b.elo_rating)}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="v2-scoreboard">
          {simRunning ? <Spinner text={`Rodando ${n.toLocaleString('pt-BR')} simulações...`} /> : sim && (
            <>
              <div className="v2-score-trio" key={`${sim.prob_a}-${sim.prob_draw}-${sim.prob_b}`}>
                <div>
                  <FlipDigits className="win" text={`${sim.prob_a.toFixed(1)}%`} />
                  <div className="v2-score-label">Vitória {match.team_a.code}</div>
                </div>
                <div>
                  <FlipDigits className="draw" text={`${sim.prob_draw.toFixed(1)}%`} />
                  <div className="v2-score-label">Empate</div>
                </div>
                <div>
                  <FlipDigits className="lose" text={`${sim.prob_b.toFixed(1)}%`} />
                  <div className="v2-score-label">Vitória {match.team_b.code}</div>
                </div>
              </div>
              <div className="v2-xg-line">
                <span>xG esperado</span>
                <span><b>{sim.lambda_a.toFixed(2)}</b> {match.team_a.code}</span>
                <span>×</span>
                <span><b>{sim.lambda_b.toFixed(2)}</b> {match.team_b.code}</span>
              </div>
              <div className="v2-toolbar">
                <div className="v2-toolbar-group">
                  {[100000, 500000, 1000000].map(v => (
                    <button key={v} className={`v2-btn ${n === v ? 'on' : ''}`} onClick={() => { setN(v); runSim(v, false) }}>
                      {v >= 1000000 ? '1M' : `${v / 1000}K`}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button className="v2-btn" onClick={() => runSim(n, true)} title="Rodar nova simulação (ignora cache)">↺ novo</button>
                  <span style={{ fontFamily: 'Chakra Petch, monospace', fontSize: 10, color: sim.cached ? 'var(--v2-chalk-mute)' : 'var(--v2-floodlight-ink)' }}>
                    {sim.cached ? '● cache' : `● ${sim.elapsed_ms}ms`}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {!simRunning && sim?.recommended_score && (
          <div
            className={`v2-palpite v2-pulse ${token && bettingOpen ? 'clickable' : ''}`}
            onClick={() => (token && bettingOpen) ? handleScoreSelect(sim.recommended_score.score) : undefined}
          >
            <div>
              <div className="v2-palpite-label">🔮 Palpite do Modelo</div>
              <div className="v2-palpite-score">{match.team_a.code} {sim.recommended_score.score.replace('x', ' × ')} {match.team_b.code}</div>
            </div>
            <div className="v2-palpite-prob">
              <div className="n">{sim.recommended_score.prob.toFixed(1)}%</div>
              <div className="l">de probabilidade</div>
            </div>
          </div>
        )}

        {match.status !== 'finished' && (
          <div className="v2-card v2-pulse" ref={betRef}>
            <div className="v2-card-tab"><span className="t">🎯 Apostar no Placar</span></div>
            <div className="v2-card-body">
              {!token ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: 'var(--v2-chalk-dim)', fontSize: 13, marginBottom: 14 }}>Faça login para apostar</p>
                  <Link to="/login" className="v2-btn on" style={{ display: 'inline-block', textDecoration: 'none', padding: '8px 18px' }}>Entrar</Link>
                </div>
              ) : !bettingOpen ? (
                <div style={{ textAlign: 'center' }}>
                  <p style={{ color: 'var(--v2-chalk-dim)', fontSize: 13 }}>Apostas encerradas — partida iniciou.</p>
                </div>
              ) : (
                <div>
                  {existingBet && (
                    <div style={{ textAlign: 'center', marginBottom: 12, fontFamily: 'Chakra Petch, monospace', fontSize: 11, color: 'var(--v2-turf)' }}>
                      ✓ Aposta atual: {existingBet.score_a} × {existingBet.score_b}
                      {existingBet.et_winner_pick && ` · pênaltis: ${existingBet.et_winner_pick === 'a' ? match.team_a.code : match.team_b.code}`}
                      {' '}— altere abaixo
                    </div>
                  )}
                  <div className="v2-bet-mock">
                    <span className="v2-bet-team">{match.team_a.code}</span>
                    <StepperV2 value={betScore.a} onChange={v => setBetScore(s => ({ ...s, a: v }))} />
                    <span className="v2-bet-sep">×</span>
                    <StepperV2 value={betScore.b} onChange={v => setBetScore(s => ({ ...s, b: v }))} />
                    <span className="v2-bet-team">{match.team_b.code}</span>
                  </div>

                  {match.phase !== 'group' && (
                    <div
                      style={{
                        marginTop: 14,
                        background: 'var(--v2-floodlight-glow)',
                        border: '1.5px dashed var(--v2-floodlight)',
                        borderRadius: 6,
                        padding: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15 }}>🥅</span>
                        <span style={{ fontFamily: "'Chakra Petch', monospace", fontWeight: 700, fontSize: 11, color: 'var(--v2-floodlight)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          Prorrogação / Pênaltis
                        </span>
                        <span style={{ fontFamily: "'Chakra Petch', monospace", fontSize: 10, fontWeight: 700, color: 'var(--v2-turf)', border: '1px solid var(--v2-turf)', borderRadius: 999, padding: '1px 8px' }}>
                          +10 pts
                        </span>
                      </div>
                      <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--v2-chalk-dim)', marginBottom: 10 }}>
                        Se empatar, quem avança? <span style={{ opacity: 0.7 }}>(opcional)</span>
                      </p>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[['a', match.team_a], ['b', match.team_b]].map(([side, team]) => (
                          <button
                            key={side}
                            type="button"
                            onClick={() => setEtWinnerPick(p => p === side ? null : side)}
                            style={{
                              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                              padding: '8px 6px', borderRadius: 5, cursor: 'pointer',
                              border: etWinnerPick === side ? `2px solid var(--v2-floodlight)` : '1.5px solid var(--v2-line-strong)',
                              background: etWinnerPick === side ? 'var(--v2-floodlight-glow)' : 'transparent',
                            }}
                          >
                            {team.flag_url && <img src={team.flag_url} alt={team.code} style={{ width: 26, height: 18, objectFit: 'cover', borderRadius: 2 }} />}
                            <span style={{ fontFamily: "'Chakra Petch', monospace", fontWeight: 700, fontSize: 13, color: etWinnerPick === side ? 'var(--v2-floodlight)' : 'var(--v2-chalk)' }}>
                              {team.code}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button className="v2-btn-confirm" onClick={placeBet}>
                    {existingBet ? 'Atualizar Aposta' : 'Confirmar Aposta'}
                  </button>
                  {betMsg && (
                    <p style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: betMsg.startsWith('✓') ? 'var(--v2-turf)' : 'var(--v2-red)' }}>
                      {betMsg}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="v2-divider"><div className="line" /><div className="arc" /><div className="line" /></div>

        <div className="v2-grid2">
          <div>
            {sim?.h2h && <H2HCardV2 h2h={sim.h2h} teamA={match.team_a} teamB={match.team_b} />}

            <div className="v2-card">
              <div className="v2-card-tab"><span className="t">🤖 Análise IA</span></div>
              <div className="v2-card-body">
                {analysisLoading ? (
                  <span style={{ fontSize: 13, color: 'var(--v2-chalk-mute)' }}>⏳ Carregando análise IA…</span>
                ) : analysis ? (
                  <AnalysisV2 analysis={analysis} teamA={match.team_a} teamB={match.team_b} show={showAnalysis} onToggle={() => setShowAnalysis(v => !v)} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, color: 'var(--v2-chalk-mute)' }}>Análise IA não disponível para esta partida</span>
                    {user?.role === 'admin' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {genError && <span style={{ fontSize: 11, color: 'var(--v2-red)' }}>{genError}</span>}
                        <button className="v2-btn on" onClick={generateAnalysis} disabled={generating}>
                          {generating ? '⏳ Gerando…' : '⚡ Gerar Análise IA'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            {sim && (
              <div className="v2-card">
                <div className="v2-card-tab"><span className="t">Placares Mais Prováveis</span></div>
                <div className="v2-card-body">
                  {token && bettingOpen && (
                    <p style={{ fontFamily: 'Chakra Petch, monospace', fontSize: 10, color: 'var(--v2-chalk-mute)', marginBottom: 10 }}>
                      Clique num placar pra preencher sua aposta ↓
                    </p>
                  )}
                  <div className="v2-scores-grid">
                    {sim.top_scores.map(({ score, prob }) => {
                      const maxP = sim.top_scores[0].prob
                      const isTop = score === sim.recommended_score?.score
                      const isSelected = token && bettingOpen && score === selectedScore
                      const clickable = token && bettingOpen
                      return (
                        <div
                          key={score}
                          className={`v2-score-row ${isTop ? 'top' : ''} ${clickable ? 'clickable' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={clickable ? () => handleScoreSelect(score) : undefined}
                        >
                          <span className="sc">{score.replace('x', '×')}</span>
                          <div className="bt"><div className="bf" style={{ width: `${(prob / maxP * 100).toFixed(0)}%` }} /></div>
                          <span className="pc">{prob.toFixed(1)}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {sim?.model_weights && (
              <div className="v2-card">
                <button className="v2-card-tab clickable" onClick={() => setShowWeights(v => !v)}>
                  <span className="t">Pesos do Modelo</span>
                  <span style={{ fontFamily: 'Chakra Petch, monospace', fontSize: 10, color: 'var(--v2-chalk-mute)' }}>{showWeights ? '▲' : '▼'}</span>
                </button>
                {showWeights && (
                  <div className="v2-card-body">
                    <div className="v2-weights">
                      {Object.entries(sim.model_weights).map(([k, v]) => (
                        <div key={k} className={`v2-weight-row ${v > 0 ? 'on' : ''}`}>
                          <div>
                            <div className="lbl">{WEIGHT_LABELS[k] || k}</div>
                            <div className="bt"><div className="bf" style={{ width: `${v}%` }} /></div>
                          </div>
                          <span className="v">{v}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {token && !isBettingOpen(match) && (
              <ParticipantsV2 data={participants} loading={participantsLoading} myUserId={user?.id} teamA={match.team_a} teamB={match.team_b} />
            )}

            {match.result && (
              <div className="v2-card">
                <div className="v2-result-final">
                  <div className="lbl">Resultado Final</div>
                  <div className="score">{match.result.score_a} – {match.result.score_b}</div>
                  {match.result.xg_a != null && (
                    <div style={{ fontFamily: 'Chakra Petch, monospace', fontSize: 11, color: 'var(--v2-chalk-mute)', marginTop: 8 }}>
                      xG: {match.result.xg_a.toFixed(2)} – {match.result.xg_b.toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="v2-footnote">Proposta visual <b>V2</b> · a versão oficial continua em <Link to={`/partida/${id}`} style={{ color: 'var(--v2-floodlight-ink)' }}>V1</Link></div>

        <MatchComments matchId={match?.id} />
      </div>
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

function FlipDigits({ text, className }) {
  return (
    <div className={`v2-flip ${className}`}>
      {[...text].map((ch, i) => (
        <span key={i} className="u" style={{ animationDelay: `${i * 40}ms` }}>{ch}</span>
      ))}
    </div>
  )
}

function StepperV2({ value, onChange }) {
  const v = Number(value) || 0
  return (
    <div className="v2-stepper">
      <button type="button" onClick={() => onChange(Math.max(0, v - 1))}>−</button>
      <input
        type="number" min="0" max="20" value={v}
        onChange={e => onChange(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
      />
      <button type="button" onClick={() => onChange(Math.min(20, v + 1))}>+</button>
    </div>
  )
}

function H2HCardV2({ h2h, teamA, teamB }) {
  const total = h2h.total || 1
  const pctA = (h2h.wins_a / total) * 100
  const pctD = (h2h.draws / total) * 100
  const pctB = (h2h.wins_b / total) * 100
  const seg = (pct, color) => pct > 0 ? (
    <div className="v2-h2h-seg" style={{ width: `${pct}%`, background: color, minWidth: 2 }}>
      {pct >= 12 && `${pct.toFixed(0)}%`}
    </div>
  ) : null

  return (
    <div className="v2-card">
      <div className="v2-card-tab"><span className="t">⚔ Confronto Direto — All-Time</span></div>
      <div className="v2-card-body">
        <div className="v2-h2h-bar">{seg(pctA, 'var(--v2-turf)')}{seg(pctD, 'var(--v2-chalk-mute)')}{seg(pctB, 'var(--v2-red)')}</div>
        <div className="v2-h2h-trio">
          <div><div className="n" style={{ color: 'var(--v2-turf)' }}>{h2h.wins_a} <span style={{ fontSize: 12, opacity: .7 }}>({pctA.toFixed(0)}%)</span></div><div className="l">{teamA?.code}</div></div>
          <div><div className="n" style={{ color: 'var(--v2-chalk-2)' }}>{h2h.draws} <span style={{ fontSize: 12, opacity: .7 }}>({pctD.toFixed(0)}%)</span></div><div className="l">Empates</div></div>
          <div><div className="n" style={{ color: 'var(--v2-red)' }}>{h2h.wins_b} <span style={{ fontSize: 12, opacity: .7 }}>({pctB.toFixed(0)}%)</span></div><div className="l">{teamB?.code}</div></div>
        </div>
        <p className="v2-h2h-summary">{h2h.summary || `${h2h.total} jogos disputados entre as seleções.`}</p>
        {h2h.recent_results?.length > 0 && (
          <ul className="v2-h2h-recent">
            {h2h.recent_results.map((r, i) => (
              <li key={i}><span className="d">{r.date}{r.competition ? ` · ${r.competition}` : ''}</span><span className="r">{r.result}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function AnalysisV2({ analysis, teamA, teamB, show, onToggle }) {
  return (
    <div>
      <button onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
        background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 10,
        fontFamily: 'Chakra Petch, monospace', fontWeight: 700, fontSize: 12, color: 'var(--v2-floodlight-ink)',
      }}>
        <span>{teamA?.code} × {teamB?.code} — análise completa</span>
        <span>{show ? '▲' : '▼'}</span>
      </button>

      {analysis.hook && <div className="v2-hook">📊 {analysis.hook}</div>}
      {analysis.verdict && <div className="v2-verdict">{analysis.verdict}</div>}

      {show && (
        <>
          {analysis.overview && <div className="v2-overview"><p>{analysis.overview}</p></div>}

          {(analysis.team_a || analysis.team_b) && (
            <div className="v2-teams-analysis">
              {[{ team: teamA, data: analysis.team_a }, { team: teamB, data: analysis.team_b }].map(({ team, data }) => data ? (
                <div key={team?.code} className="v2-team-card">
                  <div className="v2-team-card-head">
                    {team?.flag_url && <img src={team.flag_url} alt={team.code} />}
                    <span className="n">{team?.name || team?.code}</span>
                  </div>
                  {data.tactical && <><div className="v2-tc-label">Tático</div><div className="v2-tc-text">{data.tactical}</div></>}
                  {data.key_players?.length > 0 && (
                    <>
                      <div className="v2-tc-label">Jogadores-chave</div>
                      <ul className="v2-kp-list">{data.key_players.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </>
                  )}
                  {data.strengths && <><div className="v2-tc-label">Forças</div><div className="v2-tc-text">{data.strengths}</div></>}
                  {data.weaknesses && <><div className="v2-tc-label">Vulnerabilidades</div><div className="v2-tc-text">{data.weaknesses}</div></>}
                </div>
              ) : null)}
            </div>
          )}

          {analysis.matchup && <div style={{ marginTop: 14 }}><div className="v2-tc-label">Confronto</div><div className="v2-overview"><p>{analysis.matchup}</p></div></div>}
          {analysis.prediction && <div style={{ marginTop: 6 }}><div className="v2-tc-label">Predição</div><div className="v2-overview"><p>{analysis.prediction}</p></div></div>}
        </>
      )}
    </div>
  )
}

const BET_STATUS_META = {
  exact:   { icon: '🎯', label: 'Exato',     color: 'var(--v2-turf)' },
  correct: { icon: '✅', label: 'Acertando', color: 'var(--v2-turf)' },
  wrong:   { icon: '❌', label: 'Errando',   color: 'var(--v2-red)' },
  pending: { icon: '⏳', label: 'Aguardando', color: 'var(--v2-chalk-mute)' },
}

function ParticipantsV2({ data, loading, myUserId, teamA, teamB }) {
  if (loading && !data) {
    return <div className="v2-card"><div className="v2-card-tab"><span className="t">🎲 Palpites dos Participantes</span></div><div className="v2-card-body"><Spinner /></div></div>
  }
  if (!data || data.bets.length === 0) return null

  return (
    <div className="v2-card">
      <div className="v2-card-tab"><span className="t">🎲 Palpites dos Participantes</span></div>
      <div className="v2-card-body">
        {data.reference_score?.score_a != null && (
          <div style={{ textAlign: 'center', marginBottom: 10, fontFamily: 'Chakra Petch, monospace', fontSize: 11, color: 'var(--v2-chalk-mute)' }}>
            Referência: {teamA?.code} {data.reference_score.score_a} × {data.reference_score.score_b} {teamB?.code}
          </div>
        )}
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {data.bets.map(b => {
            const meta = BET_STATUS_META[b.status] || BET_STATUS_META.pending
            const mine = b.user_id === myUserId
            return (
              <div key={b.user_id} className={`v2-participants-row ${mine ? 'mine' : ''}`}>
                <span style={{ fontSize: 12.5, color: 'var(--v2-chalk-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {b.user_name}{mine ? ' (você)' : ''}
                </span>
                <span style={{ fontFamily: 'Chakra Petch, monospace', fontWeight: 700, fontSize: 12.5, color: 'var(--v2-chalk)', flexShrink: 0 }}>
                  {b.score_a} × {b.score_b}
                </span>
                <span style={{ fontFamily: 'Chakra Petch, monospace', fontSize: 10.5, fontWeight: 700, color: meta.color, flexShrink: 0 }}>
                  {meta.icon} {meta.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
