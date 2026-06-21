import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

const DEADLINE = new Date('2026-06-26T12:00:00Z')

function useCountdown() {
  const [diff, setDiff] = useState(DEADLINE - Date.now())
  useEffect(() => {
    const id = setInterval(() => setDiff(DEADLINE - Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (diff <= 0) return null
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  return `${h}h ${m}m ${s}s`
}

function TeamGrid({ teams, myTeamId, blockedTeamId, statMap, onPick, saving, canPick, accentColor }) {
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
          const isBlocked = blockedTeamId === team.id
          const stat      = statMap[team.id]
          return (
            <button
              key={team.id}
              onClick={() => canPick && !isBlocked && onPick(team)}
              disabled={saving || !canPick || isBlocked}
              title={isBlocked ? 'Já escolhido no outro palpite' : undefined}
              style={{
                background: isMyPick ? `${accentColor}22` : isBlocked ? 'var(--bg-overlay)' : 'var(--bg-surface)',
                border: `2px solid ${isMyPick ? accentColor : 'var(--border)'}`,
                borderRadius: 10, padding: '10px 8px',
                cursor: canPick && !isBlocked ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                transition: 'border-color 0.15s, background 0.15s',
                opacity: (saving || isBlocked) ? 0.45 : 1,
              }}
              onMouseEnter={e => { if (!isMyPick && canPick && !isBlocked) e.currentTarget.style.borderColor = accentColor }}
              onMouseLeave={e => { if (!isMyPick) e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              <img src={team.flag_url} alt={team.code} style={{ width: 38, height: 27, objectFit: 'cover', borderRadius: 3 }} />
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
      <img src={pick.flag} alt={pick.code} style={{ width: 38, height: 27, objectFit: 'cover', borderRadius: 3 }} />
      <div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color, letterSpacing: '0.08em' }}>{label.toUpperCase()}</div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{pick.name || pick.code}</div>
      </div>
    </div>
  )
}

export default function ChampionPick() {
  const { user, token } = useAuth()
  const countdown = useCountdown()

  const [teams, setTeams]   = useState([])
  const [stats, setStats]   = useState({ champion: [], runner_up: [] })
  const [myPick, setMyPick] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState('')

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [teamsData, statsData] = await Promise.all([
          api.get('/teams'),
          api.get('/champion/picks/stats'),
        ])
        setTeams(teamsData)
        setStats(statsData)
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
    if (!token || !countdown) return
    setSaving(true)
    setMsg('')
    try {
      const body = type === 'champion'
        ? { team_id: team.id }
        : { runner_up_team_id: team.id }
      const res = await api.post('/champion/pick', body, token)
      setMyPick(res)
      const label = type === 'champion' ? 'Campeão' : 'Vice-campeão'
      setMsg(`✓ ${label} salvo — ${team.name || team.code}`)
      const statsData = await api.get('/champion/picks/stats')
      setStats(statsData)
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
  const canPick        = !!user && !!countdown

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

      {/* Bonuses */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 'var(--s4)', flexWrap: 'wrap' }}>
        {[
          { label: 'Acertar o campeão',      pts: '+100 pts', color: 'var(--accent)' },
          { label: 'Acertar o vice-campeão', pts: '+50 pts',  color: '#d4af37' },
        ].map(({ label, pts, color }) => (
          <div key={label} style={{
            flex: 1, minWidth: 140, background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 16px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color }}>{pts}</div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Countdown */}
      <div style={{
        background: countdown ? 'rgba(15,122,120,0.08)' : 'rgba(232,82,82,0.08)',
        border: `1px solid ${countdown ? 'rgba(15,122,120,0.25)' : 'rgba(232,82,82,0.25)'}`,
        borderRadius: 10, padding: '12px 16px', marginBottom: 'var(--s4)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)' }}>
          {countdown ? '⏳ Prazo para palpitar' : '🔒 Prazo encerrado'}
        </span>
        {countdown
          ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{countdown}</span>
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

      {(!countdown && !myPick) ? (
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

            <CurrentPickBadge pick={myPick?.champion} label="Seu palpite de campeão" color="var(--accent)" />

            {stats.champion?.length > 0 && (
              <div style={{ marginBottom: 'var(--s3)' }}>
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 8 }}>FAVORITOS DO BOLÃO</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {stats.champion.slice(0, 5).map(s => (
                    <div key={s.team_id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', borderRadius: 8, padding: '5px 10px' }}>
                      <img src={s.flag} alt={s.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} />
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
                blockedTeamId={myRunnerUpId}
                statMap={champStatMap}
                onPick={t => pickTeam(t, 'champion')}
                saving={saving}
                canPick={canPick}
                accentColor="var(--accent)"
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

            <CurrentPickBadge pick={myPick?.runner_up} label="Seu palpite de vice-campeão" color="#d4af37" />

            {stats.runner_up?.length > 0 && (
              <div style={{ marginBottom: 'var(--s3)' }}>
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 8 }}>FAVORITOS DO BOLÃO</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {stats.runner_up.slice(0, 5).map(s => (
                    <div key={s.team_id} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-2)', borderRadius: 8, padding: '5px 10px' }}>
                      <img src={s.flag} alt={s.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} />
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>{s.code}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#d4af37' }}>{s.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canPick && (myChampId ? (
              <TeamGrid
                teams={teams}
                myTeamId={myRunnerUpId}
                blockedTeamId={myChampId}
                statMap={ruStatMap}
                onPick={t => pickTeam(t, 'runner_up')}
                saving={saving}
                canPick={canPick}
                accentColor="#d4af37"
              />
            ) : (
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-4)', padding: 'var(--s3) 0' }}>
                Escolha o campeão primeiro para liberar o vice.
              </div>
            ))}
          </div>
        </>
      )}
    </div>
    </div>
  )
}
