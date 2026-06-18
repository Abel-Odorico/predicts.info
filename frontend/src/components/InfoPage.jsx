import { Link } from 'react-router-dom'

export default function InfoPage({ eyebrow, title, intro, sections, aside }) {
  return (
    <div className="page">
      <div className="fade-in-1">
        <div className="info-page-hero">
          <div>
            <div className="info-page-eyebrow">{eyebrow}</div>
            <h1 className="page-title">{title}</h1>
            <p className="info-page-intro">{intro}</p>
          </div>
          <div className="row-wrap">
            <Link to="/dashboard" className="btn btn-primary btn-sm">Abrir simulador</Link>
            <Link to="/" className="btn btn-ghost btn-sm">Landing</Link>
          </div>
        </div>
      </div>

      <div className="info-page-grid mt-8">
        <div className="stack gap-6">
          {sections.map(section => (
            <section key={section.title} className="card fade-in-2">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  {section.title}
                </span>
              </div>
              <div className="card__body">
                <div className="stack gap-4">
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index} className="info-page-copy">{paragraph}</p>
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>

        <aside className="card fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
              Informacoes do site
            </span>
          </div>
          <div className="card__body">
            <div className="stack gap-4">
              {aside.map(item => (
                <div key={item.label} className="info-page-meta">
                  <div className="info-page-meta__label">{item.label}</div>
                  <div className="info-page-meta__value">{item.value}</div>
                </div>
              ))}
              <div className="info-page-links">
                <Link to="/privacidade">Privacidade</Link>
                <Link to="/termos">Termos</Link>
                <Link to="/sobre">Sobre</Link>
                <Link to="/contato">Contato</Link>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export function parseInfoContent(raw) {
  const blocks = String(raw || '')
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)

  const sections = []
  let current = null

  for (const block of blocks) {
    if (block.startsWith('## ')) {
      if (current) sections.push(current)
      current = { title: block.slice(3).trim(), paragraphs: [] }
      continue
    }

    if (!current) {
      current = { title: 'Informacoes', paragraphs: [] }
    }
    current.paragraphs.push(block.replace(/\n/g, ' '))
  }

  if (current) sections.push(current)
  return sections
}
