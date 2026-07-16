import { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { api } from '../api'

// Evolução do título do Brasileirão — RECONSTRUÍDA (não há snapshot histórico
// gravado, só sincronizamos desde 11/07): back-end recalcula o Monte Carlo
// como estaria logo após cada rodada já disputada (ver GET
// /brasileirao/title-evolution). Diferente do TitleEvolutionChart da Copa
// (que desenha tudo de uma vez e só pulsa o ponto final): aqui a linha
// avança rodada a rodada sozinha, pausa no fim e recomeça — é a "simulação
// mudando automaticamente" pedida pelo Abel, não um chart estático.
const CLUB_COLORS = {
  PAL: '#0a5c36', FLA: '#c0392b', COR: '#4a4a4a', PAU: '#c0392b',
  FLU: '#8b1538', CRU: '#003399', VAS: '#1a1a1a', BOT: '#1a1a1a',
  GRE: '#0057a8', SCI: '#c0392b', CAP: '#e8752c', RBB: '#c8102e',
  BAH: '#0b4ea2', CTB: '#5cb85c', CAM: '#000000', FBP: '#003399',
}
const FALLBACK = d3.schemeTableau10

export default function BrTitleEvolutionChart() {
  const stageRef = useRef(null)
  const genRef = useRef(0)
  const timerRef = useRef(null)
  const loopTimeoutRef = useRef(null)
  const [data, setData] = useState(null)
  const [hidden, setHidden] = useState(new Set())

  useEffect(() => {
    api.get('/brasileirao/title-evolution')
      .then(setData)
      .catch(() => setData({ rounds: [], teams_meta: {} }))
  }, [])

  useEffect(() => {
    if (!data || !stageRef.current) return
    const el = stageRef.current
    const io = new IntersectionObserver(
      entries => entries.forEach(e => {
        if (e.isIntersecting) draw()
        else { genRef.current += 1; if (timerRef.current) timerRef.current.stop(); if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current) }
      }),
      { threshold: 0.3 }
    )
    io.observe(el)
    function onVisibility() {
      if (document.hidden) { genRef.current += 1; if (timerRef.current) timerRef.current.stop(); if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      genRef.current += 1
      if (timerRef.current) timerRef.current.stop()
      if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current)
    }
  }, [data, hidden])

  function toggle(code) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }

  function colorFor(code, i) {
    return CLUB_COLORS[code] || FALLBACK[i % FALLBACK.length]
  }

  function draw() {
    const el = stageRef.current
    const rounds = data?.rounds
    if (!el || !rounds?.length) return
    genRef.current += 1
    const myGen = genRef.current
    if (timerRef.current) timerRef.current.stop()
    if (loopTimeoutRef.current) clearTimeout(loopTimeoutRef.current)

    const codes = Object.keys(data.teams_meta).filter(c => !hidden.has(c))
    const W = 1000, H = 380
    const M = { top: 20, right: 20, bottom: 34, left: 36 }
    const iw = W - M.left - M.right
    const ih = H - M.top - M.bottom

    const svg = d3.select(el)
    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${W} ${H}`)

    const x = d3.scaleLinear().domain([1, rounds.length]).range([0, iw])
    const maxPct = d3.max(rounds, r => d3.max(codes.map(c => r.teams[c] || 0))) || 40
    const y = d3.scaleLinear().domain([0, maxPct * 1.15]).range([ih, 0])

    const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`)

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(Math.min(rounds.length, 10)).tickFormat(d => `R${d}`))
      .call(s => s.selectAll('text').attr('fill', 'var(--text-4)').attr('font-size', 12.5))
      .call(s => s.selectAll('line,path').attr('stroke', 'var(--border)'))
    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d}%`))
      .call(s => s.selectAll('text').attr('fill', 'var(--text-4)').attr('font-size', 12.5))
      .call(s => s.selectAll('line,path').attr('stroke', 'var(--border)'))

    const line = d3.line()
      .x((d, i) => x(i + 1))
      .y(d => y(d))
      .curve(d3.curveMonotoneX)

    // clip que revela os traçados progressivamente (o "avanço rodada a rodada")
    const clipId = `br-title-evo-clip-${myGen}`
    svg.append('clipPath').attr('id', clipId)
      .append('rect').attr('x', 0).attr('y', 0).attr('width', 0).attr('height', ih)
    const revealG = g.append('g').attr('clip-path', `url(#${clipId})`)

    const series = codes.map((code, ci) => {
      const values = rounds.map(r => r.teams[code] ?? 0)
      const color = colorFor(code, ci)
      const path = revealG.append('path')
        .datum(values).attr('fill', 'none').attr('stroke', color)
        .attr('stroke-width', 3).attr('stroke-linecap', 'round').attr('d', line)
      return { code, values, color, path }
    })

    // playhead: linha vertical + rótulo com valor ao vivo por time
    const playhead = g.append('line')
      .attr('y1', 0).attr('y2', ih).attr('x1', 0).attr('x2', 0)
      .attr('stroke', 'var(--border-strong)').attr('stroke-dasharray', '3,3')

    const readouts = series.map(s => {
      const dot = g.append('circle').attr('r', 5).attr('fill', s.color)
      const label = g.append('text')
        .attr('font-family', 'var(--font-data)').attr('font-weight', 800).attr('font-size', 13)
        .attr('fill', s.color)
      return { ...s, dot, label }
    })

    // Evita rótulos colados quando times têm % parecido (comum na cauda de baixo)
    const MIN_GAP = 15
    function declutter(items) {
      const sorted = [...items].sort((a, b) => a.trueY - b.trueY)
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].trueY - sorted[i - 1].trueY < MIN_GAP) {
          sorted[i].trueY = sorted[i - 1].trueY + MIN_GAP
        }
      }
    }

    function renderAt(idx) {
      const px = x(idx + 1)
      playhead.attr('x1', px).attr('x2', px)
      const items = readouts.map(r => ({ r, v: r.values[idx], trueY: y(r.values[idx]) }))
      declutter(items)
      items.forEach(({ r, v, trueY }) => {
        r.dot.attr('cx', px).attr('cy', y(v))
        r.label.attr('x', px + 9).attr('y', trueY + 4).text(`${r.code} ${v}%`)
      })
    }

    const clipRect = svg.select(`#${clipId} rect`)
    const totalMs = Math.max(1800, rounds.length * 260)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    function loop() {
      if (myGen !== genRef.current) return
      clipRect.attr('width', 0)
      renderAt(0)
      const start = performance.now()
      timerRef.current = d3.timer((elapsed) => {
        if (myGen !== genRef.current) { timerRef.current.stop(); return }
        const t = Math.min(1, elapsed / totalMs)
        const eased = d3.easeLinear(t)
        clipRect.attr('width', iw * eased)
        const idx = Math.min(rounds.length - 1, Math.floor(eased * (rounds.length - 1)))
        renderAt(idx)
        if (t >= 1) {
          timerRef.current.stop()
          renderAt(rounds.length - 1)
          loopTimeoutRef.current = setTimeout(loop, 1600)
        }
      })
    }

    if (reduced) {
      clipRect.attr('width', iw)
      renderAt(rounds.length - 1)
    } else {
      loop()
    }
  }

  if (data && !data.rounds?.length) return null

  const codes = data ? Object.keys(data.teams_meta) : []

  return (
    <div className="title-evolution">
      <div className="title-evolution__legend">
        {codes.map((code, i) => (
          <button
            key={code}
            className={`title-evolution__legend-item ${hidden.has(code) ? 'is-hidden' : ''}`}
            style={{ '--dot-color': colorFor(code, i) }}
            onClick={() => toggle(code)}
          >
            <span className="dot" /> {data.teams_meta[code]?.name || code}
          </button>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={stageRef} />
      </div>
      <p className="title-evolution__note">
        📈 Projeção reconstruída rodada a rodada (Monte Carlo, mesmo motor da Copa) — Elo/xG atuais de cada clube, não um retrato histórico rodada a rodada.
      </p>
    </div>
  )
}
