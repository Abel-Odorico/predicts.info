import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

const RESULT_META = {
  exact:   { label: 'Exato',    color: 'var(--accent)' },
  correct: { label: 'Certo',    color: 'var(--win)'    },
  wrong:   { label: 'Erro',     color: 'var(--lose)'   },
}

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value.endsWith('Z') ? value : `${value}Z`)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d)
}

export default function UserHistory() {
  const { userId } = useParams()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [showAll, setShowAll] = useState(false)
  const [filterResult, setFilterResult] = useState('all')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.get(`/bets/users/${userId}`)
      .then(setData)
      .catch(err => setError(err.message || 'Não foi possível carregar o histórico.'))
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) return <Spinner text="Carregando histórico..." />

  if (error) {
    return (
      <div className="page">
        <div className="card fade-in-1">
          <div className="card__body">
            <p className="page-subtitle" style={{ margin: 0 }}>{error}</p>
            <Link to="/ranking" className="btn btn-primary btn-sm mt-4">Voltar ao ranking</Link>
          </div>
        </div>
      </div>
    )
  }

  const bets  = data?.bets  ?? []
  const stats = data?.stats ?? {}
  const user  = data?.user

  const evaluated = bets.filter(b => b.result != null)
  const pending   = bets.filter(b => b.result == null)

  const filtered = filterResult === 'all'
    ? evaluated
    : evaluated.filter(b => b.result === filterResult)

  const SHOW = 15
  const visible = showAll ? filtered : filtered.slice(0, SHOW)

  return (
    <div className="page">
      <div className="fade-in-1">
        <Link to="/ranking" className="match-breadcrumb__link">‹ Voltar ao ranking</Link>
        <h1 className="page-title" style={{ marginTop: 'var(--s4)' }}>
          {user?.name}
        </h1>
        <p className="page-subtitle">
          {bets.length} aposta{bets.length !== 1 ? 's' : ''} · {evaluated.length} avaliada{evaluated.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Stats */}
      <div className="bet-summary-grid mt-6 fade-in-2">
        <SummaryCard label="Pontos"           value={stats.total_points   ?? 0} tone="accent" />
        <SummaryCard label="Placares Exatos"  value={stats.exact_scores   ?? 0} />
        <SummaryCard label="Resultados Certos" value={stats.correct_results ?? 0} tone="win" />
      </div>

      {/* Pendentes — compacto */}
      {pending.length > 0 && (
        <div className="card mt-6 fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              Aguardando resultado
            </span>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>
              {pending.length} jogo{pending.length !== 1 ? 's' : ''}
            </span>
          </div>
          <BetTable bets={pending} showResult={false} />
        </div>
      )}

      {/* Avaliadas */}
      {evaluated.length === 0 ? (
        <div className="bet-empty fade-in-3" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', marginTop: 'var(--s16)' }}>
          Nenhuma aposta avaliada ainda.
        </div>
      ) : (
        <div className="card mt-4 fade-in-3">
          <div className="card__header" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              Apostas avaliadas
            </span>
            {/* Filtro resultado */}
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { id: 'all',     label: 'Todas' },
                { id: 'exact',   label: 'Exato' },
                { id: 'correct', label: 'Certo' },
                { id: 'wrong',   label: 'Erro'  },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => { setFilterResult(f.id); setShowAll(false) }}
                  style={{
                    fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 600,
                    padding: '3px 10px', borderRadius: 20, border: '1px solid', cursor: 'pointer',
                    background: filterResult === f.id ? 'var(--accent)' : 'transparent',
                    borderColor: filterResult === f.id ? 'var(--accent)' : 'var(--border)',
                    color: filterResult === f.id ? '#000' : 'var(--text-2)',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <BetTable bets={visible} showResult />

          {filtered.length > SHOW && (
            <div style={{ padding: 'var(--s12)', textAlign: 'center' }}>
              <button
                onClick={() => setShowAll(v => !v)}
                style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                {showAll ? 'Mostrar menos' : `Ver mais ${filtered.length - SHOW} apostas`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BetTable({ bets, showResult }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-data)', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Data', 'Jogo', 'Palpite', 'Oficial', showResult ? 'Pts' : 'Status'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bets.map((bet, i) => {
            const meta = RESULT_META[bet.result]
            const official = bet.official_score_a != null
              ? `${bet.official_score_a}–${bet.official_score_b}`
              : '—'
            const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)'
            return (
              <tr key={bet.id} style={{ background: rowBg, borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', color: 'var(--text-3)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {formatDate(bet.match_date)}
                </td>
                <td style={{ padding: '8px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {bet.team_a_code} × {bet.team_b_code}
                  <span style={{ marginLeft: 6, fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>
                    G{bet.group_name}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: meta ? meta.color : 'var(--text-1)', fontWeight: 600 }}>
                  {bet.score_a}–{bet.score_b}
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--text-2)' }}>
                  {official}
                </td>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                  {showResult ? (
                    meta
                      ? <span style={{ color: meta.color, fontWeight: 700 }}>{bet.points_earned ?? 0} — {meta.label}</span>
                      : <span style={{ color: 'var(--text-3)' }}>—</span>
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontStyle: 'italic', fontSize: 11 }}>Pendente</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  return (
    <div className={`bet-summary-card${tone ? ` bet-summary-card--${tone}` : ''}`}>
      <span className="bet-summary-card__label">{label}</span>
      <span className="bet-summary-card__value">{value}</span>
    </div>
  )
}
