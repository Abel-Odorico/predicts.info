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

  const evaluated = useMemo(() =>
    [...bets].filter(b => b.result != null)
      .sort((a, b) => new Date(a.match_date || a.created_at) - new Date(b.match_date || b.created_at)),
    [bets]
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

  if (points.length < 1) return null

  const W = 400, H = 200, BAR_H = 52, PADL = 32, PADR = 8, PADT = 10, PADB = 16
  const SEP = 6
  const chartH = H - BAR_H - PADB - SEP
  const maxCum = Math.max(...points.map(p => p.cum), 1)
  const maxPts = Math.max(...points.map(p => p.pts), 1)
  const totalPts = points[points.length - 1].cum

  const toX    = i => PADL + (points.length === 1 ? (W - PADL - PADR) / 2 : (i / (points.length - 1)) * (W - PADL - PADR))
  const toY    = v => PADT + ((1 - v / maxCum) * (chartH - PADT))
  const barBot = H - PADB
  const barMaxH = BAR_H - 8

  const coords = points.map((p, i) => [toX(i), toY(p.cum)])
  const pathD  = coords.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x},${y}` : ` L${x},${y}`), '')
  const areaD  = `${pathD} L${coords[coords.length - 1][0]},${chartH} L${coords[0][0]},${chartH} Z`
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

      {/* Bar legend */}
      <div className="uh-chart-legend">
        {Object.entries(RESULT_COLOR).map(([key, color]) => (
          <span key={key} className="uh-chart-legend__item">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
            {RESULT_META[key]?.label}
          </span>
        ))}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)', padding: 'var(--s2) 0' }}>
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
          {bet.group_name ? `Grupo ${bet.group_name}` : (PHASE_LABELS_UH[bet.phase] || bet.phase || '—')}
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

// ── Página principal ───────────────────────────────────────────────────────
export default function UserHistory() {
  const { userId }       = useParams()
  const { user: me, token } = useAuth()
  const isOwn = me && String(me.id) === String(userId)

  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [filter,     setFilter]     = useState('all')
  const [groupRanks, setGroupRanks] = useState([])
  const [search,     setSearch]     = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [acFocus,    setAcFocus]    = useState(-1)

  useEffect(() => {
    setLoading(true); setError('')
    api.get(`/bets/users/${userId}`)
      .then(setData)
      .catch(err => setError(err.message || 'Não foi possível carregar o histórico.'))
      .finally(() => setLoading(false))
  }, [userId])

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
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI strip ───────────────────────────────── */}
      <div className="uh-kpi-grid fade-in-2">
        {[
          { label: 'Pontos',    value: stats.total_points ?? 0, color: 'var(--accent)' },
          { label: '% Acerto',  value: `${accuracy}%`,          color: 'var(--win)'    },
          { label: 'Exatos',    value: exact.length,            color: '#e8c44a'        },
          { label: 'Certos',    value: correct.length,          color: 'var(--win)'    },
        ].map(k => (
          <div key={k.label} className="uh-kpi-card" style={{ '--kpi-color': k.color }}>
            <div className="uh-kpi-card__accent" />
            <div className="uh-kpi-card__label">{k.label}</div>
            <div className="uh-kpi-card__val" style={{ color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

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
    </div>
  )
}
