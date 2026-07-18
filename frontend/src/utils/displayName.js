// Nome exibido em rankings: 'name' (cadastro) ou 'username' (@apelido).
// Sem username cadastrado, cai pro nome mesmo com a preferência em 'username'.
export function displayName(row, pref) {
  if (!row) return ''
  if (pref === 'username' && row.username) return `@${row.username}`
  return row.name || ''
}
