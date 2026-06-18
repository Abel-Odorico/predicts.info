export default function Spinner({ text = 'Carregando...' }) {
  return (
    <div className="loading-state">
      <div className="spinner" />
      <span className="loading-state__text">{text}</span>
    </div>
  )
}
