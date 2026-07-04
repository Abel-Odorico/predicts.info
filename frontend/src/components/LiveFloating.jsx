import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import ProbBar from './ProbBar'
import { useAuth } from '../stores/authStore'

const POLL_MS = 10000   // refresh feed

const BET_STATUS_META = {
  exact:   { icon: '🎯', label: 'Exato',      color: 'var(--win, #3fb950)' },
  correct: { icon: '✅', label: 'Acertando',  color: 'var(--win, #3fb950)' },
  wrong:   { icon: '❌', label: 'Errando',    color: 'var(--lose, #e85252)' },
  pending: { icon: '⏳', label: 'Aguardando', color: 'var(--text-4, #777)' },
}

function _brTime(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  } catch { return '' }
}

export default function LiveFloating() {
  const navigate = useNavigate()
  const { token } = useAuth()
  const [games, setGames] = useState([])
  const [classByMatch, setClassByMatch] = useState({})
  const [upcoming, setUpcoming] = useState([])
  const [open, setOpen] = useState(false)
  const [goalFlash, setGoalFlash] = useState({})
  const widgetRef = useRef(null)
  const prevScoresRef = useRef({})

  // Detalhes (simulador + palpites) por match_id — carrega sozinho, sem clique extra
  const [detailLoading, setDetailLoading] = useState({})
  const [matchDetails, setMatchDetails] = useState({})
  const [simDetails, setSimDetails] = useState({})
  const [betsDetails, setBetsDetails] = useState({})
  const loadedRef = useRef({})

  // Linha do tempo de gols por match_id
  const [goalsByMatch, setGoalsByMatch] = useState({})

  function loadGoals(matchId) {
    api.get(`/live/goals/${matchId}`)
      .then(d => setGoalsByMatch(g => ({ ...g, [matchId]: d?.events || [] })))
      .catch(() => {})
  }

  function loadDetails(matchId) {
    if (loadedRef.current[matchId]) return
    loadedRef.current[matchId] = true
    setDetailLoading(d => ({ ...d, [matchId]: true }))
    const reqs = [api.get(`/matches/${matchId}`), api.post(`/matches/${matchId}/simulate`)]
    if (token) reqs.push(api.get(`/matches/${matchId}/live-bets`, token))
    Promise.allSettled(reqs).then(([m, s, b]) => {
      if (m.status === 'fulfilled') setMatchDetails(d => ({ ...d, [matchId]: m.value }))
      if (s.status === 'fulfilled') setSimDetails(d => ({ ...d, [matchId]: s.value }))
      if (b?.status === 'fulfilled') setBetsDetails(d => ({ ...d, [matchId]: b.value }))
    }).finally(() => setDetailLoading(d => ({ ...d, [matchId]: false })))
  }

  // Assim que a pílula é aberta, carrega detalhes de todos os jogos ao vivo
  useEffect(() => {
    if (!open) return
    games.forEach(g => { if (g.match_id != null) loadDetails(g.match_id) })
  }, [open, games])

  // Gols: recarrega a cada refresh do feed enquanto o popup tá aberto (pega gol novo)
  useEffect(() => {
    if (!open) return
    games.forEach(g => { if (g.match_id != null) loadGoals(g.match_id) })
  }, [open, games])

  // Feed ao vivo (poll) — detecta gols comparando placar do poll anterior
  useEffect(() => {
    let alive = true
    const load = () =>
      api.get('/live/world-cup')
        .then(d => {
          if (!alive) return
          const liveGames = (d?.games || []).filter(g => g.status === 'live')
          const flashed = []
          for (const g of liveGames) {
            const k = `${g.team_a}-${g.team_b}`
            const sa = g.score_a ?? 0
            const sb = g.score_b ?? 0
            const prev = prevScoresRef.current[k]
            if (prev && (sa > prev.sa || sb > prev.sb)) flashed.push(k)
            prevScoresRef.current[k] = { sa, sb }
          }
          if (flashed.length) {
            setGoalFlash(f => {
              const next = { ...f }
              flashed.forEach(k => { next[k] = true })
              return next
            })
            setTimeout(() => {
              setGoalFlash(f => {
                const next = { ...f }
                flashed.forEach(k => { delete next[k] })
                return next
              })
            }, 2800)
          }
          setGames(liveGames)
        })
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
        className="live-pill-enter live-pill-breathe"
        style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 70px)', left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 8000,
          display: 'flex', flexDirection: 'column', gap: 0, cursor: 'pointer',
          padding: '8px 16px', borderRadius: 18,
          background: 'rgba(20,20,24,0.82)', backdropFilter: 'blur(10px)',
          border: '1px solid rgba(232,82,82,0.45)',
          maxWidth: 'min(94vw, 460px)',
        }}
      >
        {games.map((g, i) => {
          const c = g.match_id != null ? classByMatch[g.match_id] : null
          const scored = !!goalFlash[`${g.team_a}-${g.team_b}`]
          return (
          <div
            key={`pill-${g.team_a}-${g.team_b}-${i}`}
            className={scored ? 'live-goal-flash' : ''}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 4px', borderRadius: 10, borderTop: i > 0 ? '1px solid rgba(255,255,255,0.12)' : 'none' }}
          >
            {scored && <span className="live-goal-badge">⚽ GOL!</span>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: 'var(--lose, #e85252)',
                boxShadow: '0 0 0 0 rgba(232,82,82,0.7)', animation: 'livedot 1.4s infinite', flexShrink: 0,
              }} />
              {g.team_a_flag && <img src={g.team_a_flag} alt={g.team_a} style={{ height: 22, width: 'auto', borderRadius: 2 }} />}
              <span className={scored ? 'live-goal-score' : ''} style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 17, color: '#fff', whiteSpace: 'nowrap' }}>
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
        <style>{`
          @keyframes livedot{0%{box-shadow:0 0 0 0 rgba(232,82,82,.7)}70%{box-shadow:0 0 0 7px rgba(232,82,82,0)}100%{box-shadow:0 0 0 0 rgba(232,82,82,0)}}
          @keyframes goalFlashBg{0%,100%{background:transparent}20%,60%{background:rgba(232,196,74,0.22)}}
          @keyframes goalScorePop{0%{transform:scale(1)}30%{transform:scale(1.35)}60%{transform:scale(1)}80%{transform:scale(1.15)}100%{transform:scale(1)}}
          @keyframes goalBadgeIn{0%{opacity:0;transform:translate(-50%,4px) scale(.8)}15%{opacity:1;transform:translate(-50%,-2px) scale(1.05)}25%{transform:translate(-50%,0) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-6px) scale(.95)}}
          .live-goal-flash{animation:goalFlashBg 2.6s ease}
          .live-goal-score{display:inline-block;color:#e8c44a !important;animation:goalScorePop 2.6s ease}
          .live-goal-badge{position:absolute;top:-10px;left:50%;padding:2px 10px;border-radius:99px;background:#e8c44a;color:#1a1400;font-family:var(--font-cond);font-weight:800;font-size:10px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;box-shadow:0 4px 14px rgba(232,196,74,.5);animation:goalBadgeIn 2.6s ease;z-index:1}

          @keyframes pillSlideIn{0%{opacity:0;transform:translateX(-50%) translateY(-16px) scale(.94)}100%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
          .live-pill-enter{animation:pillSlideIn 450ms cubic-bezier(.2,.9,.3,1.1)}
          @keyframes pillBreathe{
            0%,100%{box-shadow:0 8px 28px rgba(0,0,0,0.4),0 0 0 0 rgba(232,82,82,0.65);border-color:rgba(232,82,82,0.5);transform:translateX(-50%) scale(1)}
            50%{box-shadow:0 8px 28px rgba(0,0,0,0.4),0 0 0 13px rgba(232,82,82,0);border-color:rgba(255,110,110,1);transform:translateX(-50%) scale(1.05)}
          }
          .live-pill-breathe{animation:pillBreathe 1.5s ease-in-out infinite}

          @keyframes modalKickoff{0%{opacity:0;transform:scale(.85) translateY(16px)}55%{opacity:1;transform:scale(1.03) translateY(0)}100%{transform:scale(1) translateY(0)}}
          .live-modal-enter{animation:modalKickoff 420ms cubic-bezier(.2,.9,.3,1.15)}
          @keyframes stadiumFlash{0%{opacity:.9}100%{opacity:0}}
          .live-modal-flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 30%, rgba(255,255,255,0.35), transparent 60%);pointer-events:none;animation:stadiumFlash 600ms ease-out forwards;z-index:5;border-radius:16px}

          .live-modal-goal-celebration{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:3}
          .live-modal-goal-celebration__net{font-size:26px;display:inline-block;animation:goalNetShakeModal 2.6s ease}
          .live-modal-goal-celebration__ball{position:absolute;font-size:18px;animation:goalBallFlyModal 900ms cubic-bezier(.3,.6,.3,1) forwards}
          @keyframes goalBallFlyModal{0%{transform:translate(-50px,26px) scale(.6);opacity:0}15%{opacity:1}70%{transform:translate(0,0) scale(1.1);opacity:1}100%{transform:translate(0,0) scale(0);opacity:0}}
          @keyframes goalNetShakeModal{0%,100%{transform:rotate(0deg) scale(1)}10%{transform:rotate(-9deg) scale(1.05)}20%{transform:rotate(7deg) scale(1.08)}30%{transform:rotate(-4deg) scale(1.03)}40%{transform:rotate(2deg) scale(1)}50%{transform:rotate(0deg) scale(1)}}

          .live-mini-pitch{position:relative;height:14px;border-radius:7px;margin:10px 0 2px;overflow:hidden;
            background:repeating-linear-gradient(90deg, rgba(46,201,128,0.16) 0 16px, rgba(46,201,128,0.08) 16px 32px);
            border:1px solid rgba(46,201,128,0.25)}
          .live-mini-pitch__ball{position:absolute;top:50%;font-size:12px;transform:translateY(-50%);animation:pitchRun 3.2s ease-in-out infinite}
          @keyframes pitchRun{0%{left:4%}50%{left:92%}100%{left:4%}}

          .live-score-live{display:inline-block;animation:scoreLiveGlow 2.2s ease-in-out infinite}
          @keyframes scoreLiveGlow{0%,100%{text-shadow:0 0 0 rgba(232,82,82,0)}50%{text-shadow:0 0 14px rgba(232,82,82,0.65)}}

          .live-clock{
            display:inline-flex; align-items:center; gap:6px;
            font-family:var(--font-data, monospace); font-weight:800; font-size:16px; letter-spacing:0.03em;
            color:#fff; padding:5px 14px; border-radius:99px;
            background:linear-gradient(135deg, rgba(232,82,82,0.9), rgba(180,40,40,0.9));
            box-shadow:0 4px 16px rgba(232,82,82,0.35);
            animation:clockPulse 1.8s ease-in-out infinite;
          }
          .live-clock__dot{width:7px;height:7px;border-radius:50%;background:#fff;animation:clockDotBlink 1s steps(2) infinite}
          @keyframes clockPulse{0%,100%{box-shadow:0 4px 16px rgba(232,82,82,0.35)}50%{box-shadow:0 4px 22px rgba(232,82,82,0.65)}}
          @keyframes clockDotBlink{0%,100%{opacity:1}50%{opacity:0.25}}
          @media (prefers-reduced-motion: reduce){ .live-clock,.live-clock__dot{animation:none !important} }

          @media (prefers-reduced-motion: reduce){
            .live-pill-enter,.live-pill-breathe,.live-modal-enter,.live-modal-flash,
            .live-modal-goal-celebration__net,.live-modal-goal-celebration__ball,
            .live-mini-pitch__ball,.live-score-live{animation:none !important}
          }
        `}</style>
      </div>

      {/* Modal de detalhes */}
      {open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="live-modal-enter"
            style={{ position: 'relative', width: 'min(94vw, 460px)', maxHeight: '86vh', overflowY: 'auto', background: 'var(--bg-card, #16161c)', border: '1px solid var(--border, #2a2a33)', borderRadius: 16, padding: 18, boxShadow: '0 20px 60px rgba(0,0,0,0.55)' }}
          >
            <div className="live-modal-flash" aria-hidden="true" />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontWeight: 800, fontSize: 15, color: 'var(--text-1, #fff)' }}>
                <span className="badge badge-live">Ao vivo</span>
                {games.length === 1 ? '1 jogo agora' : `${games.length} jogos agora`}
              </span>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-3, #888)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {games.map((g, i) => {
              const scored = !!goalFlash[`${g.team_a}-${g.team_b}`]
              return (
              <div key={`${g.team_a}-${g.team_b}-${i}`} className={scored ? 'live-goal-flash' : ''} style={{ padding: '14px 0', borderTop: i > 0 ? '1px solid var(--border, #2a2a33)' : 'none', borderRadius: 10 }}>
                {g.competition && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    {g.competition_logo && <img src={g.competition_logo} alt="" style={{ height: 14 }} />}
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3, #999)', letterSpacing: '0.04em' }}>{g.competition}</span>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    {g.team_a_flag && <img src={g.team_a_flag} alt={g.team_a} style={{ height: 24, borderRadius: 3 }} />}
                    <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.team_a}</span>
                  </div>
                  <span className={`live-score-live${scored ? ' live-goal-score' : ''}`} style={{ fontFamily: 'var(--font-data, monospace)', fontWeight: 800, fontSize: 22, color: 'var(--text-1, #fff)', flexShrink: 0 }}>{g.score_a ?? '-'} : {g.score_b ?? '-'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
                    <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: 'var(--text-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.team_b}</span>
                    {g.team_b_flag && <img src={g.team_b_flag} alt={g.team_b} style={{ height: 24, borderRadius: 3 }} />}
                  </div>
                  {scored && (
                    <div className="live-modal-goal-celebration" aria-hidden="true">
                      <span className="live-modal-goal-celebration__net">🥅</span>
                      <span className="live-modal-goal-celebration__ball">⚽</span>
                    </div>
                  )}
                </div>

                <div className="live-mini-pitch" aria-hidden="true">
                  <span className="live-mini-pitch__ball">⚽</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginTop: 10 }}>
                  <span className="live-clock">
                    <span className="live-clock__dot" />
                    {g.status_raw || 'AO VIVO'}
                  </span>
                  {g.time_label && (
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4, #777)' }}>
                      início {g.time_label}
                    </span>
                  )}
                </div>

                {g.match_id != null && goalsByMatch[g.match_id]?.length > 0 && (
                  <GoalTimeline events={goalsByMatch[g.match_id]} teamA={g.team_a} teamB={g.team_b} />
                )}

                {g.match_id != null && classByMatch[g.match_id] && (
                  <ProjBlock c={classByMatch[g.match_id]} />
                )}

                {g.match_id != null && (
                  <div className="fade-in-1" style={{ marginTop: 10 }}>
                    {detailLoading[g.match_id] && !matchDetails[g.match_id] ? (
                      <div style={{ textAlign: 'center', padding: '10px 0', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4, #777)' }}>
                        ⏳ Carregando simulador…
                      </div>
                    ) : (
                      <>
                        {simDetails[g.match_id] && matchDetails[g.match_id] && (
                          <ProbBar sim={simDetails[g.match_id]} matchData={matchDetails[g.match_id]} />
                        )}
                        <MiniParticipantBets data={betsDetails[g.match_id]} hasToken={!!token} />
                      </>
                    )}
                  </div>
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
              )
            })}

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

