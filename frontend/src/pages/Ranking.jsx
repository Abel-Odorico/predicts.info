import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import MyChampionCard from '../components/MyChampionCard'
import LigaFlowModal from '../components/LigaFlowModal'
import ShareCompetitionButton from '../components/ShareCompetitionButton'
import { useAuth } from '../stores/authStore'
import { COMPETITIONS } from '../utils/competitions'

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
  const [expandedId,  setExpandedId]  = useState(null)
  const [expandedBets, setExpandedBets] = useState({}) // user_id -> { loading, bets }
  const [shareOpen,   setShareOpen]   = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [comp,        setComp]        = useState('copa2026')

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
    if (group && comp === 'copa2026') params.set('group', group)
    params.set('competition', comp)
    const { date_from, date_to } = period === 'custom'
      ? { date_from: dateFrom, date_to: dateTo }
      : periodToDates(period)
    if (date_from) params.set('date_from', date_from)
    if (date_to)   params.set('date_to',   date_to)
    const qs = params.toString()

    Promise.all([
      api.get(`/ranking${qs ? `?${qs}` : ''}`),
      api.get(`/ranking?${todayQS()}&competition=${comp}&limit=1`),
    ])
      .then(([main, today]) => {
        setData(main)
        setTodayTop(today?.[0] || null)
        setLastUpdated(new Date())
        if (silent) { setFlashUpdate(true); setTimeout(() => setFlashUpdate(false), 2500) }
      })
      .catch(console.error)
      .finally(() => { if (!silent) setLoad(false) })
  }, [group, period, dateFrom, dateTo, comp])

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

  const toggleExpand = useCallback((userId) => {
    setExpandedId(prev => {
      if (prev === userId) return null
      if (!expandedBets[userId]) {
        setExpandedBets(b => ({ ...b, [userId]: { loading: true, bets: [] } }))
        api.get(`/bets/users/${userId}`)
          .then(data => setExpandedBets(b => ({ ...b, [userId]: { loading: false, bets: data.bets || [] } })))
          .catch(() => setExpandedBets(b => ({ ...b, [userId]: { loading: false, bets: [] } })))
      }
      return userId
    })
  }, [expandedBets])

  function buildRankingShareText() {
    const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
    const periodLabel = PERIODS.find(p => p.id === period)?.label ?? 'Geral'
    const top5 = (compView ? compData : data).slice(0, 5)
      .map((r, i) => `${medal(i)} ${r.name} — ${r.total_points} pts (${r.exact_scores} 🎯)`)
      .join('\n')
    const label = compView && competition ? `Fase: ${competition.name}` : `Ranking ${periodLabel}`
    return `🏆 *Predicts.info — ${label}*\n\n${top5}\n\n⚽ Participe em https://predicts.info`
  }
  function copyRankingText() {
    navigator.clipboard.writeText(buildRankingShareText())
      .then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000) })
  }
  function shareRankingWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildRankingShareText())}`, '_blank')
  }

  return (
    <div className="page">
      <div className="fade-in-1" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <div>
          <h1 className="page-title">RANKING</h1>
          <p className="page-subtitle">Exato = 25 pts · Vencedor+gols = 18 · Saldo = 15 · Perdedor = 12 · Resultado = 10 · Campeão = +100 · Vice = +50</p>
          {lastUpdated && (
            <span className={`ranking-live-badge${flashUpdate ? ' ranking-live-badge--flash' : ''}`} style={{ marginTop: 4, display: 'inline-block' }}>
              🟢 atualizado {relUpdated()}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShareOpen(o => !o)}
          style={{ padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, flexShrink: 0 }}
        >
          📤 Compartilhar
        </button>
      </div>

      {shareOpen && (
        <div className="card fade-in-1" style={{ padding: 'var(--s4) var(--s5)', borderLeft: '3px solid var(--accent)', marginTop: 'var(--s4)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>Compartilhar Ranking</div>
          <pre style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-1)', background: 'var(--bg-overlay)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
            {buildRankingShareText()}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={shareRankingWhatsApp} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: '#25D366', color: '#fff' }}>
              <svg style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              WhatsApp
            </button>
            <button onClick={copyRankingText} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: shareCopied ? 'var(--win)' : 'var(--bg-raised)', color: shareCopied ? '#fff' : 'var(--text-1)', transition: 'all .2s' }}>
              {shareCopied ? '✓ Copiado!' : '📋 Copiar texto'}
            </button>
            {navigator.share && (
              <button onClick={() => navigator.share({ title: 'Ranking Predicts', text: buildRankingShareText() })} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--bg-raised)', color: 'var(--text-2)', fontSize: 16 }}>
                ↗
              </button>
            )}
          </div>
        </div>
      )}

      <div className="phase-nav fade-in-1" style={{ margin: 'var(--s4) 0' }}>
        {COMPETITIONS.filter(c => c.id !== 'geral').map(c => (
          <button
            key={c.id}
            type="button"
            className={`phase-nav__tab ${comp === c.id ? 'active' : ''}`}
            onClick={() => setComp(c.id)}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {comp === 'copa2026' && <MyChampionCard compact />}

      {/* ── Switcher Geral / Fase ─────────────────────────────────────── */}
      {comp === 'copa2026' && competition && (
        <div className="rank-segctrl" role="tablist" aria-label="Navegação de ranking" style={{ '--active-index': compView ? 1 : 0 }}>
          <div className="rank-segctrl__thumb" aria-hidden="true" />
          <button
            type="button"
            role="tab"
            aria-selected={!compView}
            className={`rank-segctrl__item${!compView ? ' rank-segctrl__item--active' : ''}`}
            onClick={() => setCompView(false)}
          >
            <span className="rank-segctrl__icon" aria-hidden="true">🏆</span>
            <span className="rank-segctrl__label">Ranking Geral</span>
            {data.length > 0 && <span className="rank-segctrl__badge">{data.length}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={compView}
            className={`rank-segctrl__item${compView ? ' rank-segctrl__item--active' : ''}`}
            onClick={() => setCompView(true)}
          >
            <span className="rank-segctrl__icon" aria-hidden="true">⚡</span>
            <span className="rank-segctrl__label">{competition.name}</span>
            {compData.length > 0 && <span className="rank-segctrl__badge">{compData.length}</span>}
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
              <div style={{ marginTop: 12 }}>
                <ShareCompetitionButton competition={competition} size="sm" />
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

                {/* Tabela completa — mesma estrutura do ranking geral */}
                <div className="card fade-in-2" style={{ border: `1px solid rgba(232,196,74,0.2)` }}>
                  <div className="card__header">
                    <span className="section-title" style={{ margin: 0, border: 'none', padding: 0, color: AMBER }}>
                      ⚡ Classificação da Fase
                    </span>
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>
                      {compData.length} predictor{compData.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Header */}
                  <div className="ranking-head" style={{ padding: '6px var(--s4)' }}>
                    <span className="rk-h" style={{ textAlign: 'center' }}>#</span>
                    <span className="rk-h">Predictor</span>
                    <span className="rk-h" style={{ textAlign: 'right' }}>Pts</span>
                    <span className="rk-h ranking-col-hide" style={{ textAlign: 'right' }}>Palpites</span>
                    <span className="rk-h ranking-col-hide" style={{ textAlign: 'right' }}>🎯 Exatos</span>
                    <span className="rk-h ranking-col-hide" style={{ textAlign: 'right' }}>Aprov.</span>
                    <span className="rk-h ranking-col-hide" style={{ textAlign: 'right' }}>% Res.</span>
                  </div>

                  {/* Rows */}
                  {compData.map((r, i) => {
                    const podiumClass = i === 0 ? 'ranking-row--gold' : i === 1 ? 'ranking-row--silver' : i === 2 ? 'ranking-row--bronze' : ''
                    const leaderPts   = compData[0]?.total_points || 1
                    const gapLeader   = (compData[0]?.total_points ?? 0) - r.total_points
                    const cp          = comp === 'copa2026' ? champPicks[r.user_id] : null
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
                          {/* Barra relativa ao líder — âmbar */}
                          <div style={{ height: 3, background: 'var(--bg-overlay)', borderRadius: 2, marginTop: 3, overflow: 'hidden', maxWidth: 140 }}>
                            <div style={{
                              height: '100%',
                              width: `${(r.total_points / leaderPts) * 100}%`,
                              background: i === 0 ? AMBER : i === 1 ? 'var(--text-2)' : i === 2 ? 'var(--win)' : 'var(--border-accent)',
                              borderRadius: 2, transition: 'width 600ms ease',
                            }} />
                          </div>
                          {cp && (cp.champion || cp.runner_up) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                              {cp.champion && (
                                <span title={`🏆 Campeão: ${cp.champion.name}`} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                  <img src={cp.champion.flag} alt={cp.champion.code} style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 2 }} />
                                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: AMBER }}>🏆</span>
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
                          <div className="ranking-row__mobile-stats">
                            <span>{r.total_bets ?? 0} palp.</span>
                            <span>·</span>
                            <span style={{ color: 'var(--win)' }}>✓{acertos(r)}</span>
                            <span style={{ color: 'var(--lose)' }}>✗{erros(r)}</span>
                            <span>·</span>
                            <span>🎯{r.exact_scores ?? 0}</span>
                            <span>·</span>
                            <span>{aproveitamento(r) ?? '—'}% aprov.</span>
                            {i > 0 && <><span>·</span><span>−{gapLeader} líder</span></>}
                          </div>
                        </div>

                        {/* Pts */}
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: AMBER, fontWeight: 700, lineHeight: 1 }}>
                            {r.total_points}
                          </div>
                          {i > 0 && gapLeader > 0 && (
                            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>−{gapLeader}</div>
                          )}
                        </div>

                        {/* Palpites */}
                        <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>{r.total_bets ?? 0}</div>
                          {r.total_bets > 0 && (
                            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, marginTop: 3 }}>
                              <span style={{ color: 'var(--win)' }}>✓{acertos(r)}</span>{' '}
                              <span style={{ color: 'var(--lose)' }}>✗{erros(r)}</span>
                            </div>
                          )}
                        </div>

                        {/* Exatos */}
                        <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: r.exact_scores ? AMBER : 'var(--text-4)' }}>
                            {r.exact_scores ?? 0}
                          </div>
                          {r.total_bets > 0 && (
                            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginTop: 3 }}>{pctExato(r) ?? 0}%</div>
                          )}
                        </div>

                        {/* Aproveitamento */}
                        <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                          {(() => { const v = aproveitamento(r); return v !== null
                            ? <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: v >= 60 ? 'var(--win)' : v >= 30 ? AMBER : 'var(--text-3)' }}>{v}%</span>
                            : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>—</span> })()}
                        </div>

                        {/* % Resultado */}
                        <div className="ranking-col-hide" style={{ textAlign: 'right' }}>
                          {(() => { const v = pctResultado(r); return v !== null
                            ? <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: v >= 60 ? 'var(--win)' : v >= 35 ? AMBER : 'var(--text-3)' }}>{v}%</span>
                            : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>—</span> })()}
                        </div>
                      </Link>
                    )
                  })}
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
        <>
        <RankingPodium data={data} champPicks={comp === 'copa2026' ? champPicks : {}} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--s3)', marginTop: 'var(--s4)' }} className="fade-in-2">
          <HighlightCard
            icon="👑" label="Líder Geral"
            name={leader?.name}
            stat={`${leader?.total_points ?? 0} pts`}
            sub={leader ? `${leader.total_bets} palpites · ${aproveitamento(leader) ?? 0}% aproveito` : ''}
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
        </>
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

          {comp === 'copa2026' && <div>
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
          </div>}

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
              const cp = comp === 'copa2026' ? champPicks[r.user_id] : null
              const isExpanded = expandedId === r.user_id
              const aprv = aproveitamento(r)
              const errosR = Math.max(0, (r.total_bets || 0) - acertos(r))

              return (
                <div key={r.user_id}>
                  <div
                    className={`ranking-row fade-in ${podiumClass}`}
                    onClick={() => toggleExpand(r.user_id)}
                    style={{ animationDelay: `${i * 30}ms`, borderLeft: i < 3 ? undefined : '3px solid transparent', cursor: 'pointer', userSelect: 'none', background: isExpanded ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-raised))' : undefined }}
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

                    {/* Pts + gap + expand indicator */}
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--accent)', fontWeight: 700, lineHeight: 1 }}>
                        {r.total_points}
                      </div>
                      {i > 0 && gapLeader > 0 && (
                        <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)' }} title="Diferença pro líder">
                          −{gapLeader}
                        </div>
                      )}
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', lineHeight: 1, marginTop: 2 }}>{isExpanded ? '▲' : '▼'}</div>
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
                  </div>

                  {/* ── Expanded row ── */}
                  {isExpanded && (
                    <div className="fade-in-1" style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-raised)', padding: 'var(--s3) var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
                      {/* Stats resumo */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                        {[
                          { icon: '🎯', label: 'Exatos',  val: r.exact_scores, color: 'var(--win)' },
                          { icon: '✅', label: 'Certos',  val: acertos(r) - r.exact_scores, color: 'var(--accent)' },
                          { icon: '❌', label: 'Erros',   val: errosR, color: 'var(--lose)' },
                          { icon: '📝', label: 'Total',   val: r.total_bets, color: 'var(--text-2)' },
                          { icon: '📊', label: 'Aprov.',  val: aprv !== null ? `${aprv}%` : '–', color: aprv !== null && aprv >= 50 ? 'var(--win)' : 'var(--text-2)' },
                        ].map(s => (
                          <div key={s.label} style={{ textAlign: 'center', padding: '6px 4px', borderRadius: 8, background: 'var(--bg-surface)' }}>
                            <div style={{ fontFamily: 'var(--font-data)', fontSize: 15, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
                            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-3)', marginTop: 2 }}>{s.icon} {s.label}</div>
                          </div>
                        ))}
                      </div>

                      {/* Lista de palpites */}
                      <BetsList entry={expandedBets[r.user_id]} />

                      {/* Footer */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)' }}>
                          {i === 0
                            ? <span style={{ color: 'var(--win)', fontWeight: 700 }}>👑 Líder Geral</span>
                            : gapLeader === 0
                              ? <span style={{ color: 'var(--win)', fontWeight: 700 }}>= empatado com {data[0].name}</span>
                              : <>−<strong style={{ color: 'var(--text-1)' }}>{gapLeader} pts</strong> para {data[0].name}</>
                          }
                        </span>
                        <Link
                          to={`/usuarios/${r.user_id}/historico`}
                          onClick={e => e.stopPropagation()}
                          style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: 'var(--bg-overlay)', color: 'var(--accent)', border: '1px solid var(--accent)', textDecoration: 'none' }}
                        >
                          📜 Histórico completo
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
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

// ── RankingPodium ─────────────────────────────────────────────────────────────
function _initials(name) {
  return (name || '').split(' ').filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function RankingPodium({ data, champPicks }) {
  const top3 = data.slice(0, 3)
  if (!top3.length) return null
  // CSS order: slot--2 (left), slot--1 (center/gold), slot--3 (right)
  const SLOT = { 0: 'group-podium__slot--1', 1: 'group-podium__slot--2', 2: 'group-podium__slot--3' }
  const MEDAL = ['🥇', '🥈', '🥉']
  return (
    <div className="card fade-in-2" style={{ marginTop: 'var(--s6)', padding: '0 0 var(--s4)', overflow: 'hidden' }}>
      <div style={{ padding: 'var(--s3) var(--s4) 0', fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        🏆 Pódio
      </div>
      <div className="group-podium">
        {top3.map((r, i) => {
          const cp = champPicks?.[r.user_id]
          return (
            <div key={r.user_id} className={`group-podium__slot ${SLOT[i]}`}>
              <div className="group-podium__avatar">{_initials(r.name)}</div>
              <div className="group-podium__medal">{MEDAL[i]}</div>
              <div className="group-podium__name" title={r.name}>{r.name}</div>
              <div className="group-podium__pts">{r.total_points} pts</div>
              {cp?.champion && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                  <img src={cp.champion.flag} alt={cp.champion.code} style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 2 }} />
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 8, color: '#e8a030' }}>🏆</span>
                </div>
              )}
              <div className="group-podium__platform" />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── BetsList ──────────────────────────────────────────────────────────────────
function betStatus(bet) {
  // Usa o campo `result` da API (exact/correct/wrong), não o valor absoluto dos
  // pontos — assim fica imune a mudança de escala da pontuação (V1/V2/futuras).
  const evaluated = bet.official_score_a !== null && bet.official_score_a !== undefined
  if (!evaluated || bet.result == null) {
    return { label: 'Pendente', icon: '⏳', color: 'var(--text-4)' }
  }
  if (bet.result === 'exact') {
    return { label: `Exato +${bet.points_earned ?? 0}`, icon: '🎯', color: 'var(--win)' }
  }
  if (bet.result === 'correct') {
    return { label: `Certo +${bet.points_earned ?? 0}`, icon: '✅', color: 'var(--accent)' }
  }
  return { label: 'Errou', icon: '❌', color: 'var(--lose)' }
}

function BetsList({ entry }) {
  if (!entry) return null
  if (entry.loading) return (
    <div style={{ textAlign: 'center', padding: '10px 0', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>Carregando palpites…</div>
  )
  if (!entry.bets.length) return (
    <div style={{ textAlign: 'center', padding: '8px 0', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>Sem palpites registrados.</div>
  )

  const _dk = md => {
    if (!md) return '?'
    const d = new Date(md.endsWith('Z') ? md : md + 'Z')
    return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  }
  const _dl = key => {
    if (key === '?') return '—'
    const d = new Date(key + 'T12:00:00')
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    if (key === todayKey) return 'Hoje'
    const dow = d.toLocaleDateString('pt-BR', { weekday: 'short' })
    const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    return `${dow.charAt(0).toUpperCase() + dow.slice(1)}, ${date}`
  }
  const groupByDay = (bets, desc = false) => {
    const sorted = [...bets].sort((a, b) => {
      const ta = new Date(a.match_date || 0)
      const tb = new Date(b.match_date || 0)
      return desc ? tb - ta : ta - tb
    })
    const days = []
    let lastK = null
    sorted.forEach(b => {
      const k = _dk(b.match_date)
      if (k !== lastK) { days.push({ key: k, bets: [] }); lastK = k }
      days[days.length - 1].bets.push(b)
    })
    return days
  }

  const BetRow = ({ bet }) => {
    const st = betStatus(bet)
    const hasResult = bet.official_score_a !== null && bet.official_score_a !== undefined
    const PHASE_SHORT = { r32: '16avos', r16: 'Oitavas', qf: 'Quartas', sf: 'Semi', '3rd': '3º', final: 'Final' }
    const tag = bet.group_name ? `Gr.${bet.group_name}` : (PHASE_SHORT[bet.phase] || bet.phase || '')
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center', padding: '5px 8px', borderRadius: 6, background: 'var(--bg-overlay)', fontSize: 12 }}>
        <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {bet.team_a_code} × {bet.team_b_code}
          {tag && <span style={{ color: 'var(--text-4)', fontWeight: 400, marginLeft: 4, fontSize: 10 }}>{tag}</span>}
        </div>
        <div style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 13, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{bet.hidden ? '🔒 apostou' : `${bet.score_a}–${bet.score_b}`}</div>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: hasResult ? 'var(--text-3)' : 'var(--text-4)', whiteSpace: 'nowrap' }}>
          {hasResult ? `(${bet.official_score_a}–${bet.official_score_b})` : '—'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <span title={st.label} style={{ fontSize: 12 }}>{st.icon}</span>
          {hasResult && <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, fontWeight: 700, color: st.color }}>{bet.points_earned > 0 ? `+${bet.points_earned}` : '0'}</span>}
        </div>
      </div>
    )
  }

  const DayHeader = ({ label, count, first }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--surface-2)', borderTop: first ? 'none' : '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginTop: first ? 0 : 4 }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginLeft: 'auto' }}>{count}</span>
    </div>
  )

  const realized = entry.bets.filter(b => b.official_score_a !== null && b.official_score_a !== undefined)
  const pending  = entry.bets.filter(b => b.official_score_a === null || b.official_score_a === undefined)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {pending.length > 0 && (
        <div style={{ marginBottom: realized.length ? 'var(--s3)' : 0 }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)', padding: '4px 8px 2px' }}>
            Pendentes ({pending.length})
          </div>
          {groupByDay(pending).map(({ key, bets: dayBets }, di) => (
            <div key={key}>
              <DayHeader label={_dl(key)} count={dayBets.length} first={di === 0} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
                {dayBets.map(b => <BetRow key={b.id} bet={b} />)}
              </div>
            </div>
          ))}
        </div>
      )}
      {realized.length > 0 && (
        <div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)', padding: '4px 8px 2px' }}>
            Realizados ({realized.length})
          </div>
          {groupByDay(realized, true).map(({ key, bets: dayBets }, di) => (
            <div key={key}>
              <DayHeader label={_dl(key)} count={dayBets.length} first={di === 0} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 2 }}>
                {dayBets.map(b => <BetRow key={b.id} bet={b} />)}
              </div>
            </div>
          ))}
        </div>
      )}
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
