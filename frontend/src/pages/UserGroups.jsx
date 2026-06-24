import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

function useCountdownStr(targetDateStr) {
  const [str, setStr] = useState('')
  const ref = useRef(null)
  useEffect(() => {
    if (!targetDateStr) return
    function tick() {
      const diff = new Date(targetDateStr.endsWith('Z') ? targetDateStr : targetDateStr + 'Z') - new Date()
      if (diff <= 0) { setStr('Agora!'); return }
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      const p = n => String(n).padStart(2, '0')
      setStr(h > 0 ? `${p(h)}h ${p(m)}m` : `${p(m)}m ${p(s)}s`)
    }
    tick()
    ref.current = setInterval(tick, 1000)
    return () => clearInterval(ref.current)
  }, [targetDateStr])
  return str
}

function FormDots({ form }) {
  if (!form?.length) return null
  return (
    <div className="form-dots" title={form.join(' ')}>
      {form.map((f, i) => (
        <div key={i} className={`form-dot form-dot--${f}`} title={f === 'E' ? 'Exato' : f === 'C' ? 'Certo' : 'Errado'} />
      ))}
    </div>
  )
}

export default function UserGroups() {
  const { token, user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ groups: [], pending_invites: [], next_match: null, my_bet_next: false })
  const [matchStats, setMatchStats] = useState({ finished: 0, total: 0 })
  const [newGroupName, setNewGroupName] = useState('')
  const [createMsg, setCreateMsg] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function loadGroups() {
    if (!token) return
    setLoading(true)
    try {
      const [response, matches] = await Promise.all([
        api.get('/user-groups', token),
        api.get('/matches'),
      ])
      setData(response)
      const finished = matches.filter(m => m.status === 'finished').length
      setMatchStats({ finished, total: matches.length })
    } catch (e) {
      setCreateMsg(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadGroups() }, [token])

  async function createGroup(e) {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setCreating(true)
    setCreateMsg('')
    try {
      await api.post('/user-groups', { name: newGroupName }, token)
      setNewGroupName('')
      setShowCreateForm(false)
      await loadGroups()
    } catch (err) {
      setCreateMsg(`✗ ${err.message}`)
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
  const nextMatch = data.next_match ?? null
  const myBetNext = data.my_bet_next ?? false
  const totalMembers = groups.reduce((sum, g) => sum + (g.members?.length ?? 0), 0)
  const totalGroupInvites = groups.reduce((sum, g) => sum + (g.pending_invites?.length ?? 0), 0)
  const totalConvites = pendingInvites.length + totalGroupInvites

  return (
    <div className="page">
      <div className="groups-topbar fade-in-1">
        <div className="groups-topbar__left">
          <h1 className="page-title" style={{ margin: 0 }}>MEUS GRUPOS</h1>
          <div className="groups-topbar__pills">
            <span className="groups-pill">{groups.length} bolão{groups.length !== 1 ? 'es' : ''}</span>
            <span className="groups-pill">{totalMembers} membro{totalMembers !== 1 ? 's' : ''}</span>
            {totalConvites > 0 && <span className="groups-pill groups-pill--alert">{totalConvites} convite{totalConvites !== 1 ? 's' : ''}</span>}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm groups-create-toggle"
          onClick={() => { setShowCreateForm(v => !v); setCreateMsg('') }}
          aria-expanded={showCreateForm}
        >
          {showCreateForm ? '✕ Cancelar' : '+ Criar bolão'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={createGroup} className="groups-create-panel fade-in-1" aria-label="Criar novo grupo">
          <input
            type="text"
            className="form-input"
            placeholder="Nome do bolão (ex: Família Copa 2026)"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            maxLength={120}
            autoFocus
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" disabled={creating || !newGroupName.trim()}>
            {creating ? '...' : 'Criar'}
          </button>
          {createMsg && (
            <div className={`groups-create-bar__message ${createMsg.startsWith('✓') ? 'is-success' : 'is-error'}`} style={{ width: '100%' }}>
              {createMsg}
            </div>
          )}
        </form>
      )}

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
              matchStats={matchStats}
              nextMatch={nextMatch}
              myBetNext={myBetNext}
            />
          ))}
        </section>
      )}
    </div>
  )
}

function getBadges(r, position, effectiveTotal) {
  const badges = []
  if (position === 0) badges.push({ icon: '🏆', label: 'Líder', color: '#e8a030' })
  if (r.total_bets >= 5 && r.exact_scores / r.total_bets >= 0.28)
    badges.push({ icon: '🎯', label: 'Sniper', color: '#e85252' })
  if (effectiveTotal > 0 && r.total_bets >= effectiveTotal * 0.85)
    badges.push({ icon: '⚡', label: 'Maratonista', color: '#9b5de8' })
  return badges
}

