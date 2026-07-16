// Fonte canônica de badges/aproveitamento de bolão — usada por GroupRanking.jsx (detalhe)
// e UserGroups.jsx (card da listagem). Antes cada página tinha sua própria versão
// divergente (badges diferentes, mesmo grupo podia mostrar líder/streak diferente
// dependendo de qual tela o usuário estava vendo).
export function aproveitamento(r) {
  if (!r.total_bets) return null
  return Math.round(r.total_points / (r.total_bets * 25) * 100)
}

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
