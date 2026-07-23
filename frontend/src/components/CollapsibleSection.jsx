import { useState } from 'react'

// Cabeçalho colapsável reusado pelas seções de mecânicas extras do bolão
// (Classificação/Lanterna/Dobro) — fechado por padrão, mostra um resumo (teaser)
// enquanto fechado pra não obrigar o usuário a abrir só pra saber o estado.
export default function CollapsibleSection({ kicker, title, teaser, accent = 'var(--accent)', defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="card mt-4 fade-in-1" style={{ padding: 0, borderLeft: `3px solid ${accent}` }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: 'var(--s3) var(--s4)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="group-manager-card__kicker" style={{ marginBottom: 2 }}>{kicker}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, color: 'var(--text-1)' }}>{title}</div>
          {!open && teaser && (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {teaser}
            </div>
          )}
        </div>
        <span
          className="group-manager-card__icon-btn"
          style={{ flexShrink: 0, fontFamily: 'var(--font-data)', fontSize: 16, fontWeight: 700 }}
          aria-label={open ? 'Encolher' : 'Expandir'}
        >
          {open ? '−' : '+'}
        </span>
      </button>
      {open && <div style={{ padding: '0 var(--s4) var(--s4)' }}>{children}</div>}
    </div>
  )
}