// Palpites dos participantes (versão compacta pro popup ao vivo)
function MiniParticipantBets({ data, hasToken }) {
  if (!hasToken) {
    return (
      <div style={{ marginTop: 8, textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4, #777)' }}>
        Faça login para ver quem está acertando o placar
      </div>
    )
  }
  if (!data || data.bets.length === 0) return null

  const exactCount = data.bets.filter(b => b.status === 'exact').length
  const correctCount = data.bets.filter(b => b.status === 'correct').length

  return (
    <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border, #2a2a33)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4, #777)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          🎲 Palpites · {data.total_bets}
        </span>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4, #777)' }}>
          🎯 {exactCount} · ✅ {correctCount}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
        {data.bets.map(b => {
          const meta = BET_STATUS_META[b.status] || BET_STATUS_META.pending
          return (
            <div key={b.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 6px', borderRadius: 6 }}>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-1, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {b.user_name}
              </span>
              <span style={{ fontFamily: 'var(--font-data, monospace)', fontWeight: 700, fontSize: 12, color: 'var(--text-1, #fff)', flexShrink: 0 }}>
                {b.score_a} × {b.score_b}
              </span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: meta.color, flexShrink: 0 }}>
                {meta.icon}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Linha do tempo dos gols — cada time do seu lado, minuto do gol no meio
function GoalTimeline({ events, teamA, teamB }) {
  return (
    <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-overlay, rgba(255,255,255,0.04))', border: '1px solid var(--border, #2a2a33)' }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4, #777)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, textAlign: 'center' }}>
        ⚽ Gols
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {events.map((e, i) => {
          const isA = e.side === 'a'
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                flex: 1, minWidth: 0, textAlign: 'right', fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12,
                color: isA ? 'var(--text-1, #fff)' : 'var(--text-4, #555)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {isA ? `${teamA} ⚽` : ''}
              </span>
              <span style={{
                fontFamily: 'var(--font-data, monospace)', fontSize: 11, fontWeight: 800, flexShrink: 0,
                width: 40, textAlign: 'center', color: 'var(--accent, #4f6ef7)',
                background: 'rgba(79,110,247,0.12)', borderRadius: 6, padding: '2px 0',
              }}>
                {e.minute_label || '—'}
              </span>
              <span style={{
                flex: 1, minWidth: 0, textAlign: 'left', fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12,
                color: !isA ? 'var(--text-1, #fff)' : 'var(--text-4, #555)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {!isA ? `⚽ ${teamB}` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
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
