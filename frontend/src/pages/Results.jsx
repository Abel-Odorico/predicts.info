import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api, CONF_HEX } from '../api'
import Spinner from '../components/Spinner'
import { PT_NAMES } from '../utils/teamNames'

const TOTAL_MATCHES = 104

const PHASE_MARKS = [
  { label: 'Fase de Grupos (48)', pct: (48 / 104) * 100, color: '#6366f1' },
  { label: 'R32 (16)',            pct: (64 / 104) * 100, color: '#8b5cf6' },
  { label: 'Oitavas (8)',         pct: (72 / 104) * 100, color: '#a855f7' },
  { label: 'Quartas (4)',         pct: (76 / 104) * 100, color: '#c084fc' },
  { label: 'Semi (2)',            pct: (78 / 104) * 100, color: '#d8b4fe' },
  { label: 'Final (1)',           pct: (103 / 104) * 100, color: '#f59e0b' },
]

export default function Results() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [groupFilter, setGroupFilter] = useState('')

  useEffect(() => {
    api.get('/matches?status=finished&limit=200')
      .then(d => setMatches(d.sort((a, b) => new Date(b.match_date) - new Date(a.match_date))))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const groups = useMemo(() => [...new Set(matches.map(m => m.group_name).filter(Boolean))].sort(), [matches])

  const filtered = useMemo(() =>
    groupFilter ? matches.filter(m => m.group_name === groupFilter) : matches
  , [matches, groupFilter])

  // Group by date
  const byDate = useMemo(() => {
    const map = new Map()
    for (const m of filtered) {
      const d = m.match_date?.slice(0, 10) || 'sem data'
      if (!map.has(d)) map.set(d, [])
      map.get(d).push(m)
    }
    return [...map.entries()]
  }, [filtered])

  if (loading) return <Spinner text="Carregando resultados..." />

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">RESULTADOS</h1>
        <p className="page-subtitle">{matches.length} de {TOTAL_MATCHES} jogos finalizados</p>
      </div>

      {/* Progress bar */}
      <div className="copa-progress fade-in-1">
        <div className="copa-progress__bar-track" style={{ position: 'relative' }}>
          <div
            className="copa-progress__bar-fill"
            style={{ width: `${(matches.length / TOTAL_MATCHES) * 100}%` }}
          />
          {/* Phase markers */}
          {PHASE_MARKS.map(p => (
            <div key={p.label} style={{
              position: 'absolute',
              left: `${p.pct}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--bg-overlay)',
              opacity: 0.6,
            }} />
          ))}
        </div>
        <div className="copa-progress__labels">
          <span><strong>{matches.length}</strong> jogos</span>
          <span>{Math.round((matches.length / TOTAL_MATCHES) * 100)}% da Copa</span>
          <span>{TOTAL_MATCHES - matches.length} restantes</span>
        </div>
        <div className="copa-progress__phases">
          {PHASE_MARKS.map(p => (
            <span key={p.label} className="copa-progress__phase-mark">
              <span className="copa-progress__phase-dot" style={{ background: p.color }} />
              {p.label}
            </span>
          ))}
        </div>
      </div>

      {/* Group filter */}
      <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', margin: 'var(--s5) 0 var(--s4)' }}>
        <button
          onClick={() => setGroupFilter('')}
          className={`btn btn-sm ${groupFilter === '' ? 'btn-primary' : 'btn-ghost'}`}
        >
          Todos
        </button>
        {groups.map(g => (
          <button
            key={g}
            onClick={() => setGroupFilter(g === groupFilter ? '' : g)}
            className={`btn btn-sm ${groupFilter === g ? 'btn-primary' : 'btn-ghost'}`}
          >
            G{g}
          </button>
        ))}
      </div>

      <div className="stack fade-in-2">
        {byDate.map(([date, dayMatches]) => (
          <div key={date}>
            <div className="results-date-header">
              {formatDate(date)} · <span style={{ fontWeight: 400 }}>{dayMatches.length} jogo{dayMatches.length > 1 ? 's' : ''}</span>
            </div>
            <div className="results-day-grid">
              {dayMatches.map(m => (
                <ResultCard key={m.id} match={m} />
              ))}
            </div>
          </div>
        ))}
        {byDate.length === 0 && (
          <p style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
            Nenhum resultado encontrado.
          </p>
        )}
      </div>
    </div>
  )
}

function ResultCard({ match }) {
  const r = match.result
  const sa = r?.score_a ?? '?'
  const sb = r?.score_b ?? '?'
  const outcome = r?.score_a > r?.score_b ? 'a' : r?.score_b > r?.score_a ? 'b' : 'draw'
  const ta = match.team_a
  const tb = match.team_b

  return (
    <Link to={`/partida/${match.id}`} className="result-card">
      <div className="result-card__meta">
        <span className="badge badge-group">G{match.group_name}</span>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)' }}>
          #{match.match_number} · {match.city}
        </span>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginLeft: 'auto' }}>
          {formatTime(match.match_date)}
        </span>
      </div>

      <div className="result-card__body">
        {/* Team A */}
        <div className={`result-card__team ${outcome === 'a' ? 'winner' : outcome === 'draw' ? '' : 'loser'}`}>
          {ta.flag_url && <img src={ta.flag_url} alt={ta.code} className="result-card__flag" />}
          <span className="result-card__name">{PT_NAMES[ta.code] || ta.name}</span>
        </div>

        {/* Score */}
        <div className="result-card__score">
          <span className={outcome === 'a' ? 'score-win' : 'score-neutral'}>{sa}</span>
          <span className="score-sep-sm">–</span>
          <span className={outcome === 'b' ? 'score-win' : 'score-neutral'}>{sb}</span>
        </div>

        {/* Team B */}
        <div className={`result-card__team result-card__team--right ${outcome === 'b' ? 'winner' : outcome === 'draw' ? '' : 'loser'}`}>
          <span className="result-card__name">{PT_NAMES[tb.code] || tb.name}</span>
          {tb.flag_url && <img src={tb.flag_url} alt={tb.code} className="result-card__flag" />}
        </div>
      </div>

      {outcome === 'draw' && (
        <div className="result-card__draw-label">Empate</div>
      )}
    </Link>
  )
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === 'sem data') return 'Sem data'
  const d = new Date(dateStr + 'T12:00:00')
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(d)
}

function formatTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(d)
}
