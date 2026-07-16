// Fonte canônica de badges/aproveitamento de bolão — usada por GroupRanking.jsx (detalhe)
// e UserGroups.jsx (card da listagem). Antes cada página tinha sua própria versão
// divergente (badges diferentes, mesmo grupo podia mostrar líder/streak diferente
// dependendo de qual tela o usuário estava vendo).
export function aproveitamento(r) {
  if (!r.total_bets) return null
  return Math.round(r.total_points / (r.total_bets * 25) * 100)
}

// Catálogo pra legenda "o que significa cada badge" — descrições de exibição,
// separado da lógica de quem ganha em getBadges() mas com os mesmos ícones/labels.
export const BADGE_CATALOG = [
  { icon: '🏆', label: 'Líder', desc: '1º no grupo', color: '#e8a030' },
  { icon: '🥈', label: 'Vice', desc: '2º no grupo', color: '#a0a0a0' },
  { icon: '🎯', label: 'Sniper', desc: '≥28% exatos (mín. 5)', color: '#e85252' },
  { icon: '💯', label: 'Cem%', desc: 'Apostou em todos os jogos', color: '#0fa896' },
  { icon: '⚡', label: 'Maratonista', desc: '≥85% jogos apostados', color: '#9b5de8' },
  { icon: '🔮', label: 'Preciso', desc: '≥60% aproveit (mín. 10)', color: '#4a90e8' },
  { icon: '🔥', label: 'Em Alta', desc: 'Maior pts hoje no grupo', color: 'var(--win)' },
  { icon: '🔗', label: 'Sequência', desc: '≥3 exatos consecutivos', color: '#0fa896' },
  { icon: '🎲', label: 'Ousado', desc: 'Palpite mais audacioso', color: '#e8a030' },
]

export function getBadges(r, position, effectiveTotal, isHotToday, topStreak, isMuralHero) {
  const badges = []
  if (position === 1) badges.push({ icon: '🏆', label: 'Líder', color: '#e8a030' })
  if (position === 2) badges.push({ icon: '🥈', label: 'Vice', color: '#a0a0a0' })
  if (r.total_bets >= 5 && r.exact_scores / r.total_bets >= 0.28)
    badges.push({ icon: '🎯', label: 'Sniper', color: '#e85252' })
  if (effectiveTotal >= 5 && r.total_bets >= effectiveTotal)
    badges.push({ icon: '💯', label: 'Cem%', color: '#0fa896' })
  if (effectiveTotal > 0 && r.total_bets >= effectiveTotal * 0.85)
    badges.push({ icon: '⚡', label: 'Maratonista', color: '#9b5de8' })
  if (r.total_bets >= 10 && aproveitamento(r) >= 60)
    badges.push({ icon: '🔮', label: 'Preciso', color: '#4a90e8' })
  if (isHotToday) badges.push({ icon: '🔥', label: 'Em Alta', color: 'var(--win)' })
  if (topStreak && topStreak >= 3) badges.push({ icon: '🔗', label: `${topStreak} seguidos`, color: '#0fa896' })
  if (isMuralHero) badges.push({ icon: '🎲', label: 'Ousado', color: '#e8a030' })
  return badges
}
