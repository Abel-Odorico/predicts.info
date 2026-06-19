import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, CONF_HEX } from '../api'
import Spinner from '../components/Spinner'

export default function Groups() {
  const [groups, setGroups]   = useState({})
  const [ranking, setRanking] = useState([])
  const [bracket, setBracket] = useState([])
  const [loading, setLoad]    = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      api.get('/groups'),
      api.get('/ranking?limit=3'),
      api.get('/tournament/official-bracket'),
    ])
      .then(([groupData, rankData, bracketData]) => {
        setGroups(groupData.groups || {})
        setRanking(rankData || [])
        setBracket((bracketData.schedule || []).filter(m => m.phase === 'r32'))
      })
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [])

  if (loading) return <Spinner text="Carregando grupos..." />

  const groupNames = Object.keys(groups).sort()

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">FASE DE GRUPOS</h1>
        <p className="page-subtitle">12 Grupos · 48 Seleções · Fase de Grupos</p>
      </div>

      {/* ── Top 3 Bolão ─────────────────────────────────────────────── */}
      {ranking.length > 0 && (
        <div className="card mt-6 fade-in-2">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              🏅 Top 3 Bolão
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/ranking')}>
              Ver ranking completo →
            </button>
          </div>
          <div className="card__body" style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
            {ranking.map((r, i) => {
              const medals = ['🥇', '🥈', '🥉']
              const accentColors = ['var(--accent)', 'var(--text-2)', 'var(--win)']
              return (
                <div
                  key={r.user_id}
                  onClick={() => navigate(`/usuarios/${r.user_id}/historico`)}
                  style={{
                    flex: '1 1 160px',
                    padding: 'var(--s4)',
                    background: 'var(--bg-overlay)',
                    borderRadius: 'var(--radius)',
                    border: `1px solid ${i === 0 ? 'var(--border-accent)' : 'var(--border)'}`,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--s2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                    <span style={{ fontSize: 22 }}>{medals[i]}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: accentColors[i], lineHeight: 1 }}>
                      {r.position}º
                    </span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name}
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s3)', fontFamily: 'var(--font-data)', fontSize: 12 }}>
                    <span style={{ color: accentColors[i], fontWeight: 700 }}>{r.total_points} pts</span>
                    <span style={{ color: 'var(--text-3)' }}>{r.exact_scores} exatos</span>
                    <span style={{ color: 'var(--text-3)' }}>{r.total_bets} apostas</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Chaveamento parcial R32 ───────────────────────────────────── */}
      {bracket.length > 0 && (
        <div className="card mt-6 fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              ⚔️ Chaveamento Parcial — Oitavas
            </span>
            <span className="badge badge-group">{bracket.filter(m => m.resolved_team_a && m.resolved_team_b).length}/{bracket.length} definidos</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--s2)', padding: 'var(--s4)' }}>
            {bracket.map(m => {
              const ta = m.resolved_team_a
              const tb = m.resolved_team_b
              const resolved = ta && tb
              return (
                <div
                  key={m.section}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--s3)',
                    padding: 'var(--s3) var(--s4)',
                    background: 'var(--bg-overlay)',
                    borderRadius: 'var(--radius)',
                    border: `1px solid ${resolved ? 'var(--border-accent)' : 'var(--border)'}`,
                    opacity: resolved ? 1 : 0.6,
                    minHeight: 52,
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--accent)', minWidth: 40, letterSpacing: '0.06em' }}>
                    {m.section}
                  </span>
                  <BracketTeam team={ta} label={m.team_a_label} />
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', padding: '0 var(--s1)' }}>vs</span>
                  <BracketTeam team={tb} label={m.team_b_label} right />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="groups-grid mt-8 fade-in-2">
        {groupNames.map((g, gi) => {
          const teams = groups[g] || []
          return (
            <div
              key={g}
              className="card"
              style={{ animationDelay: `${gi * 30}ms` }}
            >
              <div className="card__header">
                <span className="group-card__title">GRUPO {g}</span>
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
                  {teams.length} seleções
                </span>
              </div>
              <div>
                {teams.map((t, i) => (
                  <div
                    key={t.code}
                    className="group-team-row"
                    onClick={() => navigate(`/grupos/${t.id}`)}
                  >
                    <span className="group-team-row__pos">{t.position ?? i + 1}</span>
                    {t.flag_url && (
                      <img src={t.flag_url} alt={t.code} style={{
                        width: 22, height: 16, objectFit: 'cover',
                        borderRadius: 1, border: '1px solid var(--border)'
                      }} />
                    )}
                    <span className="group-team-row__name">
                      {t.name}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700,
                      color: CONF_HEX[t.confederation] || 'var(--text-3)',
                      letterSpacing: '0.06em'
                    }}>
                      {t.code}
                    </span>
                    <span className="group-team-row__elo" title="Pontos / Jogos / Saldo">
                      {t.points ?? 0} pts
                    </span>
                  </div>
                ))}
              </div>
              <div style={{
                padding: '0 var(--s4) var(--s4)',
                color: 'var(--text-3)',
                fontFamily: 'var(--font-data)',
                fontSize: 11,
              }}>
                {teams.map(team => (
                  <div key={`${team.code}-stats`} style={{
                    display: 'grid',
                    gridTemplateColumns: '42px minmax(0,1fr) repeat(4, 34px)',
                    gap: 'var(--s2)',
                    paddingTop: '6px',
                  }}>
                    <span>{team.position}º</span>
                    <span>{team.code}</span>
                    <span title="Jogos">{team.played ?? 0}J</span>
                    <span title="Vitórias">{team.wins ?? 0}V</span>
                    <span title="Saldo">{team.gd ?? 0}SG</span>
                    <span title="Pontos">{team.points ?? 0}P</span>
                  </div>
                ))}
              </div>
              <div style={{
                padding: 'var(--s3) var(--s4)',
                borderTop: '1px solid var(--border)',
                textAlign: 'center'
              }}>
                <GroupMatchLinks groupName={g} navigate={navigate} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BracketTeam({ team, label, right }) {
  if (team) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flex: 1, justifyContent: right ? 'flex-end' : 'flex-start' }}>
        {!right && team.flag_url && (
          <img src={team.flag_url} alt={team.code} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1, border: '1px solid var(--border)', flexShrink: 0 }} />
        )}
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{team.code}</span>
        {right && team.flag_url && (
          <img src={team.flag_url} alt={team.code} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1, border: '1px solid var(--border)', flexShrink: 0 }} />
        )}
      </div>
    )
  }
  const shortLabel = label
    ? label.replace('Winner Group ', 'W-').replace('Runner-up Group ', 'R-').replace('3rd Group ', '3º ')
    : '?'
  return (
    <div style={{ flex: 1, display: 'flex', justifyContent: right ? 'flex-end' : 'flex-start' }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>{shortLabel}</span>
    </div>
  )
}

function GroupMatchLinks({ groupName, navigate }) {
  const [matches, setMatches] = useState([])

  useEffect(() => {
    let mounted = true

    async function loadMatches() {
      try {
        const data = await api.get(`/matches?group_name=${groupName}&limit=6`)
        if (mounted) setMatches(data)
      } catch (_) {}
    }

    loadMatches()
    const intervalId = window.setInterval(loadMatches, 10000)
    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [groupName])

  if (!matches.length) return null

  return (
    <div className="group-links">
      {matches.slice(0, 3).map(m => (
        <div
          key={m.id}
          onClick={() => navigate(`/partida/${m.id}`)}
          className="group-links__item"
        >
          <span>{m.team_a.code}</span>
          <span style={{ color: 'var(--text-4)' }}>
            {m.status === 'finished' && m.result
              ? `${m.result.score_a}–${m.result.score_b}`
              : (m.live_score_a != null || m.live_score_b != null)
                ? `${m.live_score_a ?? '-'}–${m.live_score_b ?? '-'}`
              : 'vs'}
          </span>
          <span>{m.team_b.code}</span>
          {m.status === 'finished' && <span className="badge badge-done" style={{ marginLeft: 4 }}>FIM</span>}
          {m.status === 'live' && <span className="badge badge-live" style={{ marginLeft: 4 }}>{m.status_raw || 'AO VIVO'}</span>}
        </div>
      ))}
    </div>
  )
}
