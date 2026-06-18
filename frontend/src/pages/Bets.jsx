import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

const SCORING_RULES = [
  { pts: '3 pts', title: 'Placar exato', desc: 'Acertou o resultado completo da partida.' },
  { pts: '1 pt', title: 'Resultado correto', desc: 'Acertou vitória, empate ou derrota.' },
  { pts: '0 pt', title: 'Sem acerto', desc: 'Quando o resultado previsto não confere.' },
]

export default function Bets() {
  const { token } = useAuth()
  const [bets, setBets]     = useState([])
  const [matches, setMatches] = useState([])
  const [loading, setLoad]  = useState(true)
  const [tab, setTab]       = useState('open')
  const [shareMsg, setShareMsg] = useState('')

  useEffect(() => {
    const reqs = [api.get('/matches?status=scheduled&limit=20')]
    if (token) reqs.push(api.get('/bets', token))

    Promise.all(reqs)
      .then(([m, b]) => { setMatches(m); if (b) setBets(b) })
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [token])

  async function handleShare() {
    const url = `${window.location.origin}/login`
    const title = 'Bolão Copa 2026'
    const text = 'Entre no simulador, aposte nos placares e dispute o ranking da Copa.'

    try {
      if (navigator.share) {
        await navigator.share({ title, text, url })
        setShareMsg('Link compartilhado.')
        return
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        setShareMsg('Link copiado para compartilhar.')
        return
      }

      setShareMsg(`Compartilhe este link: ${url}`)
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setShareMsg('Nao foi possivel compartilhar agora.')
      }
    }
  }

  const openMatches = matches.filter(isMatchOpen)

  if (loading) return <Spinner text="Carregando apostas..." />

  if (!token) {
    return (
      <div className="page">
        <div className="card card--accent fade-in-1 bet-guide">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              Como Funciona
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleShare}>
              Compartilhar
            </button>
          </div>
          <div className="card__body">
            <div className="guide-rules">
              {SCORING_RULES.map(rule => (
                <div key={rule.title} className="guide-rule">
                  <span className="guide-rule__pts">{rule.pts}</span>
                  <div>
                    <div className="guide-rule__title">{rule.title}</div>
                    <div className="guide-rule__desc">{rule.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            {shareMsg && <p className="guide-share-msg">{shareMsg}</p>}
          </div>
        </div>

        <div className="fade-in-1 bet-empty">
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 48, color: 'var(--accent)', marginBottom: 'var(--s4)' }}>
            🎯
          </div>
          <h1 className="page-title" style={{ marginBottom: 'var(--s4)' }}>APOSTAS</h1>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 15, color: 'var(--text-3)', marginBottom: 'var(--s6)' }}>
            Faça login para apostar nos placares
          </p>
          <Link to="/login" className="btn btn-primary btn-lg">Entrar</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">APOSTAS</h1>
        <p className="page-subtitle">Aposte ate o apito inicial · quando a partida comecar, a aposta encerra</p>
      </div>

      <div className="card card--accent mt-6 fade-in-2 bet-guide">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            Regras e Convite
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleShare}>
            Compartilhar
          </button>
        </div>
        <div className="card__body">
          <div className="guide-rules">
            {SCORING_RULES.map(rule => (
              <div key={rule.title} className="guide-rule">
                <span className="guide-rule__pts">{rule.pts}</span>
                <div>
                  <div className="guide-rule__title">{rule.title}</div>
                  <div className="guide-rule__desc">{rule.desc}</div>
                </div>
              </div>
            ))}
          </div>
          {shareMsg && <p className="guide-share-msg">{shareMsg}</p>}
        </div>
      </div>

      <div className="tabs mt-6">
        {[
          { id: 'open', label: `Partidas Abertas${openMatches.length ? ` (${openMatches.length})` : ''}` },
          { id: 'mine', label: `Minhas Apostas${bets.length ? ` (${bets.length})` : ''}` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={tab === t.id ? 'active' : ''}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mine' && (
        <div className="fade-in-1">
          <div className="bet-summary-grid mt-6">
            <SummaryCard label="Abertas Agora" value={openMatches.length} tone="accent" />
            <SummaryCard label="Minhas Apostas" value={bets.length} />
            <SummaryCard label="Ja Pontuadas" value={bets.filter(b => b.result !== null).length} tone="win" />
          </div>
          {bets.length === 0 ? (
            <div className="bet-empty" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
              <p>Sem apostas ainda.</p>
              <button
                type="button"
                className="btn btn-primary btn-sm mt-4"
                onClick={() => setTab('open')}
              >
                Ver Partidas Abertas
              </button>
            </div>
          ) : (
            <div className="bets-list mt-6">
              {bets.map((b, i) => (
                <BetRow key={b.id} bet={b} index={i} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'open' && (
        <div className="fade-in-1">
          <div className="card mt-6" style={{ borderColor: 'var(--border-accent)' }}>
            <div className="card__body bet-open-intro">
              <p className="bet-open-intro__text">
                Escolha uma partida abaixo e toque em <strong>Apostar</strong>. O envio fica disponivel ate a hora marcada do jogo.
              </p>
              <div className="bet-open-intro__note">Ao iniciar a partida, as apostas sao encerradas automaticamente.</div>
            </div>
          </div>
          {openMatches.length === 0 ? (
            <div className="bet-empty" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
              Sem partidas abertas no momento
            </div>
          ) : (
            <div className="bets-list mt-6">
              {openMatches.map(m => (
                <OpenMatchRow key={m.id} match={m} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BetRow({ bet, index }) {
  const statusColor = bet.result === 'exact'   ? 'var(--accent)'
                    : bet.result === 'correct'  ? 'var(--win)'
                    : bet.result === 'wrong'    ? 'var(--lose)'
                    : 'var(--text-3)'

  const statusLabel = bet.result === 'exact'   ? 'Placar exato'
                    : bet.result === 'correct'  ? 'Resultado correto'
                    : bet.result === 'wrong'    ? 'Sem acerto'
                    : bet.is_open ? 'Pendente' : 'Aguardando avaliacao'
  const pointsLabel = bet.result === null ? 'Pendente' : `${bet.points_earned ?? 0} pt${bet.points_earned === 1 ? '' : 's'}`
  const officialScore = bet.official_score_a != null && bet.official_score_b != null
    ? `${bet.official_score_a} – ${bet.official_score_b}`
    : 'Aguardando resultado'

  return (
    <div className="bet-card fade-in" style={{ animationDelay: `${index * 30}ms` }}>
      <div className="bet-card__top">
        <span className="badge badge-group">Grupo {bet.group_name}</span>
        <span className="bet-card__time">{formatMatchDate(bet.match_date)}</span>
      </div>
      <div className="bet-card__match">
        <div className="bet-card__team">{bet.team_a_code}</div>
        <div className="bet-card__score">{bet.score_a} – {bet.score_b}</div>
        <div className="bet-card__team bet-card__team--right">{bet.team_b_code}</div>
      </div>
      <div className="bet-card__meta">
        <Metric label="Meu placar" value={`${bet.score_a} – ${bet.score_b}`} accent />
        <Metric label="Placar oficial" value={officialScore} />
        <Metric label="Pontuacao" value={pointsLabel} />
      </div>
      <div className="bet-card__footer">
        <span className="bet-card__status" style={{ color: statusColor }}>{statusLabel}</span>
        <span className="bet-card__hint">
          {bet.result === null
            ? 'A pontuacao aparece aqui assim que o resultado oficial for lancado.'
            : 'Ranking e pontuacao ja atualizados.'}
        </span>
      </div>
    </div>
  )
}

function OpenMatchRow({ match }) {
  return (
    <Link to={`/partida/${match.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="bet-card bet-card--open">
        <div className="bet-card__top">
          <span className="badge badge-group">Grupo {match.group_name}</span>
          <span className="bet-card__time">{formatMatchDate(match.match_date)}</span>
        </div>
        <div className="bet-card__match">
          <div className="bet-card__team">
            {match.team_a.flag_url && (
              <img src={match.team_a.flag_url} alt={match.team_a.code} className="match-card__flag" />
            )}
            <span>{match.team_a.code}</span>
          </div>
          <span className="bet-card__versus">vs</span>
          <div className="bet-card__team bet-card__team--right">
            {match.team_b.flag_url && (
              <img src={match.team_b.flag_url} alt={match.team_b.code} className="match-card__flag" />
            )}
            <span>{match.team_b.code}</span>
          </div>
        </div>
        <div className="bet-card__footer">
          <span className="bet-card__hint">Aposta disponivel ate {formatKickoffTime(match.match_date)}</span>
          <span className="btn btn-primary btn-sm">Apostar</span>
        </div>
      </div>
    </Link>
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

function isMatchOpen(match) {
  if (match.status !== 'scheduled') return false
  if (!match.match_date) return true
  return parseUtcMatchDate(match.match_date).getTime() > Date.now()
}

function formatMatchDate(value) {
  if (!value) return 'Sem horario'
  return parseUtcMatchDate(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatKickoffTime(value) {
  if (!value) return 'o inicio do jogo'
  return parseUtcMatchDate(value).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function parseUtcMatchDate(value) {
  return new Date(value.endsWith('Z') ? value : `${value}Z`)
}
