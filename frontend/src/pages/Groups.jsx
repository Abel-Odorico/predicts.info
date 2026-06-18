import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, CONF_HEX } from '../api'
import Spinner from '../components/Spinner'

export default function Groups() {
  const [groups, setGroups] = useState({})
  const [loading, setLoad]  = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/groups')
      .then(data => setGroups(data.groups || {}))
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [])

  if (loading) return <Spinner text="Carregando grupos..." />

  const groupNames = Object.keys(groups).sort()

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">FASE DE GRUPOS</h1>
        <p className="page-subtitle">12 Grupos · 48 Seleções · Copa do Mundo 2026</p>
      </div>

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
