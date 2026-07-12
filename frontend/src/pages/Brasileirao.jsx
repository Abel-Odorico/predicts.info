import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

const TABS = [
  { id: 'tabela',  label: '📊 Tabela' },
  { id: 'rodada',  label: '⚽ Rodada' },
  { id: 'ranking', label: '🏆 Ranking' },
]

function pctColor(pct) {
  if (pct >= 50) return 'var(--win)'
  if (pct >= 15) return 'var(--accent)'
  if (pct >= 3)  return 'var(--text-2)'
  return 'var(--text-4)'
}

function Crest({ url, name }) {
  if (!url) return <span style={{ width: 20, display: 'inline-block' }} />
  return <img src={url} alt={name} style={{ width: 20, height: 20, objectFit: 'contain' }} loading="lazy" />
}

export default function Brasileirao() {
  const [tab, setTab] = useState('tabela')
  return (
    <div className="page">
      <h1 className="section-title">🇧🇷 Brasileirão Série A 2026</h1>
      <p style={{ color: 'var(--text-3)', margin: '0 0 var(--s4)' }}>
        Tabela ao vivo, projeção do modelo (Monte Carlo) e palpites por rodada.
      </p>
      <div className="phase-nav" style={{ marginBottom: 'var(--s4)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`phase-nav__tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'tabela'  && <Tabela />}
      {tab === 'rodada'  && <Rodada />}
      {tab === 'ranking' && <RankingBR />}
    </div>
  )
}

/* ── Tabela + projeção ──────────────────────────────────────────────────── */

function Tabela() {
  const [standings, setStandings] = useState(null)
  const [projection, setProjection] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled([
      api.get('/brasileirao/standings'),
      api.get('/brasileirao/projection'),
    ]).then(([s, p]) => {
      if (s.status === 'fulfilled') setStandings(s.value)
      if (p.status === 'fulfilled') setProjection(p.value)
    }).finally(() => setLoading(false))
  }, [])

  const projByTeam = useMemo(() => {
    const m = {}
    for (const c of projection?.clubs || []) m[c.team_id] = c
    return m
  }, [projection])

  if (loading) return <Spinner text="Carregando tabela..." />
  const rows = standings?.table || []
  if (!rows.length) return <div className="card"><div className="card__body">Tabela indisponível.</div></div>

  return (
    <div className="card fade-in-1">
      <div className="card__header">
        <span>Classificação · rodada {standings.current_rodada ? standings.current_rodada - 1 : '—'} de 38</span>
        {projection?.n_sims ? (
          <span className="badge">projeção: {projection.n_sims.toLocaleString('pt-BR')} simulações</span>
        ) : null}
      </div>
      <div className="card__body" style={{ overflowX: 'auto', padding: 0 }}>
        <table className="br-table">
          <thead>
            <tr>
              <th>#</th><th style={{ textAlign: 'left' }}>Clube</th>
              <th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th>
              <th title="Chance de título">🏆%</th>
              <th title="Chance de G4 (Libertadores)">G4%</th>
              <th title="Risco de rebaixamento">Z4%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const pj = projByTeam[r.team_id]
              const zone = r.pos === 1 ? 'title' : r.pos <= 4 ? 'g4' : r.pos >= rows.length - 3 ? 'z4' : ''
              return (
                <tr key={r.team_id} className={zone ? `br-row--${zone}` : ''}>
                  <td className="br-pos">{r.pos}</td>
                  <td style={{ textAlign: 'left' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Crest url={r.flag_url} name={r.name} /> {r.name}
                    </span>
                  </td>
                  <td><strong>{r.pts}</strong></td>
                  <td>{r.j}</td><td>{r.v}</td><td>{r.e}</td><td>{r.d}</td>
                  <td>{r.sg > 0 ? `+${r.sg}` : r.sg}</td>
                  <td style={{ color: pctColor(pj?.title_pct ?? 0) }}>{pj ? `${pj.title_pct}%` : '—'}</td>
                  <td style={{ color: pctColor(pj?.g4_pct ?? 0) }}>{pj ? `${pj.g4_pct}%` : '—'}</td>
                  <td style={{ color: pj?.z4_pct >= 15 ? 'var(--lose)' : 'var(--text-4)' }}>{pj ? `${pj.z4_pct}%` : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="card__body" style={{ color: 'var(--text-4)', fontSize: '0.8rem' }}>
        🟢 líder · 🔵 G4 (Libertadores) · 🔴 Z4 (rebaixamento). Projeção recalculada a cada sync
        (Elo próprio por replay da temporada + Monte Carlo dos {projection?.remaining_matches ?? '—'} jogos restantes).
      </div>
    </div>
  )
}

/* ── Rodada + palpites ──────────────────────────────────────────────────── */

function Rodada() {
  const { token, user } = useAuth()
  const [data, setData] = useState(null)
  const [myBets, setMyBets] = useState({})
  const [loading, setLoading] = useState(true)
  const [n, setN] = useState(null)

  const load = (rodadaN) => {
    setLoading(true)
    api.get(rodadaN ? `/brasileirao/rodada?n=${rodadaN}` : '/brasileirao/rodada')
      .then(d => { setData(d); setN(d.rodada) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(null) }, [])

  useEffect(() => {
    if (!token) { setMyBets({}); return }
    api.get('/bets/mine', token).then(bets => {
      const m = {}
      for (const b of bets || []) m[b.match_id] = b
      setMyBets(m)
    }).catch(() => {})
  }, [token, data])

  if (loading && !data) return <Spinner text="Carregando rodada..." />
  if (!data?.rodada) return <div className="card"><div className="card__body">Rodada indisponível.</div></div>

  return (
    <div className="fade-in-1">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
        <button className="btn btn-ghost btn-sm" disabled={n <= 1} onClick={() => load(n - 1)}>←</button>
        <strong>Rodada {n} de {data.total_rodadas}</strong>
        <button className="btn btn-ghost btn-sm" disabled={n >= data.total_rodadas} onClick={() => load(n + 1)}>→</button>
        {n !== data.current_rodada && (
          <button className="btn btn-ghost btn-sm" onClick={() => load(null)}>ir pra atual</button>
        )}
      </div>
      {!user && (
        <div className="card" style={{ marginBottom: 'var(--s3)' }}>
          <div className="card__body">
            <Link to="/login">Entre na sua conta</Link> pra dar palpites nos jogos do Brasileirão.
          </div>
        </div>
      )}
      {data.matches.map(m => (
        <MatchRow key={m.id} m={m} bet={myBets[m.id]} token={token}
          onSaved={b => setMyBets(prev => ({ ...prev, [m.id]: b }))} />
      ))}
    </div>
  )
}

// stepper +/- reutilizando as mesmas classes CSS do bet flow da Copa (Bets.jsx)
function ScoreStep({ value, onChange }) {
  return (
    <div className="score-stepper">
      <button type="button" className="score-stepper__btn" onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <input
        type="number" min="0" max="20" className="score-input"
        value={value}
        onChange={e => onChange(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
      />
      <button type="button" className="score-stepper__btn score-stepper__btn--plus" onClick={() => onChange(Math.min(20, value + 1))}>+</button>
    </div>
  )
}

function SimPanel({ matchId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    api.post(`/matches/${matchId}/simulate`, {})
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setErr(e.message || 'Simulação indisponível.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [matchId])

  if (loading) return <div className="br-match__sim" style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: '0.8rem' }}>Simulando…</div>
  if (err || !data) return <div className="br-match__sim" style={{ textAlign: 'center', color: 'var(--text-4)', fontSize: '0.8rem' }}>{err || 'Simulação indisponível.'}</div>

  return (
    <div className="br-match__sim">
      <div className="br-match__sim-bar">
        <span style={{ width: `${data.prob_a}%` }} title={`Vitória ${data.team_a} ${data.prob_a}%`} />
        <span style={{ width: `${data.prob_draw}%` }} title={`Empate ${data.prob_draw}%`} />
        <span style={{ width: `${data.prob_b}%` }} title={`Vitória ${data.team_b} ${data.prob_b}%`} />
      </div>
      <div className="br-match__sim-legend">
        <span>🟢 {data.team_a} {data.prob_a}%</span>
        <span>⚪ Empate {data.prob_draw}%</span>
        <span>🔴 {data.team_b} {data.prob_b}%</span>
      </div>
      <div className="br-match__sim-foot">
        <span>xG: {data.xg_a.toFixed(2)} × {data.xg_b.toFixed(2)}</span>
        <span>🔮 Palpite do modelo: <strong>{data.recommended_score.score_a} × {data.recommended_score.score_b}</strong></span>
      </div>
    </div>
  )
}

function MatchRow({ m, bet, token, onSaved }) {
  const [sa, setSa] = useState(bet?.score_a ?? 0)
  const [sb, setSb] = useState(bet?.score_b ?? 0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [showSim, setShowSim] = useState(false)

  useEffect(() => {
    if (bet) { setSa(bet.score_a); setSb(bet.score_b) }
  }, [bet?.id])

  const finished = m.status === 'finished' && m.result
  const open = m.status === 'scheduled' && new Date(m.match_date + 'Z') > new Date()
  const dt = m.match_date ? new Date(m.match_date + 'Z') : null
  const when = dt ? dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''

  const save = () => {
    setSaving(true); setMsg('')
    api.post('/bets', { match_id: m.id, score_a: sa, score_b: sb }, token)
      .then(b => { setMsg('✓ salvo'); onSaved({ ...b, match_id: m.id, score_a: sa, score_b: sb }) })
      .catch(e => setMsg(e.message || 'erro'))
      .finally(() => setSaving(false))
  }

  return (
    <div className={`br-match ${open ? 'br-match--open' : ''}`}>
      <div className="br-match__top">
        <span className="br-match__time">{when}</span>
        {finished && bet && (
          <span className="badge">{(bet.points_earned ?? 0) > 0 ? `+${bet.points_earned} pts` : '0 pts'}</span>
        )}
      </div>

      <div className="br-match__teams">
        <div className="br-match__team br-match__team--a">
          <span className="br-match__name">{m.team_a.name}</span>
          <Crest url={m.team_a.flag_url} name={m.team_a.name} />
        </div>

        <div className="br-match__center">
          {finished ? (
            <strong className="br-match__score">{m.result.score_a} × {m.result.score_b}</strong>
          ) : open && token ? (
            <div className="br-match__stepper-row">
              <ScoreStep value={sa} onChange={setSa} />
              <span className="br-match__vs">×</span>
              <ScoreStep value={sb} onChange={setSb} />
            </div>
          ) : (
            <span className="br-match__vs">×</span>
          )}
        </div>

        <div className="br-match__team br-match__team--b">
          <Crest url={m.team_b.flag_url} name={m.team_b.name} />
          <span className="br-match__name">{m.team_b.name}</span>
        </div>
      </div>

      <div className="br-match__actions">
        {open && token && (
          <button className="btn btn-sm" disabled={saving} onClick={save}>
            {saving ? '...' : bet ? 'Alterar palpite' : 'Apostar'}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSim(v => !v)}>
          {showSim ? '▲ ocultar simulação' : '🔮 simulação e estatísticas'}
        </button>
        {msg && <span style={{ fontSize: '0.78rem', color: msg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>{msg}</span>}
      </div>

      {bet && !finished && (
        <div className="br-match__my-bet">Seu palpite: {bet.score_a} × {bet.score_b}</div>
      )}

      {showSim && <SimPanel matchId={m.id} />}
    </div>
  )
}

/* ── Ranking BR ─────────────────────────────────────────────────────────── */

function RankingBR() {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    api.get('/ranking?competition=brasileirao2026&limit=100')
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  if (rows === null) return <Spinner text="Carregando ranking..." />
  if (!rows.length) {
    return (
      <div className="card fade-in-1">
        <div className="card__body">
          Ninguém pontuou ainda — o Brasileirão volta na rodada 19 e os primeiros
          palpites contam a partir dela. Garante o seu na aba <strong>Rodada</strong>. 🇧🇷
        </div>
      </div>
    )
  }
  return (
    <div className="card fade-in-1">
      <div className="card__header"><span>Ranking Brasileirão</span></div>
      <div className="card__body" style={{ overflowX: 'auto', padding: 0 }}>
        <table className="br-table">
          <thead>
            <tr><th>#</th><th style={{ textAlign: 'left' }}>Participante</th><th>Pts</th><th>🎯</th><th>✅</th><th>Palpites</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.user_id}>
                <td className="br-pos">{r.position}</td>
                <td style={{ textAlign: 'left' }}>{r.name}</td>
                <td><strong>{r.total_points}</strong></td>
                <td>{r.exact_scores}</td>
                <td>{r.correct_results}</td>
                <td>{r.total_bets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
