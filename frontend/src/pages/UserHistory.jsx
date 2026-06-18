import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

export default function UserHistory() {
  const { userId } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.get(`/bets/users/${userId}`)
      .then(setData)
      .catch(err => setError(err.message || 'Nao foi possivel carregar o historico.'))
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) return <Spinner text="Carregando historico..." />

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

  const bets = data?.bets ?? []
  const stats = data?.stats ?? {}
  const user = data?.user

  return (
    <div className="page">
      <div className="fade-in-1">
        <Link to="/ranking" className="match-breadcrumb__link">‹ Voltar ao ranking</Link>
        <h1 className="page-title" style={{ marginTop: 'var(--s4)' }}>HISTORICO</h1>
        <p className="page-subtitle">
          {user?.name} · {bets.length} aposta{bets.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="bet-summary-grid mt-6 fade-in-2">
        <SummaryCard label="Pontos" value={stats.total_points ?? 0} tone="accent" />
        <SummaryCard label="Placares Exatos" value={stats.exact_scores ?? 0} />
        <SummaryCard label="Resultados Certos" value={stats.correct_results ?? 0} tone="win" />
      </div>

      {bets.length === 0 ? (
        <div className="bet-empty fade-in-3" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
          Esse usuario ainda nao tem apostas registradas.
        </div>
      ) : (
        <div className="bets-list mt-6 fade-in-3">
          {bets.map((bet, index) => (
            <HistoryBetRow key={bet.id} bet={bet} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryBetRow({ bet, index }) {
  const statusColor = bet.result === 'exact'
    ? 'var(--accent)'
    : bet.result === 'correct'
      ? 'var(--win)'
      : bet.result === 'wrong'
        ? 'var(--lose)'
        : 'var(--text-3)'

  const statusLabel = bet.result === 'exact'
    ? 'Placar exato'
    : bet.result === 'correct'
      ? 'Resultado correto'
      : bet.result === 'wrong'
        ? 'Sem acerto'
        : bet.is_open ? 'Pendente' : 'Aguardando avaliacao'

  const officialScore = bet.official_score_a != null && bet.official_score_b != null
    ? `${bet.official_score_a} - ${bet.official_score_b}`
    : 'Aguardando resultado'

  return (
    <div className="bet-card fade-in" style={{ animationDelay: `${index * 30}ms` }}>
      <div className="bet-card__top">
        <span className="badge badge-group">Grupo {bet.group_name}</span>
        <span className="bet-card__time">{formatMatchDate(bet.match_date)}</span>
      </div>
      <div className="bet-card__match">
        <div className="bet-card__team">{bet.team_a_code}</div>
        <div className="bet-card__score">{bet.score_a} - {bet.score_b}</div>
        <div className="bet-card__team bet-card__team--right">{bet.team_b_code}</div>
      </div>
      <div className="bet-card__meta">
        <Metric label="Palpite" value={`${bet.score_a} - ${bet.score_b}`} accent />
        <Metric label="Oficial" value={officialScore} />
        <Metric label="Pontos" value={bet.result == null ? 'Pendente' : `${bet.points_earned ?? 0}`} />
      </div>
      <div className="bet-card__footer">
        <span className="bet-card__status" style={{ color: statusColor }}>{statusLabel}</span>
        <Link to={`/partida/${bet.match_id}`} className="bet-card__history-link">Ver partida</Link>
      </div>
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

function Metric({ label, value, accent }) {
  return (
    <div className="bet-metric">
      <span className="bet-metric__label">{label}</span>
      <span className={`bet-metric__value${accent ? ' bet-metric__value--accent' : ''}`}>{value}</span>
    </div>
  )
}

function formatMatchDate(value) {
  if (!value) return 'Sem data'
  const date = new Date(value.endsWith('Z') ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return 'Sem data'
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(date)
}
