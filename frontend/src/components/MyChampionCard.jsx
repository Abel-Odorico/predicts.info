import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

const DEADLINE = new Date('2026-06-26T12:00:00Z')

export default function MyChampionCard({ compact = false }) {
  const { token } = useAuth()
  const [pick, setPick]   = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!token) { setReady(true); return }
    api.get('/champion/pick', token)
      .then(setPick)
      .catch(() => setPick(null))
      .finally(() => setReady(true))
  }, [token])

  if (!token || !ready) return null

  const open = Date.now() < DEADLINE.getTime()
  const hasChamp = !!pick?.champion
  const hasVice  = !!pick?.runner_up
  const allDone  = hasChamp && hasVice

  if (compact) {
    // Versão compacta: linha horizontal inline
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '10px 14px', marginBottom: 'var(--s4)',
      }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
          MEUS PALPITES DE CAMPEÃO
        </span>
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          {[
            { label: '🏆', pick: pick?.champion,  pts: '+100', color: 'var(--accent)' },
            { label: '🥈', pick: pick?.runner_up, pts: '+50',  color: '#d4af37' },
          ].map(({ label, pick: p, pts, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>{label}</span>
              {p ? (
                <>
                  <img src={p.flag} alt={p.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 2 }} />
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{p.name || p.code}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color }}>{pts}</span>
                </>
              ) : (
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic' }}>não escolhido</span>
              )}
            </div>
          ))}
        </div>
        {open && (
          <Link to="/campeao" style={{
            fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)',
            textDecoration: 'none', whiteSpace: 'nowrap',
          }}>
            {allDone ? 'Alterar →' : 'Escolher →'}
          </Link>
        )}
      </div>
    )
  }

  // Versão card completo
  return (
    <div style={{
      background: allDone ? 'var(--bg-surface)' : 'rgba(232,82,82,0.05)',
      border: `1.5px solid ${allDone ? 'var(--border)' : 'rgba(232,82,82,0.3)'}`,
      borderRadius: 12, padding: '14px 16px', marginBottom: 'var(--s4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.08em' }}>
          MEUS PALPITES DE CAMPEÃO
        </span>
        {open && (
          <Link to="/campeao" style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
            {allDone ? 'Alterar →' : 'Escolher →'}
          </Link>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { emoji: '🏆', label: 'Campeão',      pts: '+100 pts', color: 'var(--accent)', p: pick?.champion  },
          { emoji: '🥈', label: 'Vice-Campeão', pts: '+50 pts',  color: '#d4af37',       p: pick?.runner_up },
        ].map(({ emoji, label, pts, color, p }) => (
          <div key={label} style={{
            background: p ? `${color}10` : 'var(--bg-overlay)',
            border: `1px solid ${p ? color : 'var(--border)'}`,
            borderRadius: 10, padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', letterSpacing: '0.06em' }}>
                {emoji} {label.toUpperCase()}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color }}>{pts}</span>
            </div>
            {p ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <img src={p.flag} alt={p.code} style={{ width: 30, height: 21, objectFit: 'cover', borderRadius: 3 }} />
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{p.name || p.code}</div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color, marginTop: 1 }}>✓ escolhido</div>
                </div>
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', fontStyle: 'italic' }}>
                {open ? 'não escolhido' : '—'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
