const STATUS_LABEL = {
  pendente: 'Aguardando jogo',
  'em-andamento': 'Em andamento',
  finalizado: 'Resultado correto',
}

const POINTS_LABEL = {
  exato: 'Placar exato',
  'vencedor-gols': 'Vencedor + gols',
  saldo: 'Saldo correto',
  perdedor: 'Perdedor correto',
  resultado: 'Resultado correto',
}

// dado mockado — em produção viria de GET /me/predictions
export default function PredictionCard({ prediction }) {
  const { competition, round, home, away, predHome, predAway, resultHome, resultAway, status, pointsType, points } = prediction
  const done = status === 'finalizado'
  return (
    <article className="pc-pred-card">
      <div className="pc-pred-card__head">
        <span>{competition}</span>
        <span>{round}</span>
      </div>
      <div className="pc-pred-card__row">
        <span className="pc-pred-card__tag">Palpite</span>
        <strong>{home} {predHome} x {predAway} {away}</strong>
      </div>
      {done ? (
        <div className="pc-pred-card__row">
          <span className="pc-pred-card__tag">Resultado</span>
          <strong>{home} {resultHome} x {resultAway} {away}</strong>
        </div>
      ) : (
        <div className="pc-pred-card__row pc-pred-card__row--pending">
          <span className="pc-pred-card__tag">Status</span>
          <span>{STATUS_LABEL[status] || status}</span>
        </div>
      )}
      {done && (
        <div className="pc-pred-card__footer">
          <span className="pc-badge-points">{POINTS_LABEL[pointsType] || pointsType}</span>
          <span className="pc-pred-card__pts">+{points} pts</span>
        </div>
      )}
    </article>
  )
}
