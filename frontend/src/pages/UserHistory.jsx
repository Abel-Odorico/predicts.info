import { useEffect, useState, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'
import { useAuth } from '../stores/authStore'
import MyChampionCard from '../components/MyChampionCard'


const RESULT_META = {
  exact:   { label: 'Exato',   color: 'var(--accent)', hex: '#0f7a78' },
  correct: { label: 'Certo',   color: 'var(--win)',    hex: '#2ec980' },
  wrong:   { label: 'Erro',    color: 'var(--lose)',   hex: '#e85252' },
}

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value.endsWith('Z') ? value : `${value}Z`)
  return isNaN(d) ? '—' : new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(d)
}

// ── Activity Rings ─────────────────────────────────────────────────────────
const RINGS = [
  { key: 'ranking',  label: 'Ranking',  color: '#7c6ae8', trackOp: 0.13 },
  { key: 'accuracy', label: 'Acerto',   color: '#e85252', trackOp: 0.13 },
  { key: 'exact',    label: 'Exatos',   color: '#e8c44a', trackOp: 0.13 },
  { key: 'correct',  label: 'Certos',   color: '#2ec980', trackOp: 0.13 },
]
const R_SIZE = 168, R_CX = R_SIZE / 2, R_STROKE = 11, R_GAP = 4
const R_radii = RINGS.map((_, i) => R_CX - R_STROKE / 2 - i * (R_STROKE + R_GAP))

