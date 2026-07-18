import { api } from '../api'
import { useAuth } from '../stores/authStore'

export default function RankingNameToggle() {
  const { user, token, setUser } = useAuth()
  if (!token) return null

  const pref = user?.ranking_display_pref === 'username' ? 'username' : 'name'

  function setPref(next) {
    if (next === pref) return
    setUser({ ...user, ranking_display_pref: next })
    api.patch('/auth/ranking-display-pref', { ranking_display_pref: next }, token)
      .then(updated => setUser(updated))
      .catch(() => setUser({ ...user, ranking_display_pref: pref }))
  }

  return (
    <div className="btn-group" role="group" aria-label="Exibir nome ou usuário">
      <button
        type="button"
        className={`btn btn-sm ${pref === 'name' ? 'btn-ghost--active' : 'btn-ghost'}`}
        onClick={() => setPref('name')}
      >
        Nome
      </button>
      <button
        type="button"
        className={`btn btn-sm ${pref === 'username' ? 'btn-ghost--active' : 'btn-ghost'}`}
        onClick={() => setPref('username')}
      >
        Usuário
      </button>
    </div>
  )
}
