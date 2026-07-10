// dado mockado — em produção viria de GET /news?competition=:slug (tabela news_item)
export default function NewsImpactCard({ item }) {
  const up = item.direction === 'up'
  return (
    <article className="pc-news-card">
      <span className="pc-news-card__team">{item.team}</span>
      <p className="pc-news-card__headline">{item.headline}</p>
      <div className={`pc-news-card__impact ${up ? 'pc-news-card__impact--up' : 'pc-news-card__impact--down'}`}>
        <span>{up ? '▲' : '▼'}</span>
        <span>{item.impact}</span>
      </div>
    </article>
  )
}
