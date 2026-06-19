import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L']

const PERIODS = [
  { id: 'all',    label: 'Geral' },
  { id: '7d',     label: 'Últimos 7d' },
  { id: '30d',    label: 'Últimos 30d' },
  { id: 'today',  label: 'Hoje' },
  { id: 'custom', label: 'Período' },
]

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

function todayQS() {
  const now = new Date()
  const pad = n => String(n).padStart(2,'0')
  const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
  return `date_from=${d}&date_to=${d}`
}

function aproveitamento(r) {
  if (!r.total_bets) return null
  return Math.round(r.total_points / (r.total_bets * 3) * 100)
}
function pctResultado(r) {
  if (!r.total_bets) return null
  return Math.round((r.exact_scores + r.correct_results) / r.total_bets * 100)
}
function pctExato(r) {
  if (!r.total_bets) return null
  return Math.round(r.exact_scores / r.total_bets * 100)
}

export default function Ranking() {
  const [data,      setData]     = useState([])
  const [todayTop,  setTodayTop] = useState(null)
  const [loading,   setLoad]     = useState(true)
  const [group,     setGroup]    = useState('')
  const [period,    setPeriod]   = useState('all')
  const [dateFrom,  setDateFrom] = useState('')
  const [dateTo,    setDateTo]   = useState('')

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

    Promise.all([
      api.get(`/ranking${qs ? `?${qs}` : ''}`),
      api.get(`/ranking?${todayQS()}&limit=1`),
    ])
      .then(([main, today]) => {
        setData(main)
        setTodayTop(today?.[0] || null)
      })
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [group, period, dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const isFiltered = group || period !== 'all'

  // Destaques derivados do ranking geral
  const leader      = data[0] || null
  const reiExatos   = data.length ? [...data].sort((a,b) => b.exact_scores - a.exact_scores)[0] : null
  const maisAtivo   = data.length ? [...data].sort((a,b) => b.total_bets   - a.total_bets  )[0] : null
  const topAcerto   = data.length
    ? [...data].filter(r => r.total_bets >= 3).sort((a,b) => (acerto(b)||0) - (acerto(a)||0))[0]
    : null

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">RANKING</h1>
        <p className="page-subtitle">Placar exato = 3 pts · Resultado correto = 1 pt</p>
      </div>

      {/* ── Cards de destaque ─────────────────────────────────────────── */}
      {!loading && data.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--s3)', marginTop: 'var(--s6)' }} className="fade-in-2">
          <HighlightCard
            icon="👑" label="Líder Geral"
            name={leader?.name}
            stat={`${leader?.total_points ?? 0} pts`}
            sub={leader ? `${leader.total_bets * 3} em jogo · ${aproveitamento(leader) ?? 0}% aproveito` : ''}
            userId={leader?.user_id}
            accent="var(--accent)"
          />
          <HighlightCard
            icon="⚡" label="Melhor do Dia"
            name={todayTop?.name || '—'}
            stat={todayTop ? `${todayTop.total_points} pts hoje` : 'Sem apostas hoje'}
            sub={todayTop ? `${todayTop.exact_scores} exatos · ${pctExato(todayTop) ?? 0}% exatos` : ''}
            userId={todayTop?.user_id}
            accent="var(--win)"
          />
          <HighlightCard
            icon="🎯" label="Rei dos Exatos"
            name={reiExatos?.name}
            stat={`${reiExatos?.exact_scores ?? 0} placares exatos`}
            sub={reiExatos ? `${pctExato(reiExatos) ?? 0}% de exatidão · ${reiExatos.total_bets} apostas` : ''}
            userId={reiExatos?.user_id}
            accent="#e8a030"
          />
          <HighlightCard
            icon="🔥" label="Mais Ativo"
            name={maisAtivo?.name}
            stat={`${maisAtivo?.total_bets ?? 0} apostas`}
            sub={maisAtivo ? `${maisAtivo.total_points} pts · ${aproveitamento(maisAtivo) ?? 0}% aproveito` : ''}
            userId={maisAtivo?.user_id}
            accent="#9b5de8"
          />
        </div>
      )}

      {/* ── Filtros ───────────────────────────────────────────────────── */}
      <div className="card mt-6 fade-in-2" style={{ padding: 'var(--s12) var(--s16)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s10)' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
              Período
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PERIODS.map(p => (
                <button key={p.id} onClick={() => setPeriod(p.id)} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600,
                  padding: '4px 12px', borderRadius: 20, border: '1px solid', cursor: 'pointer',
                  background: period === p.id ? 'var(--accent)' : 'transparent',
                  borderColor: period === p.id ? 'var(--accent)' : 'var(--border)',
                  color: period === p.id ? '#000' : 'var(--text-2)',
                  transition: 'all .15s',
                }}>
                  {p.label}
                </button>
              ))}
            </div>
            {period === 'custom' && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  style={{ fontFamily: 'var(--font-data)', fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }} />
                <span style={{ color: 'var(--text-3)', fontSize: 12 }}>até</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  style={{ fontFamily: 'var(--font-data)', fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-1)' }} />
              </div>
            )}
          </div>

          <div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
              Grupo
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button onClick={() => setGroup('')} style={{
                fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600,
                padding: '4px 12px', borderRadius: 20, border: '1px solid', cursor: 'pointer',
                background: !group ? 'var(--accent)' : 'transparent',
                borderColor: !group ? 'var(--accent)' : 'var(--border)',
                color: !group ? '#000' : 'var(--text-2)', transition: 'all .15s',
              }}>
                Todos
              </button>
              {GROUPS.map(g => (
                <button key={g} onClick={() => setGroup(group === g ? '' : g)} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700,
                  width: 34, height: 28, borderRadius: 20, border: '1px solid', cursor: 'pointer',
                  background: group === g ? 'var(--accent)' : 'transparent',
                  borderColor: group === g ? 'var(--accent)' : 'var(--border)',
                  color: group === g ? '#000' : 'var(--text-2)', transition: 'all .15s',
                }}>
                  {g}
                </button>
              ))}
            </div>
          </div>

          {isFiltered && (
            <button onClick={() => { setGroup(''); setPeriod('all'); setDateFrom(''); setDateTo('') }}
              style={{ alignSelf: 'flex-start', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Tabela ────────────────────────────────────────────────────── */}
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
            {/* Header */}
            <div className="ranking-head" style={{ padding: '6px var(--s4)' }}>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', textAlign: 'center' }}>#</span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)' }}>Usuário</span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', textAlign: 'right' }}>Pts</span>
              <span className="ranking-col-hide" style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', textAlign: 'right' }}>Apostas</span>
              <span className="ranking-col-hide" style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', textAlign: 'right' }} title="Pontos / (Apostas × 3)">Aproveito</span>
              <span className="ranking-col-hide" style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', textAlign: 'right' }} title="Acertou vencedor ou empate">% Res.</span>
              <span className="ranking-col-hide" style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', textAlign: 'right' }} title="Acertou placar exato">% Exato</span>
            </div>

            {/* Rows */}
            {data.map((r, i) => {
              const podiumClass = i === 0 ? 'ranking-row--gold' : i === 1 ? 'ranking-row--silver' : i === 2 ? 'ranking-row--bronze' : ''
              const leaderPts = data[0]?.total_points || 1

              return (
                <Link
                  key={r.user_id}
                  to={`/usuarios/${r.user_id}/historico`}
                  className={`ranking-row fade-in ${podiumClass}`}
                  style={{ animationDelay: `${i * 30}ms`, borderLeft: i < 3 ? undefined : '3px solid transparent' }}
                >
                  <span className={`ranking-row__pos ${i < 3 ? 'ranking-row__pos--top' : ''}`} style={{ textAlign: 'center' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.name}
                    </div>
                    {/* Barra relativa ao líder */}
                    <div style={{ height: 3, background: 'var(--bg-overlay)', borderRadius: 2, marginTop: 3, overflow: 'hidden', maxWidth: 140 }}>
                      <div style={{
                        height: '100%',
                        width: `${(r.total_points / leaderPts) * 100}%`,
                        background: i === 0 ? 'var(--accent)' : i === 1 ? 'var(--text-2)' : i === 2 ? 'var(--win)' : 'var(--border-accent)',
                        borderRadius: 2, transition: 'width 600ms ease',
                      }} />
                    </div>
                    {/* Resumo visível só no mobile */}
                    <div className="ranking-row__mobile-stats">
                      <span>{r.total_bets ?? 0} apostas</span>
                      <span>·</span>
                      <span title="Aproveitamento de pontos">{aproveitamento(r) ?? '—'}% aproveito</span>
                      <span>·</span>
                      <span title="% resultado correto">{pctResultado(r) ?? '—'}% res.</span>
                      <span>·</span>
                      <span title="% exatos">{pctExato(r) ?? '—'}% exato</span>
                    </div>
                  </div>

                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--accent)', textAlign: 'right', fontWeight: 700 }}>
                    {r.total_points}
                  </span>
                  <span className="ranking-col-hide" style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)', textAlign: 'right' }}>
                    {r.total_bets ?? 0}
                  </span>
                  <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                    {(() => { const v = aproveitamento(r); return v !== null
                      ? <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, fontWeight: 700, color: v >= 60 ? 'var(--win)' : v >= 30 ? 'var(--accent)' : 'var(--text-3)' }}>{v}%</span>
                      : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>—</span> })()}
                  </div>
                  <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                    {(() => { const v = pctResultado(r); return v !== null
                      ? <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: v >= 60 ? 'var(--win)' : v >= 35 ? 'var(--accent)' : 'var(--text-3)' }}>{v}%</span>
                      : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>—</span> })()}
                  </div>
                  <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                    {(() => { const v = pctExato(r); return v !== null
                      ? <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: v >= 40 ? 'var(--win)' : v >= 15 ? 'var(--accent)' : 'var(--text-3)' }}>{v}%</span>
                      : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>—</span> })()}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Sistema de Pontuação ─────────────────────────────────────── */}
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
            { pts: 0, label: 'Erro',              desc: 'Resultado errado' },
          ].map(rule => (
            <div key={rule.pts} className="rule-item">
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 28,
                color: rule.pts === 3 ? 'var(--accent)' : rule.pts === 1 ? 'var(--win)' : 'var(--text-4)',
                minWidth: 28, textAlign: 'center',
              }}>
                {rule.pts}
              </span>
              <div>
                <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 14 }}>{rule.label}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{rule.desc}</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 'var(--s3)', padding: 'var(--s3)', background: 'var(--bg-overlay)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div><strong style={{ color: 'var(--text-2)' }}>Aproveito</strong> = Pontos ÷ (Apostas × 3) — pontos conquistados vs pontos em jogo</div>
            <div><strong style={{ color: 'var(--text-2)' }}>% Resultado</strong> = (Exatos + Certos) ÷ Apostas — acertou o vencedor ou empate</div>
            <div><strong style={{ color: 'var(--text-2)' }}>% Exato</strong> = Exatos ÷ Apostas — acertou o placar completo</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── HighlightCard ─────────────────────────────────────────────────────────────
function HighlightCard({ icon, label, name, stat, sub, userId, accent }) {
  return (
    <Link
      to={userId ? `/usuarios/${userId}/historico` : '#'}
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--s2)',
        padding: 'var(--s4)',
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        border: `1px solid var(--border)`,
        borderTop: `3px solid ${accent}`,
        textDecoration: 'none',
        transition: 'border-color 0.15s',
        cursor: userId ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span style={{
          fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.1em', textTransform: 'uppercase', color: accent,
        }}>
          {label}
        </span>
      </div>
      <div style={{
        fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700,
        color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name || '—'}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: accent, lineHeight: 1 }}>
        {stat}
      </div>
      {sub && (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
          {sub}
        </div>
      )}
    </Link>
  )
}