function UserGroupCard({ group, token, currentUser, onRefresh, matchStats = { finished: 0, total: 0 }, nextMatch = null, myBetNext = false }) {
  const isOwner = group.owner_user_id === currentUser?.id
  const myEntry = (group.members ?? []).find(m => m.user_id === currentUser?.id)
  const myPoints = myEntry?.total_points ?? 0
  const myExact = myEntry?.exact_scores ?? 0

  const sortedMembers = [...(group.members ?? [])].sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0))
  const myPosition = sortedMembers.findIndex(m => m.user_id === currentUser?.id) + 1

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(group.name)
  const [savingName, setSavingName] = useState(false)
  const [cancellingId, setCancellingId] = useState(null)
  const [showAllMembers, setShowAllMembers] = useState(false)
  const [inviteLink, setInviteLink] = useState(
    group.invite_token ? `${window.location.origin}/bolao/${group.invite_token}` : ''
  )
  const [linkLoading, setLinkLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const visibleMembers = showAllMembers ? sortedMembers : sortedMembers.slice(0, 4)
  const extraMembers = Math.max(sortedMembers.length - 4, 0)

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

  async function leaveGroup() {
    if (!window.confirm(`Sair do grupo "${group.name}"?`)) return
    setLeaving(true)
    try {
      await api.delete(`/user-groups/${group.id}/leave`, token)
      onRefresh()
    } catch (e) {
      setMsg(`✗ ${e.message}`)
      setLeaving(false)
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

  async function generateLink() {
    setLinkLoading(true)
    try {
      const res = await api.post(`/user-groups/${group.id}/invite-link`, {}, token)
      setInviteLink(`${window.location.origin}/bolao/${res.token}`)
    } catch (e) {
      setMsg(`✗ ${e.message}`)
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
      await navigator.share({ title: group.name, text: `Entre no meu bolão: ${group.name}`, url: inviteLink })
    } else {
      copyLink()
    }
  }

  useEffect(() => {
    if (!isOwner || query.trim().length < 2) { setResults([]); return }
    let cancelled = false
    const id = window.setTimeout(async () => {
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
    return () => { cancelled = true; window.clearTimeout(id) }
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

  async function inviteUser(userId) {
    setInviting(true)
    setMsg('')
    try {
      await api.post(`/user-groups/${group.id}/invites`, { user_id: userId }, token)
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

  const posEmoji = myPosition === 1 ? '🥇' : myPosition === 2 ? '🥈' : myPosition === 3 ? '🥉' : null
  const countdownStr = useCountdownStr(nextMatch?.match_date)
  const groupLevel = group.group_level ?? 1
  const groupXp = group.group_xp ?? 0
  const groupLevelNext = group.group_level_xp_next ?? 500
  const xpPct = Math.min(100, Math.round((groupXp % 500) / 5))

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
          {!isOwner && (
            <button type="button" className="btn btn-ghost btn-sm group-manager-card__danger" onClick={leaveGroup} disabled={leaving} title="Sair do grupo">
              {leaving ? '...' : 'Sair'}
            </button>
          )}
        </div>
      </header>

      {/* My position strip */}
      <div className="group-my-position">
        <div className="group-my-position__pos">
          {posEmoji
            ? <span style={{ fontSize: 22 }}>{posEmoji}</span>
            : <span className="group-my-position__num">{myPosition}º</span>
          }
        </div>
        <div className="group-my-position__info">
          <span className="group-my-position__label">Sua posição</span>
          <span className="group-my-position__pts">{myPoints} <span>pts</span></span>
        </div>
        <div className="group-my-position__exact">
          <span>{myExact}</span>
          <span>exatos</span>
        </div>
      </div>

      {/* Mini Top-3 */}
      {sortedMembers.length > 0 && (
        <div style={{ padding: '0 var(--s4) var(--s3)', display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
          {sortedMembers.slice(0, 3).map((m, i) => (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--bg-overlay)', borderRadius: 20, padding: '3px 10px 3px 6px' }}>
              <span style={{ fontSize: 13 }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{m.total_points}</span>
            </div>
          ))}
        </div>
      )}

      {/* Alerta próximo jogo */}
      {nextMatch && !myBetNext && (
        <div className="no-bet-alert">
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span className="no-bet-alert__text">
            Aposte em {nextMatch.team_a?.code} × {nextMatch.team_b?.code} — faltam {countdownStr}
          </span>
          <Link to="/apostas" className="btn btn-sm" style={{ background: 'var(--lose)', color: '#fff', border: 'none', fontSize: 11, padding: '4px 10px', flexShrink: 0 }}>
            Apostar
          </Link>
        </div>
      )}

      <div className="group-manager-card__stats">
        <GroupStat label="Membros" value={sortedMembers.length} />
        <GroupStat label="Realizados" value={`${matchStats.finished}/${matchStats.total}`} />
        <GroupStat label="Pendentes" value={matchStats.total - matchStats.finished} />
        <GroupStat label="Convites" value={group.pending_invites?.length ?? 0} />
      </div>

      {/* Barra XP do grupo */}
      <div className="group-xp-bar">
        <div className="group-xp-bar__header">
          <span className="group-xp-bar__label">Nível do grupo</span>
          <span className="group-xp-bar__level">⚡ Nível {groupLevel}</span>
        </div>
        <div className="group-xp-bar__track">
          <div className="group-xp-bar__fill" style={{ width: `${xpPct}%` }} />
        </div>
      </div>

      <div className="group-manager-card__body">
        {/* Members section */}
        <section className="group-manager-section">
          <div className="group-manager-section__header">
            <h3>Membros</h3>
            {extraMembers > 0 && !showAllMembers && <span>+{extraMembers}</span>}
          </div>
          <div className="group-member-preview">
            {visibleMembers.map((member, i) => {
              const effectiveTotal = Math.max(matchStats.finished, ...sortedMembers.map(m => m.total_bets || 0), 1)
              const coveragePct = effectiveTotal > 0 ? Math.min(100, Math.round((member.total_bets || 0) / effectiveTotal * 100)) : 0
              const badges = getBadges(member, i, effectiveTotal)
              return (
                <div key={member.user_id} className={`group-member-row${member.user_id === currentUser?.id ? ' group-member-row--me' : ''}`}>
                  <div className="group-member-row__avatar">{getInitials(member.name)}</div>
                  <div className="group-member-row__identity" style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                      <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {member.name}{member.user_id === currentUser?.id ? ' (você)' : ''}
                      </strong>
                      {member.is_owner && <span className="badge badge-group" style={{ fontSize: 9 }}>Dono</span>}
                    </div>
                    {/* Badges */}
                    {badges.length > 0 && (
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                        {badges.map(b => (
                          <span key={b.label} style={{
                            fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700,
                            padding: '1px 5px', borderRadius: 20,
                            background: `${b.color}20`, color: b.color,
                            border: `1px solid ${b.color}40`,
                          }}>
                            {b.icon} {b.label}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Barra de cobertura + forma recente */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ height: 3, width: 60, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 2,
                            width: `${coveragePct}%`,
                            background: coveragePct >= 80 ? 'var(--win)' : coveragePct >= 50 ? 'var(--accent)' : 'var(--lose)',
                          }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)' }}>
                          {member.total_bets || 0}/{effectiveTotal}
                        </span>
                      </div>
                      {member.recent_form?.length > 0 && <FormDots form={member.recent_form} />}
                    </div>
                  </div>
                  <div className="group-member-row__pts">
                    <span className="group-member-row__pts-pos">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`}
                    </span>
                    <span className="group-member-row__pts-val">{member.total_points ?? 0}pts</span>
                    {member.exact_scores > 0 && (
                      <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)' }}>
                        {member.exact_scores} exatos
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {sortedMembers.length > 4 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', marginTop: 'var(--s2)', fontSize: 12 }}
              onClick={() => setShowAllMembers(v => !v)}
            >
              {showAllMembers ? '▲ Ver menos' : `▼ Ver todos (${sortedMembers.length})`}
            </button>
          )}
        </section>

        {/* Invite link section */}
        <section className="group-manager-section group-manager-section--link">
          <div className="group-manager-section__header">
            <h3>Link de convite</h3>
            {isOwner && <span>Admin</span>}
          </div>
          {!inviteLink ? (
            isOwner ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={generateLink} disabled={linkLoading}>
                {linkLoading ? 'Gerando...' : '🔗 Gerar link de convite'}
              </button>
            ) : (
              <p className="group-tool-note">Nenhum link ativo. Solicite ao dono do grupo.</p>
            )
          ) : (
            <div className="group-link-row">
              <input readOnly value={inviteLink} className="group-link-row__input" />
              <button type="button" className="btn btn-primary btn-sm" onClick={shareLink}>
                {copied ? '✓' : '📤'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink} title="Copiar">
                📋
              </button>
            </div>
          )}
        </section>

        {/* Pending invites */}
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
                    <span className="pending-invite-row__email">{maskEmail(invite.invitee_email)}</span>
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

        {/* Invite tools (owner only) */}
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
                        <span style={{ color: 'var(--text-4)', fontSize: 11 }}>{result.email_masked}</span>
                      </div>
                      <button type="button" className="btn btn-primary btn-sm" disabled={inviting} onClick={() => inviteUser(result.id, null)}>Convidar</button>
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

        {!isOwner && msg && (
          <div className={`group-tool-message ${msg.startsWith('✓') ? 'is-success' : 'is-error'}`} style={{ marginTop: 'var(--s3)' }}>{msg}</div>
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
  return name.split(' ').filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function maskEmail(email = '') {
  if (!email || !email.includes('@')) return '***'
  const [local, domain] = email.split('@')
  const maskedLocal = local[0] + '*'.repeat(Math.min(local.length - 1, 4))
  const parts = domain.split('.')
  const maskedDomain = parts[0][0] + '*'.repeat(Math.max(parts[0].length - 1, 1)) + '.' + parts.slice(1).join('.')
  return `${maskedLocal}@${maskedDomain}`
}
