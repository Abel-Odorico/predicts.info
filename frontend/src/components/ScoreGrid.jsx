export default function ScoreGrid({ scores, onSelect, selectedScore }) {
  if (!scores?.length) return null

  const max = scores[0]?.prob || 1

  return (
    <div className="score-grid">
      {scores.map((s, i) => {
        const isSelected = selectedScore === s.score
        return (
          <div
            key={s.score}
            className="score-row fade-in"
            style={{
              animationDelay: `${i * 20}ms`,
              cursor: onSelect ? 'pointer' : 'default',
              borderRadius: 6,
              background: isSelected ? 'var(--bg-overlay)' : 'transparent',
              outline: isSelected ? '1.5px solid var(--accent)' : 'none',
              transition: 'background 150ms, outline 150ms',
            }}
            onClick={() => onSelect?.(s.score)}
            title={onSelect ? `Apostar ${s.score}` : undefined}
          >
            <div className="score-row__label" style={{ color: isSelected ? 'var(--accent)' : undefined, fontWeight: isSelected ? 700 : undefined }}>
              {s.score}
            </div>
            <div className="score-row__bar-track">
              <div
                className="score-row__bar-fill"
                style={{ width: `${(s.prob / max) * 100}%`, background: isSelected ? 'var(--accent)' : undefined }}
              />
            </div>
            <div className="score-row__pct">{s.prob.toFixed(1)}%</div>
          </div>
        )
      })}
    </div>
  )
}
