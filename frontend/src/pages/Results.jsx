import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api, CONF_HEX } from '../api'
import Spinner from '../components/Spinner'
import LiveFloating from '../components/LiveFloating'
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

const norm = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export default function Results() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [groupFilter, setGroupFilter] = useState('')
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('finished')

  useEffect(() => {
    api.get('/matches?limit=300')
      .then(d => setMatches(d.sort((a, b) => new Date(b.match_date) - new Date(a.match_date))))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const finishedCount = useMemo(() => matches.filter(m => m.status === 'finished' || m.result).length, [matches])

  const groups = useMemo(() => [...new Set(matches.map(m => m.group_name).filter(Boolean))].sort(), [matches])

  // Datas disponíveis (desc) para o seletor
  const dates = useMemo(
    () => [...new Set(matches.map(m => m.match_date?.slice(0, 10)).filter(Boolean))].sort().reverse(),
    [matches]
  )

  const filtered = useMemo(() => {
    const q = norm(search)
    return matches.filter(m => {
      const isLive = m.status === 'live'
      const isFinished = m.status === 'finished' || !!m.result
      if (statusFilter === 'finished' && !isFinished && !isLive) return false
      if (statusFilter === 'scheduled' && (isFinished || isLive)) return false
      if (groupFilter && m.group_name !== groupFilter) return false
      if (dateFilter && (m.match_date?.slice(0, 10) !== dateFilter)) return false
      if (q) {
        const fields = [
          m.team_a?.name, m.team_b?.name,
          PT_NAMES[m.team_a?.code], PT_NAMES[m.team_b?.code],
          m.team_a?.code, m.team_b?.code,
        ]
        if (!fields.some(f => norm(f).includes(q))) return false
      }
      return true
    })
  }, [matches, groupFilter, search, dateFilter, statusFilter])

  const hasFilter = !!(groupFilter || search || dateFilter || statusFilter !== 'finished')

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
      <LiveFloating />
      <div className="fade-in-1">
        <h1 className="page-title">RESULTADOS</h1>
        <p className="page-subtitle">{finishedCount} de {TOTAL_MATCHES} jogos finalizados</p>
      </div>

      {/* Progress bar */}
      <div className="copa-progress fade-in-1">
        <div className="copa-progress__bar-track" style={{ position: 'relative' }}>
          <div
            className="copa-progress__bar-fill"
            style={{ width: `${(finishedCount / TOTAL_MATCHES) * 100}%` }}
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
          <span><strong>{finishedCount}</strong> jogos</span>
          <span>{Math.round((finishedCount / TOTAL_MATCHES) * 100)}% da Copa</span>
          <span>{TOTAL_MATCHES - finishedCount} restantes</span>
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

      {/* Filtros */}
      <div className="results-filters fade-in-1" style={{ margin: 'var(--s5) 0 var(--s4)' }}>
        {/* Busca + data */}
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s3)' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: 0.5, pointerEvents: 'none' }}>🔍</span>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar seleção (ex: Brasil, ARG)…"
              autoComplete="off"
              style={{
                width: '100%', padding: '10px 12px 10px 34px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--bg-surface)',
                color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 14, outline: 'none',
              }}
            />
            {search && (
              <button
                type="button" onClick={() => setSearch('')} aria-label="Limpar busca"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'var(--bg-overlay)', color: 'var(--text-3)', borderRadius: 6, width: 22, height: 22, cursor: 'pointer', lineHeight: 1 }}
              >×</button>
            )}
          </div>
          <select
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            style={{
              flex: '0 1 200px', padding: '10px 12px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--bg-surface)',
              color: dateFilter ? 'var(--text-1)' : 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 14, cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="">📅 Todas as datas</option>
            {dates.map(d => (
              <option key={d} value={d}>{formatDate(d)}</option>
            ))}
          </select>
        </div>

        {/* Chips de status */}
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s3)' }}>
          {[
            { v: 'finished',  label: '✅ Realizados + Ao vivo' },
            { v: 'scheduled', label: '🗓 Agendados' },
            { v: 'all',       label: '⚽ Todos' },
          ].map(s => (
            <button
              key={s.v}
              onClick={() => setStatusFilter(s.v)}
              className={`btn btn-sm ${statusFilter === s.v ? 'btn-primary' : 'btn-ghost'}`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Chips de grupo */}
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center' }}>
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
          {hasFilter && (
            <button
              onClick={() => { setGroupFilter(''); setSearch(''); setDateFilter(''); setStatusFilter('finished') }}
              className="btn btn-sm btn-ghost"
              style={{ marginLeft: 'auto', color: 'var(--lose)' }}
            >
              ✕ Limpar filtros
            </button>
          )}
        </div>

        {hasFilter && (
          <p style={{ marginTop: 'var(--s3)', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
            {filtered.length} jogo{filtered.length === 1 ? '' : 's'} encontrado{filtered.length === 1 ? '' : 's'}
          </p>
        )}
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
  const isFinished = match.status === 'finished' || !!r
  const sa = r?.score_a ?? '–'
  const sb = r?.score_b ?? '–'
  const outcome = !isFinished ? null
    : r?.score_a > r?.score_b ? 'a' : r?.score_b > r?.score_a ? 'b' : 'draw'
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
        {!isFinished && (
          <span className="badge" style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', fontSize: 9 }}>
            AGENDADO
          </span>
        )}
      </div>

      <div className="result-card__body">
        {/* Team A */}
        <div className={`result-card__team ${!outcome ? '' : outcome === 'a' ? 'winner' : 'loser'}`}>
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
        <div className={`result-card__team result-card__team--right ${!outcome ? '' : outcome === 'b' ? 'winner' : 'loser'}`}>
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
  const d = new Date(value.endsWith('Z') ? value : value + 'Z')
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(d)
}
