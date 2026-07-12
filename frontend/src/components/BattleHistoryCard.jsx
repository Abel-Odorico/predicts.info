import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import * as d3 from 'd3'

// Histórico + curiosidades das semifinais da Copa 2026 — pesquisado 2026-07-12
// (FIFA/Wikipedia/365scores/ogol/Goal.com). Conteúdo temporário, só cobre os
// pares reais desta edição. Títulos = Copas do Mundo conquistadas (all-time).
const BATTLES = {
  'FRA-ESP': {
    titles: { a: 2, b: 1 },
    record: { a: 13, d: 7, b: 18, total: 38 },
    recent: { text: 'Espanha 5x4 França', context: 'Semifinal da Liga das Nações da UEFA, 2025 — jogo eletrizante' },
    timeline: [
      { year: 1984, tag: 'Eurocopa · final', result: 'França 2x0 Espanha', note: 'Primeiro título continental da seleção francesa, em Paris' },
      { year: 2006, tag: 'Copa do Mundo · oitavas', result: 'França 3x1 Espanha', note: 'Único confronto direto em Copa — virada que embalou os Bleus até a final' },
      { year: 2024, tag: 'Eurocopa · semifinal', result: 'Espanha 2x1 França', note: 'Caminho do tetracampeonato europeu espanhol' },
    ],
  },
  'ENG-ARG': {
    titles: { a: 1, b: 3 },
    record: { a: 6, d: 5, b: 2, total: 13 },
    recent: { text: 'Inglaterra 3x2 Argentina', context: 'Amistoso na Suíça, 2005 — não se enfrentam desde então' },
    timeline: [
      { year: 1966, tag: 'Copa do Mundo · quartas', result: 'Inglaterra 1x0 Argentina', note: '"El Robo del Siglo" — expulsão de Rattín, jogo parado por 8min' },
      { year: 1986, tag: 'Copa do Mundo · quartas', result: 'Argentina 2x1 Inglaterra', note: 'Mão de Deus + Gol do Século, os 2 gols mais famosos da história de Copas' },
      { year: 1998, tag: 'Copa do Mundo · oitavas', result: 'Argentina 2x2 (pên.)', note: 'Vermelho de Beckham em Simeone; Argentina avançou nos pênaltis' },
    ],
  },
}

