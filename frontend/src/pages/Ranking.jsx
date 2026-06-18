import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

const PERIODS = [
  { id: 'all',   label: 'Geral' },
  { id: '7d',    label: 'Últimos 7d' },
  { id: '30d',   label: 'Últimos 30d' },
  { id: 'today', label: 'Hoje' },
  { id: 'custom',label: 'Período' },
]

function maskEmail(email) {
  if (!email) return ''
  const [local, domain] = email.split('@')
  return `${local.slice(0, 3)}***@${domain}`
}

function periodToDates(period) {
  const now = new Date()
  const pad  = n => String(n).padStart(2, '0')
  const fmt  = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const today = fmt(now)
  if (period === 'today') return { date_from: today, date_to: today }
  if (period === '7d')    { const d = new Date(now); d.setDate(d.getDate()-7);  return { date_from: fmt(d), date_to: today } }
  if (period === '30d')   { const d = new Date(now); d.setDate(d.getDate()-30); return { date_from: fmt(d), date_to: today } }
  return {}
}

export default function Ranking() {
  const [data,    setData]    = useState([])
  const [loading, setLoad]    = useState(true)
  const [group,   setGroup]   = useState('')
  const [period,  setPeriod]  = useState('all')
  const [dateFrom,setDateFrom]= useState('')
  const [dateTo,  setDateTo]  = useState('')

  const load = useCallback(() => {
    setLoad(true)
    const params = new URLSearchParams()
    if (group) params.set('group', group)
    const { date_from, date_to } = period === 'custom'
      ? { date_from: dateFrom, date_to: dateTo }
      : periodToDates(period)
    if (date_from) params.set('date_from', date_from)
    if (date_to)   params.set('date_to',   date_to)
    const qs = params.toString()
    api.get(`/ranking${qs ? `?${qs}` : ''}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [group, period, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const isFiltered = group || period !== 'all'

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">RANKING</h1>
        <p className="page-subtitle">Placar exato = 3 pts · Resultado correto = 1 pt</p>
      </div>

      {/* ── Filtros ── */}
      <div className="card mt-6 fade-in-2" style={{ padding: 'var(--s12) var(--s16)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s10)' }}>

          {/* Período */}
          <div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
              Período
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PERIODS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPeriod(p.id)}
                  style={{
                    fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600,
                    padding: '4px 12px', borderRadius: 20, border: '1px solid',
                    cursor: 'pointer',
                    background: period === p.id ? 'var(--accent)' : 'transparent',
                    borderColor: period === p.id ? 'var(--accent)' : 'var(--border)',
                    color: period === p.id ? '#000' : 'var(--text-2)',
                    transition: 'all .15s',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  style={{ fontFamily: 'var(--font-data)', fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }}
                />
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>até</span>
                <input
                  type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  style={{ fontFamily: 'var(--font-data)', fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }}
                />
              </div>
            )}
          </div>

          {/* Grupo */}
          <div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
              Grupo
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button
                onClick={() => setGroup('')}
                style={{
                  fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600,
                  padding: '4px 12px', borderRadius: 20, border: '1px solid',
                  cursor: 'pointer',
                  background: !group ? 'var(--accent)' : 'transparent',
                  borderColor: !group ? 'var(--accent)' : 'var(--border)',
                  color: !group ? '#000' : 'var(--text-2)',
                  transition: 'all .15s',
                }}
              >
                Todos
              </button>
              {GROUPS.map(g => (
                <button
                  key={g}
                  onClick={() => setGroup(group === g ? '' : g)}
                  style={{
                    fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700,
                    width: 34, height: 28, borderRadius: 20, border: '1px solid',
                    cursor: 'pointer',
                    background: group === g ? 'var(--accent)' : 'transparent',
                    borderColor: group === g ? 'var(--accent)' : 'var(--border)',
                    color: group === g ? '#000' : 'var(--text-2)',
                    transition: 'all .15s',
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {isFiltered && (
            <button
              onClick={() => { setGroup(''); setPeriod('all'); setDateFrom(''); setDateTo('') }}
              style={{ alignSelf: 'flex-start', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Tabela ── */}
      <div className="card mt-4 fade-in-3">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            {group ? `Grupo ${group}` : period !== 'all' ? PERIODS.find(p=>p.id===period)?.label : 'Classificação Geral'}
          </span>
          {!loading && (
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>
              {data.length} participante{data.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ padding: 'var(--s24)', textAlign: 'center' }}><Spinner text="" /></div>
        ) : data.length === 0 ? (
          <div style={{ padding: 'var(--s16)', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
            {isFiltered ? 'Nenhuma aposta nos critérios selecionados.' : 'Sem apostas ainda. Seja o primeiro!'}
          </div>
        ) : (
          <div>
            <div className="ranking-head">
              {['#', 'Usuário', 'Pontos', 'Exatos', 'Apostas'].map(h => (
                <span key={h} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)',
                  textAlign: h === '#' ? 'center' : ['Pontos','Exatos','Apostas'].includes(h) ? 'right' : 'left'
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
                    {maskEmail(r.email)}
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

      {/* ── Sistema de Pontuação ── */}
      <div className="card mt-6 fade-in-4">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            Sistema de Pontuação
          </span>
        </div>
        <div className="card__body rules-list">
          {[
            { pts: 3, label: 'Placar exato',      desc: 'Acertou o placar completo (ex: 2×1)' },
            { pts: 1, label: 'Resultado correto', desc: 'Acertou vitória/empate/derrota' },
            { pts: 0, label: 'Erro',               desc: 'Resultado errado' },
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
                <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 14 }}>{rule.label}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{rule.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
