import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../api'
import ProbBar from '../components/ProbBar'
import ScoreGrid from '../components/ScoreGrid'
import Spinner from '../components/Spinner'
import { useAuth } from '../stores/authStore'

const WEIGHT_LABELS = {
  elo:          'Elo Rating (35%)',
  market_odds:  'Odds de Mercado (25%)',
  xg:           'xG — Expected Goals (15%)',
  form:         'Forma Recente (10%)',
  market_value: 'Valor de Mercado (5%)',
  wc_history:   'Histórico em Copas (5%)',
  ml_ensemble:  'ML Ensemble (5%)',
}

export default function MatchSim() {
  const { id } = useParams()
  const { token } = useAuth()
  const [match, setMatch]   = useState(null)
  const [sim, setSim]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [simRunning, setSimRunning] = useState(false)
  const [betScore, setBetScore] = useState({ a: 0, b: 0 })
  const [betMsg, setBetMsg] = useState('')
  const [existingBet, setExistingBet] = useState(null)
  const [n, setN] = useState(1000000)
  const betRef = useRef(null)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    setLoading(true)
    try {
      const reqs = [api.get(`/matches/${id}`), runSim(n, false)]
      if (token) reqs.push(api.get('/bets/mine', token))
      const [m, , betsData] = await Promise.all(reqs)
      setMatch(m)
      if (betsData) {
        const found = betsData.find(b => b.match_id === Number(id))
        if (found) {
          setExistingBet(found)
          setBetScore({ a: String(found.score_a), b: String(found.score_b) })
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
      const s = await api.post(`/matches/${id}/simulate${qs}`)
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
      const data = await api.post('/bets', { match_id: Number(id), score_a: sa, score_b: sb }, token)
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
      </div>

      <div className="card card--accent fade-in-1">
        {simRunning
          ? <Spinner text="Rodando 1.000.000 simulações..." />
          : <ProbBar sim={sim} matchData={match} />
        }

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
                />
              </>
            ) : <Spinner />}
          </div>
        </div>

        <div className="stack">
          {sim?.model_weights && (
            <div className="card fade-in-3">
              <div className="card__header">
                <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                  Pesos do Modelo
                </span>
              </div>
              <div className="card__body">
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
            </div>
          )}

          {match.status !== 'finished' && (
            <div className="card fade-in-4" ref={betRef}>
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
                        ✓ Aposta atual: {existingBet.score_a} × {existingBet.score_b} — altere abaixo
                      </div>
                    )}
                    <div className="bet-form">
                      <div className="bet-form__team-label">{match.team_a.code}</div>
                      <div className="bet-form__score">
                        <input
                          type="number" min="0" max="20"
                          className="score-input"
                          value={betScore.a}
                          onChange={e => setBetScore(s => ({ ...s, a: e.target.value }))}
                          placeholder="0"
                        />
                        <span className="score-sep">×</span>
                        <input
                          type="number" min="0" max="20"
                          className="score-input"
                          value={betScore.b}
                          onChange={e => setBetScore(s => ({ ...s, b: e.target.value }))}
                          placeholder="0"
                        />
                      </div>
                      <div className="bet-form__team-label">{match.team_b.code}</div>
                    </div>
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
