import { useEffect, useState, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

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

// ── Apple Activity Rings ──────────────────────────────────────────────────────
const RINGS = [
  { key: 'accuracy', label: 'Acerto',  color: '#FF375F', track: '#3D0011' },
  { key: 'exact',    label: 'Exatos',  color: '#FFD60A', track: '#2D2600' },
  { key: 'correct',  label: 'Certos',  color: '#30D158', track: '#002D0F' },
]
const SIZE = 160, CX = SIZE / 2, STROKE = 14, GAP = 6
const radii = [
  CX - STROKE / 2,
  CX - STROKE / 2 - STROKE - GAP,
  CX - STROKE / 2 - (STROKE + GAP) * 2,
]

function ActivityRings({ exact, correct, evaluated, totalBets }) {
  if (totalBets === 0) return null
  const accuracy = evaluated > 0 ? (exact + correct) / evaluated : 0
  const exactPct  = evaluated > 0 ? exact   / evaluated : 0
  const correctPct = evaluated > 0 ? correct / evaluated : 0
  const values = [accuracy, exactPct, correctPct]
  const labels = [
    { value: Math.round(accuracy * 100),  suffix: '%',  sub: 'Acerto'  },
    { value: exact,                        suffix: '',   sub: 'Exatos'  },
    { value: correct,                      suffix: '',   sub: 'Certos'  },
  ]

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s6)', flexWrap: 'wrap', minWidth: 0, width: '100%' }}>
      <div style={{ position: 'relative', flexShrink: 0, margin: '0 auto' }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {RINGS.map((ring, i) => {
            const r = radii[i]
            const circ = 2 * Math.PI * r
            const progress = Math.min(values[i], 1)
            const offset = circ * (1 - progress)
            // glow filter id
            return (
              <g key={ring.key}>
                {/* track */}
                <circle cx={CX} cy={CX} r={r} fill="none"
                  stroke={ring.track} strokeWidth={STROKE} />
                {/* progress arc */}
                <circle cx={CX} cy={CX} r={r} fill="none"
                  stroke={ring.color} strokeWidth={STROKE}
                  strokeDasharray={circ}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  style={{ transform: `rotate(-90deg)`, transformOrigin: `${CX}px ${CX}px`, transition: 'stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)' }}
                />
                {/* cap glow dot at tip (when progress > 0) */}
                {progress > 0.02 && (() => {
                  const angle = (progress * 360 - 90) * (Math.PI / 180)
                  const x = CX + r * Math.cos(angle)
                  const y = CX + r * Math.sin(angle)
                  return (
                    <circle cx={x} cy={y} r={STROKE / 2 - 1} fill={ring.color}
                      style={{ filter: `drop-shadow(0 0 4px ${ring.color})` }} />
                  )
                })()}
              </g>
            )
          })}
          {/* center text */}
          <text x={CX} y={CX - 8} textAnchor="middle"
            style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 900, fill: RINGS[0].color }}>
            {Math.round(accuracy * 100)}%
          </text>
          <text x={CX} y={CX + 10} textAnchor="middle"
            style={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', fill: 'rgba(255,255,255,0.4)' }}>
            ACERTO
          </text>
        </svg>
      </div>

      {/* legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)', flex: 1, minWidth: 0 }}>
        {RINGS.map((ring, i) => (
          <div key={ring.key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
            <svg width={20} height={20} viewBox="0 0 20 20" style={{ flexShrink: 0 }}>
              <circle cx={10} cy={10} r={8} fill="none" stroke={ring.track} strokeWidth={4} />
              <circle cx={10} cy={10} r={8} fill="none" stroke={ring.color} strokeWidth={4}
                strokeDasharray={2 * Math.PI * 8}
                strokeDashoffset={2 * Math.PI * 8 * (1 - Math.min(values[i], 1))}
                strokeLinecap="round"
                style={{ transform: 'rotate(-90deg)', transformOrigin: '10px 10px' }}
              />
            </svg>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: ring.color, lineHeight: 1 }}>
                {labels[i].value}{labels[i].suffix}
              </div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {ring.label}
              </div>
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

  const W = 400, H = 110, PADX = 8, PADY = 18
  const maxCum = Math.max(...points.map(p => p.cum), 1)
  const coords = points.map((p, i) => {
    const x = PADX + (points.length === 1 ? (W - PADX * 2) / 2 : (i / (points.length - 1)) * (W - PADX * 2))
    const y = PADY + ((1 - p.cum / maxCum) * (H - PADY * 2))
    return [x, y]
  })
  const polyline = coords.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `M${coords[0][0]},${H} ` + coords.map(([x, y]) => `L${x},${y}`).join(' ') + ` L${coords[coords.length - 1][0]},${H} Z`
  const totalPts = points[points.length - 1].cum

  // Y axis labels
  const yLabels = [0, Math.round(maxCum / 2), maxCum].map(v => ({
    v,
    y: PADY + ((1 - v / maxCum) * (H - PADY * 2)),
  }))

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r3)', padding: 'var(--s5)', marginTop: 'var(--s4)' }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 'var(--s4)' }}>
        <div>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Pontos acumulados
          </span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 900, color: 'var(--accent)', marginLeft: 'var(--s3)' }}>
            {totalPts} pts
          </span>
        </div>
        {/* mode pills */}
        <div style={{ display: 'flex', gap: 4 }}>
          {GROUP_MODES.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)} style={{
              fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
              padding: '3px 10px', borderRadius: 20, border: '1px solid', cursor: 'pointer',
              background: mode === m.id ? 'var(--accent)' : 'transparent',
              borderColor: mode === m.id ? 'var(--accent)' : 'var(--border)',
              color: mode === m.id ? '#000' : 'var(--text-3)',
              transition: 'all 120ms',
            }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG chart */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}
          onMouseLeave={() => setTooltip(null)}>
          <defs>
            <linearGradient id="pts-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* grid lines */}
          {yLabels.map(({ v, y }) => (
            <g key={v}>
              <line x1={PADX} y1={y} x2={W - PADX} y2={y}
                stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3,4" />
              <text x={PADX} y={y - 3}
                style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'rgba(255,255,255,0.25)' }}>
                {v}
              </text>
            </g>
          ))}
          {/* area fill */}
          <path d={area} fill="url(#pts-fill)" />
          {/* line */}
          <polyline points={polyline} fill="none" stroke="var(--accent)" strokeWidth="2"
            strokeLinejoin="round" strokeLinecap="round" />
          {/* dots + hover targets */}
          {coords.map(([x, y], i) => (
            <g key={i}
              onMouseEnter={() => setTooltip({ x, y, ...points[i] })}
              style={{ cursor: 'crosshair' }}
            >
              <circle cx={x} cy={y} r={10} fill="transparent" />
              <circle cx={x} cy={y} r={tooltip?.label === points[i].label ? 5 : 3}
                fill={tooltip?.label === points[i].label ? 'var(--accent)' : '#111'}
                stroke="var(--accent)" strokeWidth="1.5"
                style={{ transition: 'r 100ms' }}
              />
            </g>
          ))}
        </svg>

        {/* tooltip */}
        {tooltip && (
          <div style={{
            position: 'absolute',
            left: `${(tooltip.x / W) * 100}%`,
            top: `${(tooltip.y / H) * 100}%`,
            transform: 'translate(-50%, -110%)',
            background: '#1a1a1a',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--r2)',
            padding: '4px 10px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)' }}>{tooltip.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900, color: 'var(--accent)' }}>
              {tooltip.cum} pts <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>+{tooltip.pts}</span>
            </div>
          </div>
        )}

        {/* X axis labels — apenas primeiro e último */}
        {points.length >= 2 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, padding: `0 ${PADX}px` }}>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{points[0].label}</span>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>{points[points.length - 1].label}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Card individual de aposta ─────────────────────────────────────────────────
