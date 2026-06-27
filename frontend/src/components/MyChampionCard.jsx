import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

// Session-level cache — survives SPA navigation, cleared on logout/token change
let _pickCache = null
let _pickCacheToken = null
let _statusCache = null  // { can_change, deadline } — shared entre instâncias
export function invalidateChampionCache() { _pickCache = null; _pickCacheToken = null }

export default function MyChampionCard({ compact = false }) {
  const { token } = useAuth()
  const cached = (token && token === _pickCacheToken) ? _pickCache : null
  const [pick, setPick]   = useState(cached)
  const [ready, setReady] = useState(cached !== null)
  const [open, setOpen]   = useState(_statusCache?.can_change ?? false)

  useEffect(() => {
    // Busca status de abertura (sem auth)
    if (!_statusCache) {
      api.get('/champion/status').then(d => {
        _statusCache = d
        setOpen(d.can_change)
      }).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!token) { _pickCache = null; _pickCacheToken = null; setReady(true); return }
    if (token !== _pickCacheToken) { _pickCache = null; setPick(null); setReady(false) }
    api.get('/champion/pick', token)
      .then(data => {
        _pickCache = data; _pickCacheToken = token
        setPick(data)
        // pick response também tem can_change
        if (data?.can_change !== undefined) setOpen(data.can_change)
      })
      .catch(err => {
        if (err?.message?.includes('404') || err?.detail?.status === 404 || String(err?.message).match(/404/)) {
          _pickCache = null; _pickCacheToken = token
          setPick(null)
        }
      })
      .finally(() => setReady(true))
  }, [token])

  if (!token) return null
  if (!ready) {
    return compact
      ? <div style={{ height: 42, marginBottom: 'var(--s4)', borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
      : <div style={{ height: 90, marginBottom: 'var(--s4)', borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
  }
  const hasChamp = !!pick?.champion
  const hasVice  = !!pick?.runner_up
  const allDone  = hasChamp && hasVice

  if (compact) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: open ? 'linear-gradient(135deg, var(--accent-dim) 0%, var(--bg-surface) 100%)' : 'var(--bg-surface)',
        border: `1.5px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 10, padding: '10px 14px', marginBottom: 'var(--s4)',
      }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: open ? 'var(--accent)' : 'var(--text-4)', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
          {open ? '🔓 ABERTO PARA TROCAR' : 'MEUS PALPITES DE CAMPEÃO'}
        </span>
        <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
          {[
            { label: '🏆', pick: pick?.champion,  pts: '+100', color: 'var(--accent)' },
            { label: '🥈', pick: pick?.runner_up, pts: '+50',  color: '#b8860b' },
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
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: open ? 'var(--lose)' : 'var(--text-4)', fontStyle: 'italic' }}>
                  {open ? '⚠ escolha agora!' : 'não escolhido'}
                </span>
              )}
            </div>
          ))}
        </div>
        <Link to="/campeao" style={{
          fontFamily: 'var(--font-cond)', fontSize: 12,
          color: open ? '#fff' : 'var(--accent)',
          background: open ? 'var(--accent)' : 'transparent',
          textDecoration: 'none', whiteSpace: 'nowrap',
          padding: open ? '4px 10px' : '0',
          borderRadius: 6,
        }}>
          {allDone ? (open ? 'Trocar →' : 'Ver →') : 'Escolher →'}
        </Link>
      </div>
    )
  }

  // Versão card completo
  return (
    <div style={{
      background: open
        ? 'linear-gradient(135deg, var(--accent-dim) 0%, var(--bg-surface) 100%)'
        : allDone ? 'var(--bg-surface)' : 'rgba(232,82,82,0.05)',
      border: `1.5px solid ${open ? 'var(--accent)' : allDone ? 'var(--border)' : 'rgba(232,82,82,0.3)'}`,
      borderRadius: 12, padding: '14px 16px', marginBottom: 'var(--s4)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: open ? 'var(--accent)' : 'var(--text-4)', letterSpacing: '0.08em' }}>
            {open ? '🔓 PALPITES REABERTOS' : 'MEUS PALPITES DE CAMPEÃO'}
          </span>
          {open && (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
              Fase eliminatória — troque antes do 1º jogo
            </div>
          )}
        </div>
        <Link to="/campeao" style={{
          fontFamily: 'var(--font-cond)', fontSize: 12,
          color: open ? '#fff' : 'var(--accent)',
          background: open ? 'var(--accent)' : 'transparent',
          textDecoration: 'none', padding: open ? '5px 12px' : '0',
          borderRadius: 7, fontWeight: open ? 700 : 400,
        }}>
          {allDone ? (open ? 'Trocar →' : 'Ver →') : 'Escolher →'}
        </Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {[
          { emoji: '🏆', label: 'Campeão',      pts: '+100 pts', color: 'var(--accent)', p: pick?.champion  },
          { emoji: '🥈', label: 'Vice-Campeão', pts: '+50 pts',  color: '#b8860b',       p: pick?.runner_up },
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