// Barra D3 interativa: cresce na entrada, números contam junto, shimmer
// perpétuo no segmento líder (Regra Zero), hover destaca + mostra o dado
// por trás do número — texto vira parte da animação, não só rótulo estático.
function BattleRecordBar({ record, teamAName, teamBName }) {
  const stageRef = useRef(null)
  const genRef = useRef(0)
  const [tooltip, setTooltip] = useState(null)

  function onHover(sg) {
    if (!sg) { setTooltip(null); return }
    setTooltip({ x: sg.x, color: sg.color, val: sg.targetVal, tipLabel: sg.tipLabel, pct: sg.pct })
  }


  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) draw() }),
      { threshold: 0.4 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  function draw() {
    const el = stageRef.current
    if (!el) return
    genRef.current += 1
    const myGen = genRef.current

    const W = 1000, H = 74
    const pctA = (record.a / record.total) * 100
    const pctD = (record.d / record.total) * 100
    const pctB = 100 - pctA - pctD
    const segs = [
      { key: 'a', pct: pctA, val: record.a, color: 'var(--accent, #FFA203)', label: `${teamAName} venceu` },
      { key: 'd', pct: pctD, val: record.d, color: 'var(--text-4, #888)', label: 'Empates' },
      { key: 'b', pct: pctB, val: record.b, color: '#4a90e8', label: `${teamBName} venceu` },
    ]

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${W} ${H}`)

    const barY = 30, barH = 26
    let xCursor = 0
    const xStarts = segs.map(s => { const x = xCursor; xCursor += (s.pct / 100) * W; return x })
    const winnerIdx = segs[0].val >= segs[2].val ? 0 : 2

    const defs = svg.append('defs')
    segs.forEach((s, i) => {
      const grad = defs.append('linearGradient')
        .attr('id', `battle-shimmer-${i}`)
        .attr('x1', '0%').attr('x2', '100%')
      grad.append('stop').attr('offset', '0%').attr('stop-color', '#fff').attr('stop-opacity', 0)
      grad.append('stop').attr('offset', '50%').attr('stop-color', '#fff').attr('stop-opacity', 0.85)
      grad.append('stop').attr('offset', '100%').attr('stop-color', '#fff').attr('stop-opacity', 0)

      const glow = defs.append('filter').attr('id', `battle-glow-${i}`).attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
      glow.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'blur')
      const merge = glow.append('feMerge')
      merge.append('feMergeNode').attr('in', 'blur')
      merge.append('feMergeNode').attr('in', 'SourceGraphic')
    })

    svg.append('rect')
      .attr('x', 0).attr('y', barY).attr('width', W).attr('height', barH)
      .attr('rx', 13).attr('fill', 'var(--bg-overlay, #1a1a1a)')

    const segGroups = segs.map((s, i) => {
      const g = svg.append('g').style('cursor', 'pointer')
      const rect = g.append('rect')
        .attr('x', xStarts[i]).attr('y', barY).attr('width', 0).attr('height', barH)
        .attr('fill', s.color)
        .attr('filter', i === winnerIdx ? `url(#battle-glow-${i})` : null)
      const shimmer = g.append('rect')
        .attr('x', xStarts[i]).attr('y', barY).attr('width', 0).attr('height', barH)
        .attr('fill', `url(#battle-shimmer-${i})`)
      const label = svg.append('text')
        .attr('x', xStarts[i] + (s.pct / 100) * W / 2)
        .attr('y', barY - 12)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'var(--font-data, monospace)')
        .attr('font-weight', 900)
        .attr('font-size', 26)
        .attr('fill', 'var(--text-1, #fff)')
        .text('0')
      const sub = svg.append('text')
        .attr('x', xStarts[i] + (s.pct / 100) * W / 2)
        .attr('y', barY + barH + 22)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'var(--font-cond, sans-serif)')
        .attr('font-size', 12)
        .attr('font-weight', 700)
        .attr('letter-spacing', '0.05em')
        .attr('fill', 'var(--text-3, #999)')
        .text((s.key === 'd' ? 'EMPATES' : 'VITÓRIAS'))

      const tipX = xStarts[i] + (s.pct / 100) * W / 2

      g.on('mouseenter', function () {
        rect.transition().duration(180).attr('height', barH + 10).attr('y', barY - 5)
        label.transition().duration(180).attr('font-size', 32)
        onHover({ x: tipX, color: s.color, targetVal: s.val, tipLabel: s.label, pct: s.pct })
      })
      g.on('mouseleave', function () {
        rect.transition().duration(180).attr('height', barH).attr('y', barY)
        label.transition().duration(180).attr('font-size', 26)
        onHover(null)
      })

      return { rect, shimmer, label, targetVal: s.val, targetW: (s.pct / 100) * W, x0: xStarts[i], color: s.color, pct: s.pct, tipLabel: s.label, x: tipX }
    })

    // ── entrada: barras crescem com bounce + números contam em uníssono ──
    segGroups.forEach((sg, i) => {
      sg.rect.transition().delay(150 + i * 130).duration(850).ease(d3.easeBackOut.overshoot(1.1))
        .attr('width', sg.targetW)

      d3.select({}).transition().delay(150 + i * 130).duration(850).ease(d3.easeCubicOut)
        .tween('count', () => {
          const interp = d3.interpolateNumber(0, sg.targetVal)
          return t => sg.label.text(Math.round(interp(t)))
        })
    })

    // ── loop perpétuo #1: shimmer forte varre cada segmento, sempre ──────
    function loopShimmer(i) {
      if (myGen !== genRef.current) return
      const sg = segGroups[i % segGroups.length]
      const shimmerW = Math.max(sg.targetW * 0.55, 40)
      sg.shimmer
        .attr('width', shimmerW)
        .attr('x', sg.x0 - shimmerW)
        .transition().duration(900).ease(d3.easeLinear)
        .attr('x', sg.x0 + sg.targetW)
        .on('end', () => { if (myGen === genRef.current) setTimeout(() => loopShimmer(i + 1), 150) })
    }
    setTimeout(() => loopShimmer(0), 150 + segGroups.length * 130 + 900)

    // ── loop perpétuo #2: segmento vencedor respira (glow pulsando) ───────
    function loopPulse() {
      if (myGen !== genRef.current) return
      const sg = segGroups[winnerIdx]
      sg.rect.transition().duration(900).ease(d3.easeSinInOut).attr('opacity', 0.6)
        .transition().duration(900).ease(d3.easeSinInOut).attr('opacity', 1)
        .on('end', () => { if (myGen === genRef.current) loopPulse() })
    }
    setTimeout(loopPulse, 150 + segGroups.length * 130 + 900)
  }

  return (
    <div className="battle-record-bar" style={{ position: 'relative' }}>
      <svg ref={stageRef} />
      {tooltip && (
        <motion.div
          className="battle-record-bar__tooltip"
          initial={{ opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.15 }}
          style={{ left: `${(tooltip.x / 1000) * 100}%`, background: tooltip.color }}
        >
          <strong>{tooltip.val}</strong> {tooltip.tipLabel.toLowerCase()} <span>({Math.round(tooltip.pct)}%)</span>
        </motion.div>
      )}
    </div>
  )
}

export default function BattleHistoryCard({ teamACode, teamBCode, teamAName, teamBName }) {
  const battle = BATTLES[`${teamACode}-${teamBCode}`]
  if (!battle) return null

  const { titles, record, recent, timeline } = battle
  const nameA = teamAName || teamACode
  const nameB = teamBName || teamBCode

  return (
    <motion.div
      className="battle-history"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.5 }}
    >
      <div className="battle-history__head">
        <span className="battle-history__trophy">🏆 {titles.a}× campeã</span>
        <span className="battle-history__vs-label">confrontos diretos</span>
        <span className="battle-history__trophy">🏆 {titles.b}× campeã</span>
      </div>

      <BattleRecordBar record={record} teamAName={nameA} teamBName={nameB} />

      <div className="battle-history__recent">
        <span className="battle-history__recent-label">⏱ Confronto mais recente</span>
        <strong>{recent.text}</strong>
        <span className="battle-history__recent-context">{recent.context}</span>
      </div>

      <div className="battle-history__timeline">
        {timeline.map((t, i) => (
          <motion.div
            key={t.year}
            className="battle-history__timeline-item"
            initial={{ opacity: 0, x: -10 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.1 }}
          >
            <div className="battle-history__timeline-dot" />
            <div className="battle-history__timeline-body">
              <div className="battle-history__timeline-head">
                <span className="battle-history__timeline-year">{t.year}</span>
                <span className="battle-history__timeline-tag">{t.tag}</span>
              </div>
              <div className="battle-history__timeline-result">{t.result}</div>
              <p className="battle-history__timeline-note">{t.note}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}
