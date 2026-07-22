import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api, CONF_HEX, heatClass } from '../api'
import Spinner from '../components/Spinner'
import { PT_NAMES } from '../utils/teamNames'
import { COMPETITIONS as ALL_COMPETITIONS } from '../utils/competitions'
import TeamCrestFlag from '../components/TeamCrestFlag'

const COMPETITIONS = ALL_COMPETITIONS.filter(c => c.id !== 'geral').map(c => ({ id: c.id, label: `${c.emoji} ${c.label}` }))

function CompNav({ comp, setComp }) {
  return (
    <div className="phase-nav mt-4" style={{ marginBottom: 0 }}>
      {COMPETITIONS.map(c => (
        <button
          key={c.id}
          type="button"
          className={`phase-nav__tab ${comp === c.id ? 'active' : ''}`}
          onClick={() => setComp(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

// Brasileirão é pontos corridos, sem chaveamento mata-mata — não tem
// equivalente aqui. Redireciona pra tabela/projeção em /brasileirao em vez
// de fingir um bracket que não existe.
function BrasileiraoRedirect({ comp, setComp }) {
  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">CHAVEAMENTO</h1>
        <p className="page-subtitle">Fase eliminatória</p>
      </div>
      <CompNav comp={comp} setComp={setComp} />
      <div className="card mt-6 fade-in-2" style={{ padding: 'var(--s6) var(--s5)', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
          🇧🇷 Brasileirão é disputado em pontos corridos — não tem mata-mata nem chaveamento.
          Título, G4 e rebaixamento são decididos pela tabela.
        </p>
        <Link to="/brasileirao" className="btn btn-primary btn-sm">Ver Tabela do Brasileirão</Link>
      </div>
    </div>
  )
}

const PHASES = [
  { key: 'prob_title',  label: 'Título' },
  { key: 'prob_final',  label: 'Final' },
  { key: 'prob_sf',     label: 'Semi' },
  { key: 'prob_qf',     label: 'Quartas' },
  { key: 'prob_r16',    label: 'Oitavas' },
  { key: 'prob_r32',    label: 'R32' },
  { key: 'prob_groups', label: 'Grupos' },
]

const SIM_OPTIONS = [
  { value: 10000,   label: '10K' },
  { value: 100000,  label: '100K' },
  { value: 500000,  label: '500K' },
  { value: 1000000, label: '1M' },
]

const CONF_ORDER = ['UEFA', 'CONMEBOL', 'CAF', 'AFC', 'CONCACAF', 'OFC']

export default function Tournament() {
  const [comp, setComp]       = useState('brasileirao2026')
  const [data, setData]       = useState(null)
  const [bracket, setBracket] = useState(null)
  const [loading, setLoad]    = useState(true)
  const [simN, setSimN]       = useState(100000)
  const [simLoading, setSimLoad] = useState(false)
  const [sortKey, setSort]    = useState('prob_title')
  const [sortDir, setDir]     = useState(1)   // 1 = desc (highest first), -1 = asc
  const [filter, setFilter]   = useState('')
  const [confFilter, setConf] = useState('')

  const [groups, setGroups] = useState(null)
  const [phases, setPhases] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    if (comp !== 'copa2026') { setLoad(false); return }
    Promise.allSettled([
      api.get(`/tournament/simulate?n=${simN}`),
      api.get('/tournament/official-bracket'),
      api.get('/groups'),
      api.get('/tournament/phases'),
    ]).then(([simR, brR, grR, phR]) => {
      if (simR.status === 'fulfilled') setData(simR.value)
      if (brR.status === 'fulfilled') setBracket(brR.value)
      if (grR.status === 'fulfilled') setGroups(grR.value.groups || {})
      if (phR.status === 'fulfilled') setPhases(phR.value)
    }).finally(() => setLoad(false))
  }, [comp])

  async function runSim(n) {
    setSimLoad(true)
    try {
      const sim = await api.get(`/tournament/simulate?n=${n}`)
      setData(sim)
    } catch (e) { console.error(e) }
    finally { setSimLoad(false) }
  }

  function changeN(n) {
    setSimN(n)
    runSim(n)
  }

  // Torneio encerrado: prob_title (e as outras colunas prob_*) virou binário
  // 100/0 pra quase todo mundo (só quem realmente chegou lá tem valor != 0) —
  // ordenar só por isso empata 47 das 48 seleções em 0% e a ordem some no ar.
  // Reconstrói a colocação REAL (quem venceu qual jogo, do próprio bracket já
  // buscado) pra usar como critério de ordenação por padrão — mesma lógica de
  // linhagem de vencedor do backend (build_fifa_bracket_numbers).
  const stageRank = useMemo(() => {
    const rank = {}
    if (!bracket) return rank
    const qp = bracket.qualified_picture || {}
    for (const t of [...(qp.winners || []), ...(qp.runners_up || []), ...(qp.best_thirds || [])]) {
      rank[t.code] = 1
    }
    const PHASE_RANK = { r32: 2, r16: 3, qf: 4, sf: 5 }
    for (const m of (bracket.schedule || [])) {
      const ta = m.resolved_team_a, tb = m.resolved_team_b
      if (!ta || !tb || !Array.isArray(m.score)) continue
      const winnerCode = m.score[0] > m.score[1] ? ta.code : tb.code
      const loserCode  = m.score[0] > m.score[1] ? tb.code : ta.code
      if (m.phase === 'final') {
        rank[winnerCode] = 7
        rank[loserCode]  = Math.max(rank[loserCode] || 0, 6)
      } else if (m.phase === '3rd') {
        rank[winnerCode] = Math.max(rank[winnerCode] || 0, 5.5)
        rank[loserCode]  = Math.max(rank[loserCode] || 0, 4.5)
      } else if (PHASE_RANK[m.phase]) {
        rank[winnerCode] = Math.max(rank[winnerCode] || 0, PHASE_RANK[m.phase])
        rank[loserCode]  = Math.max(rank[loserCode] || 0, PHASE_RANK[m.phase] - 1)
      }
    }
    return rank
  }, [bracket])

  const teams = useMemo(() => {
    if (!data?.teams) return []
    let t = [...data.teams]
    if (filter) t = t.filter(x =>
      x.name.toLowerCase().includes(filter.toLowerCase()) ||
      x.code.toLowerCase().includes(filter.toLowerCase()) ||
      (PT_NAMES[x.code] || '').toLowerCase().includes(filter.toLowerCase())
    )
    if (confFilter) t = t.filter(x => x.confederation === confFilter)
    // sortDir 1 = descending (b-a), -1 = ascending (a-b)
    // Ordenando por Título: colocação real primeiro (evita o empate 0% acima),
    // valor da coluna e elo como desempate. Outras colunas seguem só o valor.
    if (sortKey === 'prob_title') {
      t.sort((a, b) => sortDir * (
        ((stageRank[b.code] || 0) - (stageRank[a.code] || 0)) * 1000
        + ((b.prob_title || 0) - (a.prob_title || 0))
        + ((b.elo_rating || 0) - (a.elo_rating || 0)) / 10000
      ))
    } else {
      t.sort((a, b) => sortDir * ((b[sortKey] || 0) - (a[sortKey] || 0)))
    }
    return t
  }, [data, sortKey, sortDir, filter, confFilter, stageRank])

  const top3 = useMemo(() => {
    if (!data?.teams) return []
    return [...data.teams].sort((a, b) =>
      ((stageRank[b.code] || 0) - (stageRank[a.code] || 0)) * 1000
      + ((b.prob_title || 0) - (a.prob_title || 0))
    ).slice(0, 3)
  }, [data, stageRank])

  const confCounts = useMemo(() => {
    if (!data?.teams) return {}
    return data.teams.reduce((acc, t) => {
      acc[t.confederation] = (acc[t.confederation] || 0) + 1
      return acc
    }, {})
  }, [data])

  function toggleSort(key) {
    if (sortKey === key) setDir(d => -d)
    else { setSort(key); setDir(1) }
  }

  const [pageTab, setPageTab] = useState('bracket')

  if (comp !== 'copa2026') return <BrasileiraoRedirect comp={comp} setComp={setComp} />

  if (loading) return <Spinner text="Carregando chaveamento..." />

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">COPA DO MUNDO 2026</h1>
        <p className="page-subtitle">Fase eliminatória · {data?.simulations?.toLocaleString('pt-BR')} simulações</p>
      </div>

      <CompNav comp={comp} setComp={setComp} />

      {/* Page-level tabs */}
      <div className="phase-nav mt-4" style={{ marginBottom: 0 }}>
        <button
          className={`phase-nav__tab${pageTab === 'bracket' ? ' active' : ''}`}
          onClick={() => setPageTab('bracket')}
        >
          <span className="phase-nav__icon">⚔️</span>Chaveamento
        </button>
        <button
          className={`phase-nav__tab${pageTab === 'fases' ? ' active' : ''}`}
          onClick={() => setPageTab('fases')}
        >
          <span className="phase-nav__icon">📅</span>Confrontos
        </button>
        <button
          className={`phase-nav__tab${pageTab === 'sim' ? ' active' : ''}`}
          onClick={() => setPageTab('sim')}
        >
          <span className="phase-nav__icon">🎲</span>Simulação
        </button>
      </div>

      {/* ── CHAVEAMENTO TAB ── */}
      {pageTab === 'bracket' && bracket && (
        <>
          <CompetitionSection bracket={bracket} groups={groups} phases={phases} className="mt-6 fade-in-1" />
          <KnockoutBracket bracket={bracket} className="mt-6 fade-in-2" />
        </>
      )}

      {/* ── CONFRONTOS TAB ── */}
      {pageTab === 'fases' && phases && (
        <PhasesSection phases={phases} simData={data} navigate={navigate} />
      )}

      {/* ── SIMULAÇÃO TAB ── */}
      {pageTab === 'sim' && (
        <>

      {/* Podium top 3 */}
      {top3.length === 3 && (
        <div className="card fade-in-1 mt-6" style={{ background: 'var(--bg-card)' }}>
          <div className="card__body" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--s4)', textAlign: 'center' }}>
              {[top3[1], top3[0], top3[2]].map((t, podiumPos) => {
                const rank = podiumPos === 0 ? 2 : podiumPos === 1 ? 1 : 3
                const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'
                const size = rank === 1 ? 42 : 32
                return (
                  <div key={t.code} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--s2)',
                    order: rank === 1 ? -1 : rank,
                  }}>
                    <div style={{ fontSize: size, lineHeight: 1 }}>{medal}</div>
                    {t.flag_url && (
                      <TeamCrestFlag src={t.flag_url} alt={t.code} style={{
                        width: rank === 1 ? 40 : 30, height: rank === 1 ? 28 : 21,
                        objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)'
                      }} crestStyle={{
                        width: rank === 1 ? 38 : 28, height: rank === 1 ? 38 : 28,
                        objectFit: 'contain', borderRadius: 6, background: 'var(--bg-overlay)'
                      }} />
                    )}
                    <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: rank === 1 ? 15 : 13 }}>{PT_NAMES[t.code] || t.name}</div>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontSize: rank === 1 ? 28 : 20,
                      color: rank === 1 ? 'var(--accent)' : 'var(--text-2)'
                    }}>
                      {(t.prob_title || 0).toFixed(1)}%
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                      color: CONF_HEX[t.confederation] || 'var(--text-3)'
                    }}>{t.confederation}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="tournament-toolbar mt-6" style={{ flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Filtrar seleção..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ maxWidth: 200 }}
        />

        {/* Confederation filter */}
        <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
          <button
            onClick={() => setConf('')}
            className={`btn btn-sm ${confFilter === '' ? 'btn-primary' : 'btn-ghost'}`}
          >
            Todas
          </button>
          {CONF_ORDER.filter(c => confCounts[c]).map(c => (
            <button
              key={c}
              onClick={() => setConf(c === confFilter ? '' : c)}
              className={`btn btn-sm ${confFilter === c ? 'btn-primary' : 'btn-ghost'}`}
              style={{ borderColor: CONF_HEX[c], color: confFilter === c ? undefined : CONF_HEX[c] }}
            >
              {c} ({confCounts[c]})
            </button>
          ))}
        </div>

        {/* Sim count */}
        <div style={{ display: 'flex', gap: 'var(--s1)', marginLeft: 'auto', alignItems: 'center' }}>
          {simLoading && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)' }}>⏳</span>}
          {SIM_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => changeN(o.value)}
              disabled={simLoading}
              className={`btn btn-sm ${simN === o.value ? 'btn-primary' : 'btn-ghost'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)',
        marginTop: 'var(--s2)', marginBottom: 'var(--s2)'
      }}>
        {teams.length} seleções · clique coluna para ordenar
      </div>

      <div className="card fade-in-2 table-scroll">
        <table className="tourn-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Seleção</th>
              {PHASES.map(p => (
                <th
                  key={p.key}
                  onClick={() => toggleSort(p.key)}
                  className={sortKey === p.key ? 'sorted' : ''}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                >
                  {p.label} {sortKey === p.key ? (sortDir > 0 ? '↓' : '↑') : ''}
                </th>
              ))}
              <th onClick={() => toggleSort('elo_rating')} style={{ cursor: 'pointer' }}>
                Elo {sortKey === 'elo_rating' ? (sortDir > 0 ? '↓' : '↑') : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => (
              <tr key={t.code} style={t.code === 'BRA' ? { background: 'var(--bg-overlay)' } : {}}>
                <td style={{ color: i < 3 ? 'var(--accent)' : 'var(--text-3)', fontWeight: i < 3 ? 700 : 400 }}>
                  {i + 1}
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                    {t.flag_url && (
                      <TeamCrestFlag src={t.flag_url} alt={t.code} style={{
                        width: 20, height: 14, objectFit: 'cover',
                        borderRadius: 1, border: '1px solid var(--border)'
                      }} crestStyle={{
                        width: 18, height: 18, objectFit: 'contain',
                        borderRadius: 4, background: 'var(--bg-overlay)'
                      }} />
                    )}
                    <span style={{ fontWeight: 500 }}>{PT_NAMES[t.code] || t.name}</span>
                    <span style={{
                      fontFamily: 'var(--font-cond)', fontSize: 10,
                      color: CONF_HEX[t.confederation] || 'var(--text-3)',
                      fontWeight: 700, letterSpacing: '0.06em'
                    }}>{t.confederation}</span>
                  </div>
                </td>
                {PHASES.map(p => {
                  const val = t[p.key] || 0
                  const cls = p.key === 'prob_title' ? 'title-prob ' + heatClass(val) : heatClass(val)
                  return (
                    <td key={p.key} className={cls}>
                      {val >= 0.1 ? `${val.toFixed(1)}%` : '—'}
                    </td>
                  )
                })}
                <td style={{ color: 'var(--text-3)', fontFamily: 'var(--font-data)', fontSize: 12 }}>
                  {Math.round(t.elo_rating)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="legend-row">
        {[
          { cls: 'heat-3', label: '≥15%' },
          { cls: 'heat-2', label: '8–15%' },
          { cls: 'heat-1', label: '3–8%' },
          { cls: 'heat-0', label: '<3%' },
        ].map(l => (
          <span key={l.cls} className={l.cls}>● {l.label}</span>
        ))}
      </div>

      {(data?.top_finals?.length > 0 || data?.top_sf?.length > 0) && (
        <ProjectionsSection data={data} stageRank={stageRank} className="mt-6 fade-in-3" />
      )}

        </>
      )}
    </div>
  )
}

/* ─── Projections Section ─────────────────────────────────────── */

const PROJ_TABS = [
  { key: 'finals',  label: 'Finais Prováveis',   icon: '★' },
  { key: 'sf',      label: 'Semifinalistas',      icon: '½' },
  { key: 'ranking', label: 'Top Campeões',        icon: '🏆' },
]

function ProjectionsSection({ data, stageRank, className }) {
  const [tab, setTab] = useState('finals')

  return (
    <div className={`card ${className || ''}`}>
      <div className="phase-nav">
        {PROJ_TABS.map(t => (
          <button
            key={t.key}
            className={`phase-nav__tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span className="phase-nav__icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="card__body">
        {tab === 'finals' && <TopFinalsView finals={data.top_finals || []} />}
        {tab === 'sf' && <TopSFView sfList={data.top_sf || []} />}
        {tab === 'ranking' && <TopChampionsView teams={data.teams || []} stageRank={stageRank} />}
      </div>
    </div>
  )
}

function TopFinalsView({ finals }) {
  return (
    <div>
      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
        20 finais mais prováveis em {(finals.reduce((s,f)=>s+f.prob,0)).toFixed(0)}% das simulações
      </p>
      <div className="proj-finals-grid">
        {finals.map((f, i) => (
          <div key={`${f.team_a}-${f.team_b}`} className="proj-final-card">
            <div className="proj-final-card__rank">#{i + 1}</div>
            <div className="proj-final-card__matchup">
              <TeamChip code={f.team_a} name={f.name_a} flag={f.flag_a} prob={f.prob_a_wins} side="left" />
              <div className="proj-final-card__center">
                <div className="proj-final-card__prob">{f.prob.toFixed(2)}%</div>
                <div className="proj-final-card__vs">FINAL</div>
              </div>
              <TeamChip code={f.team_b} name={f.name_b} flag={f.flag_b} prob={f.prob_b_wins} side="right" />
            </div>
            {/* Mini win bar */}
            <div className="proj-win-bar">
              <div className="proj-win-bar__a" style={{ width: `${f.prob_a_wins}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TeamChip({ code, name, flag, prob, side }) {
  return (
    <div className={`team-chip team-chip--${side}`}>
      {flag && <TeamCrestFlag src={flag} alt={code} className="team-chip__flag" crestClassName="team-chip__flag--crest" />}
      <div className="team-chip__info">
        <span className="team-chip__code">{code}</span>
        <span className="team-chip__name">{PT_NAMES[code] || name}</span>
      </div>
      {prob != null && (
        <span className="team-chip__prob" style={{ color: prob >= 55 ? 'var(--accent)' : 'var(--text-3)' }}>
          {prob}%
        </span>
      )}
    </div>
  )
}

function TopSFView({ sfList }) {
  return (
    <div>
      <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
        10 quartetos de semifinal mais frequentes
      </p>
      <div className="stack gap-3">
        {sfList.map((sf, i) => (
          <div key={i} className="proj-sf-row">
            <span className="proj-sf-row__rank">#{i + 1}</span>
            <div className="proj-sf-row__teams">
              {sf.teams.map(t => (
                <div key={t.code} className="proj-sf-team">
                  {t.flag_url && <TeamCrestFlag src={t.flag_url} alt={t.code} className="team-chip__flag" crestClassName="team-chip__flag--crest" />}
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700 }}>{PT_NAMES[t.code] || t.code}</span>
                </div>
              ))}
            </div>
            <div className="proj-sf-row__prob">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--accent)' }}>
                {sf.prob.toFixed(2)}%
              </span>
              <div className="proj-sf-bar-track">
                <div className="proj-sf-bar-fill" style={{ width: `${Math.min(100, sf.prob * 5)}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TopChampionsView({ teams, stageRank = {} }) {
  const top20 = [...teams].sort((a, b) =>
    ((stageRank[b.code] || 0) - (stageRank[a.code] || 0)) * 1000
    + ((b.prob_title || 0) - (a.prob_title || 0))
  ).slice(0, 20)
  const maxProb = top20[0]?.prob_title || 1
  return (
    <div className="stack gap-2">
      {top20.map((t, i) => (
        <div key={t.code} className="proj-champ-row">
          <span className="proj-champ-row__rank" style={{ color: i < 3 ? 'var(--accent)' : 'var(--text-4)' }}>
            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
          </span>
          {t.flag_url && <TeamCrestFlag src={t.flag_url} alt={t.code} className="team-chip__flag" crestClassName="team-chip__flag--crest" />}
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, flex: 1 }}>{PT_NAMES[t.code] || t.name}</span>
          <div className="proj-champ-bar-track">
            <div className="proj-champ-bar-fill" style={{ width: `${(t.prob_title / maxProb) * 100}%` }} />
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: i < 3 ? 'var(--accent)' : 'var(--text-2)', minWidth: 46, textAlign: 'right' }}>
            {(t.prob_title || 0).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

/* ─── Competition Section ─────────────────────────────────────── */

const PHASE_ORDER = ['groups', 'r32', 'r16', 'qf', 'sf', 'final', '3rd']
const PHASE_META = {
  groups: { label: 'Grupos',       icon: '⬡' },
  r32:    { label: 'Round of 32',  icon: '32' },
  r16:    { label: 'Oitavas',      icon: '16' },
  qf:     { label: 'Quartas',      icon: '¼' },
  sf:     { label: 'Semi',         icon: '½' },
  final:  { label: 'Final',        icon: '★' },
  '3rd':  { label: '3º Lugar',     icon: '🥉' },
}

function CompetitionSection({ bracket, groups, phases: phasesData, className }) {
  const schedule = bracket?.schedule || []

  // Build lookup: team code → enriched team (elo, group_name, position) from qualified_picture
  const qpByCode = useMemo(() => {
    const map = {}
    const qp = bracket?.qualified_picture || {}
    for (const t of [...(qp.winners || []), ...(qp.runners_up || []), ...(qp.best_thirds || [])]) {
      map[t.code] = t
    }
    return map
  }, [bracket])

  // Adapt DB r32 matches to KoMatchCard format
  const r32FromDB = useMemo(() => (phasesData?.r32 || []).map(m => {
    const enrich = t => t ? { ...t, ...(qpByCode[t.code] || {}) } : null
    return {
      ...m,
      phase: 'r32',
      section: `R32-${m.match_number}`,
      resolved_team_a: enrich(m.team_a),
      resolved_team_b: enrich(m.team_b),
      team_a_label: m.team_a?.code || '?',
      team_b_label: m.team_b?.code || '?',
      candidate_thirds_a: [],
      candidate_thirds_b: [],
    }
  }).sort((a, b) => (a.match_date || '') < (b.match_date || '') ? -1 : 1), [phasesData, qpByCode])

  const phaseTabs = useMemo(() => [
    'groups',
    ...(r32FromDB.length ? ['r32'] : []),
    ...PHASE_ORDER.filter(p => p !== 'groups' && p !== 'r32' && schedule.some(m => m.phase === p)),
  ], [r32FromDB, schedule])

  const [active, setActive] = useState('groups')

  // match_number → match for label resolution
  const matchLookup = useMemo(() => {
    const m = {}
    for (const s of schedule) m[s.match_number] = s
    for (const s of r32FromDB) m[s.match_number] = s
    return m
  }, [schedule, r32FromDB])

  const byPhase = useMemo(() => {
    const m = { r32: r32FromDB }
    for (const s of schedule) {
      if (!m[s.phase]) m[s.phase] = []
      m[s.phase].push(s)
    }
    return m
  }, [schedule, r32FromDB])

  return (
    <div className={`card ${className || ''}`}>
      {/* Phase tabs */}
      <div className="phase-nav">
        {phaseTabs.map(p => (
          <button
            key={p}
            className={`phase-nav__tab ${active === p ? 'active' : ''}`}
            onClick={() => setActive(p)}
          >
            <span className="phase-nav__icon">{PHASE_META[p]?.icon}</span>
            {PHASE_META[p]?.label || p}
            {p !== 'groups' && byPhase[p]?.length > 0 && (
              <span className="phase-nav__count">{byPhase[p].length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="card__body">
        {active === 'groups' && groups && (
          <GroupsView groups={groups} bracket={bracket} />
        )}
        {active !== 'groups' && byPhase[active]?.length > 0 && (
          <PhaseView matches={byPhase[active]} phase={active} matchLookup={matchLookup} />
        )}
        {active !== 'groups' && !byPhase[active]?.length && (
          <p style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
            Sem dados para esta fase ainda.
          </p>
        )}
      </div>
    </div>
  )
}

function GroupsView({ groups, bracket }) {
  const qp = bracket?.qualified_picture || {}
  const qualifiedCodes = new Set([
    ...(qp.winners || []).map(t => t.code),
    ...(qp.runners_up || []).map(t => t.code),
  ])
  const bestThirdCodes = new Set((qp.best_thirds || []).map(t => t.code))

  const sortedGroups = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="comp-groups-grid">
      {sortedGroups.map(([groupName, teams]) => {
        const sorted = [...teams].sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points
          if (b.gd !== a.gd) return b.gd - a.gd
          return b.gf - a.gf
        })
        return (
          <div key={groupName} className="comp-group-card">
            <div className="comp-group-card__header">
              GRUPO {groupName}
            </div>
            <div className="comp-group-card__body">
              <div className="comp-group-header-row">
                <span>#</span><span></span><span></span>
                <span>J</span><span>V</span><span>E</span><span>D</span>
                <span>SG</span><span>Pts</span>
              </div>
              {sorted.map((t, i) => {
                const isQ = qualifiedCodes.has(t.code)
                const isBT = bestThirdCodes.has(t.code)
                return (
                  <div
                    key={t.code}
                    className={`comp-group-row ${isQ ? 'qualified' : isBT ? 'best-third' : ''}`}
                  >
                    <span className="comp-group-row__pos" style={{
                      color: isQ ? 'var(--accent)' : isBT ? '#f59e0b' : 'var(--text-4)'
                    }}>
                      {i + 1}
                      {isQ && <span className="comp-badge-q">Q</span>}
                      {isBT && <span className="comp-badge-bt">3</span>}
                    </span>
                    {t.flag_url
                      ? <TeamCrestFlag src={t.flag_url} alt={t.code} className="comp-group-row__flag" crestClassName="comp-group-row__flag--crest" />
                      : <span className="comp-group-row__flag-ph" />
                    }
                    <span className="comp-group-row__name">{PT_NAMES[t.code] || t.name}</span>
                    <span className="comp-group-row__stat">{t.played}</span>
                    <span className="comp-group-row__stat">{t.wins}</span>
                    <span className="comp-group-row__stat">{t.draws}</span>
                    <span className="comp-group-row__stat">{t.losses}</span>
                    <span className="comp-group-row__stat" style={{ color: t.gd > 0 ? 'var(--win)' : t.gd < 0 ? 'var(--lose)' : 'var(--text-3)' }}>
                      {t.gd > 0 ? `+${t.gd}` : t.gd}
                    </span>
                    <span className="comp-group-row__pts">{t.points}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PhaseView({ matches, phase, matchLookup }) {
  const cols = phase === 'r32' ? 2 : 1
  return (
    <div className="comp-phase-grid" style={{
      gridTemplateColumns: `repeat(${cols}, 1fr)`
    }}>
      {matches.map(m => (
        <KoMatchCard key={m.match_number} match={m} matchLookup={matchLookup} />
      ))}
    </div>
  )
}

function KoMatchCard({ match, matchLookup }) {
  const date = formatBracketDate(match.match_date)
  const ta = match.resolved_team_a
  const tb = match.resolved_team_b
  const isFinished = match.status === 'finished' && match.score_a != null && match.score_b != null
  const probA = !isFinished && ta && tb ? eloWinProb(ta.elo_rating, tb.elo_rating) : null
  const probB = probA != null ? 1 - probA : null

  return (
    <div className="ko-card">
      <div className="ko-card__header">
        <span className="ko-card__section">{match.section}</span>
        <span className="ko-card__date">{date}</span>
        <span className="ko-card__venue">📍 {match.city}</span>
      </div>
      <div className="ko-card__body">
        <KoTeamRow
          team={ta}
          label={match.team_a_label}
          candidates={match.candidate_thirds_a}
          matchLookup={matchLookup}
          winProb={probA}
          score={isFinished ? match.score_a : null}
          isWinner={isFinished ? match.score_a > match.score_b : null}
        />
        <div className="ko-card__sep">
          <span>vs</span>
          <span className="ko-card__venue-inline">{match.venue}</span>
        </div>
        <KoTeamRow
          team={tb}
          label={match.team_b_label}
          candidates={match.candidate_thirds_b}
          matchLookup={matchLookup}
          winProb={probB}
          score={isFinished ? match.score_b : null}
          isWinner={isFinished ? match.score_b > match.score_a : null}
        />
      </div>
    </div>
  )
}

function eloWinProb(eloA, eloB) {
  // P(A beats B) from Elo formula, excludes draw
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400))
}

function KoTeamRow({ team, label, candidates, matchLookup, winProb, score, isWinner }) {
  if (team) {
    const eloNorm = Math.min(100, Math.max(0, ((team.elo_rating - 1400) / 700) * 100))
    const probPct = winProb != null ? Math.round(winProb * 100) : null
    return (
      <div className="ko-team" style={isWinner === false ? { opacity: 0.55 } : undefined}>
        {team.flag_url
          ? <TeamCrestFlag src={team.flag_url} alt={team.code} className="ko-team__flag" crestClassName="ko-team__flag--crest" />
          : <span className="ko-team__flag-ph" />
        }
        <div className="ko-team__info">
          <span className="ko-team__name">{PT_NAMES[team.code] || team.name}</span>
          <span className="ko-team__code">{team.code} · G{team.group_name}{team.position}</span>
        </div>
        <div className="ko-team__elo-wrap">
          {score != null ? (
            <span style={{
              fontFamily: 'var(--font-data)', fontSize: 20, fontWeight: 900,
              color: isWinner ? 'var(--win)' : 'var(--text-2)',
            }}>
              {score}
            </span>
          ) : probPct != null && (
            <span className="ko-team__prob" style={{
              color: probPct >= 55 ? 'var(--accent)' : probPct >= 45 ? 'var(--text-2)' : 'var(--text-3)'
            }}>
              {probPct}%
            </span>
          )}
          <div className="ko-team__elo-bar">
            <div className="ko-team__elo-fill" style={{ width: `${eloNorm}%` }} />
          </div>
          <span className="ko-team__elo-val">{Math.round(team.elo_rating)}</span>
        </div>
      </div>
    )
  }

  // Unresolved — try to decode "Winner Match N" or "Loser Match N"
  const decoded = decodeLabel(label, matchLookup)
  return (
    <div className="ko-team ko-team--ghost">
      <span className="ko-team__ghost-icon">{decoded.isLoser ? '✗' : '»'}</span>
      <div className="ko-team__info">
        <span className="ko-team__name" style={{ color: 'var(--text-3)' }}>{decoded.label}</span>
        {decoded.teams && (
          <span className="ko-team__code">{decoded.teams}</span>
        )}
        {candidates?.length > 0 && (
          <span className="ko-team__code">
            Candidatos: {candidates.map(c => c.code).join(' · ')}
          </span>
        )}
      </div>
    </div>
  )
}

function decodeLabel(label, matchLookup) {
  if (!label) return { label: '—' }
  const winM = label.match(/Winner Match (\d+)/)
  if (winM) {
    const ref = matchLookup[parseInt(winM[1])]
    const teams = ref
      ? `${ref.resolved_team_a?.code || '?'} × ${ref.resolved_team_b?.code || '?'}`
      : null
    return { label: `Venc. Jogo #${winM[1]}`, teams, isLoser: false }
  }
  const loseM = label.match(/Loser Match (\d+)/)
  if (loseM) {
    const ref = matchLookup[parseInt(loseM[1])]
    const teams = ref
      ? `${ref.resolved_team_a?.code || '?'} × ${ref.resolved_team_b?.code || '?'}`
      : null
    return { label: `Eliminado Jogo #${loseM[1]}`, teams, isLoser: true }
  }
  // "Runner-up Group A" etc
  const runnM = label.match(/Runner-up Group ([A-Z])/)
  if (runnM) return { label: `2º Grupo ${runnM[1]}` }
  const winnM = label.match(/Winner Group ([A-Z])/)
  if (winnM) return { label: `1º Grupo ${winnM[1]}` }
  return { label }
}

function formatBracketDate(value) {
  if (!value) return 'Sem data'
  // API returns naive UTC without 'Z' — append to trigger correct tz conversion
  const date = new Date(value.endsWith('Z') ? value : value + 'Z')
  if (Number.isNaN(date.getTime())) return 'Sem data'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}


/* ─── Knockout Bracket Visual ─────────────────────────────────── */

// Half assignment (A = left side / SF1 path, B = right side / SF2 path)
const HALF_A_R32 = new Set([73, 74, 75, 77, 81, 82, 83, 84])
const HALF_B_R32 = new Set([76, 78, 79, 80, 85, 86, 87, 88])

// Slot heights: each round = 2× the previous (R32=1, R16=2, QF=4, SF=8 units)
const BK_SLOT = 86   // px per R32 slot — match card ~64px centered in this
const BK_TOTAL = BK_SLOT * 8   // 688px — total bracket height (8×R32 per half)

// Ordered top-to-bottom so bracket connections align visually
const HALF_A = {
  r32: [74, 77, 73, 75, 83, 84, 81, 82],
  r16: [89, 90, 93, 94],
  qf:  [97, 98],
  sf:  [101],
}
const HALF_B = {
  r32: [76, 78, 79, 80, 86, 88, 85, 87],
  r16: [91, 92, 95, 96],
  qf:  [99, 100],
  sf:  [102],
}
const FINAL_MN  = 104
const THIRD_MN  = 103

const ROUND_LABELS = { r32: 'Round of 32', r16: 'Oitavas', qf: 'Quartas', sf: 'Semi' }

function bkDate(value) {
  if (!value) return null
  const d = new Date(value.endsWith('Z') ? value : value + 'Z')
  if (isNaN(d)) return null
  const day  = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return { day, time, full: `${day} ${time}` }
}

function bkDecodeName(team, label, matchLookup) {
  if (team) return PT_NAMES[team.code] || team.name
  if (!label) return '?'
  const wm = label.match(/Winner Match (\d+)/)
  if (wm) {
    const ref = matchLookup[parseInt(wm[1])]
    if (ref?.resolved_team_a && ref?.resolved_team_b) {
      return `Venc. ${ref.resolved_team_a.code} × ${ref.resolved_team_b.code}`
    }
    return `Venc. Jogo ${wm[1]}`
  }
  const rg = label.match(/Runner-up Group ([A-Z])/)
  if (rg) return `2º Grupo ${rg[1]}`
  const wg = label.match(/Winner Group ([A-Z])/)
  if (wg) return `1º Grupo ${wg[1]}`
  const tg = label.match(/3rd Group (.+)/)
  if (tg) return `3º (${tg[1]})`
  return label || '?'
}

function BkCard2({ matchNum, matchLookup, isFinal, isThird }) {
  const m      = matchLookup[matchNum]
  const ta     = m?.resolved_team_a
  const tb     = m?.resolved_team_b
  const result = (m?.score_a != null && m?.score_b != null) ? { score_a: m.score_a, score_b: m.score_b } : null
  const dt     = bkDate(m?.match_date)

  let winA = null, winB = null
  if (result) {
    if (result.score_a > result.score_b)      { winA = true;  winB = false }
    else if (result.score_b > result.score_a) { winA = false; winB = true  }
  }

  const nameA = bkDecodeName(ta, m?.team_a_label, matchLookup)
  const nameB = bkDecodeName(tb, m?.team_b_label, matchLookup)
  const hasBoth = !!(ta || m?.team_a_label) && !!(tb || m?.team_b_label)

  const cardCls = [
    'bk2-card',
    isFinal  ? 'bk2-card--final'   : '',
    isThird  ? 'bk2-card--third'   : '',
    !hasBoth ? 'bk2-card--pending' : '',
  ].filter(Boolean).join(' ')

  const sectionCls = isFinal ? 'bk2-section bk2-section--final'
    : isThird ? 'bk2-section bk2-section--third'
    : 'bk2-section'

  return (
    <div className={cardCls}>
      {/* Header: section tag + date/time + venue */}
      <div className="bk2-head">
        <span className={sectionCls}>
          {isFinal ? '★ FINAL' : isThird ? '🥉 3º' : (m?.section || `#${matchNum}`)}
        </span>
        {dt && (
          <span className="bk2-datetime">{dt.day} · {dt.time}</span>
        )}
        {m?.venue && (
          <span className="bk2-venue" title={`${m.venue}, ${m.city}`}>
            {m.venue}
          </span>
        )}
      </div>

      {/* Body: team A / sep / team B */}
      <div className="bk2-body">
        {/* Team A */}
        <div className={`bk2-row${winA === true ? ' bk2-row--winner' : winA === false ? ' bk2-row--loser' : ''}`}>
          {ta?.flag_url
            ? <TeamCrestFlag src={ta.flag_url} alt={ta.code} className="bk2-flag" crestClassName="bk2-flag--crest" />
            : <span className="bk2-flag--ph" />}
          <span className={`bk2-name${!ta ? ' bk2-name--ghost' : winA ? ' bk2-name--winner' : ''}`}>
            {nameA}
          </span>
          {result != null && (
            <span className={`bk2-score${winA ? ' bk2-score--win' : winA === false ? ' bk2-score--lose' : ''}`}>
              {result.score_a}
            </span>
          )}
        </div>

        {/* VS separator (only when unplayed) */}
        {!result && <div className="bk2-vs">VS</div>}

        {/* Team B */}
        <div className={`bk2-row${winB === true ? ' bk2-row--winner' : winB === false ? ' bk2-row--loser' : ''}`}>
          {tb?.flag_url
            ? <TeamCrestFlag src={tb.flag_url} alt={tb.code} className="bk2-flag" crestClassName="bk2-flag--crest" />
            : <span className="bk2-flag--ph" />}
          <span className={`bk2-name${!tb ? ' bk2-name--ghost' : winB ? ' bk2-name--winner' : ''}`}>
            {nameB}
          </span>
          {result != null && (
            <span className={`bk2-score${winB ? ' bk2-score--win' : winB === false ? ' bk2-score--lose' : ''}`}>
              {result.score_b}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function BkRound({ matchNums, matchLookup, roundKey, side }) {
  const roundIdx = ['r32', 'r16', 'qf', 'sf'].indexOf(roundKey)
  const slotH    = BK_SLOT * Math.pow(2, roundIdx)
  const isLeaf   = roundKey === 'r32'
  const isSF     = roundKey === 'sf'

  return (
    <div className="bk2-col">
      {matchNums.map((num, idx) => {
        const pairPos = idx % 2  // 0=upper, 1=lower within each pair
        const classes = ['bk2-slot']

        // Outgoing pair-bracket connector (not for SF — it connects to Final separately)
        if (!isSF) {
          if (side === 'left') {
            classes.push(pairPos === 0 ? 'bk-up-L' : 'bk-dn-L')
          } else {
            classes.push(pairPos === 0 ? 'bk-up-R' : 'bk-dn-R')
          }
        }

        // Incoming connector from previous round (not for R32 leaves)
        if (!isLeaf) {
          classes.push(side === 'left' ? 'bk-in-L' : 'bk-in-R')
        }

        return (
          <div key={num} className={classes.join(' ')} style={{ height: slotH }}>
            <BkCard2 matchNum={num} matchLookup={matchLookup} />
          </div>
        )
      })}
    </div>
  )
}

// Match number → half label (A or B)
const MATCH_HALF = {
  73:'A',74:'A',75:'A',77:'A',81:'A',82:'A',83:'A',84:'A',
  76:'B',78:'B',79:'B',80:'B',85:'B',86:'B',87:'B',88:'B',
  89:'A',90:'A',93:'A',94:'A',  91:'B',92:'B',95:'B',96:'B',
  97:'A',98:'A',                99:'B',100:'B',
  101:'A',                      102:'B',
}

// All rounds for mobile view (ordered chronologically)
const MOBILE_ROUNDS = [
  { key:'r32',   label:'Round of 32',    icon:'32', nums:[...HALF_A.r32, ...HALF_B.r32] },
  { key:'r16',   label:'Oitavas de Final', icon:'16', nums:[...HALF_A.r16, ...HALF_B.r16] },
  { key:'qf',    label:'Quartas de Final', icon:'¼', nums:[...HALF_A.qf,  ...HALF_B.qf]  },
  { key:'sf',    label:'Semifinais',      icon:'½', nums:[...HALF_A.sf,  ...HALF_B.sf]  },
  { key:'final', label:'Grande Final',    icon:'★', nums:[FINAL_MN]                      },
  { key:'3rd',   label:'3º Lugar',        icon:'🥉', nums:[THIRD_MN]                     },
]

/* Mobile full-width match card */
function BkMobileCard({ matchNum, matchLookup }) {
  const m      = matchLookup[matchNum]
  const ta     = m?.resolved_team_a
  const tb     = m?.resolved_team_b
  const result = (m?.score_a != null && m?.score_b != null) ? { score_a: m.score_a, score_b: m.score_b } : null
  const dt     = bkDate(m?.match_date)
  const half   = MATCH_HALF[matchNum]
  const isFinal  = matchNum === FINAL_MN
  const isThird  = matchNum === THIRD_MN

  let winA = null, winB = null
  if (result) {
    if (result.score_a > result.score_b)      { winA = true;  winB = false }
    else if (result.score_b > result.score_a) { winA = false; winB = true  }
  }

  const nameA = bkDecodeName(ta, m?.team_a_label, matchLookup)
  const nameB = bkDecodeName(tb, m?.team_b_label, matchLookup)

  return (
    <div style={{
      border: `1.5px solid ${isFinal ? 'color-mix(in srgb, var(--accent) 55%, transparent)' : isThird ? 'color-mix(in srgb, var(--amber) 50%, transparent)' : 'var(--border)'}`,
      borderRadius: 10,
      overflow: 'hidden',
      background: 'var(--bg-card)',
      boxShadow: isFinal ? '0 0 20px color-mix(in srgb, var(--accent) 12%, transparent)' : 'none',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px',
        background: 'var(--bg-overlay)',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap',
      }}>
        <span className="bk2-section" style={isFinal ? { fontSize: 10 } : isThird ? { color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 14%, transparent)' } : {}}>
          {isFinal ? '★ FINAL' : isThird ? '🥉 3º LUGAR' : (m?.section || `#${matchNum}`)}
        </span>
        {half && !isFinal && !isThird && (
          <span className={`half-badge half-badge--${half}`}>{half}</span>
        )}
        {dt && (
          <>
            <span style={{ fontFamily:'var(--font-data)', fontSize:11, fontWeight:700, color:'var(--text-1)' }}>
              {dt.day}
            </span>
            <span style={{ fontFamily:'var(--font-data)', fontSize:12, fontWeight:800, color:'var(--accent)' }}>
              {dt.time}
            </span>
          </>
        )}
        {m?.venue && (
          <span style={{ fontFamily:'var(--font-data)', fontSize:10, color:'var(--text-3)', marginLeft:'auto' }}>
            📍 {m.venue}{m.city ? `, ${m.city}` : ''}
          </span>
        )}
      </div>

      {/* Teams */}
      <div style={{ padding: '8px 12px', display:'flex', flexDirection:'column', gap:2 }}>
        {[
          { team: ta, label: m?.team_a_label, win: winA, score: result?.score_a },
          { team: tb, label: m?.team_b_label, win: winB, score: result?.score_b },
        ].map(({ team, label, win, score }, i) => {
          const name = bkDecodeName(team, label, matchLookup)
          return (
            <div key={i} style={{
              display: 'grid',
              gridTemplateColumns: '26px 1fr auto',
              alignItems: 'center',
              gap: 8,
              padding: '5px 6px',
              borderRadius: 6,
              background: win ? 'color-mix(in srgb, var(--win) 8%, transparent)' : 'transparent',
              opacity: win === false ? 0.42 : 1,
              transition: 'opacity 200ms',
            }}>
              {team?.flag_url
                ? <TeamCrestFlag src={team.flag_url} alt={team.code} style={{ width:26, height:18, objectFit:'cover', borderRadius:2, border:'1px solid var(--border)' }} crestStyle={{ width:24, height:24, objectFit:'contain', borderRadius:5, background:'var(--bg-overlay)' }} />
                : <span style={{ display:'inline-block', width:26, height:18, background:'var(--bg-overlay)', border:'1px solid var(--border)', borderRadius:2 }} />
              }
              <span style={{
                fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14,
                color: win ? 'var(--win)' : !team ? 'var(--text-4)' : 'var(--text-1)',
                fontStyle: !team ? 'italic' : 'normal',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {name}
              </span>
              {result != null ? (
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: 20,
                  color: win ? 'var(--win)' : win === false ? 'var(--lose)' : 'var(--text-3)',
                  minWidth: 18, textAlign: 'right',
                }}>
                  {score}
                </span>
              ) : (
                <span style={{ fontFamily:'var(--font-cond)', fontSize:10, color:'var(--text-4)' }}>–</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* Mobile view: round tabs + match list */
function BkMobileView({ matchLookup }) {
  const [activeRound, setActiveRound] = useState('r32')
  const round = MOBILE_ROUNDS.find(r => r.key === activeRound)

  return (
    <div style={{ padding: 'var(--s3) var(--s4) var(--s5)' }}>
      {/* Round tab selector */}
      <div style={{
        display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 'var(--s3)',
        scrollbarWidth: 'none',
      }}>
        {MOBILE_ROUNDS.map(r => (
          <button
            key={r.key}
            onClick={() => setActiveRound(r.key)}
            style={{
              flexShrink: 0,
              fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12,
              padding: '6px 12px', borderRadius: 20,
              border: `1.5px solid ${activeRound === r.key ? 'var(--accent)' : 'var(--border)'}`,
              background: activeRound === r.key ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-surface)',
              color: activeRound === r.key ? 'var(--accent)' : 'var(--text-3)',
              cursor: 'pointer',
              transition: 'all 150ms',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span style={{ fontSize: 10 }}>{r.icon}</span>
            {r.label}
          </button>
        ))}
      </div>

      {/* Half labels for rounds with both halves */}
      {round && !['final','3rd'].includes(round.key) && (
        <div style={{ display:'flex', gap:10, marginBottom:'var(--s3)' }}>
          {['A','B'].map(h => (
            <span key={h} style={{ display:'flex', alignItems:'center', gap:5, fontFamily:'var(--font-cond)', fontSize:11, color:'var(--text-3)' }}>
              <span className={`half-badge half-badge--${h}`}>{h}</span>
              {h === 'A' ? 'Semifinal 1' : 'Semifinal 2'}
            </span>
          ))}
        </div>
      )}

      {/* Match cards */}
      <div style={{ display:'flex', flexDirection:'column', gap: 10 }}>
        {round?.nums.map(num => (
          <BkMobileCard key={num} matchNum={num} matchLookup={matchLookup} />
        ))}
      </div>
    </div>
  )
}

function KnockoutBracket({ bracket, className }) {
  const schedule = bracket?.schedule || []
  const matchLookup = useMemo(() => {
    const m = {}
    for (const s of schedule) m[s.match_number] = s
    return m
  }, [schedule])

  if (!schedule.length) return null

  const leftRounds  = ['r32', 'r16', 'qf', 'sf']
  const rightRounds = ['sf',  'qf',  'r16', 'r32']

  const header = (
    <div className="bk2-hd">
      <h2>⚔️ CHAVEAMENTO</h2>
      <div style={{ display:'flex', gap:12, alignItems:'center' }}>
        {['A','B'].map(h => (
          <span key={h} style={{ display:'flex', alignItems:'center', gap:5, fontFamily:'var(--font-cond)', fontSize:11, color:'var(--text-3)' }}>
            <span className={`half-badge half-badge--${h}`}>{h}</span>
            Semifinal {h === 'A' ? 1 : 2}
          </span>
        ))}
      </div>
      <span className="bk2-hd-note bk2-desktop-only">← arraste →</span>
    </div>
  )

  return (
    <div className={`card ${className || ''}`}>
      {header}

      {/* ── DESKTOP: horizontal bracket tree ── */}
      <div className="bk2-desktop-view">
        <div className="bk2-scroll">
          <div style={{ display:'flex', alignItems:'stretch', marginBottom: 0 }}>
            <div style={{ display:'flex', gap:'var(--bk-gap)', marginRight:'var(--bk-gap)' }}>
              {leftRounds.map(k => (
                <div key={k} className={`bk2-label${k==='sf'?' bk2-label--sf':''}`}>{ROUND_LABELS[k]}</div>
              ))}
            </div>
            <div className="bk2-label bk2-label--center bk2-label--final">FINAL</div>
            <div style={{ display:'flex', gap:'var(--bk-gap)', marginLeft:'var(--bk-gap)' }}>
              {rightRounds.map(k => (
                <div key={k} className={`bk2-label${k==='sf'?' bk2-label--sf':''}`}>{ROUND_LABELS[k]}</div>
              ))}
            </div>
          </div>

          <div className="bk2-root" style={{ height: BK_TOTAL }}>
            <span className="bk2-side-label" style={{ height: BK_TOTAL }}>LADO A</span>

            <div className="bk2-half" style={{ height: BK_TOTAL }}>
              {leftRounds.map(k => (
                <BkRound key={k} matchNums={HALF_A[k]} matchLookup={matchLookup} roundKey={k} side="left" />
              ))}
            </div>

            <div className="bk2-center" style={{ height: BK_TOTAL }}>
              <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:8 }}>
                <div className="bk2-center-label">★ GRANDE FINAL ★</div>
                <BkCard2 matchNum={FINAL_MN} matchLookup={matchLookup} isFinal />
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, paddingBottom:'var(--s4)' }}>
                <div className="bk2-third-label">🥉 DISPUTA 3º LUGAR</div>
                <BkCard2 matchNum={THIRD_MN} matchLookup={matchLookup} isThird />
              </div>
            </div>

            <div className="bk2-half" style={{ height: BK_TOTAL }}>
              {rightRounds.map(k => (
                <BkRound key={k} matchNums={HALF_B[k]} matchLookup={matchLookup} roundKey={k} side="right" />
              ))}
            </div>

            <span className="bk2-side-label" style={{ height: BK_TOTAL, transform:'rotate(180deg)' }}>LADO B</span>
          </div>
        </div>
      </div>

      {/* ── MOBILE: round tabs + card list ── */}
      <div className="bk2-mobile-view">
        <BkMobileView matchLookup={matchLookup} />
      </div>
    </div>
  )
}

// ─── Phases / Confrontos Section ──────────────────────────────────────────────

const ROAD_PHASE_KEYS = ['r32', 'r16', 'qf', 'sf', 'final']
const ROAD_PHASE_META = {
  r32:   { label: 'Round de 32',        icon: '⚽', short: 'R32'      },
  r16:   { label: 'Oitavas de Final',   icon: '⚔️', short: 'Oitavas' },
  qf:    { label: 'Quartas de Final',   icon: '🔥', short: 'Quartas'  },
  sf:    { label: 'Semifinal',          icon: '⭐', short: 'Semi'     },
  final: { label: 'Grande Final',       icon: '🏆', short: 'Final'    },
}

function toUTC(val) {
  if (!val) return null
  const s = String(val)
  return new Date(s.endsWith('Z') ? s : s + 'Z')
}
function fmtDateBRT(val) {
  const d = toUTC(val)
  if (!d || isNaN(d)) return '—'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })
}
function fmtTimeBRT(val) {
  const d = toUTC(val)
  if (!d || isNaN(d)) return '—'
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) + ' BRT'
}
function fmtDayKeyBRT(val) {
  const d = toUTC(val)
  if (!d || isNaN(d)) return '?'
  // e.g. "2026-06-28" in BRT
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}
function fmtDayLabelBRT(val) {
  const d = toUTC(val)
  if (!d || isNaN(d)) return '—'
  const dow = d.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' })
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
  return `${dow.charAt(0).toUpperCase() + dow.slice(1)}, ${date}`
}
function parseFeedMatchNum(label) {
  const m = (label || '').match(/Match (\d+)/)
  return m ? parseInt(m[1]) : null
}

function PhasesSection({ phases, simData, navigate }) {
  const [activePhase, setActivePhase] = useState('r32')
  const [expandedMatch, setExpandedMatch] = useState(null)

  // flat lookup: match_number → match entry across all phases
  const allByNum = useMemo(() => {
    const map = {}
    for (const key of ROAD_PHASE_KEYS) {
      for (const m of (phases[key] || [])) {
        if (m.match_number) map[m.match_number] = { ...m, phaseKey: key }
      }
    }
    return map
  }, [phases])

  // sim team lookup by code
  const simByCode = useMemo(() => {
    const map = {}
    for (const t of (simData?.teams || [])) map[t.code] = t
    return map
  }, [simData])

  const matches = useMemo(() => {
    const raw = phases[activePhase] || []
    return [...raw].sort((a, b) => {
      const da = a.match_date || ''
      const db = b.match_date || ''
      if (da !== db) return da < db ? -1 : 1
      return (a.match_number || 0) - (b.match_number || 0)
    })
  }, [phases, activePhase])

  // Group by BRT day
  const matchesByDay = useMemo(() => {
    const days = []
    const seen = {}
    for (const m of matches) {
      const key = fmtDayKeyBRT(m.match_date)
      if (!seen[key]) {
        seen[key] = true
        days.push({ key, label: fmtDayLabelBRT(m.match_date), items: [] })
      }
      days[days.length - 1].items.push(m)
    }
    return days
  }, [matches])

  return (
    <div className="fade-in-1 mt-6">
      {/* Phase pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 'var(--s5)' }}>
        {ROAD_PHASE_KEYS.map(key => {
          const count = phases[key]?.length || 0
          const active = activePhase === key
          return (
            <button
              key={key}
              onClick={() => { setActivePhase(key); setExpandedMatch(null) }}
              style={{
                padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: active ? 700 : 400,
                background: active ? 'var(--accent)' : 'var(--bg-surface)',
                color: active ? '#fff' : 'var(--text-3)',
                border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                transition: 'all 150ms',
                whiteSpace: 'nowrap',
              }}
            >
              {ROAD_PHASE_META[key].icon} {ROAD_PHASE_META[key].short}
              <span style={{
                marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 10,
                background: active ? 'rgba(255,255,255,0.2)' : 'var(--bg-overlay)',
                borderRadius: 10, padding: '1px 6px',
              }}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Match cards grouped by day */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
        {matchesByDay.map(day => (
          <div key={day.key}>
            {/* Day header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--s3)',
            }}>
              <div style={{
                fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
                color: 'var(--accent)', whiteSpace: 'nowrap',
              }}>
                📅 {day.label}
              </div>
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)',
                background: 'var(--bg-overlay)', borderRadius: 10, padding: '2px 8px',
                whiteSpace: 'nowrap',
              }}>
                {day.items.length} jogo{day.items.length !== 1 ? 's' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
              {day.items.map(m => (
                <PhaseMatchCard
                  key={m.match_number}
                  match={m}
                  phaseKey={activePhase}
                  expanded={expandedMatch === m.match_number}
                  onToggle={() => setExpandedMatch(prev => prev === m.match_number ? null : m.match_number)}
                  allByNum={allByNum}
                  simByCode={simByCode}
                  navigate={navigate}
                />
              ))}
            </div>
          </div>
        ))}
        {matches.length === 0 && (
          <div style={{ textAlign: 'center', padding: 'var(--s8)', color: 'var(--text-4)', fontFamily: 'var(--font-cond)', fontSize: 14 }}>
            Nenhum jogo nesta fase ainda
          </div>
        )}
      </div>
    </div>
  )
}

function PhaseMatchCard({ match, phaseKey, expanded, onToggle, allByNum, simByCode, navigate }) {
  const isFinished  = match.status === 'finished'
  const isLive      = match.status === 'live'
  const hasSim      = !!match.id  // only R32 DB matches have id
  const meta        = ROAD_PHASE_META[phaseKey] || ROAD_PHASE_META.r32

  // Resolve team from label (e.g. "Winner Match 73") → { code, name, flag_url }
  function resolveTeam(team, label) {
    if (team) return team  // direct DB team (R32)
    const mn = parseFeedMatchNum(label)
    if (!mn) return null
    const src = allByNum[mn]
    return src ? null : null  // label matches not yet resolved
  }

  // For display: either real team or label text
  function teamDisplay(team, label) {
    if (team) return { name: PT_NAMES[team.code] || team.name, code: team.code, flag: team.flag_url, resolved: true }
    const mn = parseFeedMatchNum(label)
    if (mn) {
      const src = allByNum[mn]
      if (src?.team_a && src?.team_b) {
        // show as "KOR/SUI" to indicate one of these two
        const na = PT_NAMES[src.team_a.code] || src.team_a.name
        const nb = PT_NAMES[src.team_b.code] || src.team_b.name
        return { name: `${na} / ${nb}`, code: null, flag: null, resolved: false, srcMatch: src, srcA: src.team_a, srcB: src.team_b }
      }
    }
    return { name: label || '?', code: null, flag: null, resolved: false }
  }

  const tA = teamDisplay(match.team_a, match.team_a_label)
  const tB = teamDisplay(match.team_b, match.team_b_label)

  // Find the adversary in the next match
  function findAdversary() {
    if (!match.next_match_number) return null
    const nextM = allByNum[match.next_match_number]
    if (!nextM) return null
    const lA = nextM.team_a_label || ''
    const lB = nextM.team_b_label || ''
    const mnA = parseFeedMatchNum(lA)
    const mnB = parseFeedMatchNum(lB)
    const advLabel = mnA === match.match_number ? lB : lA
    const advMn    = mnA === match.match_number ? mnB : mnA
    const advSrc   = advMn ? allByNum[advMn] : null
    return {
      label: advLabel,
      matchNumber: advMn,
      teams: advSrc?.team_a && advSrc?.team_b ? { a: advSrc.team_a, b: advSrc.team_b } : null,
      phaseMeta: advSrc ? ROAD_PHASE_META[advSrc.phaseKey] : null,
    }
  }

  const adversary = findAdversary()

  // Prob from sim data
  const probA = match.team_a ? (simByCode[match.team_a.code]?.prob_title || 0) : 0
  const probB = match.team_b ? (simByCode[match.team_b.code]?.prob_title || 0) : 0

  const borderColor = isFinished ? 'var(--border)' : isLive ? 'var(--win)' : expanded ? 'var(--accent)' : 'var(--border)'

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden' }}>
    <div style={{
      background: 'var(--bg-card)',
      border: `1.5px solid ${borderColor}`,
      borderRadius: expanded ? '12px 12px 0 0' : 12,
      overflow: 'hidden',
      transition: 'border-color 200ms, border-radius 200ms',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px',
        background: isFinished ? 'var(--bg-overlay)' : isLive ? 'rgba(46,201,128,0.06)' : 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        flexWrap: 'wrap', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
            color: 'var(--accent)', background: 'rgba(15,122,120,0.12)',
            border: '1px solid rgba(15,122,120,0.3)', borderRadius: 4,
            padding: '2px 7px', letterSpacing: '0.04em',
          }}>
            {meta.icon} {meta.label}
          </span>
          {match.half && (
            <span className={`half-badge half-badge--${match.half}`}>Lado {match.half}</span>
          )}
          {isLive && <span className="badge badge-live">Ao vivo</span>}
          {isFinished && <span className="badge badge-done">Encerrado</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
              {fmtDayLabelBRT(match.match_date)}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
              {fmtTimeBRT(match.match_date)}
            </div>
          </div>
        </div>
      </div>

      {/* Venue */}
      {(match.venue || match.city) && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>📍</span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
            {[match.venue, match.city].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}

      {/* Teams */}
      <div style={{ padding: '14px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center' }}>
        {/* Team A */}
        <TeamSlot t={tA} align="left" />

        {/* Score / VS */}
        <div style={{ textAlign: 'center', minWidth: 60 }}>
          {isFinished && match.score_a != null ? (
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text-1)', letterSpacing: 2 }}>
              {match.score_a} – {match.score_b}
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 15, color: 'var(--text-4)', fontWeight: 700 }}>VS</div>
          )}
          {match.match_number && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>
              #{match.match_number}
            </div>
          )}
        </div>

        {/* Team B */}
        <TeamSlot t={tB} align="right" />
      </div>

      {/* Sim probabilities bar (only when real teams known) */}
      {match.team_a && match.team_b && (probA > 0 || probB > 0) && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', minWidth: 36 }}>{probA.toFixed(1)}%</span>
            <div style={{ flex: 1, height: 4, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${(probA / (probA + probB)) * 100}%`,
                background: 'var(--accent)', borderRadius: 2,
              }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', minWidth: 36, textAlign: 'right' }}>{probB.toFixed(1)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>
            <span>prob. título</span><span>prob. título</span>
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        {hasSim ? (
          <button
            onClick={() => navigate(`/partida/${match.id}`)}
            style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-surface)', color: 'var(--accent)',
              fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Simular ▶
          </button>
        ) : (
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
            {ROAD_PHASE_META[phaseKey]?.label}
          </span>
        )}

        {match.next_match_number && (
          <button
            onClick={onToggle}
            style={{
              padding: '5px 12px', borderRadius: 6, border: 'none',
              background: expanded ? 'var(--accent)' : 'var(--bg-overlay)',
              color: expanded ? '#fff' : 'var(--text-2)',
              fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, transition: 'all 150ms',
            }}
          >
            {expanded ? 'Fechar ▲' : 'Ver caminho ▼'}
          </button>
        )}
      </div>

    </div>
      {expanded && match.next_match_number && (
        <PathPanel
          match={match}
          adversary={adversary}
          allByNum={allByNum}
        />
      )}
    </div>
  )
}

function TeamSlot({ t, align }) {
  const right = align === 'right'
  if (!t) return <div />

  if (t.resolved && t.flag) {
    // Real team — full display
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', gap: 4,
      }}>
        <TeamCrestFlag src={t.flag} alt={t.code} style={{ width: 36, height: 26, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)' }} crestStyle={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6, background: 'var(--bg-overlay)' }} />
        <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)', textAlign: right ? 'right' : 'left', lineHeight: 1.2 }}>
          {t.name}
        </div>
      </div>
    )
  }

  if (!t.resolved && t.srcA && t.srcB) {
    // Two possible teams — show both flags small
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', gap: 4,
      }}>
        <div style={{ display: 'flex', gap: 3, flexDirection: right ? 'row-reverse' : 'row' }}>
          {[t.srcA, t.srcB].map(team => (
            <div key={team.code} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <TeamCrestFlag src={team.flag_url} alt={team.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)', opacity: 0.7 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)', opacity: 0.7 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>{team.code}</span>
            </div>
          ))}
        </div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', fontStyle: 'italic', textAlign: right ? 'right' : 'left' }}>
          vencedor
        </div>
      </div>
    )
  }

  // Generic label
  return (
    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic', textAlign: right ? 'right' : 'left' }}>
      {t.name}
    </div>
  )
}

function PathPanel({ match, adversary, allByNum }) {
  const nextM = match.next_match_number ? allByNum[match.next_match_number] : null
  const nextPhaseMeta = nextM ? ROAD_PHASE_META[nextM.phaseKey] : null

  // After next: the match that next feeds into
  const afterM = nextM?.next_match_number ? allByNum[nextM.next_match_number] : null
  const afterPhaseMeta = afterM ? ROAD_PHASE_META[afterM.phaseKey] : null

  return (
    <div style={{
      border: '1.5px solid var(--accent)',
      borderTop: '2px solid var(--accent)',
      background: 'rgba(15,122,120,0.04)',
      borderRadius: '0 0 12px 12px',
      padding: '14px',
    }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 10 }}>
        CAMINHO ATÉ A FINAL
      </div>

      {/* Next match */}
      {nextM && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 'var(--s3)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            <div>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
                color: 'var(--accent)', background: 'rgba(15,122,120,0.12)',
                border: '1px solid rgba(15,122,120,0.3)', borderRadius: 4,
                padding: '1px 7px', letterSpacing: '0.04em',
              }}>
                {nextPhaseMeta?.icon} {nextPhaseMeta?.label || 'Próxima fase'} · #{nextM.match_number}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>
                {fmtDateBRT(nextM.match_date || match.next_match_date)}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
                {fmtTimeBRT(nextM.match_date || match.next_match_date)}
              </div>
            </div>
          </div>

          {(nextM.venue || nextM.city || match.next_venue) && (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>📍</span>
              {[nextM.venue || match.next_venue, nextM.city || match.next_city].filter(Boolean).join(' · ')}
            </div>
          )}

          {adversary && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.05em', marginBottom: 6 }}>
                ADVERSÁRIO POTENCIAL
              </div>
              <AdversaryDisplay adversary={adversary} />
            </div>
          )}
        </div>
      )}

      {/* Further path (if exists) */}
      {afterM && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          background: 'var(--bg-overlay)', borderRadius: 8,
          marginBottom: 'var(--s2)',
        }}>
          <span style={{ fontSize: 14 }}>→</span>
          <div style={{ flex: 1 }}>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>
              {afterPhaseMeta?.icon} {afterPhaseMeta?.label || 'Próxima'} · #{afterM.match_number}
            </span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginLeft: 8 }}>
              {fmtDateBRT(afterM.match_date || nextM?.next_match_date)}
            </span>
          </div>
          {(afterM.venue || afterM.city) && (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>
              {afterM.city || match.next_city}
            </div>
          )}
        </div>
      )}

      {/* Final destination if not yet shown */}
      {!afterM && nextM?.next_match_number && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          background: 'var(--bg-overlay)', borderRadius: 8,
        }}>
          <span>→</span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
            {ROAD_PHASE_META[
              Object.keys(ROAD_PHASE_META).find(k => {
                const ph = nextM?.next_phase
                return ph === k
              }) || 'final'
            ]?.icon} {nextM.next_city || ''} · {fmtDateBRT(nextM.next_match_date)}
          </span>
        </div>
      )}
    </div>
  )
}

function AdversaryDisplay({ adversary }) {
  if (!adversary) return null

  if (adversary.teams) {
    const na = PT_NAMES[adversary.teams.a.code] || adversary.teams.a.name
    const nb = PT_NAMES[adversary.teams.b.code] || adversary.teams.b.name
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic' }}>Vencedor de</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TeamCrestFlag src={adversary.teams.a.flag_url} alt={adversary.teams.a.code}
            style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)' }}
            crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
          <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>{na}</span>
        </div>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>vs</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TeamCrestFlag src={adversary.teams.b.flag_url} alt={adversary.teams.b.code}
            style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)' }}
            crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
          <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>{nb}</span>
        </div>
        {adversary.matchNumber && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)' }}>(#{adversary.matchNumber})</span>
        )}
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic' }}>
      {adversary.label || 'A definir'}
      {adversary.matchNumber && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, marginLeft: 6 }}>(#{adversary.matchNumber})</span>
      )}
    </div>
  )
}
