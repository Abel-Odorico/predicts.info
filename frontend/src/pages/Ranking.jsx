import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import MyChampionCard from '../components/MyChampionCard'
import LigaFlowModal from '../components/LigaFlowModal'
import { useAuth } from '../stores/authStore'

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

const MIN_APROV_BETS = 5  // mínimo de palpites avaliados p/ entrar no ranking de aproveitamento

function aproveitamento(r) {
  if (!r.total_bets) return null
  return Math.round(r.total_points / (r.total_bets * 25) * 100)
}
function pctResultado(r) {
  if (!r.total_bets) return null
  return Math.round((r.exact_scores + r.correct_results) / r.total_bets * 100)
}
function pctExato(r) {
  if (!r.total_bets) return null
  return Math.round(r.exact_scores / r.total_bets * 100)
}
function acertos(r) {
  return (r.exact_scores || 0) + (r.correct_results || 0)
}
function erros(r) {
  return Math.max(0, (r.total_bets || 0) - acertos(r))
}

export default function Ranking() {
  const { token } = useAuth()
  const [data,        setData]      = useState([])
  const [todayTop,    setTodayTop]  = useState(null)
  const [loading,     setLoad]      = useState(true)
  const [group,       setGroup]     = useState('')
  const [period,      setPeriod]    = useState('all')
  const [dateFrom,    setDateFrom]  = useState('')
  const [dateTo,      setDateTo]    = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [flashUpdate, setFlashUpdate] = useState(false)
  const [champPicks,  setChampPicks]  = useState({})
  const [allPicks,    setAllPicks]    = useState([])
  const [showLiga,    setShowLiga]    = useState(false)
  const [competition, setCompetition] = useState(null)  // competição ativa
  const [compView,    setCompView]    = useState(false)  // true = vendo ranking da fase
  const [compData,    setCompData]    = useState([])
  const [compLoad,    setCompLoad]    = useState(false)

  useEffect(() => {
    api.get('/champion/picks/all')
      .then(rows => {
        setAllPicks(rows)
        setChampPicks(Object.fromEntries(rows.map(r => [r.user_id, r])))
      })
      .catch(() => {})
    api.get('/competition/active')
      .then(c => setCompetition(c || null))
      .catch(() => {})
  }, [])

  // Carrega ranking da fase quando entra na aba
  useEffect(() => {
    if (!compView || !competition) return
    setCompLoad(true)
    const start = competition.start_date.slice(0, 10)
    const end   = competition.end_date ? competition.end_date.slice(0, 10) : ''
    const qs    = `date_from=${start}${end ? `&date_to=${end}` : ''}&limit=100`
    api.get(`/ranking?${qs}`)
      .then(rows => setCompData(rows))
      .catch(() => setCompData([]))
      .finally(() => setCompLoad(false))
  }, [compView, competition])

  const loadSilent = useCallback((silent = false) => {
    if (!silent) setLoad(true)
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
        setLastUpdated(new Date())
        if (silent) { setFlashUpdate(true); setTimeout(() => setFlashUpdate(false), 2500) }
      })
      .catch(console.error)
      .finally(() => { if (!silent) setLoad(false) })
  }, [group, period, dateFrom, dateTo])

  useEffect(() => { loadSilent(false) }, [loadSilent])

  // Auto-refresh every 30s silently
  useEffect(() => {
    const iv = setInterval(() => loadSilent(true), 30000)
    return () => clearInterval(iv)
  }, [loadSilent])

  const isFiltered = group || period !== 'all'

  // Destaques derivados do ranking geral
  const leader      = data[0] || null
  const reiExatos   = data.length ? [...data].sort((a,b) => b.exact_scores - a.exact_scores)[0] : null
  const maisAtivo   = data.length ? [...data].sort((a,b) => b.total_bets   - a.total_bets  )[0] : null
  const topAcerto   = data.length
    ? [...data].filter(r => r.total_bets >= MIN_APROV_BETS).sort((a,b) => (aproveitamento(b)||0) - (aproveitamento(a)||0))[0]
    : null

  function relUpdated() {
    if (!lastUpdated) return ''
    const s = Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
    if (s < 5)  return 'agora'
    if (s < 60) return `há ${s}s`
    return `há ${Math.floor(s/60)}min`
  }

  return (
    <div className="page">
      <div className="fade-in-1" style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--s4)' }}>
        <div>
          <h1 className="page-title">RANKING</h1>
          <p className="page-subtitle">Exato = 25 pts · Vencedor+gols = 18 · Saldo = 15 · Perdedor = 12 · Resultado = 10 · Campeão = +100 · Vice = +50</p>
        </div>
        {lastUpdated && (
          <span className={`ranking-live-badge${flashUpdate ? ' ranking-live-badge--flash' : ''}`}>
            🟢 atualizado {relUpdated()}
          </span>
        )}
      </div>

      <MyChampionCard compact />

      {/* ── Switcher Geral / Fase ─────────────────────────────────────── */}
      {competition && (
        <div style={{ display: 'flex', gap: 6, margin: '14px 0 4px', background: 'var(--bg-overlay)', borderRadius: 10, padding: 4 }}>
          <button
            onClick={() => setCompView(false)}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: !compView ? 'var(--bg-surface)' : 'transparent',
              boxShadow: !compView ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
              fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
              color: !compView ? 'var(--text-1)' : 'var(--text-4)', transition: 'all 150ms',
            }}
          >
            🏆 Ranking Geral
          </button>
          <button
            onClick={() => setCompView(true)}
            style={{
              flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: compView ? 'var(--bg-surface)' : 'transparent',
              boxShadow: compView ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
              fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
              color: compView ? 'var(--accent)' : 'var(--text-4)', transition: 'all 150ms',
            }}
          >
            ⚡ {competition.name}
          </button>
        </div>
      )}

      {/* ── Ranking da Fase ───────────────────────────────────────────── */}
      {compView && competition && (() => {
        const AMBER = '#e8c44a'
        const cLeader    = compData[0] || null
        const cReiExatos = compData.length ? [...compData].sort((a,b) => b.exact_scores - a.exact_scores)[0] : null
        const cMaisAtivo = compData.length ? [...compData].sort((a,b) => b.total_bets   - a.total_bets  )[0] : null
        const cTopAcerto = compData.length
          ? [...compData].filter(r => r.total_bets >= MIN_APROV_BETS).sort((a,b) => (aproveitamento(b)||0) - (aproveitamento(a)||0))[0]
          : null
        return (
          <div className="fade-in-1">
            {/* Banner âmbar */}
            <div style={{
              margin: '8px 0 14px', padding: '14px 16px',
              background: 'linear-gradient(135deg,rgba(232,196,74,0.14) 0%,rgba(232,196,74,0.04) 100%)',
              border: `1.5px solid rgba(232,196,74,0.35)`, borderRadius: 12,
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: AMBER, letterSpacing: '0.04em', marginBottom: 4 }}>
                ⚡ {competition.name}
              </div>
              {competition.description && (
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
                  {competition.description}
                </div>
              )}
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-4)', marginTop: 6 }}>
                Palpites a partir de {new Date(competition.start_date + 'Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                {competition.end_date && ` · até ${new Date(competition.end_date + 'Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`}
              </div>
            </div>

            {compLoad ? (
              <div style={{ textAlign: 'center', padding: 24, fontFamily: 'var(--font-cond)', color: 'var(--text-4)' }}>Carregando...</div>
            ) : compData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, fontFamily: 'var(--font-cond)', color: 'var(--text-4)', fontSize: 14 }}>
                Nenhum palpite desta fase ainda.<br />
                <span style={{ fontSize: 12, color: 'var(--text-5)' }}>
                  Começa em {new Date(competition.start_date + 'Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                </span>
              </div>
            ) : (
              <>
                {/* Cards de destaque — tema âmbar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s6)' }} className="fade-in-2">
                  <HighlightCard icon="👑" label="Líder da Fase"        name={cLeader?.name}    stat={`${cLeader?.total_points ?? 0} pts`}               sub={cLeader    ? `${cLeader.exact_scores} exatos · ${aproveitamento(cLeader) ?? 0}% aproveito` : ''} userId={cLeader?.user_id}    accent={AMBER} />
                  <HighlightCard icon="🎯" label="Rei dos Exatos"       name={cReiExatos?.name} stat={`${cReiExatos?.exact_scores ?? 0} placares exatos`} sub={cReiExatos  ? `${pctExato(cReiExatos) ?? 0}% de exatidão · ${cReiExatos.total_bets} apostas` : ''} userId={cReiExatos?.user_id} accent="#e8944a" />
                  <HighlightCard icon="🔥" label="Mais Ativo"           name={cMaisAtivo?.name} stat={`${cMaisAtivo?.total_bets ?? 0} apostas`}           sub={cMaisAtivo  ? `${cMaisAtivo.total_points} pts · ${aproveitamento(cMaisAtivo) ?? 0}% aproveito` : ''} userId={cMaisAtivo?.user_id} accent="#e86a4a" />
                  <HighlightCard icon="📈" label="Melhor Aproveitamento" name={cTopAcerto?.name || '—'} stat={cTopAcerto ? `${aproveitamento(cTopAcerto) ?? 0}% aproveito` : `mín. ${MIN_APROV_BETS} palpites`} sub={cTopAcerto ? `${cTopAcerto.total_points} pts em ${cTopAcerto.total_bets} palpites` : `Ninguém com ${MIN_APROV_BETS}+ palpites`} userId={cTopAcerto?.user_id} accent="#c4e84a" />
                </div>

                {/* Tabela */}
                <div className="ranking-table fade-in-2" style={{ '--rk-accent': AMBER }}>
                  <div className="ranking-head">
                    <span>#</span><span>Predictor</span><span>Pts</span><span>Palpites</span><span>Exatos</span><span>Aprov.</span>
                  </div>
                  {compData.map((r, i) => (
                    <div key={r.user_id} className={`ranking-row${i < 3 ? ` ranking-row--top${i+1}` : ''}`}>
                      <span className="rk-pos">{i + 1}</span>
                      <span className="rk-name">{r.name}</span>
                      <span className="rk-pts" style={{ color: AMBER }}>{r.total_points}</span>
                      <span className="rk-bets">{r.total_bets}</span>
                      <span className="rk-exact">{r.exact_scores}</span>
                      <span className="rk-aprov">
                        {r.total_bets > 0 ? `${Math.round(r.total_points / (r.total_bets * 25) * 100)}%` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* ── Cards de destaque (só no ranking geral) ─────────────────────── */}
      {!compView && (
      <div>
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
          <HighlightCard
            icon="📈" label="Melhor Aproveitamento"
            name={topAcerto?.name || '—'}
            stat={topAcerto ? `${aproveitamento(topAcerto) ?? 0}% aproveito` : `mín. ${MIN_APROV_BETS} palpites`}
            sub={topAcerto
              ? `${topAcerto.total_points} pts em ${topAcerto.total_bets} palpites`
              : `Ninguém com ${MIN_APROV_BETS}+ palpites ainda`}
            userId={topAcerto?.user_id}
            accent="#23b26d"
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
              <span className="rk-h" style={{ textAlign: 'center' }}>#</span>
              <span className="rk-h">Jogador</span>
              <span className="rk-h" style={{ textAlign: 'right' }} title="Pontos totais · diferença pro líder">Pts</span>
              <span className="rk-h ranking-col-hide" style={{ textAlign: 'right' }} title="Palpites avaliados · ✓ acertos / ✗ erros">Palpites</span>
              <span className="rk-h ranking-col-hide" style={{ textAlign: 'right' }} title="Placares exatos cravados · % do total">🎯 Exatos</span>
              <span className="rk-h ranking-col-hide" style={{ textAlign: 'right' }} title="Pontos ÷ máximo possível (apostas × 25)">Aprov.</span>
              <span className="rk-h ranking-col-hide" style={{ textAlign: 'right' }} title="Acertou vencedor ou empate ÷ apostas">% Res.</span>
            </div>

            {/* Rows */}
            {data.map((r, i) => {
              const podiumClass = i === 0 ? 'ranking-row--gold' : i === 1 ? 'ranking-row--silver' : i === 2 ? 'ranking-row--bronze' : ''
              const leaderPts = data[0]?.total_points || 1
              const gapLeader = (data[0]?.total_points ?? 0) - r.total_points
              const cp = champPicks[r.user_id]

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
                    {/* Picks de campeão */}
                    {cp && (cp.champion || cp.runner_up) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        {cp.champion && (
                          <span title={`🏆 Campeão: ${cp.champion.name}`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <img src={cp.champion.flag} alt={cp.champion.code} style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 2 }} />
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--accent)' }}>🏆</span>
                          </span>
                        )}
                        {cp.runner_up && (
                          <span title={`🥈 Vice: ${cp.runner_up.name}`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <img src={cp.runner_up.flag} alt={cp.runner_up.code} style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 2 }} />
                            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: '#d4af37' }}>🥈</span>
                          </span>
                        )}
                      </div>
                    )}
                    {/* Resumo visível só no mobile */}
                    <div className="ranking-row__mobile-stats">
                      <span>{r.total_bets ?? 0} palp.</span>
                      <span>·</span>
                      <span style={{ color: 'var(--win)' }} title="Acertos">✓{acertos(r)}</span>
                      <span style={{ color: 'var(--lose)' }} title="Erros">✗{erros(r)}</span>
                      <span>·</span>
                      <span title="Placares exatos">🎯{r.exact_scores ?? 0}</span>
                      <span>·</span>
                      <span title="Aproveitamento de pontos">{aproveitamento(r) ?? '—'}% aprov.</span>
                      {i > 0 && <><span>·</span><span title="Diferença pro líder">−{gapLeader} líder</span></>}
                    </div>
                  </div>

                  {/* Pts + gap pro líder */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--accent)', fontWeight: 700, lineHeight: 1 }}>
                      {r.total_points}
                    </div>
                    {i > 0 && gapLeader > 0 && (
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }} title="Diferença pro líder">
                        −{gapLeader}
                      </div>
                    )}
                  </div>

                  {/* Palpites + acertos/erros */}
                  <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
                      {r.total_bets ?? 0}
                    </div>
                    {r.total_bets > 0 && (
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, marginTop: 3 }}>
                        <span style={{ color: 'var(--win)' }} title="Acertos">✓{acertos(r)}</span>{' '}
                        <span style={{ color: 'var(--lose)' }} title="Erros">✗{erros(r)}</span>
                      </div>
                    )}
                  </div>

                  {/* Exatos (nº + %) */}
                  <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: r.exact_scores ? 'var(--accent)' : 'var(--text-4)' }}>
                      {r.exact_scores ?? 0}
                    </div>
                    {r.total_bets > 0 && (
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>
                        {pctExato(r) ?? 0}%
                      </div>
                    )}
                  </div>

                  {/* Aproveitamento */}
                  <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                    {(() => { const v = aproveitamento(r); return v !== null
                      ? <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: v >= 60 ? 'var(--win)' : v >= 30 ? 'var(--accent)' : 'var(--text-3)' }}>{v}%</span>
                      : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>—</span> })()}
                  </div>

                  {/* % Resultado */}
                  <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                    {(() => { const v = pctResultado(r); return v !== null
                      ? <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: v >= 60 ? 'var(--win)' : v >= 35 ? 'var(--accent)' : 'var(--text-3)' }}>{v}%</span>
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
            { pts: 25,   label: 'Placar exato',               desc: 'Acertou o placar completo (ex: 2×1 = 2×1)', color: 'var(--accent)' },
            { pts: 18,   label: 'Vencedor + gols do vencedor', desc: 'Resultado 3×1 · Palpite 3×0',              color: 'var(--win)' },
            { pts: 15,   label: 'Vencedor + saldo de gols',    desc: 'Resultado 3×1 · Palpite 2×0',              color: 'var(--win)' },
            { pts: 12,   label: 'Vencedor + gols do perdedor', desc: 'Resultado 3×1 · Palpite 2×1',              color: 'var(--win)' },
            { pts: 10,   label: 'Acertou resultado',           desc: 'Vencedor ou empate — gols errados',         color: 'var(--amber, #d4af37)' },
            { pts: 0,    label: 'Erro',                        desc: 'Acertou vencedor errado',                   color: 'var(--text-4)' },
            { pts: '+100', label: 'Palpite de campeão',        desc: 'Acertou o campeão da Copa — bônus final',  color: 'var(--accent)' },
            { pts: '+50',  label: 'Palpite de vice-campeão',   desc: 'Acertou o vice-campeão — bônus final',     color: 'var(--amber, #d4af37)' },
          ].map(rule => (
            <div key={rule.label} className="rule-item">
              <span style={{
                fontFamily: 'var(--font-display)', fontSize: 24,
                color: rule.color,
                minWidth: 32, textAlign: 'center',
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
            <div><strong style={{ color: 'var(--text-2)' }}>Aproveito</strong> = Pontos ÷ (Apostas × 25) — pontos conquistados vs máximo possível</div>
            <div><strong style={{ color: 'var(--text-2)' }}>% Resultado</strong> = (Exatos + Certos) ÷ Apostas — acertou o vencedor ou empate</div>
            <div><strong style={{ color: 'var(--text-2)' }}>% Exato</strong> = Exatos ÷ Apostas — acertou o placar completo</div>
          </div>
        </div>
      </div>

      {/* ── Palpites de Campeão ────────────────────────────────────────── */}
      {allPicks.length > 0 && (
        <div className="card mt-6 fade-in-4">
          <div className="card__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              🏆 Palpites de Campeão
            </span>
            <Link to="/campeao" style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)' }}>
              Fazer seu palpite →
            </Link>
          </div>
          <div className="card__body" style={{ padding: 0 }}>
            {allPicks.map((p, i) => (
              <div key={p.user_id} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) 1fr 1fr',
                gap: 8,
                padding: '10px var(--s4)',
                borderBottom: i < allPicks.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
              }}>
                <Link to={`/usuarios/${p.user_id}/historico`} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600,
                  color: 'var(--text-1)', textDecoration: 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {p.user_name}
                </Link>
                {p.champion ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <img src={p.champion.flag} alt={p.champion.code} style={{ width: 24, height: 17, objectFit: 'cover', borderRadius: 2 }} />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-1)', fontWeight: 600 }}>{p.champion.code}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>+100</span>
                  </div>
                ) : (
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic' }}>—</span>
                )}
                {p.runner_up ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <img src={p.runner_up.flag} alt={p.runner_up.code} style={{ width: 24, height: 17, objectFit: 'cover', borderRadius: 2 }} />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-1)', fontWeight: 600 }}>{p.runner_up.code}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#d4af37' }}>+50</span>
                  </div>
                ) : (
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic' }}>—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      </div>
      )}

      {/* CTA Liga Privada */}
      <div style={{
        margin: '24px 0 8px', padding: '18px 16px',
        background: 'linear-gradient(135deg, rgba(15,122,120,0.10) 0%, rgba(15,122,120,0.04) 100%)',
        border: '1.5px solid rgba(15,122,120,0.25)', borderRadius: 14,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <span style={{ fontSize: 32, flexShrink: 0 }}>🏆</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--accent)', letterSpacing: '0.05em' }}>
            QUER VER O RANKING DA SUA TURMA?
          </div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.5 }}>
            Crie uma liga privada, convide seus amigos e dispute separado do ranking geral.
          </div>
        </div>
        {token ? (
          <button
            type="button"
            onClick={() => setShowLiga(true)}
            style={{
              flexShrink: 0, padding: '9px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: 'var(--accent)', color: '#fff',
              fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >
            Criar liga
          </button>
        ) : (
          <Link
            to="/login"
            style={{
              flexShrink: 0, padding: '9px 16px', borderRadius: 9, textDecoration: 'none',
              background: 'var(--accent)', color: '#fff',
              fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
            }}
          >
            Entrar
          </Link>
        )}
      </div>

      {showLiga && <LigaFlowModal token={token} onClose={() => setShowLiga(false)} />}
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
