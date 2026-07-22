import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { PT_NAMES } from '../utils/teamNames'
import { COMPETITIONS as ALL_COMPETITIONS } from '../utils/competitions'

const COMPETITIONS = ALL_COMPETITIONS.filter(c => c.id !== 'geral').map(c => ({ id: c.id, label: `${c.emoji} ${c.label}` }))

const POLL_MS = 10000

const C_TOP2  = 'var(--win)'
const C_THIRD = '#e8a030'
const C_OUT   = 'var(--text-4)'
const C_LIVE  = 'var(--lose, #e85252)'

const statusColor = s => (s === 'top2' ? C_TOP2 : s === 'third' ? C_THIRD : C_OUT)
const ptName = t => PT_NAMES[t.code] || t.name || t.code

function CompNav({ comp, setComp }) {
  return (
    <div className="phase-nav fade-in-1" style={{ marginBottom: 'var(--s4)' }}>
      {COMPETITIONS.map(c => (
        <button
          key={c.id}
          type="button"
          className={`phase-nav__tab ${comp === c.id ? 'active' : ''}`}
          onClick={() => setComp(c.id)}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

// Brasileirão é pontos corridos — não tem fase de grupos/classificação pra
// mata-mata. O equivalente (zona de título/G4/Z4 + projeção) já existe em
// /brasileirao (Tabela), então aqui só redireciona em vez de duplicar lógica.
function BrasileiraoRedirect({ comp, setComp }) {
  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">JOGOS DECISIVOS</h1>
        <p className="page-subtitle">Quem classifica · projeção em tempo real</p>
      </div>
      <CompNav comp={comp} setComp={setComp} />
      <div className="card mt-4 fade-in-2" style={{ padding: 'var(--s6) var(--s5)', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
          🇧🇷 Brasileirão é disputado em pontos corridos, sem fase de grupos — a projeção de título, G4 e
          rebaixamento já está na tabela ao vivo.
        </p>
        <Link to="/brasileirao" className="btn btn-primary btn-sm">Ver Tabela do Brasileirão</Link>
      </div>
    </div>
  )
}

export default function Decisivos() {
  const [comp, setComp]   = useState('brasileirao2026')
  const [data, setData]   = useState(null)
  const [loading, setLoad] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (comp !== 'copa2026') return
    let alive = true
    const load = () =>
      api.get('/live/classification')
        .then(d => { if (alive) setData(d) })
        .catch(console.error)
        .finally(() => { if (alive) setLoad(false) })
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => { alive = false; window.clearInterval(id) }
  }, [comp])

  if (comp !== 'copa2026') return <BrasileiraoRedirect comp={comp} setComp={setComp} />

  if (loading) return <Spinner text="Carregando jogos decisivos..." />
  if (!data)   return <div className="page"><p className="page-subtitle">Falha ao carregar.</p></div>

  const { has_live, live_count, decisive_games = [], qualified_picture = {}, groups = {} } = data
  const liveGames = decisive_games.filter(g => g.live)
  const upcoming  = decisive_games.filter(g => !g.live)
  const qp = qualified_picture

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">JOGOS DECISIVOS</h1>
        <p className="page-subtitle">Quem classifica · projeção em tempo real (top 2 + 8 melhores 3ºs)</p>
      </div>

      <CompNav comp={comp} setComp={setComp} />

      {/* Banner ao vivo */}
      {has_live ? (
        <div className="card mt-6 fade-in-2" style={{
          padding: 'var(--s4) var(--s5)', display: 'flex', alignItems: 'center', gap: 'var(--s3)',
          border: `1px solid ${C_LIVE}66`, background: `${C_LIVE}10`,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: C_LIVE, animation: 'livedot 1.4s infinite', flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, color: 'var(--text-1)' }}>
            {live_count} jogo{live_count > 1 ? 's' : ''} de grupo ao vivo — classificação muda em tempo real
          </span>
          <style>{`@keyframes livedot{0%{box-shadow:0 0 0 0 rgba(232,82,82,.7)}70%{box-shadow:0 0 0 7px rgba(232,82,82,0)}100%{box-shadow:0 0 0 0 rgba(232,82,82,0)}}`}</style>
        </div>
      ) : (
        <div className="card mt-6 fade-in-2" style={{ padding: 'var(--s4) var(--s5)' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)' }}>
            Nenhum jogo de grupo ao vivo agora. Mostrando confrontos da rodada decisiva e a projeção atual.
          </span>
        </div>
      )}

      {/* Legenda */}
      <div className="card mt-4 fade-in-2" style={{ padding: 'var(--s3) var(--s5)', display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Legenda color={C_TOP2}  label="Classifica (1º/2º)" />
        <Legenda color={C_THIRD} label="Melhor 3º" />
        <Legenda color={C_OUT}   label="Eliminado" />
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>
          🟢 entrou agora · 🔴 caiu agora
        </span>
      </div>

      {/* Jogos ao vivo */}
      {liveGames.length > 0 && (
        <Section title="🔴 Ao Vivo" count={liveGames.length}>
          <div style={gridGames}>
            {liveGames.map(g => <DecisiveCard key={g.match_id} g={g} navigate={navigate} />)}
          </div>
        </Section>
      )}

      {/* Quem classifica */}
      <Section title="✅ Quem Classifica" count={`${(qp.winners?.length || 0) + (qp.runners_up?.length || 0) + (qp.best_thirds?.length || 0)}/32`}>
        <div style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
          <QualRow title="Primeiros Colocados" teams={qp.winners} color={C_TOP2} navigate={navigate} />
          <QualRow title="Segundos Colocados" teams={qp.runners_up} color={C_TOP2} navigate={navigate} />
          <QualRow title={`Melhores Terceiros (${qp.best_thirds?.length || 0}/8)`} teams={qp.best_thirds} color={C_THIRD} navigate={navigate} />
        </div>
      </Section>

      {/* Próximos decisivos */}
      {upcoming.length > 0 && (
        <Section title="⚔️ Rodada Decisiva" count={upcoming.length}>
          <div style={gridGames}>
            {upcoming.map(g => <DecisiveCard key={g.match_id} g={g} navigate={navigate} />)}
          </div>
        </Section>
      )}

      {/* Mini tabelas projetadas */}
      <div className="groups-grid mt-8 fade-in-2">
        {Object.keys(groups).sort().map(gn => (
          <div key={gn} className="card">
            <div className="card__header">
              <span className="group-card__title">GRUPO {gn}</span>
            </div>
            <div>
              {groups[gn].map(t => {
                const col = statusColor(t.status)
                return (
                  <div
                    key={t.code}
                    className="group-team-row"
                    onClick={() => navigate(`/grupos/${t.id}`)}
                    style={{ borderLeft: `3px solid ${t.qualifying ? col : 'transparent'}`, background: t.live ? `${C_LIVE}12` : undefined }}
                  >
                    <span className="group-team-row__pos" style={{ color: t.qualifying ? col : undefined, fontWeight: t.qualifying ? 700 : 400 }}>
                      {t.position}
                    </span>
                    {t.flag_url && <img src={t.flag_url} alt={t.code} style={{ width: 22, height: 16, objectFit: 'cover', borderRadius: 1, border: '1px solid var(--border)' }} />}
                    <span className="group-team-row__name" style={{ flex: 1 }}>{ptName(t)}</span>
                    {t.live && <span className="badge badge-live" style={{ fontSize: 8 }}>VIVO</span>}
                    {t.delta === 'in'  && <span title="entrou agora">🟢</span>}
                    {t.delta === 'out' && <span title="caiu agora">🔴</span>}
                    <span className="group-team-row__elo" title="Pontos">{t.points}p</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

const gridGames = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--s2)', padding: 'var(--s4)' }

function Section({ title, count, children }) {
  return (
    <div className="card mt-6 fade-in-3">
      <div className="card__header">
        <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>{title}</span>
        {count != null && <span className="badge badge-group">{count}</span>}
      </div>
      {children}
    </div>
  )
}

function Legenda({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)' }}>{label}</span>
    </div>
  )
}

function TeamLine({ t, right }) {
  const col = t.qualifying ? C_TOP2 : C_OUT
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, justifyContent: right ? 'flex-end' : 'flex-start' }}>
      {!right && t.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 18, width: 'auto', borderRadius: 2 }} />}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ptName(t)} {t.delta === 'in' ? '🟢' : t.delta === 'out' ? '🔴' : ''}
        </span>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: col, fontWeight: 700 }}>
          {t.position ? `${t.position}º` : ''} {t.qualifying ? '· classifica' : '· fora'}
        </span>
      </div>
      {right && t.flag_url && <img src={t.flag_url} alt={t.code} style={{ height: 18, width: 'auto', borderRadius: 2 }} />}
    </div>
  )
}

function DecisiveCard({ g, navigate }) {
  const resolved = g.match_id != null
  const dateLabel = g.match_date
    ? new Date(g.match_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <div
      onClick={() => resolved && navigate(`/partida/${g.match_id}`)}
      style={{
        padding: 'var(--s3) var(--s4)', background: 'var(--bg-overlay)', borderRadius: 'var(--radius)',
        border: `1px solid ${g.live ? `${C_LIVE}66` : 'var(--border)'}`, cursor: resolved ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.06em' }}>
          GRUPO {g.group_name}
        </span>
        {g.live
          ? <span className="badge badge-live">{g.status_raw || 'AO VIVO'}</span>
          : <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>{dateLabel}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
        <TeamLine t={g.team_a} />
        <span style={{ fontFamily: 'var(--font-data)', fontWeight: 800, fontSize: 16, color: 'var(--text-1)', flexShrink: 0 }}>
          {g.live ? `${g.score_a ?? '-'} : ${g.score_b ?? '-'}` : 'vs'}
        </span>
        <TeamLine t={g.team_b} right />
      </div>
    </div>
  )
}

function QualRow({ title, teams, color, navigate }) {
  if (!teams || teams.length === 0) return null
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--s3)' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
        {teams.map(t => (
          <div
            key={t.code}
            onClick={() => navigate(`/grupos/${t.id}`)}
            title={`${t.name} — Grupo ${t.group_name} · ${t.points}pts`}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
              background: `${color}18`, border: `1px solid ${t.delta === 'in' ? C_TOP2 : color}44`,
              borderRadius: 'var(--radius)', cursor: 'pointer',
            }}
          >
            {t.flag_url && <img src={t.flag_url} alt={t.code} style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 1 }} />}
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>
              {ptName(t)} {t.delta === 'in' ? '🟢' : ''}
            </span>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)' }}>G{t.group_name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
