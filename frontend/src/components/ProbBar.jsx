import { useState, useEffect } from 'react'
import { CONF_HEX } from '../api'
import TeamCrestFlag from './TeamCrestFlag'

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   DUEL BAR — signature element
   Two teams fight for horizontal space. Animated on mount.
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function ProbBar({ sim, matchData }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(t)
  }, [sim])

  if (!sim || !matchData) return null

  const { team_a: a, team_b: b } = matchData
  const colorA = CONF_HEX[a.confederation] || '#2ec980'
  const colorB = CONF_HEX[b.confederation] || '#4a90e8'

  const pA = sim.prob_a
  const pD = sim.prob_draw
  const pB = sim.prob_b

  return (
    <div className="duel-bar fade-in-1">
      {/* Teams */}
      <div className="duel-bar__teams">
        <div className="duel-bar__team">
          <TeamCrestFlag src={a.flag_url} alt={a.code} className="duel-bar__flag" crestClassName="duel-bar__flag--crest" />
          <div>
            <div className="duel-bar__name">{a.code}</div>
            <div className="duel-bar__conf">{a.confederation}</div>
          </div>
        </div>

        <div className="duel-bar__vs">vs</div>

        <div className="duel-bar__team duel-bar__team--b">
          <TeamCrestFlag src={b.flag_url} alt={b.code} className="duel-bar__flag" crestClassName="duel-bar__flag--crest" />
          <div>
            <div className="duel-bar__name">{b.code}</div>
            <div className="duel-bar__conf">{b.confederation}</div>
          </div>
        </div>
      </div>

      {/* The Duel Track */}
      <div className="duel-bar__track">
        <div
          className="duel-bar__fill duel-bar__fill--a"
          style={{
            width: mounted ? `${pA}%` : '0%',
            background: colorA,
            transition: 'width 900ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
        <div
          className="duel-bar__fill duel-bar__fill--mid"
          style={{ width: mounted ? `${pD}%` : '0%', transition: 'width 900ms 100ms ease' }}
        />
        <div
          className="duel-bar__fill duel-bar__fill--b"
          style={{
            width: mounted ? `${pB}%` : '0%',
            background: colorB,
            transition: 'width 900ms 50ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        />
      </div>

      {/* Probabilities */}
      <div className="duel-bar__probs fade-in-2">
        <div className="duel-bar__prob">
          <span className="duel-bar__prob-pct" style={{ color: colorA }}>
            {pA.toFixed(1)}%
          </span>
          <span className="duel-bar__prob-label">vitória {a.code}</span>
        </div>
        <div className="duel-bar__prob">
          <span className="duel-bar__prob-pct" style={{ color: 'var(--text-2)' }}>
            {pD.toFixed(1)}%
          </span>
          <span className="duel-bar__prob-label">empate</span>
        </div>
        <div className="duel-bar__prob">
          <span className="duel-bar__prob-pct" style={{ color: colorB }}>
            {pB.toFixed(1)}%
          </span>
          <span className="duel-bar__prob-label">vitória {b.code}</span>
        </div>
      </div>

      {/* Lambda (xG esperado) */}
      <div className="duel-bar__lambda fade-in-3">
        <div className="duel-bar__lambda-item">
          <span className="duel-bar__lambda-val">{sim.lambda_a.toFixed(2)}</span>
          <span className="duel-bar__lambda-label">λ xG {a.code}</span>
        </div>
        <div className="duel-bar__lambda-item">
          <span className="duel-bar__lambda-val">{sim.lambda_b.toFixed(2)}</span>
          <span className="duel-bar__lambda-label">xG λ {b.code}</span>
        </div>
      </div>
    </div>
  )
}
