import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

export default function GroupRanking() {
  const { groupId } = useParams()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [linkLoading, setLinkLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // rename state
  const [renaming, setRenaming]     = useState(false)
  const [newName, setNewName]       = useState('')
  const [renameMsg, setRenameMsg]   = useState('')
  const [savingName, setSavingName] = useState(false)

  // remove member
  const [removingId, setRemovingId] = useState(null)

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    api.get(`/user-groups/${groupId}/ranking`, token)
      .then(setData)
      .catch(err => setError(err.message || 'Não foi possível carregar o ranking do grupo.'))
      .finally(() => setLoading(false))
  }, [groupId, token])

  useEffect(() => { load() }, [load])

  async function generateLink() {
    setLinkLoading(true)
    try {
      const res = await api.post(`/user-groups/${groupId}/invite-link`, {}, token)
      const url = `${window.location.origin}/bolao/${res.token}`
      setInviteLink(url)
    } catch (e) {
      setError(e.message)
    } finally {
      setLinkLoading(false)
    }
  }

  async function copyLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink)
      } else {
        const el = document.createElement('textarea')
        el.value = inviteLink
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  async function shareLink() {
    if (navigator.share) {
      await navigator.share({ title: data?.group_name, text: `Entre no meu bolão da Copa 2026: ${data?.group_name}`, url: inviteLink })
    } else {
      copyLink()
    }
  }

  async function saveRename(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSavingName(true)
    setRenameMsg('')
    try {
      const res = await api.put(`/user-groups/${groupId}`, { name: newName.trim() }, token)
      setData(d => ({ ...d, group_name: res.name }))
      setRenaming(false)
      setRenameMsg('')
    } catch (err) {
      setRenameMsg(`✗ ${err.message}`)
    } finally {
      setSavingName(false)
    }
  }

  async function removeMember(userId) {
    if (!window.confirm('Remover este membro do grupo?')) return
    setRemovingId(userId)
    try {
      await api.delete(`/user-groups/${groupId}/members/${userId}`, token)
      setData(d => ({ ...d, ranking: d.ranking.filter(r => r.user_id !== userId) }))
    } catch (err) {
      setError(err.message)
    } finally {
      setRemovingId(null)
    }
  }

  if (!token) {
    return (
      <div className="page">
        <div className="bet-empty fade-in-1">
          <p className="page-subtitle">Faça login para ver o ranking do grupo.</p>
          <Link to="/login" className="btn btn-primary btn-lg" style={{ marginTop: 'var(--s6)' }}>Entrar</Link>
        </div>
      </div>
    )
  }

  if (loading) return <Spinner text="Carregando ranking do grupo..." />

  if (error) {
    return (
      <div className="page">
        <div className="card fade-in-1">
          <div className="card__body">
            <p className="page-subtitle" style={{ margin: 0 }}>{error}</p>
            <Link to="/meus-grupos" className="btn btn-primary btn-sm mt-4">Voltar aos grupos</Link>
          </div>
        </div>
      </div>
    )
  }

  const ranking = data?.ranking ?? []
  const amOwner = data?.is_owner === true
  const myEntry = ranking.find(r => r.is_me)

  return (
    <div className="page">
      <div className="fade-in-1">
        <Link to="/meus-grupos" className="match-breadcrumb__link">‹ Meus Grupos</Link>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap', marginTop: 'var(--s4)' }}>
          <div>
            {renaming ? (
              <form onSubmit={saveRename} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  className="form-input"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  maxLength={120}
                  autoFocus
                  style={{ minWidth: 180 }}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingName}>
                  {savingName ? 'Salvando...' : 'Salvar'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRenaming(false); setRenameMsg('') }}>
                  Cancelar
                </button>
                {renameMsg && <span style={{ fontSize: 12, color: 'var(--lose)' }}>{renameMsg}</span>}
              </form>
            ) : (
              <h1 className="page-title">{data?.group_name}</h1>
            )}
            <p className="page-subtitle">{ranking.length} participante{ranking.length !== 1 ? 's' : ''}</p>
          </div>
          {amOwner && !renaming && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setNewName(data?.group_name ?? ''); setRenaming(true) }}
            >
              ✏️ Renomear
            </button>
          )}
        </div>
      </div>

      {/* Invite link */}
      <div className="card mt-6 fade-in-2" style={{ padding: 'var(--s12) var(--s16)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
            Link de convite
          </span>
          {!inviteLink ? (
            <button
              className="btn btn-primary btn-sm"
              onClick={generateLink}
              disabled={linkLoading}
            >
              {linkLoading ? 'Gerando...' : '🔗 Gerar link'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <input
                readOnly value={inviteLink}
                style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-data)', fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)' }}
              />
              <button className="btn btn-primary btn-sm" onClick={shareLink}>
                {copied ? '✓ Copiado' : '📤 Compartilhar'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={copyLink} title="Copiar link">
                📋
              </button>
            </div>
          )}
        </div>
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-3)' }}>
          Qualquer pessoa com o link pode entrar no grupo. Apenas o dono pode gerar e revogar o link.
        </div>
      </div>

      {/* Ranking table */}
      <div className="card mt-4 fade-in-3">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            Classificação do Grupo
          </span>
        </div>

        {/* Hero card — my position */}
        {myEntry && (
          <div className="group-ranking-hero fade-in-2">
            <div className="group-ranking-hero__pos">
              {myEntry.position === 1 ? '🥇' : myEntry.position === 2 ? '🥈' : myEntry.position === 3 ? '🥉' : `${myEntry.position}º`}
            </div>
            <div className="group-ranking-hero__info">
              <div className="group-ranking-hero__label">Sua posição no grupo</div>
              <div className="group-ranking-hero__name">{myEntry.name}</div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                {myEntry.exact_scores ?? 0} exatos · {myEntry.correct_results ?? 0} certos · {myEntry.total_bets ?? 0} apostas
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="group-ranking-hero__pts">{myEntry.total_points}</div>
              <div className="group-ranking-hero__pts-label">pontos</div>
            </div>
          </div>
        )}

        {ranking.length === 0 ? (
          <div style={{ padding: 'var(--s16)', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>
            Nenhuma aposta ainda.
          </div>
        ) : (
          <div>
            <div className="ranking-head">
              {['#', 'Participante', 'Pontos', 'Exatos', 'Apostas'].map(h => (
                <span key={h} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)',
                  textAlign: ['Pontos','Exatos','Apostas'].includes(h) ? 'right' : h === '#' ? 'center' : 'left'
                }}>
                  {h}
                </span>
              ))}
            </div>
            {ranking.map((r, i) => {
              const podiumClass = i === 0 ? 'ranking-row--gold' : i === 1 ? 'ranking-row--silver' : i === 2 ? 'ranking-row--bronze' : ''
              const meStyle = r.is_me && i >= 3 ? { background: 'rgba(0, 200, 83, 0.06)', borderLeft: '3px solid var(--accent)' } : {}
              return (
                <div
                  key={r.user_id}
                  className={`ranking-row fade-in ${podiumClass}`}
                  style={{ animationDelay: `${i * 30}ms`, borderLeft: i >= 3 ? (r.is_me ? '3px solid var(--accent)' : '3px solid transparent') : undefined, ...meStyle, textDecoration: 'none' }}
                >
                  <span className={`ranking-row__pos ${i < 3 ? 'ranking-row__pos--top' : ''}`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <Link to={`/usuarios/${r.user_id}/historico`} className="ranking-row__meta" style={{ textDecoration: 'none', flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {r.name}
                      {r.is_me && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.08em' }}>VOCÊ</span>}
                      {r.is_owner && !r.is_me && <span style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.08em' }}>DONO</span>}
                    </div>
                    <div className="ranking-row__mobile-stats">
                      <span>{r.total_points} pts</span>
                      <span>·</span>
                      <span>{r.exact_scores ?? 0} exatos</span>
                    </div>
                  </Link>
                  <span className="ranking-row__pts">{r.total_points}</span>
                  <span className="ranking-row__stats ranking-row__sub">{r.exact_scores ?? 0}</span>
                  <span className="ranking-row__stats ranking-row__sub">{r.total_bets ?? 0}</span>
                  {amOwner && !r.is_me && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11, padding: '2px 8px', color: 'var(--lose)' }}
                      disabled={removingId === r.user_id}
                      onClick={() => removeMember(r.user_id)}
                    >
                      {removingId === r.user_id ? '...' : '✕'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
