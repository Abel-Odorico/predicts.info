import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

const POSITION_STORE_KEY = id => `predicts_group_positions_${id}`

function todayStr() {
  const now = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function aproveitamento(r) {
  if (!r.total_bets) return null
  return Math.round(r.total_points / (r.total_bets * 3) * 100)
}

function getBadges(r, position, effectiveTotal, isHotToday, topStreak, isMuralHero) {
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

function buildShareText(groupName, ranking, finished, total, inviteLink) {
  const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
  const rows = ranking.slice(0, 5).map((r, i) =>
    `${medal(i)} ${r.name} — ${r.total_points} pts (${r.exact_scores} exatos)`
  ).join('\n')
  const link = inviteLink || 'https://predicts.info'
  return `🏆 *${groupName} — Ranking do Bolão*\n\n${rows}\n\n⚽ ${finished}/${total} jogos realizados\n\n🎯 Entre no grupo: ${link}`
}

function loadSavedPositions(groupId) {
  try {
    const raw = localStorage.getItem(POSITION_STORE_KEY(groupId))
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function savePositions(groupId, ranking) {
  try {
    const map = {}
    ranking.forEach((r, i) => { map[r.user_id] = i + 1 })
    localStorage.setItem(POSITION_STORE_KEY(groupId), JSON.stringify({ date: todayStr(), positions: map }))
  } catch {}
}

function useCountdown(targetDateStr) {
  const [time, setTime] = useState({ hours: 0, minutes: 0, seconds: 0, urgent: false })
  const ref = useRef(null)
  useEffect(() => {
    if (!targetDateStr) return
    function tick() {
      const diff = new Date(targetDateStr) - new Date()
      if (diff <= 0) { setTime({ hours: 0, minutes: 0, seconds: 0, urgent: true }); return }
      const totalSec = Math.floor(diff / 1000)
      const hours = Math.floor(totalSec / 3600)
      const minutes = Math.floor((totalSec % 3600) / 60)
      const seconds = totalSec % 60
      setTime({ hours, minutes, seconds, urgent: hours === 0 && minutes < 30 })
    }
    tick()
    ref.current = setInterval(tick, 1000)
    return () => clearInterval(ref.current)
  }, [targetDateStr])
  return time
}

export default function GroupRanking() {
  const { groupId }    = useParams()
  const { token }      = useAuth()

  const [data,         setData]         = useState(null)
  const [matchStats,   setMatchStats]   = useState({ finished: 0, total: 0 })
  const [todayTop,     setTodayTop]     = useState(null)
  const [highlights,   setHighlights]   = useState(null)
  const [prevPositions, setPrevPos]     = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')

  const [inviteLink,   setInviteLink]   = useState('')
  const [linkLoading,  setLinkLoading]  = useState(false)
  const [copied,       setCopied]       = useState(false)

  const [shareOpen,    setShareOpen]    = useState(false)
  const [shareCopied,  setShareCopied]  = useState(false)

  const [renaming,     setRenaming]     = useState(false)
  const [newName,      setNewName]      = useState('')
  const [renameMsg,    setRenameMsg]    = useState('')
  const [savingName,   setSavingName]   = useState(false)
  const [removingId,   setRemovingId]   = useState(null)
  const [duelMember,   setDuelMember]   = useState(null)

  const today = todayStr()

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    const saved = loadSavedPositions(groupId)
    if (saved) setPrevPos(saved.positions)

    Promise.all([
      api.get(`/user-groups/${groupId}/ranking`, token),
      api.get('/matches'),
      api.get(`/ranking?date_from=${today}&date_to=${today}&limit=100`),
      api.get(`/user-groups/${groupId}/highlights`, token).catch(() => null),
    ])
      .then(([groupData, matches, todayRanking, highlightsData]) => {
        setData(groupData)
        const finished = matches.filter(m => m.status === 'finished').length
        setMatchStats({ finished, total: matches.length })
        const memberIds = new Set((groupData.ranking ?? []).map(r => r.user_id))
        const groupToday = todayRanking
          .filter(r => memberIds.has(r.user_id))
          .sort((a, b) => b.total_points - a.total_points)
        setTodayTop(groupToday[0] || null)
        setHighlights(highlightsData)
        savePositions(groupId, groupData.ranking ?? [])
      })
      .catch(err => setError(err.message || 'Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [groupId, token, today])

  useEffect(() => { load() }, [load])

  const nextMatchDate = highlights?.next_match?.match_date
  const countdown = useCountdown(nextMatchDate)

  async function generateLink() {
    setLinkLoading(true)
    try {
      const res = await api.post(`/user-groups/${groupId}/invite-link`, {}, token)
      setInviteLink(`${window.location.origin}/bolao/${res.token}`)
    } catch (e) { setError(e.message) }
    finally { setLinkLoading(false) }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }

  async function shareLink() {
    if (navigator.share) await navigator.share({ title: data?.group_name, text: `Entre no bolão: ${data?.group_name}`, url: inviteLink })
    else copyLink()
  }

  async function saveRename(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setSavingName(true); setRenameMsg('')
    try {
      const res = await api.put(`/user-groups/${groupId}`, { name: newName.trim() }, token)
      setData(d => ({ ...d, group_name: res.name }))
      setRenaming(false)
    } catch (err) { setRenameMsg(`✗ ${err.message}`) }
    finally { setSavingName(false) }
  }

  async function removeMember(userId) {
    if (!window.confirm('Remover este membro do grupo?')) return
    setRemovingId(userId)
    try {
      await api.delete(`/user-groups/${groupId}/members/${userId}`, token)
      setData(d => ({ ...d, ranking: d.ranking.filter(r => r.user_id !== userId) }))
    } catch (err) { setError(err.message) }
    finally { setRemovingId(null) }
  }

  function copyShareText() {
    const text = buildShareText(data.group_name, ranking, matchStats.finished, matchStats.total, inviteLink)
    navigator.clipboard.writeText(text).then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000) })
  }

  function shareWhatsApp() {
    const text = buildShareText(data.group_name, ranking, matchStats.finished, matchStats.total, inviteLink)
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  if (!token) return (
    <div className="page"><div className="bet-empty fade-in-1">
      <p className="page-subtitle">Faça login para ver o ranking do grupo.</p>
      <Link to="/login" className="btn btn-primary btn-lg" style={{ marginTop: 'var(--s6)' }}>Entrar</Link>
    </div></div>
  )

  if (loading) return <Spinner text="Carregando ranking do grupo..." />
  if (error) return (
    <div className="page"><div className="card fade-in-1"><div className="card__body">
      <p className="page-subtitle" style={{ margin: 0 }}>{error}</p>
      <Link to="/meus-grupos" className="btn btn-primary btn-sm mt-4">Voltar</Link>
    </div></div></div>
  )

  const ranking = data?.ranking ?? []
  const amOwner = data?.is_owner === true
  const myEntry = ranking.find(r => r.is_me)
  const leaderPts = ranking[0]?.total_points || 1
  const { finished, total } = matchStats
  const maxBets = ranking.length ? Math.max(...ranking.map(r => r.total_bets)) : 0
  const effectiveTotal = Math.max(finished, maxBets, 1)
  const streakMap = Object.fromEntries((highlights?.streaks ?? []).map(s => [s.user_id, s.streak]))
  const recentForm = highlights?.recent_form ?? {}
  const muralHeroId = highlights?.top_bets?.[0] ? null : null // resolved below
  const muralHeroName = highlights?.top_bets?.[0]?.user_name

  const groupLevel = highlights?.group_level ?? 1
  const groupXp = highlights?.group_xp ?? 0
  const nextLevelXp = highlights?.next_level_xp ?? 500
  const xpPct = Math.min(100, Math.round((groupXp % 500) / 5))

  const topBets = highlights?.top_bets ?? []
  const weeklyRanking = highlights?.weekly_ranking ?? []

  const top3 = ranking.slice(0, 3)

  const padTime = n => String(n).padStart(2, '0')

  return (
    <div className="page">
      {/* ── Cabeçalho ── */}
      <div className="fade-in-1">
        <Link to="/meus-grupos" className="match-breadcrumb__link">‹ Meus Grupos</Link>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap', marginTop: 'var(--s4)' }}>
          <div>
            {renaming ? (
              <form onSubmit={saveRename} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="text" className="form-input" value={newName} autoFocus maxLength={120} onChange={e => setNewName(e.target.value)} style={{ minWidth: 180 }} />
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingName}>{savingName ? '...' : 'Salvar'}</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRenaming(false); setRenameMsg('') }}>Cancelar</button>
                {renameMsg && <span style={{ fontSize: 12, color: 'var(--lose)' }}>{renameMsg}</span>}
              </form>
            ) : (
              <h1 className="page-title">{data?.group_name}</h1>
            )}
            <p className="page-subtitle">{ranking.length} participante{ranking.length !== 1 ? 's' : ''}</p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" style={{ background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700 }} onClick={() => setShareOpen(o => !o)}>
              📤 Compartilhar Ranking
            </button>
            {amOwner && !renaming && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNewName(data?.group_name ?? ''); setRenaming(true) }}>
                ✏️ Renomear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Nível do grupo ── */}
      {groupXp > 0 && (
        <div className="card mt-4 fade-in-1" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: 'var(--s3) var(--s4)', display: 'flex', alignItems: 'center', gap: 'var(--s3)', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)' }}>
                Nível do Grupo
              </span>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--accent)', lineHeight: 1, marginTop: 2 }}>
                ⚡ Nível {groupLevel}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                {groupXp % 500} / 500 XP
              </span>
            </div>
          </div>
          <div style={{ height: 5, background: 'var(--bg-overlay)' }}>
            <div style={{
              height: '100%',
              width: `${xpPct}%`,
              background: 'linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #fff))',
              transition: 'width 800ms cubic-bezier(0.22,1,0.36,1)',
            }} />
          </div>
        </div>
      )}

      {/* ── Compartilhar ── */}
      {shareOpen && (
        <div className="card mt-4 fade-in-1" style={{ padding: 'var(--s4) var(--s5)', borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>Compartilhar Ranking</div>
          <pre style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-2)', background: 'var(--bg-overlay)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
            {buildShareText(data.group_name, ranking, finished, total, inviteLink)}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={shareWhatsApp} style={{ flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: '#25D366', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <WaIcon /> WhatsApp
            </button>
            <button onClick={copyShareText} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, background: shareCopied ? 'var(--win)' : 'transparent', color: shareCopied ? '#fff' : 'var(--text-2)', transition: 'all .2s' }}>
              {shareCopied ? '✓ Copiado!' : '📋 Copiar texto'}
            </button>
          </div>
        </div>
      )}

      {/* ── Stats pills ── */}
      <div className="fade-in-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--s3)', marginTop: 'var(--s6)' }}>
        <StatPill icon="⚽" label="Realizados" value={`${finished}/${total}`} />
        <StatPill icon="⏳" label="Pendentes" value={total - finished} />
        <StatPill icon="👥" label="Participantes" value={ranking.length} />
        {todayTop && <StatPill icon="🔥" label="Em Alta Hoje" value={todayTop.name} sub={`+${todayTop.total_points} pts`} accent />}
      </div>

      {/* ── Próximo jogo + countdown + cobertura ── */}
      {highlights?.next_match && (
        <div className="card mt-4 fade-in-2">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>⏰ Próximo Jogo</span>
            <span className={`countdown-chip${countdown.urgent ? ' countdown-chip--urgent' : ''}`}>
              {countdown.hours > 0
                ? `${padTime(countdown.hours)}h ${padTime(countdown.minutes)}m`
                : `${padTime(countdown.minutes)}m ${padTime(countdown.seconds)}s`
              }
            </span>
          </div>
          <div style={{ padding: 'var(--s3) var(--s4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--s4)', marginBottom: 'var(--s4)' }}>
              <TeamChip t={highlights.next_match.team_a} />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-3)' }}>×</span>
              <TeamChip t={highlights.next_match.team_b} />
            </div>
            <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              {highlights.members_bet_next.length > 0 && (
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--win)', marginBottom: 5 }}>
                    ✓ Apostaram ({highlights.members_bet_next.length})
                  </div>
                  {highlights.members_bet_next.map(m => (
                    <div key={m.user_id} style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', padding: '2px 0' }}>{m.name}</div>
                  ))}
                </div>
              )}
              {highlights.members_no_bet_next.length > 0 && (
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--lose)', marginBottom: 5 }}>
                    ⚠ Faltam apostar ({highlights.members_no_bet_next.length})
                  </div>
                  {highlights.members_no_bet_next.map(m => (
                    <div key={m.user_id} style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', padding: '2px 0' }}>{m.name}</div>
                  ))}
                </div>
              )}
            </div>
            {ranking.length > 0 && (
              <div style={{ marginTop: 'var(--s3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>Cobertura do grupo</span>
                  <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)' }}>
                    {highlights.members_bet_next.length}/{ranking.length}
                  </span>
                </div>
                <div style={{ height: 6, background: 'var(--bg-overlay)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3, transition: 'width 600ms ease',
                    width: `${Math.round(highlights.members_bet_next.length / ranking.length * 100)}%`,
                    background: highlights.members_bet_next.length === ranking.length ? 'var(--win)' : 'var(--accent)',
                  }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Highlights: streaks ── */}
      {highlights?.streaks?.length > 0 && (
        <div className="card mt-4 fade-in-2" style={{ padding: 'var(--s4) var(--s5)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#0fa896', marginBottom: 8 }}>
            🔗 Maior Sequência de Exatos
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--text-1)', lineHeight: 1 }}>
            {highlights.streaks[0].streak}
          </div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>{highlights.streaks[0].name}</div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>consecutivos</div>
        </div>
      )}

      {/* ── Mural de provocações ── */}
      {topBets.length > 0 && (
        <div className="card mt-4 fade-in-2">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>🎲 Mural de Provocações</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>palpites mais ousados</span>
          </div>
          <div className="mural-grid">
            {topBets.map((bet, i) => (
              <div key={i} className={`mural-card mural-card--${i + 1}`}>
                <span className="mural-card__tag">
                  {i === 0 ? '🏅 Mais ousado' : i === 1 ? '2º lugar' : '3º lugar'}
                </span>
                <div className="mural-card__score">{bet.score_a} × {bet.score_b}</div>
                <div className="mural-card__name">{bet.user_name}</div>
                {bet.group && (
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, color: 'var(--text-4)' }}>Grupo {bet.group}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Ranking semanal ── */}
      {weeklyRanking.length > 0 && (
        <div className="card mt-4 fade-in-2">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>📅 Ranking da Semana</span>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>últimos 7 dias</span>
          </div>
          <div className="weekly-ranking">
            {weeklyRanking.slice(0, 5).map((r, i) => (
              <div key={r.user_id} className={`weekly-ranking__row weekly-ranking__row--${i + 1}`}>
                <span className="weekly-ranking__medal">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                </span>
                <span className="weekly-ranking__name">{r.name}</span>
                <span className="weekly-ranking__pts">+{r.pts_week}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Link de convite ── */}
      <div className="card mt-6 fade-in-2" style={{ padding: 'var(--s12) var(--s16)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Link de convite</span>
          {!inviteLink ? (
            <button className="btn btn-primary btn-sm" onClick={generateLink} disabled={linkLoading}>{linkLoading ? 'Gerando...' : '🔗 Gerar link'}</button>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <input readOnly value={inviteLink} style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-data)', fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text-2)' }} />
              <button className="btn btn-primary btn-sm" onClick={shareLink}>{copied ? '✓ Copiado' : '📤 Compartilhar'}</button>
              <button className="btn btn-ghost btn-sm" onClick={copyLink} title="Copiar link">📋</button>
            </div>
          )}
        </div>
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-3)' }}>Qualquer pessoa com o link pode entrar no grupo.</div>
      </div>

      {/* ── Ranking ── */}
      <div className="card mt-4 fade-in-3">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>Classificação do Grupo</span>
        </div>

        {/* Pódio top-3 */}
        {top3.length >= 2 && (
          <div className="group-podium">
            {top3.map((r, i) => (
              <div key={r.user_id} className={`group-podium__slot group-podium__slot--${i + 1}`}>
                <div className="group-podium__avatar">{getInitials(r.name)}</div>
                <div className="group-podium__medal">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</div>
                <div className="group-podium__name" title={r.name}>{r.name}{r.is_me ? ' ★' : ''}</div>
                <div className="group-podium__pts">{r.total_points} pts</div>
                <div className="group-podium__platform" />
              </div>
            ))}
          </div>
        )}

        {myEntry && (
          <div className="group-ranking-hero fade-in-2">
            <div className="group-ranking-hero__pos">
              {myEntry.position === 1 ? '🥇' : myEntry.position === 2 ? '🥈' : myEntry.position === 3 ? '🥉' : `${myEntry.position}º`}
            </div>
            <div className="group-ranking-hero__info">
              <div className="group-ranking-hero__label">Sua posição no grupo</div>
              <div className="group-ranking-hero__name">{myEntry.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)' }}>
                  {myEntry.exact_scores} exatos · {myEntry.correct_results} certos · {myEntry.total_bets} apostas
                  {aproveitamento(myEntry) !== null && ` · ${aproveitamento(myEntry)}% aproveito`}
                </span>
                {recentForm[myEntry.user_id]?.length > 0 && (
                  <FormDots form={recentForm[myEntry.user_id]} />
                )}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="group-ranking-hero__pts">{myEntry.total_points}</div>
              <div className="group-ranking-hero__pts-label">pontos</div>
            </div>
          </div>
        )}

        {ranking.length === 0 ? (
          <div style={{ padding: 'var(--s16)', textAlign: 'center', color: 'var(--text-3)', fontFamily: 'var(--font-cond)' }}>Nenhuma aposta ainda.</div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 52px', gap: 'var(--s2)', padding: '6px var(--s4)', borderBottom: '1px solid var(--border)' }}>
              {['#', 'Participante', 'Pts'].map((h, i) => (
                <span key={h} style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)', textAlign: i === 0 ? 'center' : i === 2 ? 'right' : 'left' }}>{h}</span>
              ))}
            </div>

            {ranking.map((r, i) => {
              const podiumClass = i === 0 ? 'ranking-row--gold' : i === 1 ? 'ranking-row--silver' : i === 2 ? 'ranking-row--bronze' : ''
              const isHotToday = todayTop?.user_id === r.user_id
              const streak = streakMap[r.user_id] || 0
              const isMuralHero = muralHeroName === r.name
              const badges = getBadges(r, i + 1, effectiveTotal, isHotToday, streak, isMuralHero)
              const prevMember = i > 0 ? ranking[i - 1] : null
              const ptsDiff = prevMember ? prevMember.total_points - r.total_points : 0
              const coveragePct = Math.min(100, Math.round(r.total_bets / effectiveTotal * 100))
              const aprv = aproveitamento(r)
              const prevPos = prevPositions?.[r.user_id]
              const curPos = i + 1
              const delta = prevPos && prevPos !== curPos ? prevPos - curPos : 0
              const form = recentForm[r.user_id] ?? []

              return (
                <div
                  key={r.user_id}
                  className={`ranking-row fade-in ${podiumClass}`}
                  style={{ display: 'grid', gridTemplateColumns: '36px 1fr 52px', gap: 'var(--s2)', animationDelay: `${i * 30}ms`, borderLeft: i < 3 ? undefined : r.is_me ? '3px solid var(--accent)' : '3px solid transparent', background: r.is_me && i >= 3 ? 'rgba(15,122,120,0.04)' : undefined }}
                >
                  <div style={{ textAlign: 'center', alignSelf: 'start', paddingTop: 4 }}>
                    <span className={`ranking-row__pos ${i < 3 ? 'ranking-row__pos--top' : ''}`}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    {delta !== 0 && (
                      <div style={{ fontSize: 9, fontFamily: 'var(--font-cond)', fontWeight: 700, color: delta > 0 ? 'var(--win)' : 'var(--lose)', lineHeight: 1, marginTop: 2 }}>
                        {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
                      </div>
                    )}
                  </div>

                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => setDuelMember(duelMember?.user_id === r.user_id ? null : r)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>{r.name}</span>
                      </button>
                      {r.is_me && <span style={{ fontSize: 9, fontFamily: 'var(--font-cond)', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>VOCÊ</span>}
                    </div>
                    {badges.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {badges.map(b => (
                          <span key={b.label} style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: `${b.color}20`, color: b.color, border: `1px solid ${b.color}40` }}>
                            {b.icon} {b.label}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ height: 4, width: 80, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                          <div style={{ height: '100%', borderRadius: 2, width: `${coveragePct}%`, background: coveragePct >= 80 ? 'var(--win)' : coveragePct >= 50 ? 'var(--accent)' : 'var(--lose)', transition: 'width 600ms ease' }} />
                        </div>
                        <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
                          {r.total_bets}/{effectiveTotal}{aprv !== null && ` · ${aprv}%`}
                        </span>
                      </div>
                      {form.length > 0 && <FormDots form={form} />}
                    </div>
                    {prevMember && ptsDiff > 0 && (
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>
                        ▲ faltam <strong style={{ color: 'var(--text-3)' }}>{ptsDiff} pts</strong> para {prevMember.name}
                      </div>
                    )}
                    {prevMember && ptsDiff === 0 && (
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--win)' }}>= empatado com {prevMember.name}</div>
                    )}
                    {duelMember && duelMember.user_id !== r.user_id && myEntry && r.user_id === myEntry.user_id && (
                      <DuelCard me={myEntry} them={duelMember} onClose={() => setDuelMember(null)} />
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--accent)', fontWeight: 700 }}>{r.total_points}</span>
                    <div style={{ width: 36, height: 3, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 2, width: `${leaderPts > 0 ? (r.total_points / leaderPts) * 100 : 0}%`, background: i === 0 ? '#e8a030' : i === 1 ? 'var(--text-3)' : 'var(--accent)', transition: 'width 600ms ease' }} />
                    </div>
                    {amOwner && !r.is_me && (
                      <button type="button" style={{ fontSize: 10, padding: '1px 6px', color: 'var(--lose)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-cond)' }} disabled={removingId === r.user_id} onClick={() => removeMember(r.user_id)}>
                        {removingId === r.user_id ? '...' : '✕'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Duelo modal */}
      {duelMember && myEntry && duelMember.user_id !== myEntry.user_id && (
        <div className="card mt-4 fade-in-1" style={{ borderLeft: '3px solid #9b5de8', padding: 0 }}>
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>⚔️ Duelo Direto</span>
            <button onClick={() => setDuelMember(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 18 }}>×</button>
          </div>
          <DuelCard me={myEntry} them={duelMember} />
        </div>
      )}

      {/* ── Conquistas ── */}
      {ranking.length > 0 && (
        <div className="card mt-4 fade-in-4" style={{ padding: 'var(--s4) var(--s5)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 8 }}>Conquistas</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { icon: '🏆', label: 'Líder', desc: '1º no grupo' },
              { icon: '🎯', label: 'Sniper', desc: '≥28% exatos (mín. 5)' },
              { icon: '💯', label: 'Cem%', desc: 'Apostou em todos os jogos' },
              { icon: '⚡', label: 'Maratonista', desc: '≥85% jogos apostados' },
              { icon: '🔮', label: 'Preciso', desc: '≥60% aproveitamento (mín. 10)' },
              { icon: '🔥', label: 'Em Alta', desc: 'Maior pts hoje no grupo' },
              { icon: '🔗', label: 'Sequência', desc: '≥3 exatos consecutivos' },
              { icon: '🎲', label: 'Ousado', desc: 'Palpite mais audacioso' },
            ].map(b => (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>{b.icon}</span>
                <div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, color: 'var(--text-2)' }}>{b.label}</div>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>{b.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── FormDots ─────────────────────────────────────────────────────────────────
function FormDots({ form }) {
  return (
    <div className="form-dots" title={form.join(' ')}>
      {form.map((f, i) => (
        <div key={i} className={`form-dot form-dot--${f}`} title={f === 'E' ? 'Exato' : f === 'C' ? 'Certo' : 'Errado'} />
      ))}
    </div>
  )
}

// ── Duelo Direto ──────────────────────────────────────────────────────────────
function DuelCard({ me, them, onClose }) {
  const stats = [
    { label: 'Pontos', me: me.total_points, them: them.total_points },
    { label: 'Exatos', me: me.exact_scores, them: them.exact_scores },
    { label: 'Certos', me: me.correct_results, them: them.correct_results },
    { label: 'Apostas', me: me.total_bets, them: them.total_bets },
  ]
  function aprv(r) {
    if (!r.total_bets) return 0
    return Math.round(r.total_points / (r.total_bets * 3) * 100)
  }
  return (
    <div style={{ padding: 'var(--s4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 'var(--s3)', alignItems: 'center', marginBottom: 'var(--s4)' }}>
        <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>{me.name} <span style={{ fontSize: 10, color: 'var(--text-4)' }}>você</span></div>
        <span style={{ fontFamily: 'var(--font-display)', color: 'var(--text-3)', fontSize: 16 }}>VS</span>
        <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: '#9b5de8', textAlign: 'right' }}>{them.name}</div>
      </div>
      {stats.map(s => {
        const meWins = s.me > s.them
        const tie = s.me === s.them
        return (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: meWins ? 'var(--win)' : tie ? 'var(--text-2)' : 'var(--text-3)', textAlign: 'right' }}>{s.me}</div>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: !meWins && !tie ? 'var(--win)' : tie ? 'var(--text-2)' : 'var(--text-3)' }}>{s.them}</div>
          </div>
        )
      })}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: aprv(me) >= aprv(them) ? 'var(--win)' : 'var(--text-3)', textAlign: 'right' }}>{aprv(me)}%</div>
        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Aproveito</span>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 13, fontWeight: 700, color: aprv(them) > aprv(me) ? 'var(--win)' : 'var(--text-3)' }}>{aprv(them)}%</div>
      </div>
    </div>
  )
}

// ── Sub-componentes ────────────────────────────────────────────────────────────
function StatPill({ icon, label, value, sub, accent }) {
  return (
    <div style={{ background: accent ? 'var(--accent-dim)' : 'var(--surface)', border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent ? 'var(--accent)' : 'var(--text-4)' }}>{icon} {label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: accent ? 'var(--accent)' : 'var(--text-1)', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}

function TeamChip({ t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {t?.flag_url && <img src={t.flag_url} alt={t.code} style={{ width: 32, height: 22, objectFit: 'cover', borderRadius: 3 }} />}
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700, color: 'var(--text-1)' }}>{t?.code}</span>
    </div>
  )
}

function getInitials(name = '') {
  return name.split(' ').filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function WaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}
