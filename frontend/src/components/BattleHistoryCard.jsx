import { motion } from 'motion/react'

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

export default function BattleHistoryCard({ teamACode, teamBCode }) {
  const battle = BATTLES[`${teamACode}-${teamBCode}`]
  if (!battle) return null

  const { titles, record, recent, timeline } = battle
  const pctA = Math.round((record.a / record.total) * 100)
  const pctD = Math.round((record.d / record.total) * 100)
  const pctB = 100 - pctA - pctD

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

      <div className="battle-history__bar">
        <div className="battle-history__bar-a" style={{ width: `${pctA}%` }} />
        <div className="battle-history__bar-d" style={{ width: `${pctD}%` }} />
        <div className="battle-history__bar-b" style={{ width: `${pctB}%` }} />
      </div>
      <div className="battle-history__bar-legend">
        <span>{record.a}V</span>
        <span>{record.d}E</span>
        <span>{record.b}V</span>
      </div>

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
