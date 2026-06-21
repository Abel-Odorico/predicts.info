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

export default function ChampionPick() {
  const { user, token } = useAuth()
  const countdown = useCountdown()

  const [teams, setTeams]     = useState([])
  const [stats, setStats]     = useState([])
  const [myPick, setMyPick]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState('')
  const [filter, setFilter]   = useState('')

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

  async function pick(team) {
    if (!token) return
    if (!countdown) return
    setSaving(true)
    setMsg('')
    try {
      const res = await api.post('/champion/pick', { team_id: team.id }, token)
      setMyPick(res)
      setMsg(`✓ Palpite salvo — ${res.name || res.code}`)
      const statsData = await api.get('/champion/picks/stats')
      setStats(statsData)
    } catch {
      setMsg('Erro ao salvar palpite')
    } finally {
      setSaving(false)
    }
  }

  const statMap = Object.fromEntries(stats.map(s => [s.team_id, s]))
  const filtered = teams.filter(t =>
    !filter || t.name.toLowerCase().includes(filter.toLowerCase()) || t.code.toLowerCase().includes(filter.toLowerCase())
  )

  if (loading) return <div style={{ display:'flex', justifyContent:'center', padding:60 }}><Spinner /></div>

  return (
    <div className="page-container fade-in-1" style={{ maxWidth: 720, margin: '0 auto', padding: '0 var(--s4) var(--s6)' }}>

      {/* Header */}
      <div style={{ padding: 'var(--s5) 0 var(--s4)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px,6vw,42px)', color: 'var(--text-1)', margin: 0 }}>
          🏆 CAMPEÃO DA COPA
        </h1>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', margin: '4px 0 0' }}>
          Quem vai ganhar a Copa do Mundo 2026?
        </p>
      </div>

      {/* Bonuses */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 'var(--s4)', flexWrap: 'wrap' }}>
        {[
          { label: 'Acertar o campeão', pts: '+100 pts', color: 'var(--accent)' },
          { label: 'Acertar o vice-campeão', pts: '+50 pts', color: 'var(--amber)' },
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

      {/* Countdown / deadline */}
      <div style={{
        background: countdown ? 'rgba(15,122,120,0.08)' : 'rgba(232,82,82,0.08)',
        border: `1px solid ${countdown ? 'rgba(15,122,120,0.25)' : 'rgba(232,82,82,0.25)'}`,
        borderRadius: 10, padding: '12px 16px', marginBottom: 'var(--s4)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)' }}>
          {countdown ? '⏳ Prazo para palpitar' : '🔒 Prazo encerrado'}
        </span>
        {countdown && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
            {countdown}
          </span>
        )}
        {!countdown && (
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)' }}>Palpites encerrados</span>
        )}
      </div>

      {/* My pick */}
      {myPick && (
        <div style={{
          background: 'var(--bg-surface)', border: '2px solid var(--accent)',
          borderRadius: 12, padding: '14px 18px', marginBottom: 'var(--s4)',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <img src={myPick.flag} alt={myPick.code} style={{ width: 40, height: 28, objectFit: 'cover', borderRadius: 3 }} />
          <div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--accent)', letterSpacing: '0.08em' }}>SEU PALPITE</div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 17, fontWeight: 700, color: 'var(--text-1)' }}>{myPick.name || myPick.code}</div>
          </div>
          {myPick.can_change && (
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
              clique em outro time para alterar
            </span>
          )}
        </div>
      )}

      {msg && (
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: msg.startsWith('✓') ? 'var(--win)' : 'var(--lose)', margin: '0 0 var(--s3)' }}>
          {msg}
        </p>
      )}

      {/* Stats top picks */}
      {stats.length > 0 && (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
            FAVORITOS DO BOLÃO
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {stats.slice(0, 5).map(s => (
              <div key={s.team_id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg-2)', borderRadius: 8, padding: '6px 12px',
              }}>
                <img src={s.flag} alt={s.code} style={{ width: 24, height: 17, objectFit: 'cover', borderRadius: 2 }} />
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{s.code}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent)' }}>{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team grid */}
      {(!countdown && !myPick) ? (
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6) 0' }}>
          Prazo encerrado. Aguarde os resultados do mata-mata.
        </p>
      ) : (
        <>
          {!user && (
            <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginBottom: 'var(--s3)' }}>
              <a href="/login" style={{ color: 'var(--accent)' }}>Entre</a> para registrar seu palpite.
            </p>
          )}

          <input
            className="form-input"
            placeholder="🔍 Buscar seleção..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ marginBottom: 'var(--s3)', fontFamily: 'var(--font-cond)' }}
          />

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 8,
          }}>
            {filtered.map(team => {
              const isMyPick = myPick?.team_id === team.id
              const stat = statMap[team.id]
              return (
                <button
                  key={team.id}
                  onClick={() => user && countdown && pick(team)}
                  disabled={saving || !user || !countdown}
                  style={{
                    background: isMyPick ? 'rgba(15,122,120,0.15)' : 'var(--bg-surface)',
                    border: `2px solid ${isMyPick ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '10px 8px',
                    cursor: user && countdown ? 'pointer' : 'default',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    transition: 'border-color 0.15s, background 0.15s',
                    opacity: saving ? 0.6 : 1,
                  }}
                  onMouseEnter={e => { if (!isMyPick && user && countdown) e.currentTarget.style.borderColor = 'var(--accent)' }}
                  onMouseLeave={e => { if (!isMyPick) e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  <img src={team.flag_url} alt={team.code}
                    style={{ width: 40, height: 28, objectFit: 'cover', borderRadius: 3 }} />
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>
                    {team.code}
                  </span>
                  {stat && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>
                      {stat.pct}%
                    </span>
                  )}
                  {isMyPick && (
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>
                      ✓ seu pick
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
