const STATUS_META = {
  aberto: { label: 'Palpite aberto', tone: 'open' },
  encerrando: { label: 'Encerrando em breve', tone: 'warn' },
  fechado: { label: 'Palpite fechado', tone: 'closed' },
  'ao-vivo': { label: 'Ao vivo', tone: 'live' },
  finalizado: { label: 'Finalizado', tone: 'done' },
}

function fmtKickoff(iso) {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// dado mockado — em produção viria de GET /competitions/:slug/matches
export default function MatchCard({ match }) {
  const meta = STATUS_META[match.status] || STATUS_META.aberto
  const disabled = match.status === 'fechado' || match.status === 'finalizado'
  return (
    <article className="pc-match-card">
      <div className="pc-match-card__head">
        <span className="pc-match-card__round">{match.round}</span>
        <span className={`pc-status pc-status--${meta.tone}`}>{meta.label}</span>
      </div>
      <div className="pc-match-card__teams">
        <div className="pc-match-card__team">
          <span className="pc-match-card__flag">{match.homeFlag}</span>
          <span>{match.home}</span>
        </div>
        <span className="pc-match-card__vs">×</span>
        <div className="pc-match-card__team pc-match-card__team--away">
          <span>{match.away}</span>
          <span className="pc-match-card__flag">{match.awayFlag}</span>
        </div>
      </div>
      <div className="pc-match-card__meta">
        <span>{fmtKickoff(match.kickoff)}</span>
        <span>Deadline: {fmtKickoff(match.deadline)}</span>
      </div>
      <div className="pc-match-card__probs">
        <div className="pc-prob-bar">
          <span style={{ width: `${match.probHome}%` }} className="pc-prob-bar__fill pc-prob-bar__fill--home" />
        </div>
        <div className="pc-match-card__probs-labels">
          <span>{match.probHome}% casa</span>
          <span>{match.probDraw}% empate</span>
          <span>{match.probAway}% fora</span>
        </div>
      </div>
      <button type="button" className="pc-btn pc-btn--primary" disabled={disabled}>
        {disabled ? meta.label : 'Palpitar'}
      </button>
    </article>
  )
}
