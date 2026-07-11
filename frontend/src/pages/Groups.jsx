import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, CONF_HEX } from '../api'
import Spinner from '../components/Spinner'
import { PT_NAMES } from '../utils/teamNames'

export default function Groups() {
  const [groups, setGroups]     = useState({})
  const [qualified, setQual]    = useState({ winners: [], runners_up: [], best_thirds: [] })
  const [bracket, setBracket]   = useState([])
  const [loading, setLoad]      = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      api.get('/groups'),
      api.get('/tournament/official-bracket'),
    ])
      .then(([groupData, bracketData]) => {
        setGroups(groupData.groups || {})
        const qp = bracketData.qualified_picture || {}
        setQual({
          winners:    qp.winners    || [],
          runners_up: qp.runners_up || [],
          best_thirds: qp.best_thirds || [],
        })
        setBracket(bracketData.schedule || [])
      })
      .catch(console.error)
      .finally(() => setLoad(false))
  }, [])

  if (loading) return <Spinner text="Carregando grupos..." />

  const groupNames = Object.keys(groups).sort()

  // Build lookup sets for quick status check
  const winnerCodes   = new Set(qualified.winners.map(t => t.code))
  const runnerCodes   = new Set(qualified.runners_up.map(t => t.code))
  const bestThirdCodes = new Set(qualified.best_thirds.map(t => t.code))

  const totalQualified = qualified.winners.length + qualified.runners_up.length + qualified.best_thirds.length

  // Fase de grupos encerrada quando os 32 classificados estão definidos
  const stageOver = totalQualified >= 32

  // Fase atual do mata-mata = primeira fase com jogo ainda sem placar
  const PHASE_ORDER = ['r32', 'r16', 'qf', 'sf', '3rd', 'final']
  const PHASE_PT = {
    r32: '16avos de Final', r16: 'Oitavas de Final', qf: 'Quartas de Final',
    sf: 'Semifinais', '3rd': 'Disputa de 3º Lugar', final: 'Final',
  }
  const currentPhase = PHASE_ORDER.find(p =>
    bracket.some(m => m.phase === p && !Array.isArray(m.score))
  )

  const r32Bracket = bracket.filter(m => m.phase === 'r32' && (m.resolved_team_a || m.resolved_team_b || m.team_a_label || m.team_b_label))

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">FASE DE GRUPOS</h1>
        <p className="page-subtitle">
          {stageOver
            ? 'Encerrada · Tabelas finais dos 12 grupos · 32 seleções classificadas'
            : '12 Grupos · 48 Seleções · Top 2 + 8 melhores 3ºs avançam'}
        </p>
      </div>

      {/* ── Legenda ──────────────────────────────────────────────────── */}
      <div className="card mt-6 fade-in-2" style={{ padding: 'var(--s4) var(--s5)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s4)', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Legenda:
            </span>
            <LegendaBadge color="var(--win)"    label="1º Classificado" />
            <LegendaBadge color="var(--accent)" label="2º Classificado" />
            <LegendaBadge color="#e8a030"       label="3º (melhor colocado)" />
            <LegendaBadge color="var(--text-4)" label="Eliminado" />
          </div>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>
            {stageOver ? 'Fase encerrada · 32 classificadas' : `${totalQualified}/32 seleções definidas`}
          </span>
        </div>
      </div>

      {/* ── Fase encerrada: CTA pro mata-mata ─────────────────────────── */}
      {stageOver && (
        <div
          className="card card--accent mt-6 fade-in-3"
          onClick={() => navigate('/torneio')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 'var(--s4)', padding: 'var(--s4) var(--s5)', cursor: 'pointer', flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
            <span style={{ fontSize: 26 }}>🏆</span>
            <div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Mata-mata em andamento{currentPhase ? ` · ${PHASE_PT[currentPhase]}` : ''}
              </div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                A fase de grupos acabou — acompanhe o chaveamento, resultados e projeções de título.
              </div>
            </div>
          </div>
          <span className="btn btn-sm">Ver chaveamento →</span>
        </div>
      )}

      {/* ── Chaveamento parcial R32 (só durante a fase de grupos) ─────── */}
      {!stageOver && r32Bracket.length > 0 && (
        <div className="card mt-6 fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              ⚔️ Confrontos Projetados — 16avos de Final
            </span>
            <span className="badge badge-group">
              {r32Bracket.filter(m => m.resolved_team_a && m.resolved_team_b).length}/{r32Bracket.length} definidos
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 'var(--s2)', padding: 'var(--s4)' }}>
            {r32Bracket.map(m => {
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
                    opacity: resolved ? 1 : 0.55,
                    minHeight: 52,
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--accent)',
                    minWidth: 44, letterSpacing: '0.06em', flexShrink: 0,
                  }}>
                    {m.section}
                  </span>
                  <BracketSlot team={ta} label={m.team_a_label} />
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', flexShrink: 0 }}>vs</span>
                  <BracketSlot team={tb} label={m.team_b_label} right />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Classificados ────────────────────────────────────────────── */}
      {totalQualified > 0 && (
        <div className="card mt-6 fade-in-3">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              ✅ {stageOver ? 'Classificados ao Mata-Mata' : 'Classificados Parciais'}
            </span>
            <span className="badge badge-group">{totalQualified}/32</span>
          </div>
          <div style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
            {qualified.winners.length > 0 && (
              <QualifiedGroup
                title="Primeiros Colocados"
                teams={qualified.winners}
                color="var(--win)"
                navigate={navigate}
              />
            )}
            {qualified.runners_up.length > 0 && (
              <QualifiedGroup
                title="Segundos Colocados"
                teams={qualified.runners_up}
                color="var(--accent)"
                navigate={navigate}
              />
            )}
            {qualified.best_thirds.length > 0 && (
              <QualifiedGroup
                title={`Melhores Terceiros (${qualified.best_thirds.length}/8)`}
                teams={qualified.best_thirds}
                color="#e8a030"
                navigate={navigate}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Grade dos grupos ─────────────────────────────────────────── */}
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
                  {teams.filter(t => t.played > 0).length}/{teams.length} jogaram
                </span>
              </div>

              {/* Tabela de classificação */}
              <div>
                {teams.map((t, i) => {
                  const isWinner     = winnerCodes.has(t.code)
                  const isRunner     = runnerCodes.has(t.code)
                  const isBestThird  = bestThirdCodes.has(t.code)
                  const statusColor  = isWinner ? 'var(--win)' : isRunner ? 'var(--accent)' : isBestThird ? '#e8a030' : null
                  const statusLabel  = isWinner ? '1º' : isRunner ? '2º' : isBestThird ? '3º*' : null

                  return (
                    <div
                      key={t.code}
                      className="group-team-row"
                      onClick={() => navigate(`/grupos/${t.id}`)}
                      style={statusColor ? { borderLeft: `3px solid ${statusColor}` } : { borderLeft: '3px solid transparent' }}
                    >
                      <span className="group-team-row__pos" style={statusColor ? { color: statusColor, fontWeight: 700 } : {}}>
                        {t.position ?? i + 1}
                      </span>
                      {t.flag_url && (
                        <img src={t.flag_url} alt={t.code} style={{
                          width: 22, height: 16, objectFit: 'cover',
                          borderRadius: 1, border: '1px solid var(--border)'
                        }} />
                      )}
                      <span className="group-team-row__name" style={{ flex: 1 }}>
                        {PT_NAMES[t.code] || t.name}
                      </span>
                      {statusLabel && (
                        <span style={{
                          fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 800,
                          color: statusColor, letterSpacing: '0.06em',
                          background: `${statusColor}22`,
                          padding: '1px 5px', borderRadius: 3,
                        }}>
                          {statusLabel}
                        </span>
                      )}
                      <span className="group-team-row__elo" title="Pontos">
                        {t.points ?? 0}p
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Stats detalhadas */}
              <div style={{
                padding: '0 var(--s4) var(--s3)',
                color: 'var(--text-3)',
                fontFamily: 'var(--font-data)',
                fontSize: 10,
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '16px minmax(0,1fr) 24px 20px 20px 20px 20px 28px',
                  gap: 'var(--s1)',
                  paddingBottom: 4,
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--text-4)',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontSize: 9,
                }}>
                  <span>#</span><span>Time</span>
                  <span title="Jogos">J</span>
                  <span title="Vitórias">V</span>
                  <span title="Empates">E</span>
                  <span title="Derrotas">D</span>
                  <span title="Saldo de Gols">SG</span>
                  <span title="Pontos">Pts</span>
                </div>
                {teams.map(team => {
                  const isWinner    = winnerCodes.has(team.code)
                  const isRunner    = runnerCodes.has(team.code)
                  const isBestThird = bestThirdCodes.has(team.code)
                  const color       = isWinner ? 'var(--win)' : isRunner ? 'var(--accent)' : isBestThird ? '#e8a030' : 'var(--text-3)'
                  return (
                    <div key={`${team.code}-stats`} style={{
                      display: 'grid',
                      gridTemplateColumns: '16px minmax(0,1fr) 24px 20px 20px 20px 20px 28px',
                      gap: 'var(--s1)',
                      paddingTop: 5,
                      color,
                    }}>
                      <span>{team.position}º</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team.code}</span>
                      <span>{team.played ?? 0}</span>
                      <span>{team.wins ?? 0}</span>
                      <span>{team.draws ?? 0}</span>
                      <span>{team.losses ?? 0}</span>
                      <span>{(team.gd ?? 0) > 0 ? `+${team.gd}` : team.gd ?? 0}</span>
                      <span style={{ fontWeight: 700 }}>{team.points ?? 0}</span>
                    </div>
                  )
                })}
              </div>

              {/* Jogos do grupo */}
              <div style={{
                padding: 'var(--s3) var(--s4)',
                borderTop: '1px solid var(--border)',
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

// ── Sub-componentes ────────────────────────────────────────────────────────────

function LegendaBadge({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)' }}>{label}</span>
    </div>
  )
}

function QualifiedGroup({ title, teams, color, navigate }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700,
        color, letterSpacing: '0.08em', textTransform: 'uppercase',
        marginBottom: 'var(--s3)',
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        {[...teams].sort((a, b) => (a.group_name || '').localeCompare(b.group_name || '')).map(t => (
          <div
            key={t.code}
            onClick={() => navigate(`/grupos/${t.id}`)}
            title={`${t.name} — Grupo ${t.group_name} · ${t.points}pts`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 8px',
              background: `${color}18`,
              border: `1px solid ${color}44`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {t.flag_url && (
              <img src={t.flag_url} alt={t.code} style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 1 }} />
            )}
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>
              {PT_NAMES[t.code] || t.code}
            </span>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)' }}>
              G{t.group_name}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BracketSlot({ team, label, right }) {
  if (team) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--s2)',
        flex: 1, justifyContent: right ? 'flex-end' : 'flex-start',
      }}>
        {!right && team.flag_url && (
          <img src={team.flag_url} alt={team.code} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1, border: '1px solid var(--border)', flexShrink: 0 }} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>{PT_NAMES[team.code] || team.code}</span>
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)' }}>{team.points}pts G{team.group_name}</span>
        </div>
        {right && team.flag_url && (
          <img src={team.flag_url} alt={team.code} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1, border: '1px solid var(--border)', flexShrink: 0 }} />
        )}
      </div>
    )
  }
  const shortLabel = label
    ? label
        .replace('Winner Group ', 'W-')
        .replace('Runner-up Group ', 'R-')
        .replace('3rd Group ', '3º ')
    : '?'
  return (
    <div style={{ flex: 1, display: 'flex', justifyContent: right ? 'flex-end' : 'flex-start' }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', fontStyle: 'italic' }}>{shortLabel}</span>
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {m.team_a.flag_url && <img src={m.team_a.flag_url} alt={m.team_a.code} style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 1, border: '1px solid var(--border)', flexShrink: 0 }} />}
            {m.team_a.code}
          </span>
          <span style={{ color: 'var(--text-4)' }}>
            {m.status === 'finished' && m.result
              ? `${m.result.score_a}–${m.result.score_b}`
              : (m.live_score_a != null || m.live_score_b != null)
                ? `${m.live_score_a ?? '-'}–${m.live_score_b ?? '-'}`
              : 'vs'}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {m.team_b.code}
            {m.team_b.flag_url && <img src={m.team_b.flag_url} alt={m.team_b.code} style={{ width: 16, height: 11, objectFit: 'cover', borderRadius: 1, border: '1px solid var(--border)', flexShrink: 0 }} />}
          </span>
          {m.status === 'finished' && <span className="badge badge-done" style={{ marginLeft: 4 }}>FIM</span>}
          {m.status === 'live' && <span className="badge badge-live" style={{ marginLeft: 4 }}>{m.status_raw || 'AO VIVO'}</span>}
        </div>
      ))}
    </div>
  )
}
