import { useEffect, useState, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useAuth } from '../stores/authStore'

const FLAG = code => code ? `https://flagcdn.com/24x18/${code.toLowerCase()}.png` : null

const RESULT = {
  exact:   { label: 'Exato',    color: 'var(--accent)'  },
  correct: { label: 'Certo',    color: 'var(--win)'     },
  wrong:   { label: 'Erro',     color: 'var(--lose)'    },
}

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return isNaN(d) ? '—' : new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d)
}

// ── Activity Rings ────────────────────────────────────────────────────────────
// 4 rings: ranking position (outermost) → acerto → exatos → certos
const RINGS = [
  { key: 'ranking',  label: 'Ranking', color: '#7c6ae8', trackOp: 0.13 },
  { key: 'accuracy', label: 'Acerto',  color: '#e85252', trackOp: 0.13 },
  { key: 'exact',    label: 'Exatos',  color: '#e8c44a', trackOp: 0.13 },
  { key: 'correct',  label: 'Certos',  color: '#2ec980', trackOp: 0.13 },
]
// size up slightly to fit 4 rings comfortably
const R_SIZE = 168, R_CX = R_SIZE / 2, R_STROKE = 11, R_GAP = 4
const R_radii = RINGS.map((_, i) => R_CX - R_STROKE / 2 - i * (R_STROKE + R_GAP))

function ActivityRings({ exact, correct, evaluated, totalBets, rankingPosition, totalUsers }) {
  if (totalBets === 0) return null
  const accuracy   = evaluated > 0 ? (exact + correct) / evaluated : 0
  const exactPct   = evaluated > 0 ? exact   / evaluated : 0
  const correctPct = evaluated > 0 ? correct / evaluated : 0
  // ranking: 1st = 100%, last = 0% (percentile from top)
  const rankPct    = rankingPosition && totalUsers > 1
    ? 1 - (rankingPosition - 1) / (totalUsers - 1)
    : rankingPosition === 1 ? 1 : null

  const values = [
    rankPct ?? 0,
    accuracy,
    exactPct,
    correctPct,
  ]

  const rows = [
    {
      display: rankingPosition ? `${rankingPosition}º` : '—',
      sub: rankingPosition ? `de ${totalUsers} · top ${Math.round((1 - (rankPct ?? 0)) * 100)}%` : 'sem ranking',
    },
    { display: `${Math.round(accuracy * 100)}%`, sub: 'de acerto' },
    { display: String(exact),  sub: exact  === 1 ? 'placar exato'     : 'placares exatos'     },
    { display: String(correct), sub: correct === 1 ? 'resultado certo' : 'resultados certos'  },
  ]

  // innermost radius clear area — we skip center text to avoid overlap
  const innerClear = R_radii[RINGS.length - 1] - R_STROKE / 2

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s6)', flexWrap: 'wrap', width: '100%' }}>
      {/* SVG rings — no center text, clean center */}
      <svg width={R_SIZE} height={R_SIZE} viewBox={`0 0 ${R_SIZE} ${R_SIZE}`}
        style={{ flexShrink: 0, margin: '0 auto' }}>
        <defs>
          {RINGS.map(ring => (
            <filter key={ring.key} id={`glow-${ring.key}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          ))}
        </defs>

        {RINGS.map((ring, i) => {
          const r        = R_radii[i]
          const circ     = 2 * Math.PI * r
          const progress = Math.min(values[i], 1)
          const offset   = circ * (1 - progress)
          const tipAngle = (progress * 360 - 90) * (Math.PI / 180)
          return (
            <g key={ring.key}>
              <circle cx={R_CX} cy={R_CX} r={r} fill="none"
                stroke={ring.color} strokeOpacity={ring.trackOp} strokeWidth={R_STROKE} />
              <circle cx={R_CX} cy={R_CX} r={r} fill="none"
                stroke={ring.color} strokeWidth={R_STROKE}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transform: 'rotate(-90deg)', transformOrigin: `${R_CX}px ${R_CX}px`, transition: `stroke-dashoffset ${800 + i * 100}ms cubic-bezier(.4,0,.2,1)` }}
              />
              {progress > 0.03 && (
                <circle
                  cx={R_CX + r * Math.cos(tipAngle)}
                  cy={R_CX + r * Math.sin(tipAngle)}
                  r={R_STROKE / 2 - 1.5} fill={ring.color}
                  filter={`url(#glow-${ring.key})`}
                />
              )}
            </g>
          )
        })}

        {/* center: small icon or dot, no text overlap */}
        <circle cx={R_CX} cy={R_CX} r={innerClear * 0.55} fill="currentColor" opacity="0.04" />
        <text x={R_CX} y={R_CX + 5} textAnchor="middle"
          style={{ fontFamily: 'var(--font-cond)', fontSize: Math.max(innerClear * 0.45, 9), fill: 'currentColor', opacity: 0.2, letterSpacing: '-0.02em' }}>
          {evaluated}/{totalBets}
        </text>
      </svg>

      {/* legend com barras */}
      <div style={{ flex: 1, minWidth: 150, display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
        {RINGS.map((ring, i) => (
          <div key={ring.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ring.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: ring.color }}>
                  {ring.label}
                </span>
              </div>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: ring.color, lineHeight: 1 }}>
                {rows[i].display}
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: `${ring.color}22`, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2, background: ring.color,
                width: `${Math.round(Math.min(values[i], 1) * 100)}%`,
                transition: `width ${800 + i * 100}ms cubic-bezier(.4,0,.2,1)`,
                boxShadow: `0 0 5px ${ring.color}88`,
              }} />
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>
              {rows[i].sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Gráfico de pontos acumulados com filtro de agrupamento ───────────────────
const GROUP_MODES = [
  { id: 'jogo',  label: 'Por jogo'  },
  { id: 'dia',   label: 'Por dia'   },
  { id: 'semana',label: 'Por semana'},
  { id: 'mes',   label: 'Por mês'   },
]

function dateKey(dateStr, mode) {
  const d = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z')
  if (isNaN(d)) return '?'
  if (mode === 'dia')    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
  if (mode === 'semana') {
    const monday = new Date(d)
    const day = monday.getDay() || 7
    monday.setDate(monday.getDate() - day + 1)
    return monday.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
  }
  if (mode === 'mes')    return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'America/Sao_Paulo' })
  return null // jogo = por aposta individual
}

