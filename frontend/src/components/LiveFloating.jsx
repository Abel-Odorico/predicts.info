import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const POLL_MS = 10000   // refresh feed
const IDLE_MS = 1800    // tempo parado p/ reaparecer após "comando"

// Eventos que contam como "manipular a página" -> oculta o widget
const ACTIVITY_EVENTS = ['scroll', 'wheel', 'keydown', 'pointerdown', 'touchstart', 'touchmove']

export default function LiveFloating() {
  const navigate = useNavigate()
  const [games, setGames] = useState([])
  const [visible, setVisible] = useState(true)
  const [open, setOpen] = useState(false)
  const widgetRef = useRef(null)
  const idleTimer = useRef(null)
  const openRef = useRef(false)
  useEffect(() => { openRef.current = open }, [open])

  // Feed ao vivo (poll)
  useEffect(() => {
    let alive = true
    const load = () =>
      api.get('/live/world-cup')
        .then(d => { if (alive) setGames((d?.games || []).filter(g => g.status === 'live')) })
        .catch(() => {})
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  // Detecta atividade -> oculta; ao parar (idle) -> reaparece
  const onActivity = useCallback((e) => {
    if (openRef.current) return                                   // modal aberto: ignora
    if (widgetRef.current && e.target && widgetRef.current.contains(e.target)) return // interação no próprio widget
    setVisible(false)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setVisible(true), IDLE_MS)
  }, [])

  useEffect(() => {
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }))
    return () => {
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity))
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
    }
  }, [onActivity])

  if (games.length === 0) return null

  const primary = games[0]
  const extra = games.length - 1

  return (
    <>
      {/* Pílula flutuante topo-centro */}
      <div
        ref={widgetRef}
        onClick={() => setOpen(true)}
        role="button"
        title="Ver detalhes do ao vivo"
        style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 70px)', left: '50%',
          transform: `translateX(-50%) translateY(${visible ? '0' : '-16px'})`,
          opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none',
          transition: 'opacity .25s ease, transform .25s ease', zIndex: 8000,
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          padding: '8px 14px', borderRadius: 999,
          background: 'rgba(20,20,24,0.82)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(232,82,82,0.45)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.4)', maxWidth: 'min(92vw, 420px)',
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%', background: 'var(--lose, #e85252)',
          boxShadow: '0 0 0 0 rgba(232,82,82,0.7)', animation: 'livedot 1.4s infinite', flexShrink: 0,
        }} />
        {primary.team_a_flag && <img src={primary.team_a_flag} alt={primary.team_a} style={{ height: 18, width: 'auto', borderRadius: 2 }} />}
        <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {primary.score_a ?? '-'} : {primary.score_b ?? '-'}
        </span>
        {primary.team_b_flag && <img src={primary.team_b_flag} alt={primary.team_b} style={{ height: 18, width: 'auto', borderRadius: 2 }} />}
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--lose, #e85252)', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
          {primary.status_raw || 'AO VIVO'}{extra > 0 ? ` +${extra}` : ''}
        </span>
        <style>{`@keyframes livedot{0%{box-shadow:0 0 0 0 rgba(232,82,82,.7)}70%{box-shadow:0 0 0 7px rgba(232,82,82,0)}100%{box-shadow:0 0 0 0 rgba(232,82,82,0)}}`}</style>
      </div>

      {/* Modal de detalhes */}
      {open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 'min(94vw, 460px)', maxHeight: '86vh', overflowY: 'auto', background: 'var(--bg-card, #16161c)', border: '1px solid var(--border, #2a2a33)', borderRadius: 16, padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontWeight: 800, fontSize: 15, color: 'var(--text-1, #fff)' }}>
                <span className="badge badge-live">Ao vivo</span>
                {games.length === 1 ? '1 jogo agora' : `${games.length} jogos agora`}
              </span>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3, #888)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {games.map((g, i) => (
              <div key={`${g.team_a}-${g.team_b}-${i}`} style={{ padding: '14px 0', borderTop: i > 0 ? '1px solid var(--border, #2a2a33)' : 'none' }}>
                {g.competition && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    {g.competition_logo && <img src={g.competition_logo} alt="" style={{ height: 14 }} />}
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3, #999)', letterSpacing: '0.04em' }}>{g.competition}</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    {g.team_a_flag && <img src={g.team_a_flag} alt={g.team_a} style={{ height: 24, borderRadius: 3 }} />}
                    <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.team_a}</span>
                  </div>
                  <span style={{ fontFamily: 'var(--font-data, monospace)', fontWeight: 800, fontSize: 22, color: 'var(--text-1, #fff)', flexShrink: 0 }}>{g.score_a ?? '-'} : {g.score_b ?? '-'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.team_b}</span>
                    {g.team_b_flag && <img src={g.team_b_flag} alt={g.team_b} style={{ height: 24, borderRadius: 3 }} />}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}>
                  <span className="badge badge-live">{g.status_raw || 'Ao vivo'}</span>
                  {g.time_label && <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3, #999)' }}>{g.time_label}</span>}
                </div>

                {(g.city || g.venue) && (
                  <div style={{ textAlign: 'center', marginTop: 8, fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4, #777)', letterSpacing: '0.04em' }}>
                    📍 {[g.city, g.venue].filter(Boolean).join(' · ')}
                  </div>
                )}

                {g.channels?.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    {g.channels.slice(0, 8).map(ch => (
                      ch.img_url
                        ? <img key={ch.nome} src={ch.img_url} alt={ch.nome} title={ch.nome} style={{ height: 20, borderRadius: 3, opacity: 0.9 }} />
                        : <span key={ch.nome} style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3, #999)', border: '1px solid var(--border, #2a2a33)', borderRadius: 6, padding: '2px 7px' }}>{ch.nome}</span>
                    ))}
                  </div>
                )}

                {g.match_id && (
                  <button
                    onClick={() => { setOpen(false); navigate(`/partida/${g.match_id}`) }}
                    style={{ width: '100%', marginTop: 12, padding: '9px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, background: 'var(--accent, #4f6ef7)', color: '#fff' }}
                  >
                    Abrir partida →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
