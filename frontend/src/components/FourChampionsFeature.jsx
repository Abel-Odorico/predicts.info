import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import * as d3 from 'd3'

// "Pela 1ª vez em 36 anos" — achado factual verificado via web (FIFA/ESPN/
// Wikipedia): 1990 foi a única outra vez desde 1970 que as 4 semifinalistas
// já tinham sido campeãs (ARG/ENG/ITA/RFA, 8 títulos). 2026 repete o feito
// (FRA/ESP/ENG/ARG, 7 títulos) — 3ª vez na história, 1ª desde 1990.
const TITLES = [
  { year: 1966, code: 'ENG', name: 'Inglaterra', color: '#ef4444' },
  { year: 1978, code: 'ARG', name: 'Argentina', color: '#60a5fa' },
  { year: 1986, code: 'ARG', name: 'Argentina', color: '#60a5fa' },
  { year: 1998, code: 'FRA', name: 'França', color: '#1e3a8a' },
  { year: 2010, code: 'ESP', name: 'Espanha', color: '#fbbf24' },
  { year: 2018, code: 'FRA', name: 'França', color: '#1e3a8a' },
  { year: 2022, code: 'ARG', name: 'Argentina', color: '#60a5fa' },
]
const TOTAL_TITLES = 7

function ChampionsTimeline() {
  const stageRef = useRef(null)
  const genRef = useRef(0)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) draw() }),
      { threshold: 0.3 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  function draw() {
    const el = stageRef.current
    if (!el) return
    genRef.current += 1
    const myGen = genRef.current

    const W = 1000, H = 180
    const M = { left: 40, right: 40 }
    const x = d3.scaleLinear().domain([1964, 2024]).range([M.left, W - M.right])
    const midY = 100

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${W} ${H}`)

    svg.append('line')
      .attr('x1', M.left).attr('x2', W - M.right).attr('y1', midY).attr('y2', midY)
      .attr('stroke', 'var(--border)').attr('stroke-width', 2)

    const nodes = svg.selectAll('g.champ-node').data(TITLES).join('g')
      .attr('class', 'champ-node')
      .attr('transform', d => `translate(${x(d.year)},${midY}) scale(0)`)
      .style('cursor', 'pointer')

    nodes.append('circle').attr('r', 16).attr('fill', d => d.color).attr('opacity', 0.18)
    nodes.append('circle').attr('r', 9).attr('fill', d => d.color)
    nodes.append('text')
      .attr('y', -22).attr('text-anchor', 'middle')
      .attr('font-family', 'var(--font-data)').attr('font-weight', 800).attr('font-size', 13)
      .attr('fill', 'var(--text-1)')
      .text(d => d.year)
    nodes.append('text')
      .attr('y', 30).attr('text-anchor', 'middle')
      .attr('font-family', 'var(--font-cond)').attr('font-weight', 700).attr('font-size', 11)
      .attr('fill', d => d.color)
      .text(d => d.code)

    nodes.append('title').text(d => `${d.name} campeã em ${d.year}`)

    nodes.transition()
      .delay((d, i) => 150 + i * 130)
      .duration(500).ease(d3.easeBackOut.overshoot(1.5))
      .attr('transform', d => `translate(${x(d.year)},${midY}) scale(1)`)

    // loop perpétuo: o título mais recente (2022, Argentina) pulsa pra sempre
    const lastIdx = TITLES.length - 1
    function pulseLast() {
      if (myGen !== genRef.current) return
      const node = nodes.filter((d, i) => i === lastIdx).select('circle:last-of-type')
      node.transition().duration(800).ease(d3.easeSinInOut).attr('r', 13)
        .transition().duration(800).ease(d3.easeSinInOut).attr('r', 9)
        .on('end', () => { if (myGen === genRef.current) pulseLast() })
    }
    setTimeout(pulseLast, 150 + TITLES.length * 130 + 400)
  }

  return <div className="champions-timeline"><svg ref={stageRef} /></div>
}

export default function FourChampionsFeature() {
  return (
    <motion.div
      className="four-champions"
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.5 }}
    >
      <div className="four-champions__badge">🏆 RARIDADE HISTÓRICA</div>
      <h3 className="four-champions__title">
        Pela 1ª vez em <span>36 anos</span>, as 4 semifinalistas já foram campeãs mundiais
      </h3>
      <p className="four-champions__sub">
        França, Espanha, Inglaterra e Argentina somam <strong>{TOTAL_TITLES} títulos</strong> de Copa do Mundo.
        A última vez que isso aconteceu foi em <strong>1990</strong> (Argentina, Itália, Alemanha Ocidental e Inglaterra) —
        só a <strong>3ª vez na história</strong> do torneio.
      </p>
      <ChampionsTimeline />
      <div className="four-champions__legend">
        <span style={{ color: '#60a5fa' }}>● Argentina 3×</span>
        <span style={{ color: '#1e3a8a' }}>● França 2×</span>
        <span style={{ color: '#fbbf24' }}>● Espanha 1×</span>
        <span style={{ color: '#ef4444' }}>● Inglaterra 1×</span>
      </div>
    </motion.div>
  )
}
