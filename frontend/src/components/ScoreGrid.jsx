export default function ScoreGrid({ scores }) {
  if (!scores?.length) return null

  const max = scores[0]?.prob || 1

  return (
    <div className="score-grid">
      {scores.map((s, i) => (
        <div key={s.score} className="score-row fade-in" style={{ animationDelay: `${i * 20}ms` }}>
          <div className="score-row__label">{s.score}</div>
          <div className="score-row__bar-track">
            <div
              className="score-row__bar-fill"
              style={{ width: `${(s.prob / max) * 100}%` }}
            />
          </div>
          <div className="score-row__pct">{s.prob.toFixed(1)}%</div>
        </div>
      ))}
    </div>
  )
}
