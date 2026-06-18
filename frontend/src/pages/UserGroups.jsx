import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">MEUS GRUPOS</h1>
        <p className="page-subtitle">Crie grupos privados, convide usuários e acompanhe quem aceitou.</p>
      </div>

      <div className="card card--accent mt-6 fade-in-2">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            Criar Novo Grupo
          </span>
        </div>
        <form onSubmit={createGroup} className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <div className="form-group">
            <label className="form-label">Nome do grupo</label>
            <input
              type="text"
              className="form-input"
              placeholder="Ex: Amigos do Abel"
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Criando...' : 'Criar Grupo'}
          </button>
          {createMsg && (
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: createMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
              {createMsg}
            </div>
          )}
        </form>
      </div>

      {data.pending_invites.length > 0 && (
        <div className="card mt-6 fade-in-2">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
              Convites Pendentes
            </span>
            <span className="badge badge-group">{data.pending_invites.length}</span>
          </div>
          <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
            {data.pending_invites.map(invite => (
              <div key={invite.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap', padding: 'var(--s3)', border: '1px solid var(--border)', borderRadius: 'var(--r2)', background: 'var(--bg-overlay)' }}>
                <div>
                  <div style={{ color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 14 }}>
                    {invite.group_name}
                  </div>
                  <div style={{ color: 'var(--text-3)', fontSize: 12 }}>
                    Convite enviado por {invite.inviter_name || 'usuário'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => respondToInvite(invite.id, 'accept')}>Aceitar</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => respondToInvite(invite.id, 'reject')}>Recusar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stack mt-6 fade-in-3">
        {data.groups.length === 0 ? (
          <div className="card">
            <div className="card__body" style={{ color: 'var(--text-3)', fontFamily: 'var(--font-cond)', textAlign: 'center' }}>
              Você ainda não participa de nenhum grupo privado.
            </div>
          </div>
        ) : data.groups.map(group => (
          <UserGroupCard
            key={group.id}
            group={group}
            token={token}
            currentUser={user}
            onRefresh={loadGroups}
          />
        ))}
      </div>
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
    <div className="card">
      <div className="card__header">
        <div>
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            {group.name}
          </span>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-data)' }}>
            {group.members.length} membro(s) · {group.pending_invites.length} convite(s) pendente(s)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isOwner && <span className="badge badge-win">Dono</span>}
          <Link to={`/meus-grupos/${group.id}`} className="btn btn-primary btn-sm">🏆 Ranking</Link>
        </div>
      </div>
      <div className="card__body" style={{ display: 'grid', gap: 'var(--s5)' }}>
        <div>
          <div className="section-title" style={{ marginBottom: 'var(--s3)' }}>Membros</div>
          <div className="stack gap-3">
            {group.members.map(member => (
              <div key={member.user_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s3)', padding: 'var(--s3)', borderRadius: 'var(--r2)', background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>{member.name}</div>
                  <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{member.email}</div>
                </div>
                {member.is_owner && <span className="badge badge-group">Owner</span>}
              </div>
            ))}
          </div>
        </div>

        {group.pending_invites.length > 0 && (
          <div>
            <div className="section-title" style={{ marginBottom: 'var(--s3)' }}>Convites pendentes</div>
            <div className="stack gap-3">
              {group.pending_invites.map(invite => (
                <div key={invite.id} style={{ padding: 'var(--s3)', borderRadius: 'var(--r2)', background: 'var(--bg-overlay)', border: '1px solid var(--border)', fontSize: 12 }}>
                  <div style={{ color: 'var(--text-2)' }}>{invite.invitee_email}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isOwner && (
          <div>
            <div className="section-title" style={{ marginBottom: 'var(--s3)' }}>Convidar usuários</div>
            <div className="stack gap-4">
              <div className="form-group">
                <label className="form-label">Buscar usuário por nome ou email</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Digite ao menos 2 caracteres"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>

              {searching && <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Buscando usuários...</div>}
              {results.length > 0 && (
                <div className="stack gap-2">
                  {results.map(result => (
                    <div key={result.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--s3)', alignItems: 'center', padding: 'var(--s3)', borderRadius: 'var(--r2)', background: 'var(--bg-overlay)', border: '1px solid var(--border)' }}>
                      <div>
                        <div style={{ color: 'var(--text-1)', fontFamily: 'var(--font-cond)', fontSize: 13 }}>{result.name}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{result.email}</div>
                      </div>
                      <button type="button" className="btn btn-primary btn-sm" disabled={inviting} onClick={() => inviteUser(result.id, result.email)}>
                        Convidar
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={inviteByEmail} className="stack gap-3">
                <div className="form-group">
                  <label className="form-label">Ou convidar diretamente por email</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="email@exemplo.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>
                <button type="submit" className="btn btn-ghost btn-sm" disabled={inviting}>
                  {inviting ? 'Enviando...' : 'Enviar convite'}
                </button>
              </form>

              {msg && (
                <div style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: msg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                  {msg}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
