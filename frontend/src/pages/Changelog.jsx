import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function Changelog() {
  const [versions, setVersions] = useState(null)
  const [loading, setLoading]   = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/version/list')
      .then(v => setVersions(v))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="page">
      <div className="fade-in-1" style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--s3)', marginBottom: 'var(--s6)', flexWrap: 'wrap' }}>
          <div>
            <h1 className="page-title">CHANGELOG</h1>
            <p className="page-subtitle">Histórico de versões · predicts.info</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>← Dashboard</button>
        </div>

        {loading && (
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s8)' }}>
            Carregando...
          </p>
        )}

        {!loading && (!versions || versions.length === 0) && (
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s8)' }}>
            Nenhuma versão registrada.
          </p>
        )}

        {versions?.map((v, i) => (
          <div
            key={v.id}
            style={{
              display: 'flex',
              gap: 'var(--s5)',
              paddingBottom: i < versions.length - 1 ? 'var(--s7)' : 0,
              marginBottom: i < versions.length - 1 ? 'var(--s7)' : 0,
              borderBottom: i < versions.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            {/* Timeline dot */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 4 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: i === 0 ? 'var(--accent)' : 'var(--border)',
                border: i === 0 ? '2px solid var(--accent)' : '2px solid var(--text-4)',
                flexShrink: 0,
              }} />
              {i < versions.length - 1 && (
                <div style={{ flex: 1, width: 1, background: 'var(--border)', marginTop: 6 }} />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 'var(--s2)' }}>
              {/* Version badge + title + date */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)', flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700,
                  color: i === 0 ? 'var(--accent)' : 'var(--text-2)',
                  background: i === 0 ? 'rgba(15,122,120,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${i === 0 ? 'rgba(15,122,120,0.3)' : 'var(--border)'}`,
                  padding: '2px 8px', borderRadius: 4,
                }}>v{v.version}</span>
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: i === 0 ? 20 : 16,
                  color: i === 0 ? 'var(--text-1)' : 'var(--text-2)', letterSpacing: '0.02em',
                }}>{v.title}</span>
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto' }}>
                  {v.created_at
                    ? new Date(v.created_at).toLocaleDateString('pt-BR', {
                        timeZone: 'America/Sao_Paulo',
                        day: '2-digit', month: 'long', year: 'numeric',
                      })
                    : ''}
                </span>
              </div>

              {/* Description */}
              {v.description && (
                <p style={{
                  fontFamily: 'var(--font-cond)', fontSize: 13,
                  color: 'var(--text-2)', margin: '0 0 var(--s3)',
                  lineHeight: 1.5,
                }}>{v.description}</p>
              )}

              {/* Changes */}
              {v.changes?.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {v.changes.map((c, j) => (
                    <li key={j} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8,
                      fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)',
                    }}>
                      <span style={{
                        color: i === 0 ? 'var(--accent)' : 'var(--text-4)',
                        flexShrink: 0, fontWeight: 700, marginTop: 1,
                      }}>+</span>
                      {c}
                    </li>
                  ))}
                </ul>
              )}

              {/* Latest badge */}
              {i === 0 && (
                <div style={{
                  marginTop: 'var(--s3)',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontFamily: 'var(--font-cond)', fontSize: 10,
                  color: 'var(--win)', letterSpacing: '0.08em', fontWeight: 700,
                  background: 'rgba(46,201,128,0.08)', border: '1px solid rgba(46,201,128,0.2)',
                  padding: '2px 8px', borderRadius: 4,
                }}>
                  ✓ VERSÃO ATUAL
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Footer */}
        {versions && versions.length > 0 && (
          <div style={{ marginTop: 'var(--s8)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
              predicts.info · by Peep
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
