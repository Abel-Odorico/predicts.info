import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { PT_NAMES } from '../utils/teamNames'

const POLL_MS = 10000
const C_LIVE = 'var(--lose, #e85252)'
const ptName = t => PT_NAMES[t.code] || t.name || t.code

export default function LiveClassificationCard() {
  const [data, setData] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    let alive = true
    const load = () =>
      api.get('/live/classification')
        .then(d => { if (alive) setData(d) })
        .catch(() => {})
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  useEffect(() => {
    function dismiss() {
      setDismissed(true)
      document.removeEventListener('scroll', dismiss, true)
      document.removeEventListener('click', dismiss, true)
      document.removeEventListener('touchmove', dismiss, true)
    }
    const timer = setTimeout(() => {
      document.addEventListener('scroll', dismiss, { capture: true })
      document.addEventListener('click', dismiss, { capture: true })
      document.addEventListener('touchmove', dismiss, { capture: true })
    }, 1500)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('scroll', dismiss, true)
      document.removeEventListener('click', dismiss, true)
      document.removeEventListener('touchmove', dismiss, true)
    }
  }, [])

  if (dismissed || !data || (data.decisive_games || []).length === 0) return null

  const show = data.decisive_games || []

  const live = show.filter(g => g.live)
  // Grupos que têm jogo ao vivo → tabela projetada em tempo real
  const liveGroups = [...new Set(live.map(g => g.group_name))].sort()
  const groups = data.groups || {}

  return (
    <div
      className="card fade-in-1 mt-6"
      onClick={() => navigate('/decisivos')}
      style={{ cursor: 'pointer', border: data.has_live ? `1px solid ${C_LIVE}55` : undefined }}
    >
      <div className="card__header">
        <span className="section-title" style={{ margin: 0, border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {data.has_live && <span style={{ width: 9, height: 9, borderRadius: '50%', background: C_LIVE, animation: 'livedot 1.4s infinite' }} />}
          🔥 {data.has_live ? `${data.live_count} jogo${data.live_count > 1 ? 's' : ''} decisivo${data.live_count > 1 ? 's' : ''} ao vivo` : 'Rodada decisiva'}
        </span>
        <span className="badge badge-group">Quem classifica →</span>
      </div>
      <div style={{ padding: 'var(--s3) var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
        {show.map(g => {
          const _d = g.match_date ? new Date(g.match_date.endsWith('Z') ? g.match_date : g.match_date + 'Z') : null
          const dateLabel = _d ? _d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null
          const timeLabel = _d ? _d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
          return (
            <div key={g.match_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 13 }}>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--accent)', minWidth: 16 }}>{g.group_name}</span>
              <TeamMini t={g.team_a} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 40 }}>
                <span style={{ fontFamily: 'var(--font-data)', fontWeight: 800, color: 'var(--text-1)' }}>
                  {g.live ? `${g.score_a ?? '-'}:${g.score_b ?? '-'}` : 'vs'}
                </span>
                {!g.live && dateLabel && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', lineHeight: 1.2, textAlign: 'center' }}>
                    {dateLabel}<br />{timeLabel}
                  </span>
                )}
              </div>
              <TeamMini t={g.team_b} right />
              {g.live && <span className="badge badge-live" style={{ fontSize: 8, marginLeft: 'auto' }}>{g.status_raw || 'VIVO'}</span>}
            </div>
          )
        })}
      </div>

      {liveGroups.length > 0 && (
        <div style={{ padding: '0 var(--s4) var(--s4)', display: 'grid', gridTemplateColumns: liveGroups.length > 1 ? 'repeat(auto-fit, minmax(220px, 1fr))' : '1fr', gap: 'var(--s3)' }}>
          {liveGroups.map(gn => (
            <div key={gn} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <div style={{ padding: '5px 10px', background: 'var(--bg-overlay)', fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--text-2)' }}>
                GRUPO {gn} · ao vivo
              </div>
              {(groups[gn] || []).map(t => {
                const col = t.status === 'top2' ? 'var(--win)' : t.status === 'third' ? '#e8a030' : 'var(--text-4)'
                return (
                  <div
                    key={t.code}
                    onClick={e => { e.stopPropagation(); navigate(`/grupos/${t.id}`) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px',
                      borderTop: '1px solid var(--border)',
                      borderLeft: `3px solid ${t.qualifying ? col : 'transparent'}`,
                      background: t.live ? `${C_LIVE}12` : undefined,
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, width: 14, color: t.qualifying ? col : 'var(--text-4)', fontWeight: 700 }}>{t.position}</span>
                    {t.flag_url && <img src={t.flag_url} alt={t.code} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 1, border: '1px solid var(--border)' }} />}
                    <span style={{ flex: 1, fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ptName(t)}
                    </span>
                    {t.live && <span className="badge badge-live" style={{ fontSize: 8 }}>VIVO</span>}
                    {t.delta === 'in' && <span title="entrou agora">🟢</span>}
                    {t.delta === 'out' && <span title="caiu agora">🔴</span>}
                    <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)', minWidth: 22, textAlign: 'right' }}>{t.points}p</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Como está ficando — quem classifica */}
      <ComoEstaFicando qp={data.qualified_picture || {}} navigate={navigate} />

      {/* Confrontos projetados (só se a fonte trouxer R32) */}
      {(data.bracket || []).some(b => b.team_a && b.team_b) && (
        <div style={{ padding: '0 var(--s4) var(--s3)' }}>
          <div style={sectionLabel}>⚔️ Confrontos projetados — Oitavas</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
            {data.bracket.filter(b => b.team_a && b.team_b).map(b => (
              <div key={b.section} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'var(--bg-overlay)', borderRadius: 'var(--radius)', fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700 }}>
                <Chip t={b.team_a} /><span style={{ color: 'var(--text-4)' }}>×</span><Chip t={b.team_b} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA página completa */}
      <div style={{ padding: '0 var(--s4) var(--s4)' }}>
        <button
          onClick={e => { e.stopPropagation(); navigate('/decisivos') }}
          className="btn btn-primary w-full"
          style={{ fontFamily: 'var(--font-cond)', fontWeight: 700 }}
        >
          Ver classificação completa →
        </button>
      </div>

      <style>{`@keyframes livedot{0%{box-shadow:0 0 0 0 rgba(232,82,82,.7)}70%{box-shadow:0 0 0 6px rgba(232,82,82,0)}100%{box-shadow:0 0 0 0 rgba(232,82,82,0)}}`}</style>
    </div>
  )
}

const sectionLabel = { fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '4px 0 8px' }

function Chip({ t }) {
  if (!t) return <span style={{ color: 'var(--text-4)' }}>?</span>
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-1)' }}>
      {t.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 12, borderRadius: 1 }} />}
      {t.code}
    </span>
  )
}

function ComoEstaFicando({ qp, navigate }) {
  const blocks = [
    { title: '1ºs', teams: qp.winners, color: 'var(--win)' },
    { title: '2ºs', teams: qp.runners_up, color: 'var(--win)' },
    { title: `3ºs (${(qp.best_thirds || []).length}/8)`, teams: qp.best_thirds, color: '#e8a030' },
  ]
  return (
    <div style={{ padding: '0 var(--s4) var(--s3)' }}>
      <div style={sectionLabel}>📊 Como está ficando — quem classifica</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {blocks.map(b => (b.teams || []).length > 0 && (
          <div key={b.title} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 800, color: b.color, minWidth: 38, letterSpacing: '0.04em' }}>{b.title}</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {b.teams.map(t => (
                <span
                  key={t.code}
                  onClick={e => { e.stopPropagation(); navigate(`/grupos/${t.id}`) }}
                  title={`${t.name} · G${t.group_name} · ${t.points}pts`}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 'var(--radius)', background: `${b.color}14`, border: `1px solid ${t.delta === 'in' ? 'var(--win)' : b.color}33`, fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}
                >
                  {t.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 11, borderRadius: 1 }} />}
                  {t.code}{t.delta === 'in' ? ' 🟢' : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TeamMini({ t, right }) {
  const col = t.qualifying ? 'var(--win)' : 'var(--text-3)'
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0, justifyContent: right ? 'flex-end' : 'flex-start', color: col }}>
      {!right && t.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 14, borderRadius: 1 }} />}
      <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {ptName(t)}{t.delta === 'in' ? ' 🟢' : t.delta === 'out' ? ' 🔴' : ''}
      </span>
      {right && t.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 14, borderRadius: 1 }} />}
    </span>
  )
}
