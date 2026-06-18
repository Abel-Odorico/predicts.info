import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

export default function Ranking() {
  const [data, setData] = useState([])
  const [loading, setLoad] = useState(true)

  useEffect(() => {
    api.get('/ranking')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [])

  if (loading) return <Spinner text="Carregando ranking..." />

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">RANKING</h1>
        <p className="page-subtitle">Placar exato = 3 pts · Resultado correto = 1 pt</p>
      </div>

      <div className="card mt-8 fade-in-2">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            Classificação Geral
          </span>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>
            {data.length} participantes
          </span>
        </div>

        {data.length === 0 ? (
          <div style={{ padding: 'var(--s16)', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
            Sem apostas ainda. Seja o primeiro!
          </div>
        ) : (
          <div>
            <div className="ranking-head">
              {['#', 'Usuário', 'Pontos', 'Exatos', 'Apostas'].map(h => (
                <span key={h} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)',
                  textAlign: h === '#' ? 'center' : h === 'Pontos' ? 'right' : h === 'Exatos' ? 'right' : h === 'Apostas' ? 'right' : 'left'
                }}>
                  {h}
                </span>
              ))}
            </div>

            {data.map((r, i) => (
              <Link
                key={r.user_id}
                to={`/usuarios/${r.user_id}/historico`}
                className="ranking-row fade-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <span className={`ranking-row__pos ${i < 3 ? 'ranking-row__pos--top' : ''}`}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <div className="ranking-row__meta">
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 15 }}>
                    {r.name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                    {r.email}
                  </div>
                </div>
                <span className="ranking-row__pts">{r.total_points}</span>
                <span className="ranking-row__stats ranking-row__sub">{r.exact_scores ?? 0}</span>
                <span className="ranking-row__stats ranking-row__sub">{r.total_bets ?? 0}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card mt-6 fade-in-3">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            Sistema de Pontuação
          </span>
        </div>
        <div className="card__body rules-list">
          {[
            { pts: 3, label: 'Placar exato', desc: 'Acertou o placar completo (ex: 2×1)' },
            { pts: 1, label: 'Resultado correto', desc: 'Acertou vitória/empate/derrota' },
            { pts: 0, label: 'Erro', desc: 'Resultado errado' },
          ].map(rule => (
            <div key={rule.pts} className="rule-item">
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 28,
                color: rule.pts === 3 ? 'var(--accent)' : rule.pts === 1 ? 'var(--win)' : 'var(--text-4)',
                minWidth: 28, textAlign: 'center'
              }}>
                {rule.pts}
              </span>
              <div>
                <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 14 }}>
                  {rule.label}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>
                  {rule.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
