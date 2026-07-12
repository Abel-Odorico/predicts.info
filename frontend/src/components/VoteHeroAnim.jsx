import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

// Urna viva — hub-and-spoke D3, estilo Mira (Regra Zero: entrada coreografada
// + loop interno perpétuo). Loop: uma bolinha viaja de cada satélite
// (🏆 Posição / 🔥 Clássico / 🐴 Zebra) até a urna central, uma de cada vez,
// em looping infinito, pra sempre depois da entrada.
export default function VoteHeroAnim() {
  const stageRef = useRef(null)
  const genRef = useRef(0)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) animate()
        }
      },
      { threshold: 0.3 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  function animate() {
    const el = stageRef.current
    if (!el) return
    genRef.current += 1
    const myGen = genRef.current

    const W = 1280, H = 420
    const cx = 640, cy = 220, R = 165

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${W} ${H}`)

    const satellites = [
      { angle: -90, emoji: '🏆', label: 'Posição Final', color: '#2ec980' },
      { angle: 30,  emoji: '🔥', label: 'Clássico',       color: '#9b5de8' },
      { angle: 150, emoji: '🐴', label: 'Zebra',          color: '#e8935b' },
    ].map(s => ({
      ...s,
      x: cx + R * Math.cos(s.angle * Math.PI / 180),
      y: cy + R * Math.sin(s.angle * Math.PI / 180),
    }))

    // ── linhas tracejadas centro <-> satélites ──────────────────────────
    const lines = svg.append('g').selectAll('line')
      .data(satellites).join('line')
      .attr('x1', cx).attr('y1', cy)
      .attr('x2', d => d.x).attr('y2', d => d.y)
      .attr('stroke', d => d.color)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,5')
      .attr('opacity', 0)

    lines.transition().delay(300).duration(500).attr('opacity', 0.5)

    // ── urna central (flat icon: base + tampa + fenda) ──────────────────
    const center = svg.append('g')
      .attr('transform', `translate(${cx},${cy}) scale(0)`)

    center.append('rect')
      .attr('x', -46).attr('y', -18).attr('width', 92).attr('height', 62)
      .attr('rx', 10)
      .attr('fill', 'var(--accent, #FFA203)')
    center.append('rect')
      .attr('x', -54).attr('y', -34).attr('width', 108).attr('height', 22)
      .attr('rx', 8)
      .attr('fill', 'var(--accent, #FFA203)')
      .attr('opacity', 0.85)
    center.append('rect')
      .attr('x', -14).attr('y', -34).attr('width', 28).attr('height', 8)
      .attr('rx', 3)
      .attr('fill', '#fff')
      .attr('opacity', 0.9)
    center.append('text')
      .attr('y', 8).attr('text-anchor', 'middle')
      .attr('font-size', 26)
      .text('🗳️')

    center.transition()
      .delay(0).duration(600).ease(d3.easeBackOut.overshoot(1.4))
      .attr('transform', `translate(${cx},${cy}) scale(1)`)

    // ── satélites (entrada em cascata) ──────────────────────────────────
    const sat = svg.append('g').selectAll('g.satellite')
      .data(satellites).join('g')
      .attr('class', 'satellite')
      .attr('transform', d => `translate(${d.x},${d.y}) scale(0)`)

    sat.append('circle')
      .attr('r', 40)
      .attr('fill', d => d.color)
      .attr('opacity', 0.16)
    sat.append('circle')
      .attr('r', 30)
      .attr('fill', d => d.color)
      .attr('opacity', 0.9)
    sat.append('text')
      .attr('y', 10).attr('text-anchor', 'middle')
      .attr('font-size', 26)
      .text(d => d.emoji)
    sat.append('text')
      .attr('y', 58).attr('text-anchor', 'middle')
      .attr('font-size', 15).attr('font-weight', 700)
      .attr('fill', 'var(--text-2, #ccc)')
      .text(d => d.label)

    sat.transition()
      .delay((d, i) => 250 + i * 150)
      .duration(500)
      .ease(d3.easeBackOut.overshoot(1.3))
      .attr('transform', d => `translate(${d.x},${d.y}) scale(1)`)

    // ── loop perpétuo: bolinha viaja satélite -> centro, um de cada vez ──
    const particleLayer = svg.append('g')

    function fireParticle(sat) {
      if (myGen !== genRef.current) return
      const p = particleLayer.append('circle')
        .attr('r', 7)
        .attr('fill', sat.color)
        .attr('cx', sat.x).attr('cy', sat.y)
        .attr('opacity', 0.95)

      p.transition()
        .duration(900)
        .ease(d3.easeQuadInOut)
        .attr('cx', cx).attr('cy', cy)
        .attr('r', 3)
        .on('end', function () {
          d3.select(this).remove()
          if (myGen !== genRef.current) return
          // pulso na urna ao "receber o voto"
          center.select('rect')
            .transition().duration(150)
            .attr('transform', 'scale(1.08)')
            .transition().duration(150)
            .attr('transform', 'scale(1)')
        })
    }

    function loop(i) {
      if (myGen !== genRef.current) return
      fireParticle(satellites[i % satellites.length])
      setTimeout(() => loop(i + 1), 700)
    }

    setTimeout(() => loop(0), 250 + satellites.length * 150 + 500)
  }

  return (
    <div className="vote-hero-anim">
      <svg ref={stageRef} />
    </div>
  )
}
