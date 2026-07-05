export default function ScoringExample({ rule }) {
  const { label, points, example, bonus } = rule
  return (
    <article className={`pc-score-card ${bonus ? 'pc-score-card--bonus' : ''}`}>
      <div className="pc-score-card__head">
        <span className="pc-score-card__label">{label}</span>
        <span className="pc-score-card__pts">{points} pts</span>
      </div>
      {example ? (
        <div className="pc-score-card__body">
          <div>
            <span className="pc-score-card__tag">Palpite</span>
            <strong>{example.team[0]} {example.pred[0]} x {example.pred[1]} {example.team[1]}</strong>
          </div>
          <div>
            <span className="pc-score-card__tag">Resultado</span>
            <strong>{example.team[0]} {example.result[0]} x {example.result[1]} {example.team[1]}</strong>
          </div>
        </div>
      ) : (
        <p className="pc-score-card__bonus-note">Bônus aplicado ao final da competição.</p>
      )}
    </article>
  )
}
