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

// Seleção -> bandeira real (flagUrl). Clube -> badge nas cores do time
// (crest real ainda não integrado — ver comentário em posCopaMocks.js).
function TeamBadge({ team }) {
  if (team.flagUrl) {
    return <img src={team.flagUrl} alt={team.code} className="pc-match-card__flag-img" />
  }
  const [c1, c2] = team.colors || ['#516f8a', '#516f8a']
  return (
    <span className="pc-team-badge" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
      {team.code}
    </span>
  )
}

// dado mockado — em produção viria de GET /competitions/:slug/matches
export default function MatchCard({ match, compColor }) {
  const meta = STATUS_META[match.status] || STATUS_META.aberto
  const disabled = match.status === 'fechado' || match.status === 'finalizado'
  return (
    <article className="pc-match-card" style={{ '--comp-color': compColor }}>
      <div className="pc-match-card__head">
        <span className="pc-match-card__round">{match.round}</span>
        <span className={`pc-status pc-status--${meta.tone}`}>{meta.label}</span>
      </div>
      <div className="pc-match-card__teams">
        <div className="pc-match-card__team">
          <TeamBadge team={match.home} />
          <span>{match.home.name}</span>
        </div>
        <span className="pc-match-card__vs">×</span>
        <div className="pc-match-card__team pc-match-card__team--away">
          <span>{match.away.name}</span>
          <TeamBadge team={match.away} />
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
