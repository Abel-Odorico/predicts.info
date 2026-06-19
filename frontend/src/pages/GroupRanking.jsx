import { useState, useEffect, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

function todayStr() {
  const now = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function aproveitamento(r) {
  if (!r.total_bets) return null
  return Math.round(r.total_points / (r.total_bets * 3) * 100)
}

function getBadges(r, position, finishedCount, isHotToday) {
  const badges = []
  if (position === 1) badges.push({ icon: '🏆', label: 'Líder', color: '#e8a030' })
  if (r.total_bets >= 5 && r.exact_scores / r.total_bets >= 0.28)
    badges.push({ icon: '🎯', label: 'Sniper', color: '#e85252' })
  if (finishedCount > 0 && r.total_bets >= finishedCount * 0.85)
    badges.push({ icon: '⚡', label: 'Maratonista', color: '#9b5de8' })
  if (isHotToday) badges.push({ icon: '🔥', label: 'Em Alta', color: 'var(--win)' })
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

export default function GroupRanking() {
  const { groupId }    = useParams()
  const { token }      = useAuth()
  const navigate       = useNavigate()

  const [data,         setData]         = useState(null)
  const [matchStats,   setMatchStats]   = useState({ finished: 0, total: 0 })
  const [todayTop,     setTodayTop]     = useState(null)
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

  const today = todayStr()

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    Promise.all([
      api.get(`/user-groups/${groupId}/ranking`, token),
      api.get('/matches'),
      api.get(`/ranking?date_from=${today}&date_to=${today}&limit=100`),
    ])
      .then(([groupData, matches, todayRanking]) => {
        setData(groupData)
        const finished = matches.filter(m => m.status === 'finished').length
        setMatchStats({ finished, total: matches.length })
        const memberIds = new Set((groupData.ranking ?? []).map(r => r.user_id))
        const groupToday = todayRanking
          .filter(r => memberIds.has(r.user_id))
          .sort((a, b) => b.total_points - a.total_points)
        setTodayTop(groupToday[0] || null)
      })
      .catch(err => setError(err.message || 'Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [groupId, token, today])

  useEffect(() => { load() }, [load])

  async function generateLink() {
    setLinkLoading(true)
    try {
      const res = await api.post(`/user-groups/${groupId}/invite-link`, {}, token)
      setInviteLink(`${window.location.origin}/bolao/${res.token}`)
    } catch (e) { setError(e.message) }
    finally { setLinkLoading(false) }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  async function shareLink() {
    if (navigator.share) {
      await navigator.share({ title: data?.group_name, text: `Entre no bolão: ${data?.group_name}`, url: inviteLink })
    } else copyLink()
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
    navigator.clipboard.writeText(text).then(() => {
      setShareCopied(true); setTimeout(() => setShareCopied(false), 2000)
    })
  }

  function shareWhatsApp() {
    const text = buildShareText(data.group_name, ranking, matchStats.finished, matchStats.total, inviteLink)
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
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
            <Link to="/meus-grupos" className="btn btn-primary btn-sm mt-4">Voltar</Link>
          </div>
        </div>
      </div>
    )
  }

  const ranking = data?.ranking ?? []
  const amOwner = data?.is_owner === true
  const myEntry = ranking.find(r => r.is_me)
  const leaderPts = ranking[0]?.total_points || 1
  const { finished, total } = matchStats
  const maxBets = Math.max(...ranking.map(r => r.total_bets), 1)
  const effectiveTotal = Math.max(finished, maxBets)

  return (
    <div className="page">
      {/* ── Cabeçalho ── */}
      <div className="fade-in-1">
        <Link to="/meus-grupos" className="match-breadcrumb__link">‹ Meus Grupos</Link>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--s3)', flexWrap: 'wrap', marginTop: 'var(--s4)' }}>
          <div>
            {renaming ? (
              <form onSubmit={saveRename} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="text" className="form-input" value={newName} autoFocus maxLength={120}
                  onChange={e => setNewName(e.target.value)} style={{ minWidth: 180 }}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingName}>
                  {savingName ? '...' : 'Salvar'}
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
          <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm"
              style={{ background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700 }}
              onClick={() => setShareOpen(o => !o)}
            >
              📤 Compartilhar Ranking
            </button>
            {amOwner && !renaming && (
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => { setNewName(data?.group_name ?? ''); setRenaming(true) }}>
                ✏️ Renomear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Painel de compartilhar ── */}
      {shareOpen && (
        <div className="card mt-4 fade-in-1" style={{ padding: 'var(--s4) var(--s5)', borderLeft: '3px solid var(--accent)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 10 }}>
            Compartilhar Ranking
          </div>
          {/* Preview do texto */}
          <pre style={{
            fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-2)',
            background: 'var(--bg-overlay)', borderRadius: 8, padding: '10px 12px',
            marginBottom: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
          }}>
            {buildShareText(data.group_name, ranking, finished, total, inviteLink)}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={shareWhatsApp}
              style={{
                flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
                background: '#25D366', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <WhatsAppIcon /> WhatsApp
            </button>
            <button
              onClick={copyShareText}
              style={{
                flex: 1, padding: '10px', borderRadius: 10,
                border: '1px solid var(--border)', cursor: 'pointer',
                fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
                background: shareCopied ? 'var(--win)' : 'transparent',
                color: shareCopied ? '#fff' : 'var(--text-2)',
                transition: 'all .2s',
              }}
            >
              {shareCopied ? '✓ Copiado!' : '📋 Copiar texto'}
            </button>
          </div>
        </div>
      )}

      {/* ── Stats do grupo ── */}
      <div className="fade-in-2" style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        gap: 'var(--s3)', marginTop: 'var(--s6)',
      }}>
        <StatPill label="Jogos realizados" value={`${finished}/${total}`} icon="⚽" />
        <StatPill label="Jogos pendentes" value={total - finished} icon="⏳" />
        <StatPill label="Participantes" value={ranking.length} icon="👥" />
        {todayTop && (
          <StatPill label="Em alta hoje" value={todayTop.name} icon="🔥" sub={`${todayTop.total_points} pts hoje`} accent />
        )}
      </div>

      {/* ── Link de convite ── */}
      <div className="card mt-6 fade-in-2" style={{ padding: 'var(--s12) var(--s16)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
            Link de convite
          </span>
          {!inviteLink ? (
            <button className="btn btn-primary btn-sm" onClick={generateLink} disabled={linkLoading}>
              {linkLoading ? 'Gerando...' : '🔗 Gerar link'}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <input readOnly value={inviteLink} style={{
                flex: 1, minWidth: 0, fontFamily: 'var(--font-data)', fontSize: 11,
                padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--surface-2)', color: 'var(--text-2)',
              }} />
              <button className="btn btn-primary btn-sm" onClick={shareLink}>
                {copied ? '✓ Copiado' : '📤 Compartilhar'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={copyLink} title="Copiar link">📋</button>
            </div>
          )}
        </div>
        <div style={{ marginTop: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--text-3)' }}>
          Qualquer pessoa com o link pode entrar no grupo.
        </div>
      </div>

      {/* ── Ranking ── */}
      <div className="card mt-4 fade-in-3">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
            Classificação do Grupo
          </span>
        </div>

        {/* Minha posição */}
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
                {aproveitamento(myEntry) !== null && ` · ${aproveitamento(myEntry)}% aproveito`}
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
            {/* Header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '36px 1fr 52px',
              gap: 'var(--s2)', padding: '6px var(--s4)', borderBottom: '1px solid var(--border)',
            }}>
              {['#', 'Participante', 'Pts'].map((h, i) => (
                <span key={h} style={{
                  fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-4)',
                  textAlign: i === 0 ? 'center' : i === 2 ? 'right' : 'left',
                }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Rows */}
            {ranking.map((r, i) => {
              const podiumClass = i === 0 ? 'ranking-row--gold' : i === 1 ? 'ranking-row--silver' : i === 2 ? 'ranking-row--bronze' : ''
              const isHotToday = todayTop?.user_id === r.user_id
              const badges = getBadges(r, i + 1, effectiveTotal, isHotToday)
              const prevMember = i > 0 ? ranking[i - 1] : null
              const ptsDiff = prevMember ? prevMember.total_points - r.total_points : 0
              const coveragePct = effectiveTotal > 0 ? Math.min(100, Math.round(r.total_bets / effectiveTotal * 100)) : 0
              const aprv = aproveitamento(r)

              return (
                <div
                  key={r.user_id}
                  className={`ranking-row fade-in ${podiumClass}`}
                  style={{
                    display: 'grid', gridTemplateColumns: '36px 1fr 52px',
                    gap: 'var(--s2)', animationDelay: `${i * 30}ms`,
                    borderLeft: i < 3 ? undefined : r.is_me ? '3px solid var(--accent)' : '3px solid transparent',
                    background: r.is_me && i >= 3 ? 'rgba(15,122,120,0.04)' : undefined,
                  }}
                >
                  {/* Posição */}
                  <span className={`ranking-row__pos ${i < 3 ? 'ranking-row__pos--top' : ''}`} style={{ textAlign: 'center', alignSelf: 'start', paddingTop: 4 }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>

                  {/* Nome + badges + barra + próxima vítima */}
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <Link to={`/usuarios/${r.user_id}/historico`} style={{ textDecoration: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 14, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.name}
                        </span>
                        {r.is_me && <span style={{ fontSize: 9, fontFamily: 'var(--font-cond)', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>VOCÊ</span>}
                      </div>
                    </Link>

                    {/* Badges */}
                    {badges.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {badges.map(b => (
                          <span key={b.label} style={{
                            fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700,
                            padding: '1px 6px', borderRadius: 20,
                            background: `${b.color}20`, color: b.color,
                            border: `1px solid ${b.color}40`,
                            letterSpacing: '0.04em',
                          }}>
                            {b.icon} {b.label}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Barra de cobertura de apostas */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ height: 4, flex: 1, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden', maxWidth: 120 }}>
                        <div style={{
                          height: '100%', borderRadius: 2, transition: 'width 600ms ease',
                          width: `${coveragePct}%`,
                          background: coveragePct >= 80 ? 'var(--win)' : coveragePct >= 50 ? 'var(--accent)' : 'var(--lose)',
                        }} />
                      </div>
                      <span style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>
                        {r.total_bets}/{effectiveTotal} apostas
                        {aprv !== null && ` · ${aprv}%`}
                      </span>
                    </div>

                    {/* Próxima vítima */}
                    {prevMember && ptsDiff > 0 && (
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)', lineHeight: 1.2 }}>
                        ▲ faltam <strong style={{ color: 'var(--text-3)' }}>{ptsDiff} pts</strong> para alcançar {prevMember.name}
                      </div>
                    )}
                    {prevMember && ptsDiff === 0 && (
                      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--win)' }}>
                        = empatado com {prevMember.name}
                      </div>
                    )}
                  </div>

                  {/* Pts + ações */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--accent)', fontWeight: 700 }}>
                      {r.total_points}
                    </span>
                    {/* Barra relativa ao líder */}
                    <div style={{ width: 36, height: 3, background: 'var(--bg-overlay)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${leaderPts > 0 ? (r.total_points / leaderPts) * 100 : 0}%`,
                        background: i === 0 ? '#e8a030' : i === 1 ? 'var(--text-3)' : 'var(--accent)',
                        transition: 'width 600ms ease',
                      }} />
                    </div>
                    {amOwner && !r.is_me && (
                      <button
                        type="button"
                        style={{ fontSize: 10, padding: '1px 6px', color: 'var(--lose)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-cond)' }}
                        disabled={removingId === r.user_id}
                        onClick={() => removeMember(r.user_id)}
                      >
                        {removingId === r.user_id ? '...' : '✕ remover'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Legenda de badges ── */}
      {ranking.length > 0 && (
        <div className="card mt-4 fade-in-4" style={{ padding: 'var(--s4) var(--s5)' }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-4)', marginBottom: 8 }}>
            Conquistas
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { icon: '🏆', label: 'Líder', desc: '1º no ranking do grupo' },
              { icon: '🎯', label: 'Sniper', desc: '≥28% de placares exatos (mín. 5 apostas)' },
              { icon: '⚡', label: 'Maratonista', desc: 'Apostou em ≥85% dos jogos realizados' },
              { icon: '🔥', label: 'Em Alta', desc: 'Maior pontuação do grupo hoje' },
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

// ── Sub-componentes ────────────────────────────────────────────────────────────

function StatPill({ label, value, icon, sub, accent }) {
  return (
    <div style={{
      background: accent ? 'var(--accent-dim)' : 'var(--surface)',
      border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 12, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ fontFamily: 'var(--font-cond)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accent ? 'var(--accent)' : 'var(--text-4)' }}>
        {icon} {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: accent ? 'var(--accent)' : 'var(--text-1)', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
      {sub && <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  )
}