function BetCard({ bet, idx }) {
  const meta = RESULT[bet.result]
  const pending = bet.result == null
  const hasOfficial = bet.official_score_a != null && bet.official_score_b != null

  return (
    <div
      className="fade-in"
      style={{
        animationDelay: `${idx * 20}ms`,
        background: 'var(--bg-surface)',
        border: `1px solid ${meta ? meta.color + '44' : 'var(--border)'}`,
        borderLeft: `3px solid ${meta ? meta.color : 'var(--border)'}`,
        borderRadius: 'var(--r3)',
        padding: 'var(--s4) var(--s5)',
        display: 'flex', flexDirection: 'column', gap: 'var(--s3)',
      }}
    >
      {/* top row: grupo + data + badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
          Grupo {bet.group_name}
        </span>
        <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
          {pending ? (
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', fontStyle: 'italic' }}>Pendente</span>
          ) : (
            <span style={{
              fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              padding: '2px 8px', borderRadius: 20, textTransform: 'uppercase',
              background: meta.color + '22', color: meta.color, border: `1px solid ${meta.color}44`,
            }}>
              {meta.label} · +{bet.points_earned ?? 0}
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)' }}>
            {fmtDate(bet.match_date)}
          </span>
        </div>
      </div>

      {/* match row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 'var(--s3)' }}>
        {/* team A */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
          {FLAG(bet.team_a_code) && (
            <img src={FLAG(bet.team_a_code)} alt={bet.team_a_code}
              style={{ width: 24, height: 18, borderRadius: 2, objectFit: 'cover', flexShrink: 0 }} />
          )}
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
            {bet.team_a_code}
          </span>
        </div>

        {/* scores */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 900,
              color: meta ? meta.color : 'var(--text-2)', lineHeight: 1,
              minWidth: 22, textAlign: 'right',
            }}>{bet.score_a}</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>–</span>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 900,
              color: meta ? meta.color : 'var(--text-2)', lineHeight: 1,
              minWidth: 22, textAlign: 'left',
            }}>{bet.score_b}</span>
          </div>
          {hasOfficial ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                {bet.official_score_a}–{bet.official_score_b}
              </span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.06em' }}>OFICIAL</span>
            </div>
          ) : (
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.06em' }}>
              {pending ? 'AGUARDANDO' : 'SEM DADO'}
            </span>
          )}
        </div>

        {/* team B */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', justifyContent: 'flex-end' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>
            {bet.team_b_code}
          </span>
          {FLAG(bet.team_b_code) && (
            <img src={FLAG(bet.team_b_code)} alt={bet.team_b_code}
              style={{ width: 24, height: 18, borderRadius: 2, objectFit: 'cover', flexShrink: 0 }} />
          )}
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────
export default function UserHistory() {
  const { userId } = useParams()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [filter,  setFilter]  = useState('all')

  useEffect(() => {
    setLoading(true)
    setError('')
    api.get(`/bets/users/${userId}`)
      .then(setData)
      .catch(err => setError(err.message || 'Não foi possível carregar o histórico.'))
      .finally(() => setLoading(false))
  }, [userId])

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

  const bets      = data?.bets  ?? []
  const stats     = data?.stats ?? {}
  const user      = data?.user

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

  return (
    <div className="page">
      {/* Header */}
      <div className="fade-in-1">
        <Link to="/ranking" className="match-breadcrumb__link">‹ Ranking</Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', marginTop: 'var(--s4)', flexWrap: 'wrap' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
            background: 'color-mix(in srgb, var(--accent) 20%, var(--bg-overlay))',
            border: '2px solid var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: 'var(--accent)',
          }}>
            {initials}
          </div>
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>{user?.name}</h1>
            <p className="page-subtitle" style={{ margin: 0 }}>
              {bets.length} apostas · {evaluated.length} avaliadas · {accuracy}% de acerto
            </p>
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div className="fade-in-2" style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
        gap: 'var(--s3)', marginTop: 'var(--s6)',
      }}>
        {[
          { label: 'Pontos',    value: stats.total_points ?? 0, color: 'var(--accent)' },
          { label: '% Acerto',  value: `${accuracy}%`,          color: 'var(--win)'    },
          { label: 'Exatos',    value: exact.length,            color: 'var(--accent)' },
          { label: 'Certos',    value: correct.length,          color: 'var(--win)'    },
          { label: 'Erros',     value: wrong.length,            color: 'var(--lose)'   },
          { label: 'Pendentes', value: pending.length,          color: 'var(--text-3)' },
        ].map(k => (
          <div key={k.label} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderTop: `2px solid ${k.color}`,
            borderRadius: 'var(--r3)', padding: 'var(--s4)',
          }}>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 'var(--s1)' }}>
              {k.label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, color: k.color, lineHeight: 1 }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Activity Rings + Sparkline */}
      {evaluated.length > 0 && (
        <div className="fade-in-2" style={{
          display: 'flex', flexWrap: 'wrap', gap: 'var(--s6)',
          background: '#111', border: '1px solid #222',
          borderRadius: 'var(--r3)', padding: 'var(--s6)', marginTop: 'var(--s4)',
          alignItems: 'center', overflow: 'hidden',
        }}>
          <ActivityRings
            exact={exact.length} correct={correct.length}
            evaluated={evaluated.length} totalBets={bets.length}
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