function ActivityRings({ exact, correct, evaluated, totalBets, rankingPosition, totalUsers }) {
  if (totalBets === 0) return null
  const accuracy   = evaluated > 0 ? (exact + correct) / evaluated : 0
  const exactPct   = evaluated > 0 ? exact   / evaluated : 0
  const correctPct = evaluated > 0 ? correct / evaluated : 0
  const rankPct    = rankingPosition && totalUsers > 1
    ? 1 - (rankingPosition - 1) / (totalUsers - 1)
    : rankingPosition === 1 ? 1 : null

  const values = [rankPct ?? 0, accuracy, exactPct, correctPct]

  const rows = [
    { display: rankingPosition ? `${rankingPosition}º` : '—', sub: rankingPosition ? `de ${totalUsers} · top ${Math.round((1 - (rankPct ?? 0)) * 100)}%` : 'sem ranking' },
    { display: `${Math.round(accuracy * 100)}%`, sub: 'de acerto geral' },
    { display: String(exact),   sub: exact   === 1 ? 'placar exato'     : 'placares exatos'    },
    { display: String(correct), sub: correct === 1 ? 'resultado certo'  : 'resultados certos'  },
  ]

  const innerClear = R_radii[RINGS.length - 1] - R_STROKE / 2

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s6)', flexWrap: 'wrap' }}>
      <svg width={R_SIZE} height={R_SIZE} viewBox={`0 0 ${R_SIZE} ${R_SIZE}`} style={{ flexShrink: 0, margin: '0 auto' }}>
        <defs>
          {RINGS.map(ring => (
            <filter key={ring.key} id={`glow-${ring.key}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          ))}
        </defs>
        {RINGS.map((ring, i) => {
          const r = R_radii[i]
          const circ = 2 * Math.PI * r
          const progress = Math.min(values[i], 1)
          const offset   = circ * (1 - progress)
          const tipAngle = (progress * 360 - 90) * (Math.PI / 180)
          return (
            <g key={ring.key}>
              <circle cx={R_CX} cy={R_CX} r={r} fill="none" stroke={ring.color} strokeOpacity={ring.trackOp} strokeWidth={R_STROKE} />
              <circle cx={R_CX} cy={R_CX} r={r} fill="none" stroke={ring.color} strokeWidth={R_STROKE}
                strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                style={{ transform: 'rotate(-90deg)', transformOrigin: `${R_CX}px ${R_CX}px`, transition: `stroke-dashoffset ${800 + i * 100}ms cubic-bezier(.4,0,.2,1)` }}
              />
              {progress > 0.03 && (
                <circle cx={R_CX + r * Math.cos(tipAngle)} cy={R_CX + r * Math.sin(tipAngle)}
                  r={R_STROKE / 2 - 1.5} fill={ring.color} filter={`url(#glow-${ring.key})`} />
              )}
            </g>
          )
        })}
        <circle cx={R_CX} cy={R_CX} r={innerClear * 0.55} fill="currentColor" opacity="0.04" />
        <text x={R_CX} y={R_CX + 5} textAnchor="middle"
          style={{ fontFamily: 'var(--font-cond)', fontSize: Math.max(innerClear * 0.45, 9), fill: 'currentColor', opacity: 0.2, letterSpacing: '-0.02em' }}>
          {evaluated}/{totalBets}
        </text>
      </svg>

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
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>{rows[i].sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Barra de distribuição de resultados ───────────────────────────────────
function ResultBar({ exact, correct, wrong, pending }) {
  const total = exact + correct + wrong + pending
  if (total === 0) return null
  const pct = v => Math.round((v / total) * 100)
  const segments = [
    { key: 'exact',   label: 'Exatos',    value: exact,   color: '#0f7a78', pct: pct(exact)   },
    { key: 'correct', label: 'Certos',    value: correct, color: '#2ec980', pct: pct(correct) },
    { key: 'wrong',   label: 'Erros',     value: wrong,   color: '#e85252', pct: pct(wrong)   },
    { key: 'pending', label: 'Pendentes', value: pending, color: '#3d5a78', pct: pct(pending) },
  ].filter(s => s.value > 0)

  return (
    <div className="uh-result-bar">
      <div className="uh-result-bar__track">
        {segments.map((s, i) => (
          <div
            key={s.key}
            className="uh-result-bar__seg"
            style={{
              width: `${s.pct}%`,
              background: s.color,
              borderRadius: i === 0 ? '4px 0 0 4px' : i === segments.length - 1 ? '0 4px 4px 0' : 0,
            }}
          />
        ))}
      </div>
      <div className="uh-result-bar__labels">
        {segments.map(s => (
          <div key={s.key} className="uh-result-bar__label" style={{ width: `${s.pct}%` }}>
            <span className="uh-result-bar__pct" style={{ color: s.color }}>{s.pct}%</span>
            <span className="uh-result-bar__name">{s.label}</span>
            <span className="uh-result-bar__count">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Streaks ────────────────────────────────────────────────────────────────
function computeStreaks(evaluated) {
  if (!evaluated.length) return null
  // sort by match_date
  const sorted = [...evaluated].sort((a, b) =>
    new Date(a.match_date || a.created_at) - new Date(b.match_date || b.created_at)
  )

  let bestStreak = 0, worstStreak = 0
  let curGood = 0, curBad = 0
  let maxGood = 0, maxBad = 0

  for (const b of sorted) {
    const hit = b.result === 'exact' || b.result === 'correct'
    if (hit) { curGood++; curBad = 0; if (curGood > maxGood) maxGood = curGood }
    else      { curBad++;  curGood = 0; if (curBad  > maxBad)  maxBad  = curBad  }
  }

  // current streak (from end)
  let currentVal = 0
  let currentType = null
  for (let i = sorted.length - 1; i >= 0; i--) {
    const hit = sorted[i].result === 'exact' || sorted[i].result === 'correct'
    if (currentType === null) { currentType = hit; currentVal = 1 }
    else if (hit === currentType) { currentVal++ }
    else break
  }

  return { best: maxGood, worst: maxBad, currentVal, currentType }
}

function StreaksSection({ evaluated }) {
  const s = useMemo(() => computeStreaks(evaluated), [evaluated])
  if (!s || evaluated.length < 2) return null

  return (
    <div className="uh-streaks">
      <div className="uh-streaks__item">
        <div className="uh-streaks__val" style={{ color: 'var(--win)' }}>{s.best}</div>
        <div className="uh-streaks__label">Melhor sequência</div>
        <div className="uh-streaks__sub">acertos seguidos</div>
      </div>
      <div className="uh-streaks__divider" />
      <div className="uh-streaks__item">
        <div className="uh-streaks__val" style={{ color: s.currentType ? 'var(--win)' : 'var(--lose)' }}>
          {s.currentVal}
        </div>
        <div className="uh-streaks__label">Sequência atual</div>
        <div className="uh-streaks__sub" style={{ color: s.currentType ? 'var(--win)' : 'var(--lose)' }}>
          {s.currentType ? 'acertos' : 'erros'} seguidos
        </div>
      </div>
      <div className="uh-streaks__divider" />
      <div className="uh-streaks__item">
        <div className="uh-streaks__val" style={{ color: 'var(--lose)' }}>{s.worst}</div>
        <div className="uh-streaks__label">Pior sequência</div>
        <div className="uh-streaks__sub">erros seguidos</div>
      </div>
    </div>
  )
}

// ── Gráfico de pontos ──────────────────────────────────────────────────────
const GROUP_MODES = [
  { id: 'jogo',   label: 'Por jogo'   },
  { id: 'dia',    label: 'Por dia'    },
  { id: 'semana', label: 'Por semana' },
  { id: 'mes',    label: 'Por mês'    },
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
  if (mode === 'mes') return d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'America/Sao_Paulo' })
  return null
}

const RESULT_COLOR = { exact: '#0f7a78', correct: '#2ec980', wrong: '#e85252' }

function PointsChart({ bets }) {
  const [mode, setMode] = useState('jogo')
  const [tooltip, setTooltip] = useState(null)
  const [hidden, setHidden] = useState(() => new Set())

  const toggleHidden = key => setHidden(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  const evaluated = useMemo(() =>
    [...bets].filter(b => b.result != null && !hidden.has(b.result))
      .sort((a, b) => new Date(a.match_date || a.created_at) - new Date(b.match_date || b.created_at)),
    [bets, hidden]
  )

  const points = useMemo(() => {
    if (mode === 'jogo') {
      let cum = 0
      return evaluated.map(b => {
        cum += b.points_earned ?? 0
        return { label: `${b.team_a_name || b.team_a_code}×${b.team_b_name || b.team_b_code}`, pts: b.points_earned ?? 0, cum, result: b.result }
      })
    }
    const map = new Map()
    const resultMap = new Map()
    for (const b of evaluated) {
      const k = dateKey(b.match_date || b.created_at, mode)
      map.set(k, (map.get(k) || 0) + (b.points_earned ?? 0))
      if (!resultMap.has(k)) resultMap.set(k, b.result)
    }
    let cum = 0
    return [...map.entries()].map(([label, pts]) => {
      cum += pts
      return { label, pts, cum, result: resultMap.get(label) }
    })
  }, [evaluated, mode])

  const hasAnyEvaluated = useMemo(() => bets.some(b => b.result != null), [bets])
  if (!hasAnyEvaluated) return null

  const W = 400, H = 200, BAR_H = 52, PADL = 32, PADR = 8, PADT = 10, PADB = 16
  const SEP = 6
  const chartH = H - BAR_H - PADB - SEP
  const maxCum = Math.max(...points.map(p => p.cum), 1)
  const maxPts = Math.max(...points.map(p => p.pts), 1)
  const totalPts = points.length ? points[points.length - 1].cum : 0

  const toX    = i => PADL + (points.length === 1 ? (W - PADL - PADR) / 2 : (i / (points.length - 1)) * (W - PADL - PADR))
  const toY    = v => PADT + ((1 - v / maxCum) * (chartH - PADT))
  const barBot = H - PADB
  const barMaxH = BAR_H - 8

  const coords = points.map((p, i) => [toX(i), toY(p.cum)])
  const pathD  = coords.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x},${y}` : ` L${x},${y}`), '')
  const areaD  = points.length ? `${pathD} L${coords[coords.length - 1][0]},${chartH} L${coords[0][0]},${chartH} Z` : ''
  const yTicks = [0, Math.round(maxCum / 2), maxCum]

  const barW = points.length > 1
    ? Math.max(3, ((W - PADL - PADR) / points.length) * 0.65)
    : 16

  return (
    <div className="uh-chart-card">
      <div className="uh-chart-card__head">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s3)' }}>
          <span className="uh-chart-card__label">Pontos acumulados</span>
          <span className="uh-chart-card__total">{totalPts}</span>
        </div>
        <div className="uh-chart-modes">
          {GROUP_MODES.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={`uh-chart-mode${mode === m.id ? ' active' : ''}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        {points.length < 1 ? (
          <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>
            Todos os tipos de resultado estão ocultos — clique na legenda abaixo para reexibir.
          </div>
        ) : (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}
          onMouseLeave={() => setTooltip(null)}>
          <defs>
            <linearGradient id="pts-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Y grid */}
          {yTicks.map(v => {
            const y = toY(v)
            return (
              <g key={v}>
                <line x1={PADL} y1={y} x2={W - PADR} y2={y} stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" />
                <text x={PADL - 4} y={y + 3} textAnchor="end"
                  style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.35 }}>{v}</text>
              </g>
            )
          })}

          {/* Separator line between chart area and bars */}
          <line x1={PADL} y1={chartH + SEP} x2={W - PADR} y2={chartH + SEP} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="2 3" />

          {/* Area + Line */}
          <path d={areaD} fill="url(#pts-area)" />
          <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* Per-game bars + connector lines */}
          {points.map((p, i) => {
            const x      = toX(i)
            const bh     = p.pts > 0 ? Math.max(4, (p.pts / maxPts) * barMaxH) : 2
            const col    = RESULT_COLOR[p.result] || '#3d5a78'
            const barTop = barBot - bh
            const dotY   = coords[i][1]
            const active = tooltip?.idx === i
            return (
              <g key={i}
                onMouseEnter={() => setTooltip({ x, y: dotY, idx: i, ...points[i] })}
                style={{ cursor: 'crosshair' }}>
                {/* Connector always visible: dot bottom → bar top */}
                <line
                  x1={x} y1={dotY + 4} x2={x} y2={barTop - 1}
                  stroke={col}
                  strokeOpacity={active ? 0.7 : 0.22}
                  strokeWidth={active ? 1.5 : 1}
                  strokeDasharray={active ? '3 3' : '2 4'}
                />
                {/* Bar */}
                <rect
                  x={x - barW / 2} y={barTop}
                  width={barW} height={bh}
                  fill={col} opacity={active ? 1 : 0.72} rx="2"
                />
                {/* Hover hit area (full column height) */}
                <rect x={x - Math.max(barW, 10) / 2} y={PADT} width={Math.max(barW, 10)} height={H - PADT - PADB}
                  fill="transparent" />
              </g>
            )
          })}

          {/* Dots on line */}
          {coords.map(([x, y], i) => {
            const active = tooltip?.idx === i
            return (
              <g key={i} style={{ pointerEvents: 'none' }}>
                <circle cx={x} cy={y} r={active ? 5 : 3}
                  fill={active ? 'var(--accent)' : 'var(--bg-surface)'}
                  stroke="var(--accent)" strokeWidth={active ? 2 : 1.5}
                  style={{ transition: 'r 80ms' }}
                />
              </g>
            )
          })}

          {/* X labels first/last */}
          {points.length >= 2 && (
            <>
              <text x={PADL} y={H - 2} textAnchor="start"
                style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.3 }}>{points[0].label}</text>
              <text x={W - PADR} y={H - 2} textAnchor="end"
                style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.3 }}>{points[points.length - 1].label}</text>
            </>
          )}
        </svg>
        )}

        {/* Tooltip */}
        {tooltip && (() => {
          const leftPct = (tooltip.x / W) * 100
          const flipLeft = leftPct > 75
          return (
            <div style={{
              position: 'absolute',
              left: `${leftPct}%`,
              top: `${(tooltip.y / H) * 100}%`,
              transform: `translate(${flipLeft ? 'calc(-100% - 8px)' : '8px'}, calc(-50%))`,
              background: 'var(--bg-overlay)',
              border: `1px solid ${RESULT_COLOR[tooltip.result] || 'var(--border)'}`,
              borderRadius: 'var(--r2)', padding: '6px 12px',
              pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 20,
              boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            }}>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: 2 }}>
                {tooltip.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--accent)', lineHeight: 1 }}>
                  {tooltip.cum} pts
                </span>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: RESULT_COLOR[tooltip.result] || 'var(--text-4)', fontWeight: 700 }}>
                  +{tooltip.pts}
                </span>
              </div>
              {tooltip.result && (
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: RESULT_COLOR[tooltip.result], letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
                  {RESULT_META[tooltip.result]?.label}
                </div>
              )}
            </div>
          )
        })()}
      </div>

      {/* Bar legend — clique para ocultar/exibir */}
      <div className="uh-chart-legend">
        {Object.entries(RESULT_COLOR).map(([key, color]) => {
          const isHidden = hidden.has(key)
          return (
            <button
              key={key}
              onClick={() => toggleHidden(key)}
              className="uh-chart-legend__item"
              title={isHidden ? `Mostrar ${RESULT_META[key]?.label}` : `Ocultar ${RESULT_META[key]?.label}`}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                opacity: isHidden ? 0.35 : 1, transition: 'opacity .15s',
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: 2, display: 'inline-block',
                background: isHidden ? 'transparent' : color,
                border: `1.5px solid ${color}`,
              }} />
              <span style={{ textDecoration: isHidden ? 'line-through' : 'none' }}>
                {RESULT_META[key]?.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Phase Chart ────────────────────────────────────────────────────────
const PHASE_ORDER = ['r32', 'r16', 'qf', 'sf', '3rd', 'final']

function PhaseChart({ bets }) {
  const evaluated = useMemo(() => bets.filter(b => b.result != null), [bets])

  const phases = useMemo(() => {
    const map = new Map()
    for (const b of evaluated) {
      const lbl = b.group_name
        ? `Grp. ${b.group_name}`
        : (PHASE_LABELS_UH[b.match_phase] || b.match_phase || 'Outro')
      if (!map.has(lbl)) map.set(lbl, { exact: 0, correct: 0, wrong: 0, total: 0, phaseKey: b.match_phase })
      const s = map.get(lbl)
      s.total++
      if (b.result === 'exact')   s.exact++
      else if (b.result === 'correct') s.correct++
      else s.wrong++
    }
    return [...map.entries()]
      .map(([label, s]) => ({
        label, ...s,
        accuracy: Math.round(((s.exact + s.correct) / s.total) * 100),
      }))
      .sort((a, b) => {
        const ai = PHASE_ORDER.indexOf(a.phaseKey)
        const bi = PHASE_ORDER.indexOf(b.phaseKey)
        if (ai !== -1 && bi !== -1) return ai - bi
        return b.accuracy - a.accuracy
      })
  }, [evaluated])

  if (phases.length < 2) return null

  const best = [...phases].sort((a, b) => b.accuracy - a.accuracy)[0]

  return (
    <div className="uh-chart-card" style={{ margin: 0 }}>
      <div className="uh-chart-card__head">
        <span className="uh-chart-card__label">Acerto por fase</span>
        <span className="uh-chart-card__total" style={{ color: best.accuracy >= 50 ? 'var(--win)' : 'var(--lose)', fontSize: 20 }}>
          {best.accuracy}%
        </span>
      </div>
      <div className="uh-phase-list">
        {phases.map(p => (
          <div key={p.label} className="uh-phase-row">
            <div className="uh-phase-row__label">{p.label}</div>
            <div className="uh-phase-row__track">
              <div className="uh-phase-row__seg" style={{ width: `${(p.exact   / p.total) * 100}%`, background: '#0f7a78' }} />
              <div className="uh-phase-row__seg" style={{ width: `${(p.correct / p.total) * 100}%`, background: '#2ec980' }} />
              <div className="uh-phase-row__seg" style={{ width: `${(p.wrong   / p.total) * 100}%`, background: '#e8525230' }} />
            </div>
            <div className="uh-phase-row__right">
              <span className="uh-phase-row__pct" style={{ color: p.accuracy >= 50 ? 'var(--win)' : 'var(--text-3)' }}>
                {p.accuracy}%
              </span>
              <span className="uh-phase-row__count">{p.total} jogo{p.total !== 1 ? 's' : ''}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="uh-chart-legend" style={{ marginTop: 'var(--s4)', justifyContent: 'flex-start' }}>
        {[['#0f7a78', 'Exato'], ['#2ec980', 'Certo'], ['#e85252', 'Erro']].map(([c, l]) => (
          <span key={l} className="uh-chart-legend__item">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: 'inline-block' }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Score Heatmap ──────────────────────────────────────────────────────
const HM_SIZE = 6

function ScoreHeatmap({ bets }) {
  const [hovCell, setHovCell] = useState(null)

  const { countMap, maxCount, mostCommon } = useMemo(() => {
    const cMap = new Map()
    let max = 0
    for (const b of bets) {
      if (b.score_a == null || b.score_b == null) continue
      const a  = Math.min(b.score_a, HM_SIZE - 1)
      const bb = Math.min(b.score_b, HM_SIZE - 1)
      const k  = `${a},${bb}`
      const c  = (cMap.get(k) || 0) + 1
      cMap.set(k, c)
      if (c > max) max = c
    }
    const mc = [...cMap.entries()].sort((a, b) => b[1] - a[1])[0]
    return { countMap: cMap, maxCount: max, mostCommon: mc }
  }, [bets])

  const validBets = bets.filter(b => b.score_a != null && b.score_b != null)
  if (validBets.length < 5) return null

  const [fa, fb] = mostCommon ? mostCommon[0].split(',') : ['—', '—']
  const favScore = mostCommon ? `${fa}–${fb}` : '—'

  return (
    <div className="uh-chart-card" style={{ margin: 0 }}>
      <div className="uh-chart-card__head">
        <span className="uh-chart-card__label">Mapa de placares</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span className="uh-chart-card__total" style={{ fontSize: 20 }}>{favScore}</span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.08em' }}>mais apostado</span>
        </div>
      </div>
      <div className="uh-heatmap__grid">
        {/* corner + col headers (Time A) */}
        <div className="uh-heatmap__corner" />
        {Array.from({ length: HM_SIZE }, (_, i) => (
          <div key={i} className="uh-heatmap__head">{i === HM_SIZE - 1 ? `${i}+` : i}</div>
        ))}
        {/* rows: row header (Time B) + cells */}
        {Array.from({ length: HM_SIZE }, (_, b) => [
          <div key={`h${b}`} className="uh-heatmap__head">{b === HM_SIZE - 1 ? `${b}+` : b}</div>,
          ...Array.from({ length: HM_SIZE }, (_, a) => {
            const key   = `${a},${b}`
            const count = countMap.get(key) || 0
            const intensity = maxCount > 0 ? count / maxCount : 0
            const active = hovCell === key
            return (
              <div
                key={key}
                className={`uh-heatmap__cell${active ? ' active' : ''}`}
                onMouseEnter={() => setHovCell(key)}
                onMouseLeave={() => setHovCell(null)}
                title={`${a}–${b}: ${count} vez${count !== 1 ? 'es' : ''}`}
                style={{ '--i': intensity }}
              >
                {count > 0 && <span>{count}</span>}
              </div>
            )
          }),
        ])}
      </div>
      <div className="uh-heatmap__footer">
        <span>colunas = Time A</span>
        <span>linhas = Time B</span>
      </div>
    </div>
  )
}

// ── BetGroups ─────────────────────────────────────────────────────────────
const PHASE_LABELS_UH = { r32: '16avos', r16: 'Oitavas', qf: 'Quartas', sf: 'Semi', '3rd': '3º Lugar', final: 'Final' }

function _betDk(md) {
  if (!md) return '?'
  const s = typeof md === 'string' ? md : md.toISOString()
  return new Date(s.endsWith('Z') ? s : s + 'Z').toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}
function _betDl(key) {
  if (key === '?') return '—'
  const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  if (key === todayKey) return 'Hoje'
  const d = new Date(key + 'T12:00:00')
  const dow = d.toLocaleDateString('pt-BR', { weekday: 'long' })
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  return `${dow.charAt(0).toUpperCase() + dow.slice(1)}, ${date}`
}
function _groupByDay(arr, desc = false) {
  const ms = b => b.match_date ? new Date(b.match_date.endsWith('Z') ? b.match_date : b.match_date + 'Z').getTime() : 0
  const sorted = [...arr].sort((a, b) => desc ? ms(b) - ms(a) : ms(a) - ms(b))
  const days = []
  let lastK = null
  sorted.forEach(b => {
    const k = _betDk(b.match_date)
    if (k !== lastK) { days.push({ key: k, bets: [] }); lastK = k }
    days[days.length - 1].bets.push(b)
  })
  return days
}

function DayDivider({ label, count, first }) {
  const isToday = label === 'Hoje'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s2) var(--s3)', background: isToday ? 'color-mix(in srgb, var(--accent) 10%, var(--surface-2))' : 'var(--surface-2)', borderTop: first ? 'none' : '2px solid var(--border)', borderBottom: '1px solid var(--border)', marginTop: first ? 0 : 'var(--s3)' }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: isToday ? 'var(--accent)' : 'var(--text-1)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto' }}>{count} {count === 1 ? 'aposta' : 'apostas'}</span>
    </div>
  )
}

function SectionDivider({ label, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', margin: 'var(--s4) 0 var(--s2)', padding: 'var(--s1) 0' }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: color || 'var(--text-3)' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

function DayGroup({ days, desc }) {
  return days.map(({ key, bets: db }, di) => (
    <div key={key}>
      <DayDivider label={_betDl(key)} count={db.length} first={di === 0} />
      <div className="uh-day-bets">
        {db.map((bet, i) => <BetCard key={bet.id} bet={bet} idx={i} />)}
      </div>
    </div>
  ))
}

function BetGroups({ bets, filter }) {
  if (filter === 'all') {
    const pend = bets.filter(b => b.result == null)
    const done = bets.filter(b => b.result != null)
    return (
      <div>
        {pend.length > 0 && (
          <div>
            <SectionDivider label={`Pendentes · ${pend.length}`} color="var(--text-3)" />
            <DayGroup days={_groupByDay(pend, false)} />
          </div>
        )}
        {done.length > 0 && (
          <div style={{ marginTop: pend.length ? 'var(--s5)' : 0 }}>
            <SectionDivider label={`Realizados · ${done.length}`} color="var(--text-2)" />
            <DayGroup days={_groupByDay(done, true)} />
          </div>
        )}
      </div>
    )
  }
  // pending filter: ascending (next game first)
  // exact/correct/wrong: descending (most recent first)
  const desc = filter !== 'pending'
  return <DayGroup days={_groupByDay(bets, desc)} />
}

// ── BetCard ────────────────────────────────────────────────────────────────
function BetCard({ bet, idx }) {
  const meta    = RESULT_META[bet.result]
  const pending = bet.result == null
  const hasOfficial = bet.official_score_a != null && bet.official_score_b != null

  const resultClass = bet.result === 'exact'   ? 'bet-card--result-exact'
                    : bet.result === 'correct'  ? 'bet-card--result-correct'
                    : bet.result === 'wrong'    ? 'bet-card--result-wrong'
                    : ''
  const ptsVariant  = bet.result === 'exact'   ? 'pts-badge--exact'
                    : bet.result === 'correct'  ? 'pts-badge--correct'
                    : bet.result === 'wrong'    ? 'pts-badge--wrong'
                    : 'pts-badge--pending'

  return (
    <div className={`bet-card fade-in ${resultClass}`} style={{ animationDelay: `${idx * 20}ms` }}>
      <div className="bet-card__top">
        <span className="badge badge-group">
          {bet.group_name ? `Grupo ${bet.group_name}` : (PHASE_LABELS_UH[bet.match_phase] || bet.match_phase || '—')}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
          <span className="bet-card__time">{fmtDate(bet.match_date)}</span>
          <span className={`pts-badge ${ptsVariant}`} style={{ fontSize: 13, padding: '3px 10px' }}>
            {pending ? 'Pendente' : `${meta.label} · +${bet.points_earned ?? 0}`}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
          {bet.team_a_flag && (
            <img src={bet.team_a_flag} alt={bet.team_a_name || bet.team_a_code}
              style={{ width: 26, height: 19, borderRadius: 2, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
          )}
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
            {bet.team_a_name || bet.team_a_code}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1, color: meta ? meta.color : 'var(--text-2)' }}>
            {bet.score_a} – {bet.score_b}
          </span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-4)', textTransform: 'uppercase' }}>
            palpite
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', justifyContent: 'flex-end' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
            {bet.team_b_name || bet.team_b_code}
          </span>
          {bet.team_b_flag && (
            <img src={bet.team_b_flag} alt={bet.team_b_name || bet.team_b_code}
              style={{ width: 26, height: 19, borderRadius: 2, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
          )}
        </div>
      </div>

      {hasOfficial && (
        <div className="score-compare">
          <div className="score-compare__block">
            <span className="score-compare__label">Palpite</span>
            <span className="score-compare__value" style={{ color: meta ? meta.color : 'var(--text-2)' }}>
              {bet.score_a}–{bet.score_b}
            </span>
          </div>
          <div className="score-compare__divider" />
          <div className="score-compare__block">
            <span className="score-compare__label">Oficial</span>
            <span className="score-compare__value" style={{ color: 'var(--text-2)' }}>
              {bet.official_score_a}–{bet.official_score_b}
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

// ── PosBadge ───────────────────────────────────────────────────────────────
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
      borderRadius: 'var(--r2)', padding: 'var(--s2) var(--s4)', minWidth: 80, gap: 1,
    }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1, color }}>
        {posLabel(pos)}
      </span>
      {total && <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)' }}>de {total}</span>}
    </div>
  )
}

// ── Feature: Estratégia & Recomendações ────────────────────────────────────
function analyzeStrategy(bets) {
  const rows = bets.filter(b => b.result != null && b.official_score_a != null && b.official_score_b != null)
  if (rows.length < 8) return null
  const sorted = [...rows].sort((a, b) => new Date(a.match_date || a.created_at) - new Date(b.match_date || b.created_at))
  const n = sorted.length
  const hit = b => b.result === 'exact' || b.result === 'correct'
  const acc = arr => arr.length ? arr.filter(hit).length / arr.length : null

  const recentN = Math.min(10, n)
  const recent  = sorted.slice(-recentN)
  const prior   = sorted.slice(0, n - recentN)

  const overallAcc = acc(sorted)
  const recentAcc  = acc(recent)
  const priorAcc   = prior.length >= 3 ? acc(prior) : null
  const trendDelta = priorAcc != null ? recentAcc - priorAcc : null

  const avgBetGoals = sorted.reduce((s, b) => s + b.score_a + b.score_b, 0) / n
  const avgOffGoals = sorted.reduce((s, b) => s + b.official_score_a + b.official_score_b, 0) / n

  const officialDraws = sorted.filter(b => b.official_score_a === b.official_score_b)
  const betDraws      = sorted.filter(b => b.score_a === b.score_b)
  const drawHits      = officialDraws.filter(b => b.score_a === b.score_b).length
  const drawAcc       = officialDraws.length ? drawHits / officialDraws.length : null

  const outcome = (a, b) => a > b ? 'A' : a < b ? 'B' : 'D'
  const wrongs = sorted.filter(b => b.result === 'wrong')
  let missedDraw = 0, falseDraw = 0, wrongTeam = 0
  wrongs.forEach(b => {
    const betO = outcome(b.score_a, b.score_b)
    const offO = outcome(b.official_score_a, b.official_score_b)
    if (offO === 'D' && betO !== 'D') missedDraw++
    else if (betO === 'D' && offO !== 'D') falseDraw++
    else wrongTeam++
  })

  const scoreMap = new Map()
  sorted.forEach(b => { const k = `${b.score_a}–${b.score_b}`; scoreMap.set(k, (scoreMap.get(k) || 0) + 1) })
  const topScore = [...scoreMap.entries()].sort((a, b) => b[1] - a[1])[0]

  const profile = avgBetGoals >= 3.2 ? 'Ousado' : avgBetGoals <= 2.15 ? 'Cauteloso' : 'Equilibrado'

  return {
    n, overallAcc, recentAcc, recentN, priorAcc, trendDelta,
    avgBetGoals, avgOffGoals, goalDiff: avgBetGoals - avgOffGoals,
    officialDraws, betDraws, drawHits, drawAcc,
    wrongs, missedDraw, falseDraw, wrongTeam,
    topScore, profile,
  }
}

const PROFILE_CFG = {
  Ousado:      { icon: '🔥',  color: '#e8a030' },
  Cauteloso:   { icon: '🛡️', color: '#4a90e8' },
  Equilibrado: { icon: '⚖️', color: 'var(--accent)' },
}

function StrategyInsights({ bets }) {
  const s = useMemo(() => analyzeStrategy(bets), [bets])
  if (!s) return null

  const pct = v => v == null ? '—' : Math.round(v * 100)
  const insights = []

  if (s.trendDelta != null) {
    if (s.trendDelta >= 0.12) {
      insights.push({ icon: '📈', color: 'var(--win)', text: `Em ascensão: ${pct(s.recentAcc)}% de acerto nos últimos ${s.recentN} jogos, contra ${pct(s.priorAcc)}% antes disso.` })
    } else if (s.trendDelta <= -0.12) {
      insights.push({ icon: '📉', color: 'var(--lose)', text: `Queda de forma: ${pct(s.recentAcc)}% de acerto nos últimos ${s.recentN} jogos, contra ${pct(s.priorAcc)}% antes — vale rever os critérios recentes.` })
    }
  }

  if (s.officialDraws.length >= 3 && s.drawAcc != null && s.drawAcc < 0.3) {
    insights.push({ icon: '🟰', color: '#f59e0b', text: `Ponto cego em empates: acertou só ${s.drawHits}/${s.officialDraws.length} jogos que terminaram empatados, apostando empate em apenas ${pct(s.betDraws.length / s.n)}% das apostas.` })
  }

  if (s.wrongs.length >= 3) {
    const max = Math.max(s.missedDraw, s.falseDraw, s.wrongTeam)
    if (max === s.wrongTeam && s.wrongTeam / s.wrongs.length >= 0.5) {
      insights.push({ icon: '🎯', color: 'var(--lose)', text: `Principal erro: ${pct(s.wrongTeam / s.wrongs.length)}% das apostas erradas foram por cravar o time errado como vencedor — reveja o favoritismo antes de apostar.` })
    } else if (max === s.missedDraw && s.missedDraw / s.wrongs.length >= 0.4) {
      insights.push({ icon: '🟰', color: '#f59e0b', text: `Principal erro: ${pct(s.missedDraw / s.wrongs.length)}% das apostas erradas foram jogos que terminaram empatados e você apostou um vencedor.` })
    } else if (max === s.falseDraw && s.falseDraw / s.wrongs.length >= 0.4) {
      insights.push({ icon: '🎲', color: '#f59e0b', text: `Você chuta empate demais: ${pct(s.falseDraw / s.wrongs.length)}% das apostas erradas eram jogos com vencedor claro.` })
    }
  }

  if (Math.abs(s.goalDiff) >= 0.5) {
    insights.push(s.goalDiff > 0
      ? { icon: '⚽', color: '#9b5de8', text: `Superestima gols: média de ${s.avgBetGoals.toFixed(1)} apostados contra ${s.avgOffGoals.toFixed(1)} reais por jogo — considere placares mais fechados.` }
      : { icon: '⚽', color: '#9b5de8', text: `Subestima gols: média de ${s.avgBetGoals.toFixed(1)} apostados contra ${s.avgOffGoals.toFixed(1)} reais por jogo — placares mais elásticos podem valer a pena.` })
  }

  if (s.topScore && s.n >= 10 && s.topScore[1] / s.n >= 0.22) {
    insights.push({ icon: '🔁', color: 'var(--text-3)', text: `Repetição de placar: você apostou ${s.topScore[0]} em ${pct(s.topScore[1] / s.n)}% das partidas — variar conforme o confronto pode render mais placares exatos.` })
  }

  const cfg = PROFILE_CFG[s.profile]

  return (
    <div className="uh-section fade-in-2">
      <div className="uh-section__head">
        <span className="uh-section__icon">🧠</span>
        <span className="uh-section__title">Estratégia & Recomendações</span>
      </div>

      <div style={{ borderRadius: 'var(--radius)', background: `${cfg.color}1a`, border: `1px solid ${cfg.color}44`, padding: 'var(--s5) var(--s6)', display: 'flex', alignItems: 'center', gap: 'var(--s6)', flexWrap: 'wrap', marginBottom: insights.length ? 'var(--s4)' : 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: cfg.color }}>{cfg.icon} PERFIL {s.profile.toUpperCase()}</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 42, fontWeight: 900, lineHeight: 1, color: cfg.color }}>{pct(s.overallAcc)}%</span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>acerto em {s.n} jogos avaliados</span>
        </div>
        <div style={{ flex: 1, minWidth: 200, fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Média de <strong>{s.avgBetGoals.toFixed(1)} gols</strong> por palpite (real: {s.avgOffGoals.toFixed(1)}) ·
          empate apostado em <strong>{pct(s.betDraws.length / s.n)}%</strong> dos jogos, real em {pct(s.officialDraws.length / s.n)}%.
        </div>
      </div>

      {insights.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          {insights.map((ins, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)', borderLeft: `3px solid ${ins.color}`, borderRadius: 'var(--r2)' }}>
              <span style={{ fontSize: 16, lineHeight: 1.3, flexShrink: 0 }}>{ins.icon}</span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5 }}>{ins.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', textAlign: 'center', padding: 'var(--s3)' }}>
          Sem padrões claros de erro ou acerto até agora — continue apostando para refinar a análise.
        </div>
      )}
    </div>
  )
}

// ── Feature 1: Melhor / Pior aposta ───────────────────────────────────────
function BestWorstCard({ type, bet }) {
  const isBest = type === 'best'
  const color  = isBest ? 'var(--win)' : 'var(--lose)'
  const meta   = RESULT_META[bet.result]
  return (
    <div className="uh-bw-card" style={{ '--bw-color': color }}>
      <div className="uh-bw-card__head">
        <span style={{ fontSize: 15 }}>{isBest ? '⚡' : '💀'}</span>
        <span className="uh-bw-card__label">{isBest ? 'Melhor aposta' : 'Pior aposta'}</span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color, lineHeight: 1 }}>{bet.points_earned}pts</span>
      </div>
      <div className="uh-bw-card__match">
        {bet.team_a_flag && <img src={bet.team_a_flag} alt="" style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />}
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700 }}>{bet.team_a_code}</span>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, color, lineHeight: 1 }}>{bet.score_a}–{bet.score_b}</span>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700 }}>{bet.team_b_code}</span>
        {bet.team_b_flag && <img src={bet.team_b_flag} alt="" style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover' }} />}
      </div>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: meta?.color, letterSpacing: '0.08em', textAlign: 'center', marginTop: 4 }}>
        {meta?.label}{bet.official_score_a != null ? ` · Oficial ${bet.official_score_a}–${bet.official_score_b}` : ''}
      </div>
    </div>
  )
}

function BestWorstHighlight({ bets }) {
  const evaluated = useMemo(() => bets.filter(b => b.result != null && b.points_earned != null), [bets])
  if (evaluated.length < 3) return null
  const sorted = [...evaluated].sort((a, b) => (b.points_earned ?? 0) - (a.points_earned ?? 0))
  const best   = sorted[0]
  const worst  = sorted[sorted.length - 1]
  if (best.id === worst.id) return null
  return (
    <div className="uh-bw-row fade-in-2">
      <BestWorstCard type="best"  bet={best}  />
      <BestWorstCard type="worst" bet={worst} />
    </div>
  )
}

// ── Feature 2: Acerto por seleção ─────────────────────────────────────────
function TeamAccuracy({ bets }) {
  const data = useMemo(() => {
    const evaluated = bets.filter(b => b.result != null)
    if (evaluated.length < 5) return null
    const map = new Map()
    for (const b of evaluated) {
      for (const [code, name, flag] of [
        [b.team_a_code, b.team_a_name, b.team_a_flag],
        [b.team_b_code, b.team_b_name, b.team_b_flag],
      ]) {
        if (!code) continue
        if (!map.has(code)) map.set(code, { code, name: name || code, flag, exact: 0, correct: 0, wrong: 0, total: 0 })
        const t = map.get(code)
        t.total++
        if (b.result === 'exact') t.exact++
        else if (b.result === 'correct') t.correct++
        else t.wrong++
      }
    }
    const rows = [...map.values()]
      .filter(t => t.total >= 2)
      .map(t => ({ ...t, accuracy: Math.round(((t.exact + t.correct) / t.total) * 100) }))
      .sort((a, b) => b.accuracy - a.accuracy || b.total - a.total)
    return rows.length >= 3 ? rows : null
  }, [bets])

  if (!data) return null
  return (
    <div className="uh-chart-card fade-in-3" style={{ margin: 0 }}>
      <div className="uh-chart-card__head">
        <span className="uh-chart-card__label">Acerto por seleção</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {data[0].flag && <img src={data[0].flag} alt="" style={{ width: 20, height: 14, borderRadius: 2, objectFit: 'cover', border: '1px solid var(--win)' }} />}
          <span className="uh-chart-card__total" style={{ color: 'var(--win)', fontSize: 20 }}>{data[0].accuracy}%</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
        {data.map(t => (
          <div key={t.code} className="uh-phase-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', minWidth: 100 }}>
              {t.flag && <img src={t.flag} alt={t.code} style={{ width: 16, height: 11, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />}
              <span className="uh-phase-row__label" style={{ fontSize: 12 }}>{t.name}</span>
            </div>
            <div className="uh-phase-row__track">
              <div className="uh-phase-row__seg" style={{ width: `${(t.exact   / t.total) * 100}%`, background: '#0f7a78' }} />
              <div className="uh-phase-row__seg" style={{ width: `${(t.correct / t.total) * 100}%`, background: '#2ec980' }} />
              <div className="uh-phase-row__seg" style={{ width: `${(t.wrong   / t.total) * 100}%`, background: '#e8525230' }} />
            </div>
            <div className="uh-phase-row__right">
              <span className="uh-phase-row__pct" style={{ color: t.accuracy >= 50 ? 'var(--win)' : 'var(--text-3)' }}>{t.accuracy}%</span>
              <span className="uh-phase-row__count">{t.total}j</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Feature 3: Pontos por fase ────────────────────────────────────────────
function PointsByPhase({ bets }) {
  const data = useMemo(() => {
    const evaluated = bets.filter(b => b.result != null && b.points_earned != null)
    if (evaluated.length < 3) return null
    const map = new Map()
    for (const b of evaluated) {
      const lbl = b.group_name
        ? `Grp. ${b.group_name}`
        : (PHASE_LABELS_UH[b.match_phase] || b.match_phase || 'Outro')
      const key = b.group_name ? 'group' : (b.match_phase || 'other')
      if (!map.has(lbl)) map.set(lbl, { label: lbl, phaseKey: key, points: 0, count: 0 })
      const s = map.get(lbl)
      s.points += b.points_earned ?? 0
      s.count++
    }
    const rows = [...map.values()].sort((a, b) => {
      const ai = PHASE_ORDER.indexOf(a.phaseKey), bi = PHASE_ORDER.indexOf(b.phaseKey)
      if (ai !== -1 && bi !== -1) return ai - bi
      return b.points - a.points
    })
    return rows.length >= 2 ? rows : null
  }, [bets])

  if (!data) return null
  const maxPts  = Math.max(...data.map(p => p.points), 1)
  const total   = data.reduce((s, p) => s + p.points, 0)
  const bestLbl = [...data].sort((a, b) => b.points - a.points)[0].label

  return (
    <div className="uh-chart-card fade-in-3" style={{ margin: 0 }}>
      <div className="uh-chart-card__head">
        <span className="uh-chart-card__label">Pontos por fase</span>
        <span className="uh-chart-card__total" style={{ fontSize: 20 }}>{total}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        {data.map(p => (
          <div key={p.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)' }}>{p.label}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)' }}>{p.count}j</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: p.label === bestLbl ? 'var(--accent)' : 'var(--text-2)', lineHeight: 1 }}>{p.points}</span>
              </div>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${(p.points / maxPts) * 100}%`,
                background: p.label === bestLbl ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 50%, var(--border))',
                transition: 'width 700ms cubic-bezier(.4,0,.2,1)',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Feature 4: Próximos jogos com countdown ───────────────────────────────
function _useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

function _fmtCountdown(ms) {
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return d >= 2 ? `${d}d` : h >= 1 ? `${h}h${String(m).padStart(2,'0')}m` : `${m}m`
}

function UpcomingBets({ bets }) {
  const now = _useNow()
  const upcoming = useMemo(() =>
    bets
      .filter(b => b.result == null && b.match_date)
      .map(b => ({ ...b, _ts: new Date(b.match_date.endsWith('Z') ? b.match_date : `${b.match_date}Z`).getTime() }))
      .filter(b => b._ts > now)
      .sort((a, b) => a._ts - b._ts)
      .slice(0, 6),
    [bets, now]
  )
  if (upcoming.length === 0) return null
  const msNext = upcoming[0]._ts - now
  const isHot  = msNext < 3 * 3600000
  return (
    <div className={`uh-upcoming fade-in-2${isHot ? ' uh-upcoming--hot' : ''}`}>
      <div className="uh-upcoming__head">
        <span className="uh-upcoming__title">{isHot ? '🔥 ' : '⏱ '}Próximos jogos</span>
        <span className="uh-upcoming__next" style={{ color: isHot ? 'var(--lose)' : 'var(--text-3)' }}>
          próximo em {_fmtCountdown(msNext)}
        </span>
      </div>
      <div className="uh-upcoming__list">
        {upcoming.map((b, i) => {
          const ms  = b._ts - now
          const hot = ms < 3 * 3600000
          return (
            <div key={b.id} className={`uh-upcoming__item${i === 0 ? ' uh-upcoming__item--next' : ''}`}>
              <div className="uh-upcoming__teams">
                {b.team_a_flag && <img src={b.team_a_flag} alt="" style={{ width: 18, height: 13, borderRadius: 1, objectFit: 'cover' }} />}
                <span className="uh-upcoming__code">{b.team_a_code}</span>
                <span className="uh-upcoming__score">{b.score_a}–{b.score_b}</span>
                <span className="uh-upcoming__code">{b.team_b_code}</span>
                {b.team_b_flag && <img src={b.team_b_flag} alt="" style={{ width: 18, height: 13, borderRadius: 1, objectFit: 'cover' }} />}
              </div>
              <span className="uh-upcoming__time" style={{ color: hot ? 'var(--lose)' : 'var(--text-4)' }}>
                {_fmtCountdown(ms)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Feature 5: Placares mais apostados ────────────────────────────────────
function ScorePatternBar({ bets }) {
  const data = useMemo(() => {
    const valid = bets.filter(b => b.score_a != null && b.score_b != null)
    if (valid.length < 8) return null
    const map = new Map()
    for (const b of valid) {
      const k = `${b.score_a}–${b.score_b}`
      map.set(k, (map.get(k) || 0) + 1)
    }
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    return sorted.length >= 3 ? sorted : null
  }, [bets])

  if (!data) return null
  const maxC = data[0][1]
  return (
    <div className="uh-chart-card fade-in-3" style={{ margin: 0 }}>
      <div className="uh-chart-card__head">
        <span className="uh-chart-card__label">Placares mais apostados</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span className="uh-chart-card__total" style={{ fontSize: 20 }}>{data[0][0]}</span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.08em' }}>{data[0][1]}× apostado</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
        {data.map(([score, count], i) => (
          <div key={score}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: i === 0 ? 'var(--accent)' : 'var(--text-2)', lineHeight: 1 }}>{score}</span>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-4)' }}>{count}×</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${(count / maxC) * 100}%`,
                background: i === 0 ? 'var(--accent)' : `color-mix(in srgb, var(--accent) ${Math.max(30, 70 - i * 12)}%, var(--text-4))`,
                transition: 'width 700ms cubic-bezier(.4,0,.2,1)',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Feature 6: Evolução no ranking ────────────────────────────────────────
function RankingEvolution({ userId }) {
  const [history, setHistory] = useState([])
  useEffect(() => {
    api.get(`/bets/users/${userId}/ranking-history`).then(setHistory).catch(() => {})
  }, [userId])
  if (history.length < 2) return null

  const W = 400, H = 90, PADL = 28, PADR = 8, PADT = 6, PADB = 16
  const pct  = h => h.total_users > 1 ? 1 - (h.position - 1) / (h.total_users - 1) : 1
  const toX  = i => PADL + (i / (history.length - 1)) * (W - PADL - PADR)
  const toY  = h => PADT + (1 - pct(h)) * (H - PADT - PADB)
  const coords = history.map((h, i) => [toX(i), toY(h)])
  const pathD  = coords.reduce((a, [x, y], i) => a + (i === 0 ? `M${x},${y}` : ` L${x},${y}`), '')
  const areaD  = `${pathD} L${coords[coords.length-1][0]},${H-PADB} L${coords[0][0]},${H-PADB} Z`

  const latest   = history[history.length - 1]
  const earliest = history[0]
  const diff     = earliest.position - latest.position
  const diffColor = diff > 0 ? 'var(--win)' : diff < 0 ? 'var(--lose)' : 'var(--text-3)'
  const arrow     = diff > 0 ? '↑' : diff < 0 ? '↓' : '→'
  const fmtD      = s => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })

  const yTicks = [...new Set([earliest.position, latest.position])]

  return (
    <div className="uh-chart-card fade-in-3">
      <div className="uh-chart-card__head">
        <span className="uh-chart-card__label">Evolução no ranking</span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span className="uh-chart-card__total" style={{ color: diffColor, fontSize: 20 }}>{arrow} {latest.position}º</span>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.08em' }}>
            {diff !== 0 ? `${Math.abs(diff)} pos. ${diff > 0 ? 'subiu' : 'caiu'}` : 'sem variação'}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="rank-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {yTicks.map(v => {
          const hSnap = history.find(h => h.position === v)
          if (!hSnap) return null
          const y = toY(hSnap)
          return <text key={v} x={PADL - 4} y={y + 4} textAnchor="end"
            style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.4 }}>{v}º</text>
        })}
        <text x={PADL} y={H} textAnchor="start"
          style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.3 }}>{fmtD(earliest.snapshot_at)}</text>
        <text x={W - PADR} y={H} textAnchor="end"
          style={{ fontFamily: 'var(--font-data)', fontSize: 8, fill: 'currentColor', opacity: 0.3 }}>{fmtD(latest.snapshot_at)}</text>
        <path d={areaD} fill="url(#rank-grad)" />
        <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={coords[coords.length-1][0]} cy={coords[coords.length-1][1]} r={4} fill="var(--accent)" />
      </svg>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', textAlign: 'right', marginTop: 'var(--s1)' }}>
        {history.length} medições · {fmtD(earliest.snapshot_at)} → {fmtD(latest.snapshot_at)}
      </div>
    </div>
  )
}

