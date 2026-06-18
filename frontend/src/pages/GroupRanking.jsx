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
  const isOwner = ranking.find(r => r.is_me)?.position !== undefined &&
    data?.ranking?.[0] !== undefined &&
    ranking.some(r => r.is_me)

  const amOwner = ranking.some(r => r.is_me) && data?.is_owner

  return (
    <div className="page">
      <div className="fade-in-1">
        <Link to="/meus-grupos" className="match-breadcrumb__link">‹ Meus Grupos</Link>
        <h1 className="page-title" style={{ marginTop: 'var(--s4)' }}>{data?.group_name}</h1>
        <p className="page-subtitle">{ranking.length} participante{ranking.length !== 1 ? 's' : ''}</p>
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
            {ranking.map((r, i) => (
              <Link
                key={r.user_id}
                to={`/usuarios/${r.user_id}/historico`}
                className="ranking-row fade-in"
                style={{
                  animationDelay: `${i * 30}ms`,
                  background: r.is_me ? 'rgba(0, 200, 83, 0.06)' : undefined,
                  borderLeft: r.is_me ? '3px solid var(--accent)' : '3px solid transparent',
                }}
              >
                <span className={`ranking-row__pos ${i < 3 ? 'ranking-row__pos--top' : ''}`}>
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <div className="ranking-row__meta">
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.name}
                    {r.is_me && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.08em' }}>VOCÊ</span>}
                  </div>
                </div>
                <span className="ranking-row__pts">{r.total_points}</span>
                <span className="ranking-row__stats ranking-row__sub">{r.exact_scores ?? 0}</span>
                <span className="ranking-row__stats ranking-row__sub">{r.total_bets ?? 0}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
