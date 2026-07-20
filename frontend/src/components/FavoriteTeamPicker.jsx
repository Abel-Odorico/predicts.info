import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import { toast } from '../toast'
import TeamCrestFlag from './TeamCrestFlag'

// Picker do "time do coração" do usuário — mesmo campo favorite_team_code que
// o Bot Squad já usa pras personas (backend/models.py User.favorite_team_code),
// só que editável por gente de verdade. Lista combinada Copa+Brasileirão vem
// de GET /teams/favorites/options (público, sem N+1 por time).
export default function FavoriteTeamPicker() {
  const { user, token, setUser } = useAuth()
  const [options, setOptions] = useState(null) // { copa2026: [...], brasileirao2026: [...] }
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    api.get('/teams/favorites/options').then(setOptions).catch(() => setOptions({ copa2026: [], brasileirao2026: [] }))
  }, [])

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const current = useMemo(() => {
    if (!user?.favorite_team_code || !options) return null
    const all = [...(options.copa2026 || []), ...(options.brasileirao2026 || [])]
    return all.find(t => t.code === user.favorite_team_code) || null
  }, [user?.favorite_team_code, options])

  const filtered = useMemo(() => {
    if (!options) return { copa2026: [], brasileirao2026: [] }
    const q = query.trim().toLowerCase()
    const match = t => !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)
    return {
      copa2026: (options.copa2026 || []).filter(match),
      brasileirao2026: (options.brasileirao2026 || []).filter(match),
    }
  }, [options, query])

  async function choose(code) {
    setOpen(false)
    setQuery('')
    if (code === (user?.favorite_team_code || null)) return
    const prev = user
    setUser({ ...user, favorite_team_code: code })
    setSaving(true)
    try {
      const updated = await api.patch('/auth/favorite-team', { favorite_team_code: code }, token)
      setUser(updated)
      toast.success(code ? 'Time do coração atualizado' : 'Time do coração removido')
    } catch (e) {
      setUser(prev)
      toast.error(e?.message || 'Erro ao salvar time do coração')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fav-team-picker" ref={boxRef}>
      <button
        type="button"
        className="fav-team-picker__trigger"
        onClick={() => setOpen(o => !o)}
        disabled={saving}
      >
        {current ? (
          <>
            <TeamCrestFlag
              src={current.flag_url}
              alt={current.name}
              className="fav-team-picker__crest"
              crestClassName="fav-team-picker__crest--crest"
            />
            <span>{current.name}</span>
          </>
        ) : (
          <span className="fav-team-picker__placeholder">❤️ Escolher time do coração</span>
        )}
        <span className="fav-team-picker__chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="fav-team-picker__panel">
          <input
            type="text"
            className="form-input"
            placeholder="Buscar time..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <div className="fav-team-picker__list">
            {current && (
              <button type="button" className="fav-team-picker__option fav-team-picker__option--clear" onClick={() => choose(null)}>
                ✕ Nenhum
              </button>
            )}
            {filtered.copa2026.length > 0 && (
              <>
                <div className="fav-team-picker__group">🌎 Copa do Mundo</div>
                {filtered.copa2026.map(t => (
                  <button
                    key={t.code}
                    type="button"
                    className={`fav-team-picker__option${t.code === user?.favorite_team_code ? ' fav-team-picker__option--active' : ''}`}
                    onClick={() => choose(t.code)}
                  >
                    <TeamCrestFlag src={t.flag_url} alt={t.name} className="fav-team-picker__crest" crestClassName="fav-team-picker__crest--crest" />
                    <span>{t.name}</span>
                  </button>
                ))}
              </>
            )}
            {filtered.brasileirao2026.length > 0 && (
              <>
                <div className="fav-team-picker__group">🇧🇷 Brasileirão</div>
                {filtered.brasileirao2026.map(t => (
                  <button
                    key={t.code}
                    type="button"
                    className={`fav-team-picker__option${t.code === user?.favorite_team_code ? ' fav-team-picker__option--active' : ''}`}
                    onClick={() => choose(t.code)}
                  >
                    <TeamCrestFlag src={t.flag_url} alt={t.name} className="fav-team-picker__crest" crestClassName="fav-team-picker__crest--crest" />
                    <span>{t.name}</span>
                  </button>
                ))}
              </>
            )}
            {!filtered.copa2026.length && !filtered.brasileirao2026.length && (
              <div className="fav-team-picker__empty">Nenhum time encontrado.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