// ── Features 7+8: Comparar usuários / vs Oráculo ──────────────────────────
const ORACLE_ID = 34
const CMP_RESULT_COLOR = { exact: '#0f7a78', correct: '#2ec980', wrong: '#e85252' }

function CompareTable({ data, onBack }) {
  const { user_a, user_b, matches, summary } = data
  const evaluated = matches.filter(m => m.bet_a?.result != null || m.bet_b?.result != null)

  return (
    <div className="uh-cmp">
      <div className="uh-cmp__header">
        <button onClick={onBack} className="uh-cmp__back">‹ Voltar</button>
        <div className="uh-cmp__scoreboard">
          <div className="uh-cmp__player" style={{ textAlign: 'right' }}>
            <div className="uh-cmp__player-name">{user_a.name}</div>
            <div className="uh-cmp__player-pts" style={{ color: summary.user_a_total >= summary.user_b_total ? 'var(--win)' : 'var(--text-3)' }}>{summary.user_a_total}pts</div>
            <div className="uh-cmp__player-w" style={{ color: summary.user_a_wins >= summary.user_b_wins ? 'var(--win)' : 'var(--text-4)' }}>{summary.user_a_wins} vitórias</div>
          </div>
          <div className="uh-cmp__vs">VS</div>
          <div className="uh-cmp__player" style={{ textAlign: 'left' }}>
            <div className="uh-cmp__player-name">{user_b.name}</div>
            <div className="uh-cmp__player-pts" style={{ color: summary.user_b_total >= summary.user_a_total ? 'var(--win)' : 'var(--text-3)' }}>{summary.user_b_total}pts</div>
            <div className="uh-cmp__player-w" style={{ color: summary.user_b_wins >= summary.user_a_wins ? 'var(--win)' : 'var(--text-4)' }}>{summary.user_b_wins} vitórias</div>
          </div>
        </div>
        {summary.ties > 0 && (
          <div style={{ textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
            {summary.ties} empate{summary.ties !== 1 ? 's' : ''}
          </div>
        )}
      </div>
      <div className="uh-cmp__rows">
        {evaluated.map(m => {
          const ba  = m.bet_a
          const bb  = m.bet_b
          const aWin = ba && bb && (ba.points ?? 0) > (bb.points ?? 0)
          const bWin = ba && bb && (bb.points ?? 0) > (ba.points ?? 0)
          return (
            <div key={m.match_id} className="uh-cmp__row">
              <div className={`uh-cmp__side uh-cmp__side--a${aWin ? ' uh-cmp__side--win' : ''}`}>
                {ba ? (
                  <>
                    <span className={`pts-badge pts-badge--${ba.result || 'pending'}`} style={{ fontSize: 10, padding: '2px 6px' }}>+{ba.points ?? 0}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: CMP_RESULT_COLOR[ba.result] || 'var(--text-3)', lineHeight: 1 }}>{ba.score_a}–{ba.score_b}</span>
                  </>
                ) : <span style={{ color: 'var(--text-4)', fontSize: 11, fontFamily: 'var(--font-cond)' }}>—</span>}
              </div>
              <div className="uh-cmp__match">
                <div className="uh-cmp__flags">
                  {m.team_a_flag && <img src={m.team_a_flag} alt="" style={{ width: 14, height: 10, borderRadius: 1, objectFit: 'cover' }} />}
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>{m.team_a_code}×{m.team_b_code}</span>
                  {m.team_b_flag && <img src={m.team_b_flag} alt="" style={{ width: 14, height: 10, borderRadius: 1, objectFit: 'cover' }} />}
                </div>
                {m.official_score_a != null && (
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--text-4)', lineHeight: 1 }}>{m.official_score_a}–{m.official_score_b}</span>
                )}
              </div>
              <div className={`uh-cmp__side uh-cmp__side--b${bWin ? ' uh-cmp__side--win' : ''}`}>
                {bb ? (
                  <>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: CMP_RESULT_COLOR[bb.result] || 'var(--text-3)', lineHeight: 1 }}>{bb.score_a}–{bb.score_b}</span>
                    <span className={`pts-badge pts-badge--${bb.result || 'pending'}`} style={{ fontSize: 10, padding: '2px 6px' }}>+{bb.points ?? 0}</span>
                  </>
                ) : <span style={{ color: 'var(--text-4)', fontSize: 11, fontFamily: 'var(--font-cond)' }}>—</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompareView({ userId, onClose }) {
  const [users,       setUsers]       = useState([])
  const [compareData, setCompareData] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [search,      setSearch]      = useState('')

  useEffect(() => {
    api.get('/ranking')
      .then(d => setUsers((Array.isArray(d) ? d : (d.ranking || [])).filter(u => u.user_id != userId && u.user_id != ORACLE_ID)))
      .catch(() => {})
  }, [userId])

  const doCompare = id => {
    setLoading(true)
    setCompareData(null)
    api.get(`/bets/compare/${userId}/${id}`)
      .then(setCompareData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  const filtered = search
    ? users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()))
    : users

  return (
    <div className="uh-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="uh-overlay__modal">
        <div className="uh-overlay__head">
          <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 16 }}>
            {compareData ? 'Comparação' : 'Comparar com...'}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
        <div className="uh-overlay__body">
          {!compareData && !loading && (
            <>
              <button onClick={() => doCompare(ORACLE_ID)} className="uh-cmp-btn uh-cmp-btn--oracle">
                🔮 vs Oráculo Predictor
              </button>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar usuário..." className="uh-cmp-search" />
              <div className="uh-cmp-list">
                {filtered.map(u => (
                  <button key={u.user_id} onClick={() => doCompare(u.user_id)} className="uh-cmp-btn">
                    <span>{u.name}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--accent)' }}>{u.total_points}pts</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {loading && (
            <div style={{ textAlign: 'center', padding: 'var(--s10)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
              Carregando comparação...
            </div>
          )}
          {compareData && <CompareTable data={compareData} onBack={() => setCompareData(null)} />}
        </div>
      </div>
    </div>
  )
}

// ── Página principal ───────────────────────────────────────────────────────
export default function UserHistory() {
  const { userId }       = useParams()
  const { user: me, token } = useAuth()
  const isOwn = me && String(me.id) === String(userId)

  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [filter,      setFilter]      = useState('all')
  const [groupRanks,  setGroupRanks]  = useState([])
  const [search,      setSearch]      = useState('')
  const [searchOpen,  setSearchOpen]  = useState(false)
  const [acFocus,     setAcFocus]     = useState(-1)
  const [compareOpen, setCompareOpen] = useState(false)

  useEffect(() => {
    setLoading(true); setError('')
    api.get(`/bets/users/${userId}`)
      .then(setData)
      .catch(err => setError(err.message || 'Não foi possível carregar o histórico.'))
      .finally(() => setLoading(false))
  }, [userId])

  useEffect(() => {
    if (!isOwn || !token) return
    api.get('/user-groups', token).then(response => {
      const groups = response?.groups
      if (!Array.isArray(groups)) return
      Promise.allSettled(
        groups.map(g =>
          api.get(`/user-groups/${g.id}/ranking`, token)
            .then(d => {
              const ranking = d?.ranking ?? []
              const me = ranking.find(r => String(r.user_id) === String(userId))
              return me ? { id: g.id, name: g.name || d?.group_name || `Bolão ${g.id}`, pos: me.position ?? (ranking.indexOf(me) + 1), total: ranking.length } : null
            })
        )
      ).then(results => setGroupRanks(results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)))
    }).catch(() => {})
  }, [isOwn, token, userId])

  // useMemo must be before any early return (Rules of Hooks)
  const acSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const allBets = data?.bets ?? []
    const set = new Set()
    allBets.forEach(b => {
      if (b.team_a_name) set.add(b.team_a_name)
      if (b.team_b_name) set.add(b.team_b_name)
    })
    return [...set].filter(n => n.toLowerCase().includes(q)).slice(0, 6)
  }, [search, data])

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
    { id: 'all',     label: 'Todas',     count: bets.length    },
    { id: 'exact',   label: 'Exatos',    count: exact.length   },
    { id: 'correct', label: 'Certos',    count: correct.length },
    { id: 'wrong',   label: 'Erros',     count: wrong.length   },
    { id: 'pending', label: 'Pendentes', count: pending.length },
  ]

  const filterBase = filter === 'all'     ? bets
                   : filter === 'exact'   ? exact
                   : filter === 'correct' ? correct
                   : filter === 'wrong'   ? wrong
                   : pending

  const searchQ = search.trim().toLowerCase()
  const visible = searchQ
    ? filterBase.filter(b => {
        const ta = (b.team_a_name || b.team_a_code || '').toLowerCase()
        const tb = (b.team_b_name || b.team_b_code || '').toLowerCase()
        return ta.includes(searchQ) || tb.includes(searchQ)
      })
    : filterBase

  const initials = user?.name ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'
  const GROUP_COLORS = ['var(--win)', '#4a90e8', '#e8a030', '#9b5de8']

  return (
    <div className="page">
      {/* ── Header ──────────────────────────────────── */}
      <div className="fade-in-1">
        <Link to="/ranking" className="match-breadcrumb__link">‹ Ranking</Link>

        <div className="uh-header">
          <div className="uh-header__bg" />
          <div className="uh-header__content">
            <div className="uh-header__avatar">
              <span className="uh-header__avatar-icon">🏆</span>
              <span className="uh-header__avatar-initials">{initials}</span>
            </div>
            <div className="uh-header__info">
              <h1 className="uh-header__name">{user?.name}</h1>
              {user?.username && (
                <div className="uh-header__username">@{user.username}</div>
              )}
              <div className="uh-header__meta">
                {bets.length} apostas · {evaluated.length} avaliadas · {accuracy}% de acerto
              </div>
            </div>
            <div className="uh-header__badges">
              {rankingPosition && <PosBadge label="Geral" pos={rankingPosition} total={totalUsers} />}
              {groupRanks.map((g, i) => (
                <PosBadge key={g.id}
                  label={g.name.length > 12 ? g.name.slice(0, 11) + '…' : g.name}
                  pos={g.pos} total={g.total}
                  accent={GROUP_COLORS[i % GROUP_COLORS.length]}
                />
              ))}
              <button onClick={() => setCompareOpen(true)} className="uh-compare-trigger">
                ⚔ Comparar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI strip ───────────────────────────────── */}
      <div className="uh-kpi-grid fade-in-2">
        {[
          { label: 'Pontos',       value: stats.total_points ?? 0,                                                          color: 'var(--accent)' },
          { label: '% Acerto',     value: `${accuracy}%`,                                                                   color: 'var(--win)'    },
          { label: 'Exatos',       value: exact.length,                                                                     color: '#e8c44a'       },
          { label: 'Certos',       value: correct.length,                                                                   color: '#2ec980'       },
          { label: 'Erros',        value: wrong.length,                                                                     color: 'var(--lose)'   },
          { label: 'Pts / Jogo',   value: evaluated.length > 0 ? ((stats.total_points ?? 0) / evaluated.length).toFixed(1) : '—', color: '#9b5de8' },
        ].map(k => (
          <div key={k.label} className="uh-kpi-card" style={{ '--kpi-color': k.color }}>
            <div className="uh-kpi-card__accent" />
            <div className="uh-kpi-card__label">{k.label}</div>
            <div className="uh-kpi-card__val" style={{ color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* ── Próximos jogos ──────────────────────────── */}
      {pending.length > 0 && <UpcomingBets bets={bets} />}

      {/* ── Palpite de campeão (só perfil próprio) ── */}
      {isOwn && <MyChampionCard />}

      {/* ── Barra distribuição ──────────────────────── */}
      {evaluated.length > 0 && (
        <div className="fade-in-2">
          <ResultBar
            exact={exact.length} correct={correct.length}
            wrong={wrong.length} pending={pending.length}
          />
        </div>
      )}

      {/* ── Sequências ──────────────────────────────── */}
      {evaluated.length >= 2 && (
        <div className="fade-in-2">
          <StreaksSection evaluated={evaluated} />
        </div>
      )}

      {/* ── Melhor / Pior aposta ────────────────────── */}
      {evaluated.length >= 3 && <BestWorstHighlight bets={bets} />}

      {/* ── Estratégia & Recomendações ──────────────── */}
      <StrategyInsights bets={bets} />

      {/* ── Anéis de desempenho ─────────────────────── */}
      {evaluated.length > 0 && (
        <div className="uh-section fade-in-2">
          <div className="uh-section__head">
            <span className="uh-section__icon">📈</span>
            <span className="uh-section__title">Análise Estatística</span>
          </div>
          <ActivityRings
            exact={exact.length} correct={correct.length}
            evaluated={evaluated.length} totalBets={bets.length}
            rankingPosition={rankingPosition} totalUsers={totalUsers}
          />
        </div>
      )}

      {/* ── Gráfico de pontos ───────────────────────── */}
      {evaluated.length > 0 && (
        <div className="fade-in-3">
          <PointsChart bets={bets} />
        </div>
      )}

      {/* ── Fase + Heatmap ──────────────────────────── */}
      {evaluated.length >= 5 && (
        <div className="uh-charts-row fade-in-3">
          <PhaseChart bets={bets} />
          <ScoreHeatmap bets={bets} />
        </div>
      )}

      {/* ── Pontos por fase + Placares frequentes ──────── */}
      {evaluated.length >= 5 && (
        <div className="uh-charts-row fade-in-3">
          <PointsByPhase bets={bets} />
          <ScorePatternBar bets={bets} />
        </div>
      )}

      {/* ── Acerto por seleção ──────────────────────── */}
      {evaluated.length >= 5 && (
        <div className="fade-in-3">
          <TeamAccuracy bets={bets} />
        </div>
      )}

      {/* ── Evolução no ranking ─────────────────────── */}
      <RankingEvolution userId={userId} />

      {/* ── Filtros + busca + apostas ───────────────── */}
      <div className="fade-in-3" style={{ marginTop: 'var(--s6)' }}>
        {/* Filtros */}
        <div className="uh-filters">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`uh-filter${filter === f.id ? ' active' : ''}`}>
              {f.label} <span className="uh-filter__count">({f.count})</span>
            </button>
          ))}
        </div>

        {/* Busca com autocomplete */}
        <div style={{ position: 'relative', margin: 'var(--s3) 0 var(--s4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', background: 'var(--surface-2)', border: `1.5px solid ${searchQ ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--r3)', padding: 'var(--s2) var(--s3)', transition: 'border-color .15s' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: searchQ ? 'var(--accent)' : 'var(--text-4)', flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setAcFocus(-1) }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setAcFocus(f => Math.min(f + 1, acSuggestions.length - 1)) }
                if (e.key === 'ArrowUp')   { e.preventDefault(); setAcFocus(f => Math.max(f - 1, -1)) }
                if (e.key === 'Enter' && acFocus >= 0) { setSearch(acSuggestions[acFocus]); setSearchOpen(false); setAcFocus(-1) }
                if (e.key === 'Escape') { setSearch(''); setSearchOpen(false) }
              }}
              placeholder="Buscar por seleção..."
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-1)', minWidth: 0 }}
            />
            {search && (
              <button onClick={() => { setSearch(''); setAcFocus(-1) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-4)', padding: 0, lineHeight: 1, fontSize: 16 }}>×</button>
            )}
            {searchQ && (
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
                {visible.length} resultado{visible.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {searchOpen && acSuggestions.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50, background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', boxShadow: '0 4px 16px rgba(0,0,0,.25)', overflow: 'hidden' }}>
              {acSuggestions.map((s, i) => (
                <div key={s} onMouseDown={() => { setSearch(s); setSearchOpen(false) }}
                  style={{ padding: 'var(--s2) var(--s4)', fontFamily: 'var(--font-cond)', fontSize: 14, cursor: 'pointer', background: i === acFocus ? 'var(--accent-dim)' : 'transparent', color: i === acFocus ? 'var(--accent)' : 'var(--text-1)', borderBottom: i < acSuggestions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--s16)', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
            {searchQ ? `Nenhum resultado para "${search}".` : 'Nenhuma aposta neste filtro.'}
          </div>
        ) : <BetGroups bets={visible} filter={filter} />}
      </div>

      {compareOpen && <CompareView userId={userId} onClose={() => setCompareOpen(false)} />}
    </div>
  )
}
