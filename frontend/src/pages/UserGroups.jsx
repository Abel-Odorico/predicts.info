import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

export default function UserGroups() {
  const { token, user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ groups: [], pending_invites: [] })
  const [newGroupName, setNewGroupName] = useState('')
  const [createMsg, setCreateMsg] = useState('')
  const [creating, setCreating] = useState(false)

  async function loadGroups() {
    if (!token) return
    setLoading(true)
    try {
      const response = await api.get('/user-groups', token)
      setData(response)
    } catch (e) {
      setCreateMsg(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadGroups()
  }, [token])

  async function createGroup(e) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setCreating(true)
    setCreateMsg('')
    try {
      await api.post('/user-groups', { name: newGroupName }, token)
      setNewGroupName('')
      setCreateMsg('✓ Grupo criado.')
      await loadGroups()
    } catch (e) {
      setCreateMsg(`✗ ${e.message}`)
    } finally {
      setCreating(false)
    }
  }

  async function respondToInvite(inviteId, action) {
    try {
      await api.post(`/user-groups/invites/${inviteId}/${action}`, {}, token)
      await loadGroups()
    } catch (e) {
      setCreateMsg(`✗ ${e.message}`)
    }
  }

  if (!token) {
    return (
      <div className="page">
        <div className="bet-empty fade-in-1">
          <h1 className="page-title">MEUS GRUPOS</h1>
          <p className="page-subtitle" style={{ marginTop: 'var(--s4)' }}>Faça login para criar grupos privados e convidar usuários.</p>
          <Link to="/login" className="btn btn-primary btn-lg" style={{ marginTop: 'var(--s6)' }}>Entrar</Link>
        </div>
      </div>
    )
  }

  if (loading) return <Spinner text="Carregando grupos privados..." />

  const groups = data.groups ?? []
  const pendingInvites = data.pending_invites ?? []
  const totalMembers = groups.reduce((sum, group) => sum + (group.members?.length ?? 0), 0)
  const totalGroupInvites = groups.reduce((sum, group) => sum + (group.pending_invites?.length ?? 0), 0)
  const ownedGroups = groups.filter(group => group.owner_user_id === user?.id).length
  const metricCards = [
    { label: 'Grupos', value: groups.length, hint: 'bolões ativos', tone: 'accent' },
    { label: 'Membros', value: totalMembers, hint: 'participantes somados', tone: 'blue' },
    { label: 'Convites', value: pendingInvites.length + totalGroupInvites, hint: 'aguardando resposta', tone: 'gold' },
    { label: 'Administrados', value: ownedGroups, hint: 'grupos sob sua gestão', tone: 'green' },
  ]

  return (
    <div className="page">
      <section className="groups-panel-hero fade-in-1">
        <div className="groups-panel-hero__copy">
          <span className="groups-panel-hero__eyebrow">Central dos bolões</span>
          <h1 className="page-title">MEUS GRUPOS</h1>
          <p className="page-subtitle">Gerencie seus bolões privados, convites e rankings em um só lugar.</p>
        </div>
        <form onSubmit={createGroup} className="groups-create-bar" aria-label="Criar novo grupo">
          <input
            type="text"
            className="form-input groups-create-bar__input"
            placeholder="Nome do novo grupo"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            maxLength={120}
          />
          <button type="submit" className="btn btn-primary groups-create-bar__button" disabled={creating || !newGroupName.trim()}>
            {creating ? 'Criando...' : '+ Criar grupo'}
          </button>
          {createMsg && (
            <div className={`groups-create-bar__message ${createMsg.startsWith('✓') ? 'is-success' : 'is-error'}`}>
              {createMsg}
            </div>
          )}
        </form>
      </section>

      <section className="groups-metrics-grid fade-in-2" aria-label="Resumo dos grupos">
        {metricCards.map(card => (
          <div key={card.label} className={`groups-metric-card groups-metric-card--${card.tone}`}>
            <span className="groups-metric-card__label">{card.label}</span>
            <strong className="groups-metric-card__value">{card.value}</strong>
            <span className="groups-metric-card__hint">{card.hint}</span>
          </div>
        ))}
      </section>

      {pendingInvites.length > 0 && (
        <section className="groups-invite-strip fade-in-2">
          <div className="groups-invite-strip__header">
            <div>
              <span className="groups-panel-hero__eyebrow">Convites recebidos</span>
              <h2 className="groups-section-heading">Responda para entrar no bolão</h2>
            </div>
            <span className="badge badge-group">{pendingInvites.length}</span>
          </div>
          <div className="groups-invite-strip__list">
            {pendingInvites.map(invite => (
              <div key={invite.id} className="groups-received-invite">
                <div className="groups-received-invite__main">
                  <strong>{invite.group_name}</strong>
                  <span>Convite enviado por {invite.inviter_name || 'usuário'}</span>
                </div>
                <div className="groups-received-invite__actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => respondToInvite(invite.id, 'accept')}>Aceitar</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => respondToInvite(invite.id, 'reject')}>Recusar</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {groups.length === 0 ? (
        <section className="groups-empty-state fade-in-3">
          <div className="groups-empty-state__icon">🏆</div>
          <div>
            <h2 className="groups-section-heading">Nenhum grupo privado ainda</h2>
            <p>Crie seu primeiro bolão privado para convidar amigos, acompanhar rankings separados e manter a disputa organizada.</p>
          </div>
        </section>
      ) : (
        <section className="groups-list-grid fade-in-3" aria-label="Lista de grupos">
          {groups.map(group => (
            <UserGroupCard
              key={group.id}
              group={group}
              token={token}
              currentUser={user}
              onRefresh={loadGroups}
            />
          ))}
        </section>
      )}
    </div>
  )
}

function UserGroupCard({ group, token, currentUser, onRefresh }) {
  const isOwner = group.owner_user_id === currentUser?.id
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(group.name)
  const [savingName, setSavingName] = useState(false)
  const [cancellingId, setCancellingId] = useState(null)
  const memberPreview = (group.members ?? []).slice(0, 4)
  const extraMembers = Math.max((group.members?.length ?? 0) - memberPreview.length, 0)

  async function deleteGroup() {
    if (!window.confirm(`Excluir o grupo "${group.name}"? Esta ação não pode ser desfeita.`)) return
    setDeleting(true)
    try {
      await api.delete(`/user-groups/${group.id}`, token)
      onRefresh()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
      setDeleting(false)
    }
  }

  async function saveRename(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSavingName(true)
    try {
      await api.put(`/user-groups/${group.id}`, { name: newName.trim() }, token)
      setRenaming(false)
      onRefresh()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    } finally {
      setSavingName(false)
    }
  }

  useEffect(() => {
    if (!isOwner || query.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setSearching(true)
      try {
        const users = await api.get(`/user-groups/users/search?q=${encodeURIComponent(query.trim())}`, token)
        if (!cancelled) setResults(users)
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [query, token, isOwner])

  async function cancelInvite(inviteId) {
    if (!window.confirm('Cancelar este convite?')) return
    setCancellingId(inviteId)
    try {
      await api.delete(`/user-groups/${group.id}/invites/${inviteId}`, token)
      setMsg('✓ Convite cancelado.')
      onRefresh()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    } finally {
      setCancellingId(null)
    }
  }

  async function inviteByEmail(e) {
    e.preventDefault()
    if (!email.trim()) return
    setInviting(true)
    setMsg('')
    try {
      await api.post(`/user-groups/${group.id}/invites`, { email }, token)
      setEmail('')
      setQuery('')
      setResults([])
      setMsg('✓ Convite enviado.')
      onRefresh()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    } finally {
      setInviting(false)
    }
  }

  async function inviteUser(userId, emailValue) {
    setInviting(true)
    setMsg('')
    try {
      await api.post(`/user-groups/${group.id}/invites`, { user_id: userId, email: emailValue }, token)
      setQuery('')
      setResults([])
      setMsg('✓ Convite enviado.')
      onRefresh()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
    } finally {
      setInviting(false)
    }
  }

  return (
    <article className="group-manager-card">
      <header className="group-manager-card__header">
        <div className="group-manager-card__title-block">
          {renaming ? (
            <form onSubmit={saveRename} className="group-manager-card__rename">
              <input
                type="text"
                className="form-input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                maxLength={120}
                autoFocus
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingName}>{savingName ? '...' : 'Salvar'}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRenaming(false); setNewName(group.name) }}>Cancelar</button>
            </form>
          ) : (
            <>
              <div className="group-manager-card__kicker">Bolão privado</div>
              <h2 className="group-manager-card__title">{group.name}</h2>
            </>
          )}
        </div>
        <div className="group-manager-card__actions">
          {isOwner && <span className="badge badge-win">Dono</span>}
          <Link to={`/meus-grupos/${group.id}`} className="btn btn-primary btn-sm">🏆 Ranking</Link>
          {isOwner && !renaming && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(true)}>✏️ Editar</button>}
          {isOwner && !renaming && (
            <button type="button" className="btn btn-ghost btn-sm group-manager-card__danger" onClick={deleteGroup} disabled={deleting} aria-label={`Excluir ${group.name}`}>
              {deleting ? '...' : '🗑'}
            </button>
          )}
        </div>
      </header>

      <div className="group-manager-card__stats">
        <GroupStat label="Membros" value={group.members?.length ?? 0} />
        <GroupStat label="Convites" value={group.pending_invites?.length ?? 0} />
        <GroupStat label="Seu papel" value={isOwner ? 'Dono' : 'Membro'} compact />
      </div>

      <div className="group-manager-card__body">
        <section className="group-manager-section">
          <div className="group-manager-section__header">
            <h3>Membros</h3>
            {extraMembers > 0 && <span>+{extraMembers}</span>}
          </div>
          <div className="group-member-preview">
            {memberPreview.map(member => (
              <div key={member.user_id} className="group-member-row">
                <div className="group-member-row__avatar">{getInitials(member.name)}</div>
                <div className="group-member-row__identity">
                  <strong>{member.name}</strong>
                  <span>{member.email}</span>
                </div>
                {member.is_owner && <span className="badge badge-group">Dono</span>}
              </div>
            ))}
          </div>
        </section>

        {group.pending_invites.length > 0 && (
          <section className="group-manager-section">
            <div className="group-manager-section__header">
              <h3>Convites pendentes</h3>
              <span>{group.pending_invites.length}</span>
            </div>
            <div className="group-pending-list">
              {group.pending_invites.map(invite => (
                <div key={invite.id} className="pending-invite-row">
                  <div className="pending-invite-row__content">
                    <span className="pending-invite-row__email">{invite.invitee_email}</span>
                    <span className="pending-invite-row__meta">Aguardando resposta</span>
                  </div>
                  {isOwner && (
                    <button type="button" className="btn btn-ghost btn-sm group-manager-card__danger" disabled={cancellingId === invite.id} onClick={() => cancelInvite(invite.id)}>
                      {cancellingId === invite.id ? '...' : 'Cancelar'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {isOwner && (
          <section className="group-manager-section group-manager-section--tools">
            <div className="group-manager-section__header">
              <h3>Ferramentas de convite</h3>
              <span>Admin</span>
            </div>
            <div className="group-invite-tools">
              <label className="form-label" htmlFor={`user-search-${group.id}`}>Buscar usuário</label>
              <input
                id={`user-search-${group.id}`}
                type="text"
                className="form-input"
                placeholder="Nome ou email"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />

              {searching && <div className="group-tool-note">Buscando usuários...</div>}
              {results.length > 0 && (
                <div className="group-search-results">
                  {results.map(result => (
                    <div key={result.id} className="group-search-result">
                      <div>
                        <strong>{result.name}</strong>
                        <span>{result.email}</span>
                      </div>
                      <button type="button" className="btn btn-primary btn-sm" disabled={inviting} onClick={() => inviteUser(result.id, result.email)}>Convidar</button>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={inviteByEmail} className="group-email-invite">
                <label className="form-label" htmlFor={`invite-email-${group.id}`}>Convidar por email</label>
                <div className="group-email-invite__row">
                  <input
                    id={`invite-email-${group.id}`}
                    type="email"
                    className="form-input"
                    placeholder="email@exemplo.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                  <button type="submit" className="btn btn-ghost btn-sm" disabled={inviting || !email.trim()}>{inviting ? 'Enviando...' : 'Enviar'}</button>
                </div>
              </form>

              {msg && <div className={`group-tool-message ${msg.startsWith('✓') ? 'is-success' : 'is-error'}`}>{msg}</div>}
            </div>
          </section>
        )}
      </div>
    </article>
  )
}

function GroupStat({ label, value, compact = false }) {
  return (
    <div className="group-stat">
      <span>{label}</span>
      <strong className={compact ? 'group-stat__value--text' : undefined}>{value}</strong>
    </div>
  )
}

function getInitials(name = '') {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return initials || '?'
}
