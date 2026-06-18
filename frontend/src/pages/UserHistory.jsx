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
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s8)', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
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

// ── Sparkline SVG — pontos acumulados ─────────────────────────────────────────
function Sparkline({ bets }) {
  const evaluated = useMemo(() =>
    [...bets]
      .filter(b => b.result != null)
      .sort((a, b) => new Date(a.match_date || a.created_at) - new Date(b.match_date || b.created_at)),
    [bets]
  )
  if (evaluated.length < 2) return null

  const cumulative = evaluated.reduce((acc, b, i) => {
    acc.push((acc[i - 1] ?? 0) + (b.points_earned ?? 0))
    return acc
  }, [])

  const W = 320, H = 72, PAD = 8
  const maxPts = Math.max(...cumulative, 1)
  const pts = cumulative.map((v, i) => {
    const x = PAD + (i / (cumulative.length - 1)) * (W - PAD * 2)
    const y = H - PAD - (v / maxPts) * (H - PAD * 2)
    return [x, y]
  })
  const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `M${pts[0][0]},${H - PAD} ` + pts.map(([x, y]) => `L${x},${y}`).join(' ') + ` L${pts[pts.length - 1][0]},${H - PAD} Z`
  const last = pts[pts.length - 1]
  const totalPts = cumulative[cumulative.length - 1]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s2)' }}>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Pontos acumulados
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 900, color: 'var(--accent)' }}>
          {totalPts} pts
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }}>
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#spark-fill)" />
        <polyline points={polyline} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4 : 2.5}
            fill={i === pts.length - 1 ? 'var(--accent)' : 'var(--bg-surface)'}
            stroke="var(--accent)" strokeWidth="1.5"
          />
        ))}
        <text x={last[0]} y={last[1] - 8} textAnchor="middle"
          style={{ fontFamily: 'var(--font-data)', fontSize: 10, fill: 'var(--accent)', fontWeight: 700 }}>
          {totalPts}
        </text>
        <text x={PAD} y={H - 2} style={{ fontFamily: 'var(--font-data)', fontSize: 9, fill: 'var(--text-4)' }}>
          #{evaluated[0].team_a_code}×{evaluated[0].team_b_code}
        </text>
      </svg>
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
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
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

      {/* Donut + Sparkline */}
      {evaluated.length > 0 && (
        <div className="fade-in-2" style={{
          display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--s6)',
          background: '#111', border: '1px solid #222',
          borderRadius: 'var(--r3)', padding: 'var(--s6)', marginTop: 'var(--s4)',
          alignItems: 'center',
        }}>
          <ActivityRings
            exact={exact.length} correct={correct.length}
            evaluated={evaluated.length} totalBets={bets.length}
          />
          <div style={{ borderLeft: '1px solid #222', paddingLeft: 'var(--s6)', minWidth: 0 }}>
            <Sparkline bets={bets} />
          </div>
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
