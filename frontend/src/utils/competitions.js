// Fonte única das competições ativas — antes cada página (Dashboard, UserGroups,
// GroupRanking, Bets, Ranking) reimplementava essa mesma lista à mão, e já tinha
// dado pra notar (Bets/Ranking sem "Geral", UserGroups sem emoji).
export const COMPETITIONS = [
  { id: 'geral', label: 'Geral', emoji: '🏠' },
  { id: 'brasileirao2026', label: 'Brasileirão', emoji: '🇧🇷' },
  { id: 'copa2026', label: 'Copa 2026', emoji: '🏆' },
]

export const COMPETITION_LABEL = Object.fromEntries(COMPETITIONS.map(c => [c.id, c.label]))
