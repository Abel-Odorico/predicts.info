import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const POLL_MS = 10000   // refresh feed

function _brTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  } catch { return '' }
}

export default function LiveFloating() {
  const navigate = useNavigate()
  const [games, setGames] = useState([])
  const [classByMatch, setClassByMatch] = useState({})
  const [upcoming, setUpcoming] = useState([])
  const [open, setOpen] = useState(false)
  const widgetRef = useRef(null)

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

  // Projeção de classificação ao vivo (poll) — só jogos de grupo decisivos
  useEffect(() => {
    let alive = true
    const load = () =>
      api.get('/live/classification')
        .then(d => {
          if (!alive) return
          const map = {}
          const up = []
          for (const g of (d?.decisive_games || [])) {
            if (g.live && g.match_id != null) map[g.match_id] = g
            else if (!g.live) up.push(g)
          }
          setClassByMatch(map)
          setUpcoming(up.slice(0, 8))
        })
        .catch(() => {})
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  if (games.length === 0) return null

  return (
    <>
      {/* Pílula flutuante topo-centro — todos os jogos ao vivo */}
      <div
        ref={widgetRef}
        onClick={() => setOpen(true)}
        role="button"
        title="Ver detalhes do ao vivo"
        style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 70px)', left: '50%',
          transform: 'translateX(-50%)',
          transition: 'opacity .25s ease, transform .25s ease', zIndex: 8000,
          display: 'flex', flexDirection: 'column', gap: 0, cursor: 'pointer',
          padding: '8px 16px', borderRadius: 18,
          background: 'rgba(20,20,24,0.82)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(232,82,82,0.45)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.4)', maxWidth: 'min(94vw, 460px)',
        }}
      >
        {games.map((g, i) => {
          const c = g.match_id != null ? classByMatch[g.match_id] : null
          return (
          <div key={`pill-${g.team_a}-${g.team_b}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 0', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.12)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: 'var(--lose, #e85252)',
                boxShadow: '0 0 0 0 rgba(232,82,82,0.7)', animation: 'livedot 1.4s infinite', flexShrink: 0,
              }} />
              {g.team_a_flag && <img src={g.team_a_flag} alt={g.team_a} style={{ height: 22, width: 'auto', borderRadius: 2 }} />}
              <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 17, color: '#fff', whiteSpace: 'nowrap' }}>
                {g.score_a ?? '-'} : {g.score_b ?? '-'}
              </span>
              {g.team_b_flag && <img src={g.team_b_flag} alt={g.team_b} style={{ height: 22, width: 'auto', borderRadius: 2 }} />}
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose, #e85252)', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
                {g.status_raw || 'AO VIVO'}
              </span>
            </div>
            {c && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.02em', whiteSpace: 'nowrap', paddingLeft: 16 }}>
                <span style={{ color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>G{c.group_name}</span>
                <PillTeam t={c.team_a} />
                <PillTeam t={c.team_b} />
              </div>
            )}
          </div>
          )
        })}
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

                {g.match_id != null && classByMatch[g.match_id] && (
                  <ProjBlock c={classByMatch[g.match_id]} />
                )}

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

            {upcoming.length > 0 && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border, #2a2a33)', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 800, fontSize: 13, color: 'var(--text-1, #fff)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Próximos confrontos
                  </span>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4, #777)' }}>decisivos</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {upcoming.map((g, i) => (
                    <button
                      key={`up-${g.match_id ?? i}`}
                      onClick={() => { if (g.match_id) { setOpen(false); navigate(`/partida/${g.match_id}`) } }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                        padding: '8px 10px', borderRadius: 10, cursor: g.match_id ? 'pointer' : 'default',
                        background: 'var(--bg-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border, #2a2a33)',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 800, color: 'var(--text-4, #777)', flexShrink: 0, width: 22, textTransform: 'uppercase' }}>G{g.group_name}</span>
                      <BracketTeam t={g.team_a} />
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4, #777)', fontWeight: 700, flexShrink: 0 }}>vs</span>
                      <BracketTeam t={g.team_b} align="right" />
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4, #777)', flexShrink: 0, marginLeft: 4 }}>{_brTime(g.match_date)}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setOpen(false); navigate('/decisivos') }}
                  style={{ width: '100%', marginTop: 10, padding: '9px', borderRadius: 10, border: '1px solid var(--border, #2a2a33)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12, background: 'transparent', color: 'var(--text-2, #bbb)' }}
                >
                  Ver todos os decisivos →
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// Time de um confronto do bracket (pode estar resolvido ou ainda como rótulo)
function BracketTeam({ t, label, align }) {
  const right = align === 'right'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
      justifyContent: right ? 'flex-end' : 'flex-start',
    }}>
      {!right && t?.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 16, borderRadius: 2 }} />}
      <span style={{
        fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13,
        color: t ? (t.qualifying ? 'var(--win, #3fb950)' : 'var(--text-1, #fff)') : 'var(--text-4, #777)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {t ? t.name : (label || '?')}
        {t?.position != null && <span style={{ color: 'var(--text-4, #777)', fontWeight: 600 }}> {t.position}º</span>}
      </span>
      {right && t?.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 16, borderRadius: 2 }} />}
    </span>
  )
}

// Time compacto na pílula: posição + se classifica
function PillTeam({ t }) {
  if (!t) return null
  const qual = t.qualifying
  const col = qual ? 'var(--win, #3fb950)' : 'rgba(255,255,255,0.55)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: col }}>
      {t.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 11, borderRadius: 1 }} />}
      <span style={{ color: '#fff' }}>{t.code}</span>
      {t.position != null && <span style={{ color: 'rgba(255,255,255,0.55)' }}>{t.position}º</span>}
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: qual ? 'var(--win, #3fb950)' : 'var(--lose, #e85252)',
      }} />
      {t.delta === 'in' ? '🟢' : t.delta === 'out' ? '🔴' : ''}
    </span>
  )
}

// Projeção "se acabar agora" para um jogo de grupo decisivo
function ProjBlock({ c }) {
  const Row = ({ t }) => {
    const col = t.qualifying ? 'var(--win, #3fb950)' : 'var(--text-3, #999)'
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-1, #fff)', fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700 }}>
          {t.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 12, borderRadius: 1 }} />}
          {t.code}
          {t.delta === 'in' ? ' 🟢' : t.delta === 'out' ? ' 🔴' : ''}
        </span>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: col }}>
          {t.position ? `${t.position}º · ` : ''}{t.qualifying ? 'classifica' : 'fora'}
        </span>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border, #2a2a33)' }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4, #777)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
        Se acabar agora · Grupo {c.group_name}
      </div>
      <Row t={c.team_a} />
      <Row t={c.team_b} />
    </div>
  )
}
