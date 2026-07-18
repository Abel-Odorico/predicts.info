import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { api } from '../api'
import { toast } from '../toast'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import { COMPETITIONS, COMPETITION_LABEL } from '../utils/competitions'
import { aproveitamento, getBadges, BADGE_CATALOG } from '../utils/groupBadges'
import { displayName } from '../utils/displayName'
import RankingNameToggle from '../components/RankingNameToggle'
import MedalIcon from '../components/MedalIcon'

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

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
  const [activeGroupId, setActiveGroupId] = useState(() => {
    const v = Number(localStorage.getItem('ug_active'))
    return Number.isFinite(v) && v > 0 ? v : null
  })
  const [comp, setComp] = useState('geral')
  const [todayRanking, setTodayRanking] = useState([])
  const [siteRank, setSiteRank] = useState(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherQuery, setSwitcherQuery] = useState('')
  const switcherRef = useRef(null)

  useEffect(() => {
    if (!switcherOpen) return
    function onClick(e) { if (switcherRef.current && !switcherRef.current.contains(e.target)) setSwitcherOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setSwitcherOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [switcherOpen])

  async function loadGroups() {
    if (!token) return
    setLoading(true)
    try {
      // "geral" soma pontos entre competições — progresso de jogos não faz sentido
      // misturado (Copa e Brasileirão têm calendários e tamanhos bem diferentes).
      const reqs = [api.get(`/user-groups?competition=${comp}`, token)]
      if (comp !== 'geral') reqs.push(api.get(`/matches?competition=${comp}`))
      const [response, matches] = await Promise.all(reqs)
      setData(response)
      if (matches) {
        const finished = matches.filter(m => m.status === 'finished').length
        setMatchStats({ finished, total: matches.length })
      } else {
        setMatchStats({ finished: 0, total: 0 })
      }
    } catch (e) {
      setCreateMsg(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadGroups() }, [token, comp])

  // "Em Alta hoje" — mesma fonte que GroupRanking.jsx usa (ranking global do dia,
  // filtrado por membro em cada card), pra badge nunca divergir entre as duas telas.
  useEffect(() => {
    if (!token) return
    const now = new Date()
    const p = n => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
    api.get(`/ranking?date_from=${today}&date_to=${today}&limit=100`, token)
      .then(setTodayRanking)
      .catch(() => setTodayRanking([]))
  }, [token])

  // Posição ATUAL do usuário no ranking do SITE (não dos bolões) — respeita a
  // aba de competição selecionada, refaz sempre que trocar de aba.
  useEffect(() => {
    if (!token) return
    api.get(`/ranking/me?competition=${comp}`, token)
      .then(setSiteRank)
      .catch(() => setSiteRank(null))
  }, [token, comp])

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

  const namePref = user?.ranking_display_pref === 'username' ? 'username' : 'name'
  const groups = data.groups ?? []
  const pendingInvites = data.pending_invites ?? []
  const nextMatch = data.next_match ?? null
  const myBetNext = data.my_bet_next ?? false
  const totalMembers = groups.reduce((sum, g) => sum + (g.members?.length ?? 0), 0)
  const totalGroupInvites = groups.reduce((sum, g) => sum + (g.pending_invites?.length ?? 0) + (g.pending_join_requests?.length ?? 0), 0)
  const totalConvites = pendingInvites.length + totalGroupInvites

  // Grupo em foco: respeita seleção salva; cai no 1º se inválida.
  const activeGroup = groups.find(g => g.id === activeGroupId) || groups[0] || null
  const selectGroup = id => { setActiveGroupId(id); localStorage.setItem('ug_active', String(id)) }

  // Melhor posição real do usuário entre os bolões que participa (dado da API, não decorativo)
  const myBestRank = groups.reduce((best, g) => {
    const sorted = [...(g.members ?? [])].sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0))
    const pos = sorted.findIndex(m => m.user_id === user?.id) + 1
    if (pos > 0 && (best === null || pos < best)) return pos
    return best
  }, null)
  const bestRankMedal = myBestRank === 1 ? '🥇' : myBestRank === 2 ? '🥈' : myBestRank === 3 ? '🥉' : null

  // Posição ATUAL no ranking do site (não dos bolões) — respeita a aba `comp`
  const siteRankPos = siteRank?.position ?? null
  const siteRankTop3 = siteRankPos !== null && siteRankPos <= 3

  return (
    <div className="page">
      <div className="page-hero groups-hero fade-in-1">
        <div className="groups-hero__top">
          <div className="page-hero__main">
            <div className="page-hero__icon">🏆</div>
            <div className="page-hero__text">
              <h1 className="page-hero__title groups-hero__title">Meus Grupos</h1>
              <div className="page-hero__subtitle">Seus bolões privados, num só lugar</div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary groups-hero__cta"
            onClick={() => { setShowCreateForm(v => !v); setCreateMsg('') }}
            aria-expanded={showCreateForm}
          >
            <span className="groups-hero__cta-icon">{showCreateForm ? '✕' : '+'}</span>
            {showCreateForm ? 'Cancelar' : 'Criar bolão'}
          </button>
        </div>

        <div className="groups-hero__stats">
          <div className="groups-stat-card fade-in-1">
            <span className="groups-stat-card__icon">🏆</span>
            <span className="groups-stat-card__value">{groups.length}</span>
            <span className="groups-stat-card__label">{groups.length === 1 ? 'Bolão' : 'Bolões'}</span>
          </div>
          <div className="groups-stat-card fade-in-2">
            <span className="groups-stat-card__icon">👥</span>
            <span className="groups-stat-card__value">{totalMembers}</span>
            <span className="groups-stat-card__label">{totalMembers === 1 ? 'Membro' : 'Membros'}</span>
          </div>
          <div className={`groups-stat-card fade-in-3${totalConvites > 0 ? ' groups-stat-card--alert' : ''}`}>
            <span className="groups-stat-card__icon">✉️</span>
            <span className="groups-stat-card__value">{totalConvites}</span>
            <span className="groups-stat-card__label">{totalConvites === 1 ? 'Convite' : 'Convites'}</span>
          </div>
          <div className={`groups-stat-card groups-stat-card--best${bestRankMedal ? ' groups-stat-card--medal' : ' fade-in-4'}`}>
            <span className="groups-stat-card__icon">
              {myBestRank && myBestRank <= 3 ? <MedalIcon rank={myBestRank} size={24} /> : '🎖️'}
            </span>
            <span className="groups-stat-card__value">{myBestRank ? `${myBestRank}º` : '–'}</span>
            <span className="groups-stat-card__label">Melhor posição · bolões</span>
          </div>
          <div className={`groups-stat-card groups-stat-card--best${siteRankTop3 ? ' groups-stat-card--rank-medal' : ' fade-in-5'}`}>
            <span className="groups-stat-card__icon">
              {siteRankTop3 ? <MedalIcon rank={siteRankPos} size={24} /> : '📊'}
            </span>
            <span className="groups-stat-card__value">{siteRankPos ? `${siteRankPos}º` : '–'}</span>
            <span className="groups-stat-card__label">Posição · ranking {COMPETITION_LABEL[comp]}</span>
          </div>
        </div>
      </div>

      <div className="phase-nav groups-comp-nav fade-in-2">
        {COMPETITIONS.map(c => (
          <button key={c.id} type="button" className={`phase-nav__tab ${comp === c.id ? 'active' : ''}`} onClick={() => setComp(c.id)}>{c.emoji} {c.label}</button>
        ))}
      </div>
      {comp === 'geral' && (
        <p className="groups-comp-note">
          Soma bruta dos pontos entre competições — só curiosidade, sem pódio oficial de nenhuma delas.
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }} className="fade-in-2">
        <RankingNameToggle />
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
                  <span>Convite enviado por {invite.inviter_name ? displayName({ name: invite.inviter_name, username: invite.inviter_username }, namePref) : 'usuário'}</span>
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
        <>
          {groups.length > 1 && (() => {
            const withMeta = groups.map(group => {
              const members = group.members?.length ?? 0
              const sorted = [...(group.members ?? [])].sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0))
              const pos = sorted.findIndex(m => m.user_id === user?.id) + 1
              const invites = (group.pending_invites?.length ?? 0) + (group.pending_join_requests?.length ?? 0)
              return { group, members, pos, invites }
            })
            const totalInvites = withMeta.reduce((sum, g) => sum + g.invites, 0)
            const activeMeta = withMeta.find(g => g.group.id === activeGroup?.id)
            const q = switcherQuery.trim().toLowerCase()
            const filtered = q ? withMeta.filter(g => g.group.name.toLowerCase().includes(q)) : withMeta

            return (
              <div className="groups-switcher-dd fade-in-3" ref={switcherRef}>
                <button
                  type="button"
                  className="groups-switcher-dd__trigger"
                  onClick={() => setSwitcherOpen(o => !o)}
                  aria-expanded={switcherOpen}
                  aria-haspopup="listbox"
                >
                  <span className="groups-switcher-dd__trigger-icon">🏆</span>
                  <span className="groups-switcher-dd__trigger-text">
                    <span className="groups-switcher-dd__trigger-name">{activeGroup?.name}</span>
                    <span className="groups-switcher-dd__trigger-meta">
                      {activeMeta?.members} membro{activeMeta?.members !== 1 ? 's' : ''}
                      {activeMeta?.pos > 0 && <> · {activeMeta.pos}º</>}
                      {' '}· {groups.length} bolões no total
                    </span>
                  </span>
                  {totalInvites > 0 && <span className="groups-switcher-dd__trigger-badge">{totalInvites}</span>}
                  <span className={`groups-switcher-dd__chevron${switcherOpen ? ' is-open' : ''}`}>▾</span>
                </button>

                {switcherOpen && (
                  <div className="groups-switcher-dd__panel" role="listbox">
                    {groups.length > 6 && (
                      <input
                        type="text"
                        className="groups-switcher-dd__search"
                        placeholder="Buscar bolão..."
                        value={switcherQuery}
                        onChange={e => setSwitcherQuery(e.target.value)}
                        autoFocus
                      />
                    )}
                    <div className="groups-switcher-dd__list">
                      {filtered.length === 0 && (
                        <div className="groups-switcher-dd__empty">Nenhum bolão encontrado</div>
                      )}
                      {filtered.map(({ group, members, pos, invites }) => {
                        const active = group.id === activeGroup?.id
                        return (
                          <button
                            key={group.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            className={`groups-switcher-dd__row${active ? ' is-active' : ''}`}
                            onClick={() => { selectGroup(group.id); setSwitcherOpen(false); setSwitcherQuery('') }}
                          >
                            <span className="groups-switcher-dd__row-name">{group.name}</span>
                            <span className="groups-switcher-dd__row-meta">
                              {members} membro{members !== 1 ? 's' : ''}
                              {pos > 0 && <> · {pos}º</>}
                            </span>
                            {invites > 0 && <span className="groups-switcher-dd__row-badge">{invites}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          <section className="groups-list-grid fade-in-3" aria-label="Grupo selecionado">
            {activeGroup && (
              <UserGroupCard
                key={activeGroup.id}
                group={activeGroup}
                token={token}
                currentUser={user}
                onRefresh={loadGroups}
                matchStats={matchStats}
                nextMatch={nextMatch}
                myBetNext={myBetNext}
                comp={comp}
                todayRanking={todayRanking}
                namePref={namePref}
              />
            )}
          </section>
        </>
      )}
    </div>
  )
}

function UserGroupCard({ group, token, currentUser, onRefresh, matchStats = { finished: 0, total: 0 }, nextMatch = null, myBetNext = false, comp = 'geral', todayRanking = [], namePref = 'name' }) {
  const isOwner = group.owner_user_id === currentUser?.id
  const myEntry = (group.members ?? []).find(m => m.user_id === currentUser?.id)
  const myPoints = myEntry?.total_points ?? 0
  const myExact = myEntry?.exact_scores ?? 0

  const sortedMembers = [...(group.members ?? [])].sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0))
  const myPosition = sortedMembers.findIndex(m => m.user_id === currentUser?.id) + 1

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [email, setEmail] = useState('')
  const [searching, setSearching] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(group.name)
  const [savingName, setSavingName] = useState(false)
  const [cancellingId, setCancellingId] = useState(null)
  const [reqActionId, setReqActionId] = useState(null)
  const [removingMemberId, setRemovingMemberId] = useState(null)
  const [showAllMembers, setShowAllMembers] = useState(false)
  const [expandedMemberId, setExpandedMemberId] = useState(null)
  const [inviteLink, setInviteLink] = useState(
    group.invite_token ? `${window.location.origin}/bolao/${group.invite_token}` : ''
  )
  const [linkLoading, setLinkLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Link pessoal (?by=<meu_id>) — cada membro rastreia quem entrou via SEU compartilhamento,
  // mesmo token de convite pra todos, atribuição só muda o parâmetro
  const personalLink = inviteLink && currentUser?.id ? `${inviteLink}?by=${currentUser.id}` : inviteLink
  const signupLink = group.invite_token && currentUser?.id
    ? `${window.location.origin}/entrar?join=${group.invite_token}&by=${currentUser.id}`
    : ''
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [signupQrDataUrl, setSignupQrDataUrl] = useState('')
  const [enlargedQr, setEnlargedQr] = useState(null) // null | 'invite' | 'signup'

  // position:fixed dentro de um ancestral com scroll/transform fica preso ao offset
  // dele em vez do viewport (bug clássico mobile) — portal pro body + lock de scroll
  // garante centralização real na tela, mesmo card rolado
  useEffect(() => {
    if (!enlargedQr) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [enlargedQr])

  useEffect(() => {
    if (!personalLink) { setQrDataUrl(''); return }
    QRCode.toDataURL(personalLink, { width: 260, margin: 1, color: { dark: '#0c1a2a', light: '#f5f7fb' } })
      .then(setQrDataUrl).catch(() => {})
  }, [personalLink])

  useEffect(() => {
    if (!signupLink) { setSignupQrDataUrl(''); return }
    QRCode.toDataURL(signupLink, { width: 260, margin: 1, color: { dark: '#0c1a2a', light: '#f5f7fb' } })
      .then(setSignupQrDataUrl).catch(() => {})
  }, [signupLink])

  const visibleMembers = showAllMembers ? sortedMembers : sortedMembers.slice(0, 4)
  const extraMembers = Math.max(sortedMembers.length - 4, 0)

  const [shared, setShared] = useState('')

  // Badges/highlights: mesma fonte canônica do GroupRanking.jsx (detalhe do grupo) —
  // evita o card mostrar líder/streak/destaque diferente do que a página de detalhe mostra
  // pro mesmo grupo. `highlightsData` vem do backend (streaks reais, mural); `todayTop`
  // vem do ranking global do dia (mesma chamada que GroupRanking faz), filtrado aos membros.
  const [highlightsData, setHighlightsData] = useState(null)
  useEffect(() => {
    if (!token || comp === 'geral') { setHighlightsData(null); return }
    api.get(`/user-groups/${group.id}/highlights?competition=${comp}`, token)
      .then(setHighlightsData)
      .catch(() => setHighlightsData(null))
  }, [group.id, token, comp])

  const memberIds = new Set(sortedMembers.map(m => m.user_id))
  const groupToday = todayRanking.filter(r => memberIds.has(r.user_id)).sort((a, b) => b.total_points - a.total_points)
  const todayTop = groupToday[0] || null
  const streakMap = Object.fromEntries((highlightsData?.streaks ?? []).map(s => [s.user_id, s.streak]))
  const muralHeroName = highlightsData?.top_bets?.[0]?.user_name
  const topBet = highlightsData?.top_bets?.[0]

  // Raio-X do grupo (tudo derivado dos membros — sem chamada extra à API)
  const gStats = (() => {
    const sum = k => sortedMembers.reduce((a, m) => a + (m[k] || 0), 0)
    const points = sum('total_points')
    const bets = sum('total_bets')
    const exacts = sum('exact_scores')
    const correct = sum('correct_results')
    const members = sortedMembers.length
    return {
      points, bets, exacts, correct, members,
      exactRate: bets > 0 ? Math.round((exacts / bets) * 100) : 0,
      avgPoints: members > 0 ? Math.round(points / members) : 0,
      efficiency: bets > 0 ? Math.round((points / (bets * 25)) * 100) : 0,
    }
  })()

  const cardEffectiveTotal = Math.max(matchStats.finished, ...sortedMembers.map(m => m.total_bets || 0), 1)
  const memberBadges = sortedMembers.map((m, i) => getBadges(
    m, i + 1, cardEffectiveTotal,
    todayTop?.user_id === m.user_id, streakMap[m.user_id] || 0, muralHeroName === m.name,
  ))
  const holderOf = icon => {
    const i = memberBadges.findIndex(bs => bs.some(b => b.icon === icon))
    return i === -1 ? null : sortedMembers[i]
  }
  const myBadgeIcons = new Set(
    (memberBadges[sortedMembers.findIndex(m => m.user_id === currentUser?.id)] ?? []).map(b => b.icon)
  )
  const badgeHolderCount = {}
  memberBadges.forEach(bs => bs.forEach(b => { badgeHolderCount[b.icon] = (badgeHolderCount[b.icon] || 0) + 1 }))
  const highlights = (() => {
    const out = []
    const lead = holderOf('🏆')
    if (lead) out.push({ icon: '🏆', label: 'Líder', m: lead, val: `${lead.total_points} pts`, color: '#e8a030' })
    const sniper = holderOf('🎯')
    if (sniper) out.push({ icon: '🎯', label: 'Sniper', m: sniper, val: `${Math.round((sniper.exact_scores / sniper.total_bets) * 100)}% exatos`, color: '#e85252' })
    const mara = holderOf('⚡')
    if (mara) out.push({ icon: '⚡', label: 'Maratonista', m: mara, val: `${mara.total_bets} palpites`, color: '#9b5de8' })
    const preciso = holderOf('🔮')
    if (preciso) out.push({ icon: '🔮', label: 'Preciso', m: preciso, val: `${aproveitamento(preciso)}% eficiência`, color: '#4a90e8' })
    if (todayTop) out.push({ icon: '🔥', label: 'Em Alta', m: todayTop, val: `+${todayTop.total_points} pts hoje`, color: 'var(--win)' })
    const streaker = holderOf('🔗')
    if (streaker) out.push({ icon: '🔗', label: 'Sequência', m: streaker, val: `${streakMap[streaker.user_id]} seguidos`, color: '#0fa896' })
    if (topBet) {
      const bold = sortedMembers.find(m => m.name === topBet.user_name)
      if (bold) out.push({ icon: '🎲', label: 'Ousado', m: bold, val: `${topBet.score_a}–${topBet.score_b}`, color: '#e8a030' })
    }
    return out
  })()

  async function shareGroup() {
    const lead = sortedMembers[0]
    const text = [
      `🏆 ${group.name} — Bolão ${COMPETITION_LABEL[comp] ?? 'Predicts'}`,
      lead ? `👑 Líder: ${lead.name} (${lead.total_points} pts)` : '',
      `👥 ${gStats.members} membros · 🎯 ${gStats.exacts} placares exatos · 📊 ${gStats.bets} palpites`,
      `⭐ ${gStats.points} pts no total · aproveitamento ${gStats.efficiency}%`,
      personalLink ? `Entre no bolão: ${personalLink}` : `Jogue em ${window.location.origin}`,
    ].filter(Boolean).join('\n')
    try {
      if (navigator.share) { await navigator.share({ title: group.name, text }); setShared('✓ Compartilhado') }
      else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); setShared('✓ Copiado') }
      else setShared('Copie o texto')
    } catch (e) { if (e?.name !== 'AbortError') setShared('✗ Falhou') }
    setTimeout(() => setShared(''), 2500)
  }

  async function deleteGroup() {
    if (!window.confirm(`Excluir o grupo "${group.name}"? Esta ação não pode ser desfeita.`)) return
    setDeleting(true)
    try {
      await api.delete(`/user-groups/${group.id}`, token)
      onRefresh()
    } catch (e) {
      toast.error(e.message)
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
      toast.error(e.message)
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
      toast.success('Nome do grupo atualizado.')
      onRefresh()
    } catch (e) {
      toast.error(e.message)
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
      toast.error(e.message)
    } finally {
      setLinkLoading(false)
    }
  }

  async function copyLink() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(personalLink)
      } else {
        const el = document.createElement('textarea')
        el.value = personalLink
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Link copiado!')
    } catch {
      toast.error('Não foi possível copiar o link.')
    }
  }

  async function shareLink() {
    if (navigator.share) {
      await navigator.share({ title: group.name, text: `Entre no meu bolão: ${group.name}`, url: personalLink })
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
      toast.success('Convite cancelado.')
      onRefresh()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setCancellingId(null)
    }
  }

  async function approveJoinRequest(requestId) {
    if (!window.confirm('Aceitar esse pedido de entrada no grupo?')) return
    setReqActionId(requestId)
    try {
      await api.post(`/user-groups/${group.id}/join-requests/${requestId}/approve`, {}, token)
      toast.success('Pedido aceito.')
      onRefresh()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setReqActionId(null)
    }
  }

  async function removeMember(targetUserId, name) {
    if (!window.confirm(`Remover ${name} do grupo? Essa ação não pode ser desfeita.`)) return
    setRemovingMemberId(targetUserId)
    try {
      await api.delete(`/user-groups/${group.id}/members/${targetUserId}`, token)
      toast.success('Membro removido.')
      onRefresh()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setRemovingMemberId(null)
    }
  }

  async function rejectJoinRequest(requestId) {
    if (!window.confirm('Recusar esse pedido de entrada? Essa ação não pode ser desfeita.')) return
    setReqActionId(requestId)
    try {
      await api.post(`/user-groups/${group.id}/join-requests/${requestId}/reject`, {}, token)
      toast.success('Pedido recusado.')
      onRefresh()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setReqActionId(null)
    }
  }

  async function inviteByEmail(e) {
    e.preventDefault()
    if (!email.trim()) return
    setInviting(true)
    try {
      await api.post(`/user-groups/${group.id}/invites`, { email }, token)
      setEmail('')
      setQuery('')
      setResults([])
      toast.success('Convite enviado.')
      onRefresh()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setInviting(false)
    }
  }

  async function inviteUser(userId) {
    setInviting(true)
    try {
      await api.post(`/user-groups/${group.id}/invites`, { user_id: userId }, token)
      setQuery('')
      setResults([])
      toast.success('Convite enviado.')
      onRefresh()
    } catch (e) {
      toast.error(e.message)
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
  const joinRequests = group.pending_join_requests ?? []
  const emailInvites = group.pending_invites
  const pendingTotal = joinRequests.length + emailInvites.length

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
              <div className="group-manager-card__title-row">
                <h2 className="group-manager-card__title">{group.name}</h2>
                {isOwner && <span className="group-manager-card__owner-chip">Dono</span>}
              </div>
            </>
          )}
        </div>
        <div className="group-manager-card__actions">
          <Link to={`/meus-grupos/${group.id}`} className="btn btn-primary btn-sm group-manager-card__rank-btn">🏆 Ranking</Link>
          {isOwner && !renaming && (
            <button type="button" className="group-manager-card__icon-btn" onClick={() => setRenaming(true)} title="Editar nome" aria-label="Editar nome do bolão">
              ✏️
            </button>
          )}
          {isOwner && !renaming && (
            <button type="button" className="group-manager-card__icon-btn group-manager-card__icon-btn--danger" onClick={deleteGroup} disabled={deleting} title="Excluir bolão" aria-label={`Excluir ${group.name}`}>
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
        <div style={{ padding: 'var(--s4) var(--s4) var(--s3)', display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          {sortedMembers.slice(0, 3).map((m, i) => (
            <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--bg-overlay)', borderRadius: 20, padding: '3px 10px 3px 6px' }}>
              <MedalIcon rank={i + 1} size={16} />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(m, namePref)}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'var(--accent)', fontWeight: 700 }}>{m.total_points}</span>
            </div>
          ))}
        </div>
      )}

      {/* Alerta próximo jogo — backend já escopa nextMatch pela competição selecionada */}
      {comp !== 'geral' && nextMatch && !myBetNext && (
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

      {/* ── StatPills ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)' }}>
        <StatPill icon="👥" label="Participantes" value={sortedMembers.length} />
        {comp !== 'geral' && <StatPill icon="⚽" label="Realizados" value={`${matchStats.finished}/${matchStats.total}`} />}
        {comp !== 'geral' && <StatPill icon="⏳" label="Pendentes" value={matchStats.total - matchStats.finished} />}
        <StatPill icon="📈" label="Eficiência" value={`${gStats.efficiency}%`} sub={`${gStats.bets} palpites no total`} />
        <StatPill icon="🎯" label="Exatos" value={gStats.exacts} sub={`${gStats.exactRate}% taxa`} />
        <StatPill icon="🧮" label="Média/membro" value={`${gStats.avgPoints} pts`} />
      </div>

      {/* ── Barra XP ── */}
      <div className="group-xp-bar" style={{ margin: '0 var(--s4) var(--s3)' }}>
        <div className="group-xp-bar__header">
          <span className="group-xp-bar__label">Nível do grupo</span>
          <span className="group-xp-bar__level">⚡ Nível {groupLevel} · {groupXp % 500}/500 XP</span>
        </div>
        <div className="group-xp-bar__track">
          <div className="group-xp-bar__fill" style={{ width: `${xpPct}%` }} />
        </div>
      </div>

      {/* ── Highlight cards ── */}
      {highlights.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--s3)', padding: '0 var(--s4) var(--s4)' }}>
          {highlights.map(h => (
            <Link
              key={h.label}
              to={`/usuarios/${h.m.user_id}/historico`}
              style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', background: 'var(--bg-raised)', borderRadius: 12, border: '1px solid var(--border)', borderTop: `3px solid ${h.color ?? 'var(--accent)'}`, textDecoration: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 15 }}>{h.icon}</span>
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: h.color ?? 'var(--accent)' }}>{h.label}</span>
              </div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(h.m, namePref)}</div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-2)' }}>{h.val}</div>
            </Link>
          ))}
          <button
            type="button"
            onClick={shareGroup}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', background: 'var(--bg-raised)', borderRadius: 12, border: '1px solid var(--border)', borderTop: '3px solid var(--accent)', cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 15 }}>🔗</span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)' }}>Compartilhar</span>
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: shared ? 'var(--win)' : 'var(--text-1)' }}>{shared || 'Enviar ranking →'}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>WhatsApp / nativo</div>
          </button>
        </div>
      )}

      {/* ── Legenda: o que significa cada badge ── */}
      {comp !== 'geral' && (
        <div style={{ margin: '0 var(--s4) var(--s4)', padding: 'var(--s4) var(--s5)', background: 'var(--bg-raised)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
            🏅 O que significa cada badge {myBadgeIcons.size > 0 && <span style={{ color: 'var(--accent)' }}>· você tem {myBadgeIcons.size}</span>}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {BADGE_CATALOG.map(b => {
              const unlocked = myBadgeIcons.has(b.icon)
              const holders = badgeHolderCount[b.icon] || 0
              return (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, background: unlocked ? `${b.color}18` : 'var(--bg-overlay)', border: `1px solid ${unlocked ? `${b.color}50` : 'var(--border)'}`, opacity: unlocked ? 1 : 0.55 }}>
                  <span style={{ fontSize: 18 }}>{b.icon}</span>
                  <div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: unlocked ? b.color : 'var(--text-1)' }}>
                      {b.label} {unlocked && '✓'}
                    </div>
                    <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-2)' }}>{b.desc}</div>
                    {holders > 0 && (
                      <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-3)', marginTop: 1 }}>{holders} do grupo já tem</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="group-manager-card__body">
        {/* Members section */}
        <section className="group-manager-section">
          <div className="group-manager-section__header">
            <h3>Membros</h3>
            {extraMembers > 0 && !showAllMembers && <span>+{extraMembers}</span>}
          </div>
          <div className="group-member-preview">
            {visibleMembers.map((member, i) => {
              const effectiveTotal = cardEffectiveTotal
              const coveragePct = effectiveTotal > 0 ? Math.min(100, Math.round((member.total_bets || 0) / effectiveTotal * 100)) : 0
              const badges = memberBadges[i]
              const aprv = aproveitamento(member)
              const isExpanded = expandedMemberId === member.user_id
              const leaderPts = sortedMembers[0]?.total_points ?? 0
              const leaderDiff = i > 0 ? leaderPts - (member.total_points ?? 0) : 0
              const erros = Math.max(0, (member.total_bets || 0) - (member.exact_scores || 0) - (member.correct_results || 0))
              return (
                <div key={member.user_id}>
                  <div
                    className={`group-member-row${member.user_id === currentUser?.id ? ' group-member-row--me' : ''}`}
                    onClick={() => setExpandedMemberId(isExpanded ? null : member.user_id)}
                    style={{ cursor: 'pointer', userSelect: 'none', background: isExpanded ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-raised))' : undefined }}
                  >
                    <div className="group-member-row__avatar">{getInitials(member.name)}</div>
                    <div className="group-member-row__identity" style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayName(member, namePref)}{member.user_id === currentUser?.id ? ' (você)' : ''}
                        </strong>
                        {member.is_owner && <span className="badge badge-group" style={{ fontSize: 9 }}>Dono</span>}
                      </div>
                      {badges.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>
                          {badges.map(b => (
                            <span key={b.label} style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 20, background: `${b.color}20`, color: b.color, border: `1px solid ${b.color}40` }}>
                              {b.icon} {b.label}
                            </span>
                          ))}
                        </div>
                      )}
                      {member.invited_by_name && (
                        <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)', marginTop: 2 }}>
                          🔗 indicado por {displayName({ name: member.invited_by_name, username: member.invited_by_username }, namePref)}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <div style={{ height: 3, width: 60, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 2, width: `${coveragePct}%`, background: coveragePct >= 80 ? 'var(--win)' : coveragePct >= 50 ? 'var(--accent)' : 'var(--lose)' }} />
                          </div>
                          <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)' }}>
                            {member.total_bets || 0}/{effectiveTotal}{aprv !== null ? ` · ${aprv}%` : ''}
                          </span>
                        </div>
                        {member.recent_form?.length > 0 && <FormDots form={member.recent_form} />}
                      </div>
                    </div>
                    <div className="group-member-row__pts">
                      <span className="group-member-row__pts-pos">
                        {i < 3 ? <MedalIcon rank={i + 1} size={18} /> : `${i + 1}º`}
                      </span>
                      <span className="group-member-row__pts-val">{member.total_points ?? 0}pts</span>
                      {member.exact_scores > 0 && (
                        <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)' }}>{member.exact_scores} 🎯</span>
                      )}
                      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-4)' }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* ── Expanded member ── */}
                  {isExpanded && (
                    <div className="fade-in-1" style={{ background: 'var(--bg-raised)', borderBottom: '1px solid var(--border)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                        {[
                          { icon: '🎯', label: 'Exatos', val: member.exact_scores || 0, color: 'var(--win)' },
                          { icon: '✅', label: 'Certos', val: member.correct_results || 0, color: 'var(--accent)' },
                          { icon: '❌', label: 'Erros', val: erros, color: 'var(--lose)' },
                          { icon: '📝', label: 'Total', val: member.total_bets || 0, color: 'var(--text-2)' },
                          { icon: '📊', label: 'Aprov.', val: aprv !== null ? `${aprv}%` : '–', color: aprv !== null && aprv >= 50 ? 'var(--win)' : 'var(--text-2)' },
                        ].map(s => (
                          <div key={s.label} style={{ textAlign: 'center', padding: '6px 4px', borderRadius: 8, background: 'var(--bg-surface)' }}>
                            <div style={{ fontFamily: 'var(--font-data)', fontSize: 14, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.val}</div>
                            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, color: 'var(--text-3)', marginTop: 2 }}>{s.icon} {s.label}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-2)' }}>
                          {i === 0
                            ? <span style={{ color: 'var(--win)', fontWeight: 700 }}>👑 Líder do grupo</span>
                            : leaderDiff === 0
                              ? <span style={{ color: 'var(--win)', fontWeight: 700 }}>= empatado com {displayName(sortedMembers[0], namePref)}</span>
                              : <>−<strong style={{ color: 'var(--text-1)' }}>{leaderDiff} pts</strong> para {displayName(sortedMembers[0], namePref)}</>
                          }
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Link
                            to={`/usuarios/${member.user_id}/historico`}
                            onClick={e => e.stopPropagation()}
                            style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: 'var(--bg-overlay)', color: 'var(--accent)', border: '1px solid var(--accent)', textDecoration: 'none' }}
                          >
                            📜 Histórico
                          </Link>
                          {isOwner && !member.is_owner && (
                            <button
                              type="button"
                              disabled={removingMemberId === member.user_id}
                              onClick={e => { e.stopPropagation(); removeMember(member.user_id, displayName(member, namePref)) }}
                              style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: 'color-mix(in srgb, var(--lose) 10%, transparent)', color: 'var(--lose)', border: '1px solid var(--lose)', cursor: 'pointer' }}
                            >
                              {removingMemberId === member.user_id ? '...' : '🚫 Remover'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
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
            <>
              <div className="group-link-row">
                <input readOnly value={inviteLink} className="group-link-row__input" />
                <button type="button" className="btn btn-primary btn-sm" onClick={shareLink}>
                  {copied ? '✓' : '📤'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink} title="Copiar">
                  📋
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`🏆 *${group.name} — Bolão ${COMPETITION_LABEL[comp] ?? 'Predicts'}*\n\nVem disputar comigo no Predicts!\n\n👉 ${personalLink}`)}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                    padding: '9px 0', borderRadius: 8, textDecoration: 'none',
                    background: '#25D366', color: '#fff',
                    fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
                  }}
                >
                  WhatsApp
                </a>
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(personalLink)}&text=${encodeURIComponent(`🏆 ${group.name} — venha disputar no Predicts!`)}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                    padding: '9px 0', borderRadius: 8, textDecoration: 'none',
                    background: '#0088cc', color: '#fff',
                    fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
                  }}
                >
                  Telegram
                </a>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                {qrDataUrl && (
                  <button
                    type="button"
                    onClick={() => setEnlargedQr('invite')}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: 8, cursor: 'zoom-in' }}
                  >
                    <img src={qrDataUrl} alt="QR do link de convite" style={{ width: '100%', maxWidth: 96, borderRadius: 6 }} />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>🔍 QR do convite</span>
                  </button>
                )}
                {signupQrDataUrl && (
                  <button
                    type="button"
                    onClick={() => setEnlargedQr('signup')}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: 8, cursor: 'zoom-in' }}
                  >
                    <img src={signupQrDataUrl} alt="QR direto para cadastro" style={{ width: '100%', maxWidth: 96, borderRadius: 6 }} />
                    <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>🔍 QR → cadastro direto</span>
                  </button>
                )}
              </div>
              <p className="group-tool-note" style={{ marginTop: 6 }}>
                O QR do convite leva pra tela do bolão; o QR de cadastro pula direto pro formulário de criar conta. Toque pra ampliar.
              </p>
            </>
          )}
        </section>

        {enlargedQr && createPortal(
          <div
            onClick={() => setEnlargedQr(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(3,8,14,0.82)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: 360 }}
            >
              <img
                src={enlargedQr === 'invite' ? qrDataUrl : signupQrDataUrl}
                alt={enlargedQr === 'invite' ? 'QR do link de convite ampliado' : 'QR de cadastro direto ampliado'}
                style={{ width: '100%', maxWidth: 280, borderRadius: 8 }}
              />
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', textAlign: 'center' }}>
                {enlargedQr === 'invite' ? 'Escaneie para entrar no bolão' : 'Escaneie para criar conta e já entrar no bolão'}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEnlargedQr(null)}>Fechar</button>
            </div>
          </div>,
          document.body
        )}

        {/* Pending invites + join requests (link de membro que não é o dono, aguarda aprovação) */}
        <section className="group-manager-section group-invites-section">
          <div className="group-manager-section__header">
            <span className="group-manager-card__kicker">Convites pendentes</span>
            <span className="group-invites-count">{pendingTotal}</span>
          </div>
          {pendingTotal === 0 ? (
            <div className="group-invites-empty">Nenhum convite ou pedido pendente por aqui.</div>
          ) : (
            <div className="group-invites-list">
              {joinRequests.map(req => (
                <div key={`req-${req.id}`} className="group-invites-row">
                  <span className="group-invites-avatar group-invites-avatar--request" title="Pedido de entrada via link de membro">🔔</span>
                  <div className="group-invites-content">
                    <span className="group-invites-name">{req.name ? displayName(req, namePref) : req.email_masked}</span>
                    <span className="group-invites-meta">
                      {req.invited_by_name ? `via ${displayName({ name: req.invited_by_name, username: req.invited_by_username }, namePref)}` : 'via link'} · {timeAgo(req.created_at)}
                    </span>
                  </div>
                  {isOwner && (
                    <div className="group-invites-actions">
                      <button
                        type="button"
                        title="Aceitar"
                        disabled={reqActionId === req.id}
                        onClick={() => approveJoinRequest(req.id)}
                        className="group-manager-card__icon-btn group-invites-icon-btn group-invites-icon-btn--approve"
                      >
                        {reqActionId === req.id ? '·' : '✓'}
                      </button>
                      <button
                        type="button"
                        title="Recusar"
                        disabled={reqActionId === req.id}
                        onClick={() => rejectJoinRequest(req.id)}
                        className="group-manager-card__icon-btn group-manager-card__icon-btn--danger group-invites-icon-btn"
                      >
                        {reqActionId === req.id ? '·' : '✕'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {emailInvites.map(invite => (
                <div key={`inv-${invite.id}`} className="group-invites-row">
                  <span className="group-invites-avatar group-invites-avatar--email" title="Convite por email">✉️</span>
                  <div className="group-invites-content">
                    <span className="group-invites-name group-invites-name--data">{maskEmail(invite.invitee_email)}</span>
                    <span className="group-invites-meta">{timeAgo(invite.created_at)}</span>
                  </div>
                  {isOwner && (
                    <div className="group-invites-actions">
                      <button
                        type="button"
                        title="Cancelar convite"
                        disabled={cancellingId === invite.id}
                        onClick={() => cancelInvite(invite.id)}
                        className="group-manager-card__icon-btn group-manager-card__icon-btn--danger group-invites-icon-btn"
                      >
                        {cancellingId === invite.id ? '·' : '✕'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Invite tools (owner only) */}
        {isOwner && (
          <section className="group-manager-section group-manager-section--tools group-tools-section">
            <div className="group-manager-section__header">
              <span className="group-manager-card__kicker">Ferramentas de convite</span>
              <span className="group-manager-card__owner-chip">Admin</span>
            </div>
            <div className="group-tools-body">
              <div className="group-tools-field">
                <label className="form-label" htmlFor={`user-search-${group.id}`}>Buscar usuário</label>
                <input
                  id={`user-search-${group.id}`}
                  type="text"
                  className="form-input"
                  placeholder="Nome ou email"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>
              {searching && <div className="group-tool-note">Buscando usuários...</div>}
              {results.length > 0 && (
                <div className="group-tools-results">
                  {results.map(result => (
                    <div key={result.id} className="group-tools-result-row">
                      <div>
                        <span className="group-tools-result-name">{result.name}</span>
                        <span className="group-tools-result-email">{result.email_masked}</span>
                      </div>
                      <button type="button" className="btn btn-primary btn-sm" disabled={inviting} onClick={() => inviteUser(result.id, null)}>Convidar</button>
                    </div>
                  ))}
                </div>
              )}
              <form onSubmit={inviteByEmail} className="group-tools-field group-tools-invite-form">
                <label className="form-label" htmlFor={`invite-email-${group.id}`}>Convidar por email</label>
                <div className="group-tools-invite-row">
                  <input
                    id={`invite-email-${group.id}`}
                    type="email"
                    className="form-input"
                    placeholder="email@exemplo.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                  <button type="submit" className="btn btn-primary btn-sm" disabled={inviting || !email.trim()}>{inviting ? 'Enviando...' : 'Enviar'}</button>
                </div>
              </form>
            </div>
          </section>
        )}
      </div>
    </article>
  )
}

function StatPill({ icon, label, value, sub, accent }) {
  return (
    <div style={{ background: accent ? 'var(--accent-dim)' : 'var(--bg-raised)', border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent ? 'var(--accent)' : 'var(--text-3)' }}>{icon} {label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: accent ? 'var(--accent)' : 'var(--text-1)', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-2)' }}>{sub}</div>}
    </div>
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

function XrayTile({ icon, value, label }) {
  return (
    <div className="group-xray__tile">
      <span className="group-xray__tile-icon">{icon}</span>
      <span className="group-xray__tile-value">{value}</span>
      <span className="group-xray__tile-label">{label}</span>
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
