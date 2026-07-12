import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { api } from '../api'

// Evolução real de chance de título — reconstruída com o chaveamento
// verdadeiro de cada fase (r32/r16/qf/sf), não é número inventado (ver
// GET /tournament/title-evolution). Regra Zero: linhas se desenham na
// entrada (stroke-dashoffset) e DEPOIS o ponto do valor atual de cada
// time pulsa pra sempre — texto (legenda + tooltip) é parte da interação,
// não só rótulo estático.
const TEAM_COLORS = { ARG: '#60a5fa', ENG: '#ef4444', ESP: '#fbbf24', FRA: '#1e3a8a' }
const TEAM_NAMES = { ARG: 'Argentina', ENG: 'Inglaterra', ESP: 'Espanha', FRA: 'França' }

export default function TitleEvolutionChart({ codes = ['ARG', 'ENG', 'ESP', 'FRA'] }) {
  const stageRef = useRef(null)
  const genRef = useRef(0)
  const [data, setData] = useState(null)
  const [hidden, setHidden] = useState(new Set())
  const [tooltipData, setTooltipData] = useState(null)

  useEffect(() => {
    api.get(`/tournament/title-evolution?codes=${codes.join(',')}`)
      .then(setData)
      .catch(() => setData([]))
  }, [codes.join(',')])

  useEffect(() => {
    if (!data || !stageRef.current) return
    const el = stageRef.current
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) draw() }),
      { threshold: 0.3 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [data, hidden])

  function toggle(code) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  function draw() {
    const el = stageRef.current
    if (!el || !data?.length) return
    genRef.current += 1
    const myGen = genRef.current

    const W = 1000, H = 380
    const M = { top: 20, right: 20, bottom: 34, left: 36 }
    const iw = W - M.left - M.right
    const ih = H - M.top - M.bottom

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${W} ${H}`)

    const dates = data.map(d => new Date(d.computed_at))
    const x = d3.scaleTime().domain(d3.extent(dates)).range([0, iw])
    const y = d3.scaleLinear().domain([0, d3.max(data, d => d3.max(codes.map(c => d.teams[c] || 0))) * 1.15 || 40]).range([ih, 0])

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`)

    // eixos
    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(data.length).tickFormat(d3.timeFormat('%d/%m')))
      .call(s => s.selectAll('text').attr('fill', 'var(--text-4)').attr('font-size', 10))
      .call(s => s.selectAll('line,path').attr('stroke', 'var(--border)'))
    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d}%`))
      .call(s => s.selectAll('text').attr('fill', 'var(--text-4)').attr('font-size', 10))
      .call(s => s.selectAll('line,path').attr('stroke', 'var(--border)'))

    const line = d3.line()
      .x((d, i) => x(dates[i]))
      .y(d => y(d))
      .curve(d3.curveMonotoneX)

    const visible = codes.filter(c => !hidden.has(c))

    // ── entrada: cada linha se desenha (stroke-dashoffset), em cascata ────
    const paths = visible.map((code, ci) => {
      const values = data.map(d => d.teams[code] ?? 0)
      const path = g.append('path')
        .datum(values)
        .attr('fill', 'none')
        .attr('stroke', TEAM_COLORS[code])
        .attr('stroke-width', 3)
        .attr('stroke-linecap', 'round')
        .attr('d', line)

      const len = path.node().getTotalLength()
      path.attr('stroke-dasharray', len).attr('stroke-dashoffset', len)
        .transition().delay(200 + ci * 200).duration(900).ease(d3.easeCubicInOut)
        .attr('stroke-dashoffset', 0)

      return { code, values, path, color: TEAM_COLORS[code] }
    })

    // pontos finais (valor atual) + label
    paths.forEach((p, ci) => {
      const lastVal = p.values[p.values.length - 1]
      const cx = x(dates[dates.length - 1]), cy = y(lastVal)

      const dot = g.append('circle')
        .attr('cx', cx).attr('cy', cy).attr('r', 0)
        .attr('fill', p.color)
      dot.transition().delay(200 + ci * 200 + 900).duration(300).ease(d3.easeBackOut.overshoot(2))
        .attr('r', 5)

      g.append('text')
        .attr('x', cx + 10).attr('y', cy + 4)
        .attr('font-family', 'var(--font-data)').attr('font-weight', 800).attr('font-size', 13)
        .attr('fill', p.color)
        .attr('opacity', 0)
        .text(`${p.code} ${lastVal}%`)
        .transition().delay(200 + ci * 200 + 900).duration(300)
        .attr('opacity', 1)

      // pulso perpétuo no ponto atual
      function pulse() {
        if (myGen !== genRef.current) return
        dot.transition().duration(900).ease(d3.easeSinInOut).attr('r', 8).attr('opacity', 0.5)
          .transition().duration(900).ease(d3.easeSinInOut).attr('r', 5).attr('opacity', 1)
          .on('end', () => { if (myGen === genRef.current) pulse() })
      }
      setTimeout(pulse, 200 + ci * 200 + 1300)
    })

    // ── overlay de hover: guideline + tooltip com os 4 valores no ponto ───
    const focusLine = g.append('line')
      .attr('y1', 0).attr('y2', ih)
      .attr('stroke', 'var(--border-strong)').attr('stroke-dasharray', '3,3')
      .attr('opacity', 0)

    const bisect = d3.bisector(d => d).left

    svg.append('rect')
      .attr('x', M.left).attr('y', M.top).attr('width', iw).attr('height', ih)
      .attr('fill', 'transparent')
      .on('mousemove', function (event) {
        const [mx] = d3.pointer(event, g.node())
        const t = x.invert(mx)
        let idx = bisect(dates, t)
        idx = Math.max(0, Math.min(dates.length - 1, idx))
        focusLine.attr('x1', x(dates[idx])).attr('x2', x(dates[idx])).attr('opacity', 1)
        const point = data[idx]
        setTooltipData({
          left: `${(x(dates[idx]) / iw) * 100}%`,
          date: dates[idx],
          values: visible.map(c => ({ code: c, val: point.teams[c] ?? 0, color: TEAM_COLORS[c] })),
        })
      })
      .on('mouseleave', () => { focusLine.attr('opacity', 0); setTooltipData(null) })
  }

  if (data && !data.length) return null

  return (
    <div className="title-evolution">
      <div className="title-evolution__legend">
        {codes.map(code => (
          <button
            key={code}
            className={`title-evolution__legend-item ${hidden.has(code) ? 'is-hidden' : ''}`}
            style={{ '--dot-color': TEAM_COLORS[code] }}
            onClick={() => toggle(code)}
          >
            <span className="dot" /> {TEAM_NAMES[code] || code}
          </button>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={stageRef} />
        {tooltipData && (
          <div className="title-evolution__tooltip" style={{ left: tooltipData.left }}>
            <strong>{tooltipData.date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</strong>
            {tooltipData.values.map(v => (
              <div key={v.code} style={{ color: v.color }}>{v.code}: {v.val}%</div>
            ))}
          </div>
        )}
      </div>
      <p className="title-evolution__note">
        📈 Evolução real, reconstruída com o chaveamento verdadeiro de cada fase (16avos → oitavas → quartas → semis).
      </p>
    </div>
  )
}
