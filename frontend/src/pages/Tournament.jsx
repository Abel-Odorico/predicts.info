import { useState, useEffect, useMemo } from 'react'
import { api, CONF_HEX, heatClass } from '../api'
import Spinner from '../components/Spinner'
import { PT_NAMES } from '../utils/teamNames'

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

  useEffect(() => {
    Promise.all([
      api.get(`/tournament/simulate?n=${simN}`),
      api.get('/tournament/official-bracket'),
      api.get('/groups'),
    ])
      .then(([sim, br, gr]) => { setData(sim); setBracket(br); setGroups(gr.groups || {}) })
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [])

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
    t.sort((a, b) => sortDir * ((b[sortKey] || 0) - (a[sortKey] || 0)))
    return t
  }, [data, sortKey, sortDir, filter, confFilter])

  const top3 = useMemo(() => {
    if (!data?.teams) return []
    return [...data.teams].sort((a, b) => (b.prob_title || 0) - (a.prob_title || 0)).slice(0, 3)
  }, [data])

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

  if (loading) return <Spinner text="Rodando simulações do torneio..." />

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">SIMULAÇÃO DO TORNEIO</h1>
        <p className="page-subtitle">
          {data?.simulations.toLocaleString('pt-BR')} simulações · {data?.elapsed_ms}ms
          {data?.cached && ' · cache'}
        </p>
      </div>

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
                      <img src={t.flag_url} alt={t.code} style={{
                        width: rank === 1 ? 40 : 30, height: rank === 1 ? 28 : 21,
                        objectFit: 'cover', borderRadius: 2, border: '1px solid var(--border)'
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
                      <img src={t.flag_url} alt={t.code} style={{
                        width: 20, height: 14, objectFit: 'cover',
                        borderRadius: 1, border: '1px solid var(--border)'
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
        <ProjectionsSection data={data} className="mt-6 fade-in-3" />
      )}

      {bracket && (
        <CompetitionSection bracket={bracket} groups={groups} className="mt-6 fade-in-3" />
      )}

      {bracket && (
        <KnockoutBracket bracket={bracket} className="mt-6 fade-in-3" />
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

function ProjectionsSection({ data, className }) {
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
        {tab === 'ranking' && <TopChampionsView teams={data.teams || []} />}
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
      {flag && <img src={flag} alt={code} className="team-chip__flag" />}
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
                  {t.flag_url && <img src={t.flag_url} alt={t.code} className="team-chip__flag" />}
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

function TopChampionsView({ teams }) {
  const top20 = [...teams].sort((a, b) => (b.prob_title || 0) - (a.prob_title || 0)).slice(0, 20)
  const maxProb = top20[0]?.prob_title || 1
  return (
    <div className="stack gap-2">
      {top20.map((t, i) => (
        <div key={t.code} className="proj-champ-row">
          <span className="proj-champ-row__rank" style={{ color: i < 3 ? 'var(--accent)' : 'var(--text-4)' }}>
            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
          </span>
          {t.flag_url && <img src={t.flag_url} alt={t.code} className="team-chip__flag" />}
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

function CompetitionSection({ bracket, groups, className }) {
  const schedule = bracket?.schedule || []
  const phases = ['groups', ...PHASE_ORDER.filter(p => p !== 'groups' && schedule.some(m => m.phase === p))]
  const [active, setActive] = useState('groups')

  // match_number → match for label resolution
  const matchLookup = useMemo(() => {
    const m = {}
    for (const s of schedule) m[s.match_number] = s
    return m
  }, [schedule])

  const byPhase = useMemo(() => {
    const m = {}
    for (const s of schedule) {
      if (!m[s.phase]) m[s.phase] = []
      m[s.phase].push(s)
    }
    return m
  }, [schedule])

  return (
    <div className={`card ${className || ''}`}>
      {/* Phase tabs */}
      <div className="phase-nav">
        {phases.map(p => (
          <button
            key={p}
            className={`phase-nav__tab ${active === p ? 'active' : ''}`}
            onClick={() => setActive(p)}
          >
            <span className="phase-nav__icon">{PHASE_META[p]?.icon}</span>
            {PHASE_META[p]?.label || p}
            {p !== 'groups' && byPhase[p] && (
              <span className="phase-nav__count">{byPhase[p].length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="card__body">
        {active === 'groups' && groups && (
          <GroupsView groups={groups} bracket={bracket} />
        )}
        {active !== 'groups' && byPhase[active] && (
          <PhaseView matches={byPhase[active]} phase={active} matchLookup={matchLookup} />
        )}
        {active !== 'groups' && !byPhase[active] && (
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
                      ? <img src={t.flag_url} alt={t.code} className="comp-group-row__flag" />
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
  const probA = ta && tb ? eloWinProb(ta.elo_rating, tb.elo_rating) : null
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
        />
      </div>
    </div>
  )
}

function eloWinProb(eloA, eloB) {
  // P(A beats B) from Elo formula, excludes draw
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400))
}

function KoTeamRow({ team, label, candidates, matchLookup, winProb }) {
  if (team) {
    const eloNorm = Math.min(100, Math.max(0, ((team.elo_rating - 1400) / 700) * 100))
    const probPct = winProb != null ? Math.round(winProb * 100) : null
    return (
      <div className="ko-team">
        {team.flag_url
          ? <img src={team.flag_url} alt={team.code} className="ko-team__flag" />
          : <span className="ko-team__flag-ph" />
        }
        <div className="ko-team__info">
          <span className="ko-team__name">{PT_NAMES[team.code] || team.name}</span>
          <span className="ko-team__code">{team.code} · G{team.group_name}{team.position}</span>
        </div>
        <div className="ko-team__elo-wrap">
          {probPct != null && (
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
  const result = m?.result
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
            ? <img src={ta.flag_url} alt={ta.code} className="bk2-flag" />
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
            ? <img src={tb.flag_url} alt={tb.code} className="bk2-flag" />
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
  const result = m?.result
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
                ? <img src={team.flag_url} alt={team.code} style={{ width:26, height:18, objectFit:'cover', borderRadius:2, border:'1px solid var(--border)' }} />
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
