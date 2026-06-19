import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, CONF_HEX } from '../api'
import Spinner from '../components/Spinner'

export default function Dashboard() {
  const [matches, setMatches]         = useState([])
  const [results, setResults]         = useState([])
  const [tourney, setTourney]         = useState(null)
  const [liveGames, setLiveGames]     = useState([])
  const [calendar, setCalendar]       = useState([])
  const [topBettors, setTopBettors]   = useState([])
  const [liveBets, setLiveBets]       = useState({}) // { [match_id]: bets[] }
  const [loading, setLoading]         = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true

    async function loadAll() {
      try {
        const [sched, done, tour, live, fullCalendar] = await Promise.all([
          api.get('/matches?status=scheduled&limit=10'),
          api.get('/matches?status=finished&limit=5'),
          api.get('/tournament/simulate?n=50000'),
          api.get('/live/world-cup'),
          api.get('/matches/calendar'),
        ])
        if (!mounted) return
        setMatches(sched)
        setResults(done)
        setTourney(tour)
        const games = live?.games || []
        setLiveGames(games)
        setCalendar(fullCalendar?.days || [])
        api.get('/ranking?limit=8').then(bettors => {
          if (!mounted) return
          setTopBettors(Array.isArray(bettors) ? bettors.filter(b => b.total_points > 0) : [])
        }).catch(() => {})
        const liveMatchIds = games.filter(g => g.status === 'live' && g.match_id).map(g => g.match_id)
        if (liveMatchIds.length > 0) {
          Promise.all(liveMatchIds.map(id => api.get(`/matches/${id}/live-bets`).catch(() => null)))
            .then(results => {
              if (!mounted) return
              const map = {}
              results.forEach(r => { if (r) map[r.match_id] = r.bets })
              setLiveBets(map)
            })
        }
      } catch (error) {
        console.error(error)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    async function refreshLive() {
      try {
        const [live, fullCalendar] = await Promise.all([
          api.get('/live/world-cup'),
          api.get('/matches/calendar'),
        ])
        if (!mounted) return
        const games = live?.games || []
        setLiveGames(games)
        setCalendar(fullCalendar?.days || [])
        const liveMatchIds = games.filter(g => g.status === 'live' && g.match_id).map(g => g.match_id)
        if (liveMatchIds.length > 0) {
          Promise.all(liveMatchIds.map(id => api.get(`/matches/${id}/live-bets`).catch(() => null)))
            .then(results => {
              if (!mounted) return
              const map = {}
              results.forEach(r => { if (r) map[r.match_id] = r.bets })
              setLiveBets(map)
            })
        }
      } catch (error) {
        console.error(error)
      }
    }

    loadAll()
    const intervalId = window.setInterval(refreshLive, 10000)
    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  if (loading) return <Spinner text="Carregando dados da Copa..." />

  const featured = matches[0]
  const top5 = tourney?.teams?.slice(0, 5) || []
  const topProb = top5[0]?.prob_title || 1
  const liveNow = liveGames.filter(game => game.status === 'live')
  const todaysGames = liveGames.filter(game => game.status !== 'finished')
  const totalCalendarMatches = calendar.reduce((sum, day) => sum + day.matches.length, 0)
  const liveUpdatedAt = liveGames.length > 0 ? 'Feed ativo' : 'Sem feed'
  const highlightedGames = [...liveGames]
    .sort((a, b) => {
      const statusWeight = s => s.status === 'live' ? 0 : s.status === 'scheduled' ? 1 : 2
      const channelCount = game => game.channels?.length || 0
      return statusWeight(a) - statusWeight(b) || channelCount(b) - channelCount(a)
    })
    .slice(0, 3)

  return (
    <div className="page">
      <div className="fade-in-1">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">COPA DO MUNDO 2026</h1>
            <p className="page-subtitle">Motor Elo · xG · Poisson · Monte Carlo</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', flexShrink: 0 }}>
            <a href="/" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>
              🌐 Página Inicial
            </a>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => navigate('/grupos')}>
              🗂 Classificação
            </button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => navigate('/meus-grupos')}>
              👥 Meus Grupos
            </button>
          </div>
        </div>
      </div>

      <div className="card fade-in-1 mt-6">
        <div className="card__body" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
          <div className="stack gap-2">
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
              Painel Ao Vivo do Sistema
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
              <span className="badge badge-group">{todaysGames.length} jogos hoje</span>
              <span className="badge badge-group">{liveNow.length} ao vivo</span>
              <span className="badge badge-group">{calendar.length} dias no calendario</span>
              <span className="badge badge-group">{totalCalendarMatches} jogos no calendario</span>
              <span className="badge badge-group">{liveUpdatedAt}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid mt-8">
        <div className="stack gap-6">
          {featured && (
            <div className="card card--accent fade-in-2">
              <div className="card__header">
                <div className="row-wrap">
                  <span className="badge badge-group">Grupo {featured.group_name}</span>
                  <span
                    className="section-title"
                    style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}
                  >
                    Próxima Partida em Destaque
                  </span>
                </div>
                <Link to={`/partida/${featured.id}`} className="btn btn-primary btn-sm">
                  Simular ▶
                </Link>
              </div>

              <div className="card__body">
                <div className="featured-teams">
                  <TeamBig team={featured.team_a} />
                  <div className="featured-vs">
                    <div className="featured-vs__date">
                      {featured.match_date
                        ? new Date(featured.match_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                        : '—'}
                    </div>
                    <div className="featured-vs__label">VS</div>
                  </div>
                  <TeamBig team={featured.team_b} />
                </div>
              </div>
            </div>
          )}

          {liveNow.length > 0 && (
            <div className="card fade-in-2">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  {liveNow.length === 1 ? 'Jogo Acontecendo Agora' : `${liveNow.length} Jogos Ao Vivo`}
                </span>
                <span className="badge badge-live">Ao vivo</span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {liveNow.map((game, index) => (
                  <div key={`live-${game.team_a}-${game.team_b}-${index}`} className="now-playing-card" onClick={() => game.match_id && navigate(`/partida/${game.match_id}`)} style={{ ...(index > 0 ? { marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--border)' } : {}), ...(game.match_id ? { cursor: 'pointer' } : {}) }}>
                    <div className="now-playing-card__team">
                      <span>{game.team_a}</span>
                    </div>
                    <div className="now-playing-card__center">
                      <div className="now-playing-card__score">
                        {game.score_a ?? '-'}:{game.score_b ?? '-'}
                      </div>
                      <div className="now-playing-card__status">{game.status_raw || 'Ao vivo'}</div>
                    </div>
                    <div className="now-playing-card__team now-playing-card__team--right">
                      <span>{game.team_b}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {todaysGames.length > 0 && (
            <div className="card fade-in-2">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Jogos de Hoje
                </span>
                <span className="badge badge-group">{todaysGames.length} jogos</span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {todaysGames.map((game, index) => (
                  <div key={`${game.team_a}-${game.team_b}-today-${index}`} className="live-score-row" onClick={() => game.match_id && navigate(`/partida/${game.match_id}`)} style={game.match_id ? { cursor: 'pointer' } : {}}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 600 }}>{game.team_a}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{game.time_label}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className="live-score-row__score">
                        {game.score_a ?? '-'}:{game.score_b ?? '-'}
                      </div>
                      <div className="live-score-row__status">
                        <StatusBadge game={game} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 600 }}>{game.team_b}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{game.channels?.map(c => c.nome).filter(Boolean).join(' · ') || 'Sem canal'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card fade-in-3">
            <div className="card__header">
              <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                Próximas Partidas
              </span>
            </div>
            {matches.slice(1, 8).map(m => <MatchRow key={m.id} match={m} />)}
            {matches.length === 0 && (
              <p style={{ padding: 'var(--s6)', color: 'var(--text-3)', textAlign: 'center', fontFamily: 'var(--font-cond)' }}>
                Sem partidas agendadas
              </p>
            )}
          </div>

          {liveGames.length > 0 && (
            <div className="card fade-in-4">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Calendário e Tempo Real
                </span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {liveGames.map((game, index) => (
                  <div key={`${game.team_a}-${game.team_b}-${index}`} className="live-score-row" onClick={() => game.match_id && navigate(`/partida/${game.match_id}`)} style={game.match_id ? { cursor: 'pointer' } : {}}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 600 }}>{game.team_a}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{game.date_label} · {game.time_label}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className="live-score-row__score">
                        {game.score_a ?? '-'}:{game.score_b ?? '-'}
                      </div>
                      <div className="live-score-row__status">
                        <StatusBadge game={game} />
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 600 }}>{game.team_b}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{game.channels?.map(c => c.nome).filter(Boolean).join(' · ') || 'Sem canal'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {highlightedGames.length > 0 && (
            <div className="card fade-in-4">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Destaques da Copa
                </span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {highlightedGames.map((game, index) => (
                  <div key={`${game.team_a}-${game.team_b}-highlight-${index}`} className="highlight-row" onClick={() => game.match_id && navigate(`/partida/${game.match_id}`)} style={game.match_id ? { cursor: 'pointer' } : {}}>
                    <div>
                      <div className="highlight-row__teams">{game.team_a} vs {game.team_b}</div>
                      <div className="highlight-row__meta">{game.time_label} · {game.channels?.map(c => c.nome).filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="highlight-row__status">
                      {(game.score_a != null || game.score_b != null) ? `${game.score_a ?? '-'}:${game.score_b ?? '-'}` : (game.status_raw || 'Agendado')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="card fade-in-4">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Últimos Resultados
                </span>
              </div>
              {results.map(m => <MatchRow key={m.id} match={m} done />)}
            </div>
          )}
        </div>

        <div className="stack gap-6">
          {topBettors.length > 0 && (
            <TopBettorsCard bettors={topBettors} />
          )}

          <div className="card fade-in-2">
            <div className="card__header">
              <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                🏆 Favoritos ao Título
              </span>
            </div>
            <div className="card__body" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
              {top5.map((t, i) => (
                <div key={t.code} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--s3)',
                  padding: 'var(--s3) 0',
                  borderBottom: i < 4 ? '1px solid var(--border)' : 'none'
                }}>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: 22,
                    color: i === 0 ? 'var(--accent)' : 'var(--text-4)',
                    minWidth: 24
                  }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 15 }}>
                      {t.name}
                    </div>
                    <div style={{
                      height: 4, background: 'var(--bg-overlay)',
                      borderRadius: 2, marginTop: 4, overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${(t.prob_title / topProb) * 100}%`,
                        background: CONF_HEX[t.confederation] || 'var(--accent)',
                        borderRadius: 2,
                        transition: 'width 600ms ease'
                      }} />
                    </div>
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-data)', fontSize: 15, fontWeight: 600,
                    color: 'var(--accent)'
                  }}>
                    {t.prob_title.toFixed(1)}%
                  </span>
                </div>
              ))}
              {tourney && (
                <div style={{ marginTop: 'var(--s4)', textAlign: 'center' }}>
                  <Link to="/torneio" className="btn btn-ghost btn-sm w-full">
                    Ver todas as 48 seleções →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Stats card */}
          {tourney && (
            <div className="card fade-in-3">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Simulação
                </span>
              </div>
              <div className="card__body stack gap-3" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
                <StatRow label="Simulações" value={tourney.simulations.toLocaleString('pt-BR')} />
                <StatRow label="Tempo" value={`${tourney.elapsed_ms}ms`} />
                <StatRow label="Do cache" value={tourney.cached ? 'Sim' : 'Não'} />
                <StatRow label="Seleções" value="48" />
              </div>
            </div>
          )}

          {calendar.length > 0 && (
            <div className="card fade-in-3">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Calendário Completo
                </span>
                <span className="badge badge-group">{calendar.length} dias · {totalCalendarMatches} jogos</span>
              </div>
              <div className="card__body">
                {calendar.map(day => (
                  <div key={day.date} style={{ marginBottom: 'var(--s4)' }}>
                    <div className="calendar-day__title">{formatCalendarDate(day.date)}</div>
                    <div className="stack gap-2" style={{ marginTop: 'var(--s2)' }}>
                      {day.matches.map(match => (
                        <div key={match.id} className="calendar-row" onClick={() => typeof match.id === 'number' && navigate(`/partida/${match.id}`)}>
                          <div className="calendar-row__teams">{match.team_a.code} vs {match.team_b.code}</div>
                          <div className="calendar-row__meta">{match.city} · {match.venue}</div>
                          <div className="calendar-row__status">
                            {match.live_score_a != null || match.live_score_b != null
                              ? `${match.live_score_a ?? '-'}:${match.live_score_b ?? '-'} · ${match.status_raw || match.status}`
                              : (match.status_raw || match.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TeamBig({ team }) {
  return (
    <div className="team-big">
      {team.flag_url && (
        <img src={team.flag_url} alt={team.code} className="team-big__flag" />
      )}
      <div className="team-big__code">{team.code}</div>
      <div className="team-big__meta">Elo {Math.round(team.elo_rating)}</div>
    </div>
  )
}

function MatchRow({ match, done }) {
  const navigate = useNavigate()
  const isLive = match.status === 'live'
  const hasLiveScore = match.live_score_a != null || match.live_score_b != null
  const scoreLabel = done && match.result
    ? `${match.result.score_a}–${match.result.score_b}`
    : hasLiveScore
      ? `${match.live_score_a ?? '-'}–${match.live_score_b ?? '-'}`
      : 'vs'

  return (
    <div className="match-card" onClick={() => navigate(`/partida/${match.id}`)}>
      <span className="match-card__group">G{match.group_name}</span>
      <div className="match-card__teams">
        <div className="match-card__team">
          {match.team_a.flag_url && (
            <img src={match.team_a.flag_url} alt={match.team_a.code} className="match-card__flag" />
          )}
          <span>{match.team_a.code}</span>
        </div>
        <span className="match-card__sep">
          {scoreLabel}
        </span>
        <div className="match-card__team">
          {match.team_b.flag_url && (
            <img src={match.team_b.flag_url} alt={match.team_b.code} className="match-card__flag" />
          )}
          <span>{match.team_b.code}</span>
        </div>
      </div>
      {done ? <span className="badge badge-done">FIM</span> : isLive ? <span className="badge badge-live">{match.status_raw || 'Ao vivo'}</span> : <span className="match-card__arrow">›</span>}
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: 'var(--text-1)' }}>
        {value}
      </span>
    </div>
  )
}

function formatCalendarDate(value) {
  if (!value || value === 'sem-data') return 'Sem data'
  const date = new Date(`${value}T00:00:00`)
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(date)
}

function StatusBadge({ game }) {
  if (game.status === 'live') {
    return <span className="badge badge-live">{game.status_raw || 'Ao vivo'}</span>
  }
  if (game.status === 'finished') {
    return <span className="badge badge-done">{game.status_raw || 'Fim'}</span>
  }
  return <span className="badge badge-group">{game.status_raw || 'Agendado'}</span>
}

const MEDAL = ['🥇', '🥈', '🥉']

function TopBettorsCard({ bettors }) {
  const [idx, setIdx]       = useState(0)
  const [visible, setVisible] = useState(true)
  const timerRef            = useRef(null)

  const maxPts = bettors[0]?.total_points || 1

  function goTo(next) {
    setVisible(false)
    setTimeout(() => {
      setIdx(next)
      setVisible(true)
    }, 220)
  }

  useEffect(() => {
    if (bettors.length < 2) return
    timerRef.current = setInterval(() => {
      setIdx(prev => {
        const next = (prev + 1) % bettors.length
        setVisible(false)
        setTimeout(() => setVisible(true), 220)
        return next
      })
    }, 3500)
    return () => clearInterval(timerRef.current)
  }, [bettors.length])

  const b = bettors[idx]
  if (!b) return null

  const accuracy = b.total_bets > 0 ? Math.round(((b.exact_scores + b.correct_results) / b.total_bets) * 100) : 0
  const ptsWidth  = Math.round((b.total_points / maxPts) * 100)

  return (
    <div className="card fade-in-2" style={{ overflow: 'hidden' }}>
      <div className="card__header">
        <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
          🎯 Melhores Apostadores
        </span>
        <Link to="/ranking" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
          Ver todos →
        </Link>
      </div>

      {/* dots nav */}
      <div style={{ display: 'flex', gap: 5, justifyContent: 'center', padding: '0 var(--s4) var(--s2)' }}>
        {bettors.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            style={{
              width: i === idx ? 18 : 6,
              height: 6,
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              background: i === idx ? 'var(--accent)' : 'var(--border)',
              transition: 'width 300ms ease, background 300ms ease',
            }}
          />
        ))}
      </div>

      <div
        className="card__body"
        style={{
          paddingTop: 'var(--s3)',
          paddingBottom: 'var(--s4)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(6px)',
          transition: 'opacity 220ms ease, transform 220ms ease',
        }}
      >
        {/* position + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>
            {MEDAL[idx] || `#${idx + 1}`}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 17,
              color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              {b.name}
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {b.total_bets} aposta{b.total_bets !== 1 ? 's' : ''} · {accuracy}% acertos
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--accent)', lineHeight: 1 }}>
              {b.total_points}
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>pts</div>
          </div>
        </div>

        {/* points bar */}
        <div style={{ height: 5, background: 'var(--bg-overlay)', borderRadius: 3, overflow: 'hidden', marginBottom: 'var(--s4)' }}>
          <div style={{
            height: '100%',
            width: `${ptsWidth}%`,
            background: 'var(--accent)',
            borderRadius: 3,
            transition: 'width 400ms ease',
          }} />
        </div>

        {/* stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--s2)', textAlign: 'center' }}>
          <div style={{ background: 'var(--bg-overlay)', borderRadius: 8, padding: 'var(--s3) var(--s2)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--win)' }}>{b.exact_scores}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Exatos</div>
          </div>
          <div style={{ background: 'var(--bg-overlay)', borderRadius: 8, padding: 'var(--s3) var(--s2)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-2)' }}>{b.correct_results}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Acertos</div>
          </div>
          <div style={{ background: 'var(--bg-overlay)', borderRadius: 8, padding: 'var(--s3) var(--s2)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-2)' }}>{b.total_bets}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Apostas</div>
          </div>
        </div>
      </div>
    </div>
  )
}