function PointsChart({ bets }) {
  const [mode, setMode] = useState('jogo')
  const [tooltip, setTooltip] = useState(null) // {x, y, label, pts, cum}

  const evaluated = useMemo(() =>
    [...bets]
      .filter(b => b.result != null)
      .sort((a, b) => new Date(a.match_date || a.created_at) - new Date(b.match_date || b.created_at)),
    [bets]
  )

  const points = useMemo(() => {
    if (mode === 'jogo') {
      let cum = 0
      return evaluated.map(b => {
        cum += b.points_earned ?? 0
        return { label: `${b.team_a_code}×${b.team_b_code}`, pts: b.points_earned ?? 0, cum }
      })
    }
    const map = new Map()
    for (const b of evaluated) {
      const k = dateKey(b.match_date || b.created_at, mode)
      if (!map.has(k)) map.set(k, 0)
      map.set(k, map.get(k) + (b.points_earned ?? 0))
    }
    let cum = 0
    return [...map.entries()].map(([label, pts]) => {
      cum += pts
      return { label, pts, cum }
    })
  }, [evaluated, mode])

  if (points.length < 1) return null

  const W = 400, H = 120, PADL = 30, PADR = 8, PADT = 10, PADB = 20
  const maxCum  = Math.max(...points.map(p => p.cum), 1)
  const totalPts = points[points.length - 1].cum

  const toX = i => PADL + (points.length === 1 ? (W - PADL - PADR) / 2 : (i / (points.length - 1)) * (W - PADL - PADR))
  const toY = v => PADT + ((1 - v / maxCum) * (H - PADT - PADB))

  const coords = points.map((p, i) => [toX(i), toY(p.cum)])
  const pathD  = coords.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x},${y}` : ` L${x},${y}`), '')
  const areaD  = `${pathD} L${coords[coords.length-1][0]},${H-PADB} L${coords[0][0]},${H-PADB} Z`

  const yTicks = [0, Math.round(maxCum / 2), maxCum]

  // colour bars below — pts per point, coloured by result
  const BAR_H = 4
  const barMax = Math.max(...points.map(p => p.pts), 1)

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r3)', padding: 'var(--s5)', marginTop: 'var(--s4)' }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--s4)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
            Pontos acumulados
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--accent)', lineHeight: 1 }}>
            {totalPts}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {GROUP_MODES.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} style={{
              fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
              padding: '3px 10px', borderRadius: 20, border: '1px solid', cursor: 'pointer',
              background: mode === m.id ? 'var(--accent)' : 'transparent',
              borderColor: mode === m.id ? 'var(--accent)' : 'var(--border)',
              color: mode === m.id ? 'var(--on-accent, #000)' : 'var(--text-3)',
              transition: 'all 120ms',
            }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG chart */}
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}
          onMouseLeave={() => setTooltip(null)}>
          <defs>
            <linearGradient id="pts-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Y axis + grid */}
          {yTicks.map(v => {
            const y = toY(v)
            return (
              <g key={v}>
                <line x1={PADL} y1={y} x2={W - PADR} y2={y}
                  stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" />
                <text x={PADL - 4} y={y + 3} textAnchor="end"
                  style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.35 }}>
                  {v}
                </text>
              </g>
            )
          })}

          {/* baseline */}
          <line x1={PADL} y1={H - PADB} x2={W - PADR} y2={H - PADB}
            stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />

          {/* area */}
          <path d={areaD} fill="url(#pts-area)" />

          {/* line */}
          <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" />

          {/* dots */}
          {coords.map(([x, y], i) => {
            const active = tooltip?.idx === i
            return (
              <g key={i} onMouseEnter={() => setTooltip({ x, y, idx: i, ...points[i] })} style={{ cursor: 'crosshair' }}>
                <circle cx={x} cy={y} r={10} fill="transparent" />
                <circle cx={x} cy={y} r={active ? 5 : 3}
                  fill={active ? 'var(--accent)' : 'var(--bg-surface)'}
                  stroke="var(--accent)" strokeWidth={active ? 2 : 1.5}
                  style={{ transition: 'r 80ms' }}
                />
              </g>
            )
          })}

          {/* X axis first/last labels */}
          {points.length >= 2 && (
            <>
              <text x={PADL} y={H - 4} textAnchor="start"
                style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.3 }}>
                {points[0].label}
              </text>
              <text x={W - PADR} y={H - 4} textAnchor="end"
                style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.3 }}>
                {points[points.length - 1].label}
              </text>
            </>
          )}
        </svg>

        {/* tooltip */}
        {tooltip && (
          <div style={{
            position: 'absolute',
            left: `${(tooltip.x / W) * 100}%`,
            top: `${(tooltip.y / H) * 100}%`,
            transform: 'translate(-50%, calc(-100% - 8px))',
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border-accent)',
            borderRadius: 'var(--r2)',
            padding: '5px 12px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 20,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          }}>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.06em' }}>
              {tooltip.label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--accent)', lineHeight: 1.1 }}>
              {tooltip.cum} pts
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginLeft: 6 }}>
                +{tooltip.pts}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Card individual de aposta ─────────────────────────────────────────────────
function BetCard({ bet, idx }) {
  const meta    = RESULT[bet.result]
  const pending = bet.result == null
  const hasOfficial = bet.official_score_a != null && bet.official_score_b != null

  const resultClass = bet.result === 'exact'   ? 'bet-card--result-exact'
                    : bet.result === 'correct'  ? 'bet-card--result-correct'
                    : bet.result === 'wrong'    ? 'bet-card--result-wrong'
                    : ''

  const ptsVariant = bet.result === 'exact'   ? 'pts-badge--exact'
                   : bet.result === 'correct'  ? 'pts-badge--correct'
                   : bet.result === 'wrong'    ? 'pts-badge--wrong'
                   : 'pts-badge--pending'

  const pts = pending ? '—' : `+${bet.points_earned ?? 0}`

  return (
    <div className={`bet-card fade-in ${resultClass}`} style={{ animationDelay: `${idx * 20}ms` }}>
      {/* top: grupo + data + pts badge */}
      <div className="bet-card__top">
        <span className="badge badge-group">Grupo {bet.group_name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
          <span className="bet-card__time">{fmtDate(bet.match_date)}</span>
          <span className={`pts-badge ${ptsVariant}`} style={{ fontSize: 13, padding: '3px 10px' }}>
            {pending ? 'Pendente' : `${meta.label} · ${pts}`}
          </span>
        </div>
      </div>

      {/* match: bandeira + time × palpite × time + bandeira */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
          {FLAG(bet.team_a_code) && (
            <img src={FLAG(bet.team_a_code)} alt={bet.team_a_code}
              style={{ width: 26, height: 19, borderRadius: 2, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
          )}
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
            {bet.team_a_code}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1,
            color: meta ? meta.color : 'var(--text-2)',
          }}>
            {bet.score_a} {String.fromCharCode(8211)} {bet.score_b}
          </span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-4)', textTransform: 'uppercase' }}>
            palpite
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', justifyContent: 'flex-end' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
            {bet.team_b_code}
          </span>
          {FLAG(bet.team_b_code) && (
            <img src={FLAG(bet.team_b_code)} alt={bet.team_b_code}
              style={{ width: 26, height: 19, borderRadius: 2, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
          )}
        </div>
      </div>

      {/* compare: palpite × oficial × pontos */}
      {hasOfficial && (
        <div className="score-compare">
          <div className="score-compare__block">
            <span className="score-compare__label">Palpite</span>
            <span className="score-compare__value" style={{ color: meta ? meta.color : 'var(--text-2)' }}>
              {bet.score_a}{String.fromCharCode(8211)}{bet.score_b}
            </span>
          </div>
          <div className="score-compare__divider" />
          <div className="score-compare__block">
            <span className="score-compare__label">Oficial</span>
            <span className="score-compare__value" style={{ color: 'var(--text-2)' }}>
              {bet.official_score_a}{String.fromCharCode(8211)}{bet.official_score_b}
            </span>
          </div>
          <div className="score-compare__divider" />
          <div className="score-compare__block">
            <span className="score-compare__label">Pontos</span>
            <span className="score-compare__value" style={{ color: meta ? meta.color : 'var(--text-3)', fontSize: 24, fontWeight: 700 }}>
              {bet.points_earned ?? 0}
            </span>
          </div>
        </div>
      )}

      {!hasOfficial && !pending && (
        <div style={{ marginTop: 'var(--s2)', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', textAlign: 'center' }}>
          Aguardando resultado oficial
        </div>
      )}
    </div>
  )
}

function posLabel(pos) {
  return pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos ? `${pos}º` : '—'
}

function PosBadge({ label, pos, total, accent }) {
  const color = accent || 'var(--accent)'
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in srgb, ${color} 10%, var(--bg-surface))`,
      border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      borderRadius: 'var(--r2)', padding: 'var(--s2) var(--s4)',
      minWidth: 80, gap: 1,
    }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1, color }}>
        {posLabel(pos)}
      </span>
      {total && (
        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)' }}>
          de {total}
        </span>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function UserHistory() {
  const { userId }   = useParams()
  const { user: me, token } = useAuth()
  const isOwn        = me && String(me.id) === String(userId)

  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [filter,     setFilter]     = useState('all')
  const [groupRanks, setGroupRanks] = useState([]) // [{name, pos, total}]

  useEffect(() => {
    setLoading(true)
    setError('')
    api.get(`/bets/users/${userId}`)
      .then(setData)
      .catch(err => setError(err.message || 'Não foi possível carregar o histórico.'))
      .finally(() => setLoading(false))
  }, [userId])

  // fetch group positions only for own profile
  useEffect(() => {
    if (!isOwn || !token) return
    api.get('/user-groups', token).then(groups => {
      if (!Array.isArray(groups)) return
      Promise.all(
        groups.map(g =>
          api.get(`/user-groups/${g.id}/ranking`, token)
            .then(d => {
              const ranking = d?.ranking ?? []
              const me = ranking.find(r => String(r.user_id) === String(userId))
              return me ? { id: g.id, name: g.name || d?.group_name || `Bolão ${g.id}`, pos: me.position ?? (ranking.indexOf(me) + 1), total: ranking.length } : null
            })
            .catch(() => null)
        )
      ).then(results => setGroupRanks(results.filter(Boolean)))
    }).catch(() => {})
  }, [isOwn, token, userId])

  if (loading) return <Spinner text="Carregando histórico..." />
  if (error) return (
    <div className="page">
      <div className="card fade-in-1">
        <div className="card__body">
          <p className="page-subtitle" style={{ margin: 0 }}>{error}</p>
          <Link to="/ranking" className="btn btn-primary btn-sm mt-4">Voltar ao ranking</Link>
        </div>
      </div>
    </div>
  )

  const bets            = data?.bets  ?? []
  const stats           = data?.stats ?? {}
  const user            = data?.user
  const rankingPosition = data?.ranking_position ?? null
  const totalUsers      = data?.total_users ?? null

  const evaluated = bets.filter(b => b.result != null)
  const pending   = bets.filter(b => b.result == null)
  const exact     = evaluated.filter(b => b.result === 'exact')
  const correct   = evaluated.filter(b => b.result === 'correct')
  const wrong     = evaluated.filter(b => b.result === 'wrong')
  const accuracy  = evaluated.length > 0 ? Math.round(((exact.length + correct.length) / evaluated.length) * 100) : 0

  const FILTERS = [
    { id: 'all',     label: 'Todas',     count: bets.length      },
    { id: 'exact',   label: 'Exatos',    count: exact.length     },
    { id: 'correct', label: 'Certos',    count: correct.length   },
    { id: 'wrong',   label: 'Erros',     count: wrong.length     },
    { id: 'pending', label: 'Pendentes', count: pending.length   },
  ]

  const visible = filter === 'all'     ? bets
                : filter === 'exact'   ? exact
                : filter === 'correct' ? correct
                : filter === 'wrong'   ? wrong
                : pending

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const GROUP_COLORS = ['var(--win)', '#4a90e8', '#e8a030', '#9b5de8']

  return (
    <div className="page">
      {/* ── Player card header ─────────────────────────── */}
      <div className="fade-in-1">
        <Link to="/ranking" className="match-breadcrumb__link">‹ Ranking</Link>

        <div style={{
          marginTop: 'var(--s5)',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r3)', padding: 'var(--s5)',
          display: 'flex', gap: 'var(--s4)', alignItems: 'center', flexWrap: 'wrap',
          boxShadow: 'var(--shadow-soft)',
        }}>
          {/* avatar */}
          <div style={{
            width: 52, height: 52, borderRadius: 'var(--r2)', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--accent-dim), var(--bg-overlay))',
            border: '2px solid var(--border-accent)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 1,
          }}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>🏆</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.04em' }}>
              {initials}
            </span>
          </div>

          {/* nome + subtítulo */}
          <div style={{ flex: 1, minWidth: 160 }}>
            <h1 className="page-title" style={{ margin: 0, lineHeight: 0.95, fontSize: 'clamp(1.6rem, 6vw, 2.4rem)' }}>
              {user?.name}
            </h1>
            <p className="page-subtitle" style={{ margin: '5px 0 0' }}>
              {bets.length} apostas · {evaluated.length} avaliadas · {accuracy}% de acerto
            </p>
          </div>

          {/* badges de posição */}
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', alignItems: 'center' }}>
            {rankingPosition && (
              <PosBadge label="Geral" pos={rankingPosition} total={totalUsers} />
            )}
            {groupRanks.map((g, i) => (
              <PosBadge
                key={g.id}
                label={g.name.length > 12 ? g.name.slice(0, 11) + '…' : g.name}
                pos={g.pos}
                total={g.total}
                accent={GROUP_COLORS[i % GROUP_COLORS.length]}
              />
            ))}
          </div>
        </div>
      </div>

      {/* KPI strip — 3 primários grandes + linha secundária */}
      <div className="fade-in-2" style={{ marginTop: 'var(--s5)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s3)' }}>
          {[
            { label: 'Pontos',   value: stats.total_points ?? 0, color: 'var(--accent)', big: true },
            { label: '% Acerto', value: `${accuracy}%`,           color: 'var(--win)',    big: true },
            { label: 'Exatos',   value: exact.length,             color: 'var(--accent)', big: true },
          ].map(k => (
            <div key={k.label} style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderTop: `3px solid ${k.color}`,
              borderRadius: 'var(--r3)', padding: 'var(--s4) var(--s5)',
            }}>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                {k.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, color: k.color, lineHeight: 1, marginTop: 4 }}>
                {k.value}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s4)', marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
          {[
            { label: 'Certos',     value: correct.length, color: 'var(--win)'    },
            { label: 'Erros',      value: wrong.length,   color: 'var(--lose)'   },
            { label: 'Pendentes',  value: pending.length, color: 'var(--text-4)' },
            { label: 'Total',      value: bets.length,    color: 'var(--text-3)' },
          ].map(k => (
            <span key={k.label} style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
              <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, color: k.color }}>{k.value}</span>
              {' '}{k.label}
            </span>
          ))}
        </div>
      </div>

      {/* Activity Rings */}
      {evaluated.length > 0 && (
        <div className="fade-in-2" style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--r3)', padding: 'var(--s5)', marginTop: 'var(--s4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: 'var(--s4)' }}>
            <span style={{ fontSize: 13, opacity: 0.7 }}>📈</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Desempenho
            </span>
          </div>
          <ActivityRings
            exact={exact.length} correct={correct.length}
            evaluated={evaluated.length} totalBets={bets.length}
            rankingPosition={rankingPosition} totalUsers={totalUsers}
          />
        </div>
      )}

      {/* Gráfico de pontos */}
      {evaluated.length > 0 && (
        <div className="fade-in-3">
          <PointsChart bets={bets} />
        </div>
      )}

      {/* Filtros + cards */}
      <div className="fade-in-3" style={{ marginTop: 'var(--s6)' }}>
        <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600,
                padding: '4px 14px', borderRadius: 20, border: '1px solid', cursor: 'pointer',
                background: filter === f.id ? 'var(--accent)' : 'transparent',
                borderColor: filter === f.id ? 'var(--accent)' : 'var(--border)',
                color: filter === f.id ? 'var(--on-accent, #000)' : 'var(--text-2)',
                transition: 'all 150ms',
              }}
            >
              {f.label} <span style={{ opacity: 0.7 }}>({f.count})</span>
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--s16)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
            Nenhuma aposta neste filtro.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            {visible.map((bet, i) => <BetCard key={bet.id} bet={bet} idx={i} />)}
          </div>
        )}
      </div>
    </div>
  )
}
