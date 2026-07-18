import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import { invalidateChampionCache } from '../components/MyChampionCard'
import TeamCrestFlag from '../components/TeamCrestFlag'

function useChampionStatus() {
  const [deadline, setDeadline] = useState(null)
  const [canChange, setCanChange] = useState(false)
  const [diff, setDiff] = useState(0)

  useEffect(() => {
    api.get('/champion/status').then(d => {
      const dl = new Date(d.deadline)
      setDeadline(dl)
      setCanChange(d.can_change)
      setDiff(dl - Date.now())
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!deadline) return
    const id = setInterval(() => setDiff(deadline - Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadline])

  const countdown = diff > 0 ? (() => {
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    return `${h}h ${m}m ${s}s`
  })() : null

  return { countdown, canChange, deadline }
}

function TeamGrid({ teams, myTeamId, blockedSet, statMap, onPick, saving, canPick, accentColor, halfMap }) {
  const [filter, setFilter] = useState('')
  const filtered = teams.filter(t =>
    !filter || t.name.toLowerCase().includes(filter.toLowerCase()) || t.code.toLowerCase().includes(filter.toLowerCase())
  )
  return (
    <>
      <input
        className="form-input"
        placeholder="🔍 Buscar seleção..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{ marginBottom: 'var(--s3)', fontFamily: 'var(--font-cond)' }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
        {filtered.map(team => {
          const isMyPick  = myTeamId === team.id
          const isBlocked = blockedSet ? blockedSet.has(team.id) : false
          const stat      = statMap[team.id]
          const half      = halfMap ? halfMap[team.id] : null
          return (
            <button
              key={team.id}
              onClick={() => canPick && !isBlocked && onPick(team)}
              disabled={saving || !canPick || isBlocked}
              title={isBlocked ? 'Mesmo lado do chaveamento — não pode chegar na final juntos' : undefined}
              style={{
                background: isMyPick ? `${accentColor}22` : isBlocked ? 'var(--bg-overlay)' : 'var(--bg-surface)',
                border: `2px solid ${isMyPick ? accentColor : 'var(--border)'}`,
                borderRadius: 10, padding: '10px 8px',
                cursor: canPick && !isBlocked ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                transition: 'border-color 0.15s, background 0.15s',
                opacity: (saving || isBlocked) ? 0.4 : 1,
                position: 'relative',
              }}
              onMouseEnter={e => { if (!isMyPick && canPick && !isBlocked) e.currentTarget.style.borderColor = accentColor }}
              onMouseLeave={e => { if (!isMyPick) e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              {half && (
                <span
                  className={`half-badge half-badge--${half}`}
                  style={{ position: 'absolute', top: 4, right: 4 }}
                  title={`Lado ${half} do chaveamento`}
                >
                  {half}
                </span>
              )}
              <TeamCrestFlag src={team.flag_url} alt={team.code} style={{ width: 38, height: 27, objectFit: 'cover', borderRadius: 3 }} crestStyle={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, background: 'var(--bg-overlay)' }} />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>
                {team.code}
              </span>
              {stat && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: accentColor }}>{stat.pct}%</span>
              )}
              {isMyPick && (
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: accentColor, fontWeight: 700 }}>✓ seu pick</span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

function CurrentPickBadge({ pick, label, color }) {
  if (!pick) return (
    <div style={{
      background: 'var(--bg-overlay)', border: '1.5px dashed var(--border)',
      borderRadius: 10, padding: '12px 16px', marginBottom: 'var(--s3)',
      fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)',
    }}>
      {label} — clique em um time abaixo
    </div>
  )
  return (
    <div style={{
      background: `${color}12`, border: `2px solid ${color}`,
      borderRadius: 10, padding: '12px 16px', marginBottom: 'var(--s3)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <TeamCrestFlag src={pick.flag} alt={pick.code} style={{ width: 38, height: 27, objectFit: 'cover', borderRadius: 3 }} crestStyle={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, background: 'var(--bg-overlay)' }} />
      <div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color, letterSpacing: '0.08em' }}>{label.toUpperCase()}</div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{pick.name || pick.code}</div>
      </div>
    </div>
  )
}

export default function ChampionPick() {
  const { user, token } = useAuth()
  const { countdown, canChange, deadline } = useChampionStatus()

  const [teams, setTeams]       = useState([])
  const [stats, setStats]       = useState({ champion: [], runner_up: [] })
  const [allPicks, setAllPicks] = useState([])
  const [myPick, setMyPick]     = useState(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const [halfMap, setHalfMap]   = useState({})  // teamId → 'A' | 'B'

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [teamsData, statsData, picksData, sidesData] = await Promise.all([
          api.get('/teams'),
          api.get('/champion/picks/stats'),
          api.get('/champion/picks/all'),
          api.get('/tournament/bracket-sides').catch(() => ({ half_a: [], half_b: [] })),
        ])
        setTeams(teamsData)
        setStats(statsData)
        setAllPicks(picksData)
        const map = {}
        for (const t of (sidesData.half_a || [])) map[t.id] = 'A'
        for (const t of (sidesData.half_b || [])) map[t.id] = 'B'
        setHalfMap(map)
        if (token) {
          try { setMyPick(await api.get('/champion/pick', token)) } catch {}
        }
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [token])

  async function pickTeam(team, type) {
    if (!token || !canChange) return
    setSaving(true)
    setMsg('')
    try {
      const body = type === 'champion'
        ? { team_id: team.id }
        : { runner_up_team_id: team.id }
      const res = await api.post('/champion/pick', body, token)
      setMyPick(res)
      invalidateChampionCache()
      const label = type === 'champion' ? 'Campeão' : 'Vice-campeão'
      setMsg(`✓ ${label} salvo — ${team.name || team.code}`)
      const [statsData, picksData] = await Promise.all([
        api.get('/champion/picks/stats'),
        api.get('/champion/picks/all'),
      ])
      setStats(statsData)
      setAllPicks(picksData)
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || ''
      setMsg(detail || 'Erro ao salvar palpite')
    } finally {
      setSaving(false)
    }
  }

  const champStatMap   = Object.fromEntries((stats.champion  || []).map(s => [s.team_id, s]))
  const ruStatMap      = Object.fromEntries((stats.runner_up || []).map(s => [s.team_id, s]))
  const myChampId      = myPick?.champion?.team_id
  const myRunnerUpId   = myPick?.runner_up?.team_id
  const canPick        = !!user && canChange

  // Teams from same bracket half as champion can't also be vice (they'd meet before the final)
  const champHalf      = myChampId ? halfMap[myChampId] : null
  const ruHalf         = myRunnerUpId ? halfMap[myRunnerUpId] : null
  // For vice grid: block champion team AND all teams from same half as champion
  const sameHalfAsChamp = champHalf ? new Set(Object.entries(halfMap).filter(([,h]) => h === champHalf).map(([id]) => Number(id))) : new Set()
  const sameHalfAsRu    = ruHalf ? new Set(Object.entries(halfMap).filter(([,h]) => h === ruHalf).map(([id]) => Number(id))) : new Set()

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:60 }}><Spinner /></div>

  return (
    <div className="page fade-in-1">
    <div style={{ maxWidth: 720, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ padding: 'var(--s5) 0 var(--s4)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px,6vw,42px)', color: 'var(--text-1)', margin: 0 }}>
          🏆 CAMPEÃO DA COPA
        </h1>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', margin: '4px 0 0' }}>
          Escolha o campeão e o vice-campeão da Copa do Mundo 2026
        </p>
      </div>

      {/* Banner de reabertura */}
      {canChange && (
        <div style={{
          background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 'var(--s4)',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>🔓</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: '#fff', letterSpacing: '0.06em' }}>
              PALPITES REABERTOS — FASE ELIMINATÓRIA
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'rgba(255,255,255,0.80)', marginTop: 2 }}>
              {countdown
                ? <>Fecha em <strong style={{ color: '#fff' }}>{countdown}</strong> — antes do 1º jogo do mata-mata</>
                : 'Atualize seu palpite agora!'
              }
            </div>
          </div>
        </div>
      )}

      {/* Resumo dos palpites */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 'var(--s4)' }}>
        {[
          { emoji: '🏆', label: 'Campeão',      pts: '+100 pts', color: 'var(--accent)', pick: myPick?.champion },
          { emoji: '🥈', label: 'Vice-Campeão', pts: '+50 pts',  color: '#d4af37',       pick: myPick?.runner_up },
        ].map(({ emoji, label, pts, color, pick }) => (
          <div key={label} style={{
            background: pick ? `${color}12` : 'var(--bg-surface)',
            border: `1.5px solid ${pick ? color : 'var(--border)'}`,
            borderRadius: 12, padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 6,
            transition: 'border-color 0.2s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.08em' }}>
                {emoji} {label.toUpperCase()}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color }}>{pts}</span>
            </div>
            {pick ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <TeamCrestFlag src={pick.flag} alt={pick.code} style={{ width: 36, height: 25, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} crestStyle={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 6, background: 'var(--bg-overlay)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1)', lineHeight: 1.2 }}>
                    {pick.name || pick.code}
                  </div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color, marginTop: 2 }}>✓ escolhido</div>
                </div>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)', fontStyle: 'italic' }}>
                não escolhido ainda
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Countdown */}
      <div style={{
        background: canChange ? 'rgba(15,122,120,0.08)' : 'rgba(232,82,82,0.08)',
        border: `1px solid ${canChange ? 'rgba(15,122,120,0.25)' : 'rgba(232,82,82,0.25)'}`,
        borderRadius: 10, padding: '12px 16px', marginBottom: 'var(--s4)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)' }}>
          {canChange ? '⏳ Prazo para palpitar' : '🔒 Prazo encerrado'}
        </span>
        {canChange
          ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{countdown || '...'}</span>
          : <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)' }}>Palpites encerrados</span>
        }
      </div>

      {msg && (
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: msg.startsWith('✓') ? 'var(--win)' : 'var(--lose)', margin: '0 0 var(--s3)' }}>
          {msg}
        </p>
      )}

      {!user && (
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginBottom: 'var(--s3)' }}>
          <a href="/login" style={{ color: 'var(--accent)' }}>Entre</a> para registrar seu palpite.
        </p>
      )}

      {(!canChange && !myPick) ? (
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6) 0' }}>
          Prazo encerrado. Aguarde os resultados do mata-mata.
        </p>
      ) : (
        <>
          {/* ── Seção Campeão ── */}
          <div style={{ marginBottom: 'var(--s6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--s3)' }}>
              <span style={{ fontSize: 22 }}>🏆</span>
              <div>
                <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 16, color: 'var(--text-1)' }}>Campeão</div>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>Acerte e ganhe +100 pts</div>
              </div>
            </div>


            {stats.champion?.length > 0 && (
              <div style={{ marginBottom: 'var(--s3)' }}>
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 8 }}>FAVORITOS DO BOLÃO</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {stats.champion.slice(0, 5).map(s => (
                    <div key={s.team_id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', borderRadius: 8, padding: '5px 10px' }}>
                      <TeamCrestFlag src={s.flag} alt={s.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{s.code}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{s.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canPick && (
              <TeamGrid
                teams={teams}
                myTeamId={myChampId}
                blockedSet={myRunnerUpId ? new Set([myRunnerUpId, ...sameHalfAsRu]) : undefined}
                statMap={champStatMap}
                onPick={t => pickTeam(t, 'champion')}
                saving={saving}
                canPick={canPick}
                accentColor="var(--accent)"
                halfMap={halfMap}
              />
            )}
          </div>

          {/* ── Seção Vice-Campeão ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--s3)' }}>
              <span style={{ fontSize: 22 }}>🥈</span>
              <div>
                <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 16, color: 'var(--text-1)' }}>Vice-Campeão</div>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>Acerte e ganhe +50 pts</div>
              </div>
            </div>


            {stats.runner_up?.length > 0 && (
              <div style={{ marginBottom: 'var(--s3)' }}>
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 8 }}>FAVORITOS DO BOLÃO</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {stats.runner_up.slice(0, 5).map(s => (
                    <div key={s.team_id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', borderRadius: 8, padding: '5px 10px' }}>
                      <TeamCrestFlag src={s.flag} alt={s.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{s.code}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#d4af37' }}>{s.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canPick && (myChampId ? (
              <>
                {champHalf && (
                  <div style={{
                    fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)',
                    marginBottom: 'var(--s3)', display: 'flex', alignItems: 'center', gap: 6,
                    background: 'var(--bg-overlay)', borderRadius: 8, padding: '8px 12px',
                  }}>
                    <span>Campeão no</span>
                    <span className={`half-badge half-badge--${champHalf}`}>{champHalf}</span>
                    <span>— vice deve ser do</span>
                    <span className={`half-badge half-badge--${champHalf === 'A' ? 'B' : 'A'}`}>{champHalf === 'A' ? 'B' : 'A'}</span>
                    <span style={{ color: 'var(--text-4)', fontSize: 11 }}>(lados opostos chegam na final)</span>
                  </div>
                )}
                <TeamGrid
                  teams={teams}
                  myTeamId={myRunnerUpId}
                  blockedSet={new Set([myChampId, ...sameHalfAsChamp])}
                  statMap={ruStatMap}
                  onPick={t => pickTeam(t, 'runner_up')}
                  saving={saving}
                  canPick={canPick}
                  accentColor="#d4af37"
                  halfMap={halfMap}
                />
              </>
            ) : (
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)', padding: 'var(--s3) 0' }}>
                Escolha o campeão primeiro para liberar o vice.
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Palpites do Bolão ── */}
      {allPicks.length > 0 && (
        <div style={{ marginTop: 'var(--s6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s3)' }}>
            <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.08em', margin: 0 }}>
              PALPITES DO BOLÃO — {allPicks.length} participante{allPicks.length !== 1 ? 's' : ''}
            </p>
            <Link to="/ranking" style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)' }}>
              Ver ranking →
            </Link>
          </div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {/* header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 1fr 1fr', gap: 8, padding: '8px var(--s4)', borderBottom: '1px solid var(--border)' }}>
              {['Participante', '🏆 Campeão (+100)', '🥈 Vice (+50)'].map(h => (
                <span key={h} style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-4)', textTransform: 'uppercase' }}>{h}</span>
              ))}
            </div>
            {allPicks.map((p, i) => (
              <div key={p.user_id} style={{
                display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 1fr 1fr', gap: 8,
                padding: '10px var(--s4)',
                borderBottom: i < allPicks.length - 1 ? '1px solid var(--border)' : 'none',
                alignItems: 'center',
                background: p.user_id === user?.id ? 'rgba(15,122,120,0.06)' : 'transparent',
              }}>
                <Link to={`/usuarios/${p.user_id}/historico`} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: p.user_id === user?.id ? 700 : 500,
                  color: p.user_id === user?.id ? 'var(--accent)' : 'var(--text-1)',
                  textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {p.user_name}{p.user_id === user?.id ? ' (você)' : ''}
                </Link>
                {p.champion ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <TeamCrestFlag src={p.champion.flag} alt={p.champion.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{p.champion.code}</span>
                  </div>
                ) : <span style={{ fontSize: 11, color: 'var(--text-4)' }}>—</span>}
                {p.runner_up ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <TeamCrestFlag src={p.runner_up.flag} alt={p.runner_up.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} crestStyle={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 4, background: 'var(--bg-overlay)' }} />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600, color: 'var(--text-1)' }}>{p.runner_up.code}</span>
                  </div>
                ) : <span style={{ fontSize: 11, color: 'var(--text-4)' }}>—</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
