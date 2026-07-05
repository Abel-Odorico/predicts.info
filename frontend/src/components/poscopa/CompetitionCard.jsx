const STATUS_LABEL = {
  ativa: 'Em andamento',
  'em-breve': 'Em breve',
  historica: 'Histórica',
}

export default function CompetitionCard({ competition, onCta }) {
  const { name, country, status, blurb, color, features, cta } = competition
  return (
    <article className="pc-comp-card" style={{ '--comp-color': color }}>
      <div className="pc-comp-card__top">
        <span className="pc-comp-card__badge" data-status={status}>{STATUS_LABEL[status] || status}</span>
        <span className="pc-comp-card__country">{country}</span>
      </div>
      <h3 className="pc-comp-card__name">{name}</h3>
      <p className="pc-comp-card__blurb">{blurb}</p>
      <ul className="pc-comp-card__features">
        {features.slice(0, 5).map((f) => <li key={f}>{f}</li>)}
        {features.length > 5 && <li className="pc-comp-card__more">+{features.length - 5} recursos</li>}
      </ul>
      <button type="button" className="pc-btn pc-btn--outline" onClick={() => onCta?.(competition)}>
        {cta}
      </button>
    </article>
  )
}
