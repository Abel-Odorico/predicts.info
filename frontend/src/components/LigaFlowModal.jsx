import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../api'

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.553 4.118 1.522 5.852L0 24l6.302-1.497A11.934 11.934 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.893 0-3.667-.514-5.188-1.41l-.372-.22-3.741.889.937-3.638-.243-.386A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
    </svg>
  )
}

function TelegramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
    </svg>
  )
}

export default function LigaFlowModal({ token, onClose }) {
  const [step,       setStep]       = useState('loading')
  const [group,      setGroup]      = useState(null)
  const [allGroups,  setAllGroups]  = useState([])
  const [inviteLink, setInviteLink] = useState('')
  const [groupName,  setGroupName]  = useState('')
  const [creating,   setCreating]   = useState(false)
  const [msg,        setMsg]        = useState('')
  const [copied,     setCopied]     = useState(false)

  useEffect(() => {
    if (!token) { setStep('create'); return }
    api.get('/user-groups', token)
      .then(res => {
        const groups = res?.groups || []
        setAllGroups(groups)
        if (groups.length === 0) { setStep('create'); return }
        const g = groups[0]
        setGroup(g)
        const existing = g.invite_token ? `${window.location.origin}/bolao/${g.invite_token}` : ''
        if (existing) { setInviteLink(existing); setStep('share'); return }
        api.post(`/user-groups/${g.id}/invite-link`, {}, token)
          .then(r => { setInviteLink(`${window.location.origin}/bolao/${r.token}`); setStep('share') })
          .catch(() => setStep('share'))
      })
      .catch(() => setStep('create'))
  }, [token])

  async function handleCreate(e) {
    e.preventDefault()
    if (!groupName.trim()) return
    setCreating(true); setMsg('')
    try {
      const g = await api.post('/user-groups', { name: groupName.trim() }, token)
      setGroup(g)
      const r = await api.post(`/user-groups/${g.id}/invite-link`, {}, token)
      setInviteLink(`${window.location.origin}/bolao/${r.token}`)
      setStep('share')
    } catch (e) {
      setMsg(e?.message || 'Erro ao criar liga')
    } finally {
      setCreating(false)
    }
  }

  function copy() {
    if (!inviteLink) return
    navigator.clipboard?.writeText(inviteLink)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500) })
      .catch(() => {
        const el = document.createElement('textarea')
        el.value = inviteLink
        document.body.appendChild(el); el.select(); document.execCommand('copy')
        document.body.removeChild(el)
        setCopied(true); setTimeout(() => setCopied(false), 2500)
      })
  }

  const leadName = group?.members?.[0]?.name?.split(' ')[0] || ''
  const memberCount = group?.members?.length ?? 0
  const waMsg = inviteLink
    ? `🏆 *Bolão ${group?.name || 'Liga Privada'} — Predicts*\n\nVem disputar comigo! Copa 2026 e Brasileirão, mesmos palpites e ranking.\n\n👉 ${inviteLink}`
    : ''
  const waHref  = `https://wa.me/?text=${encodeURIComponent(waMsg)}`
  const tgHref  = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(`🏆 ${group?.name || 'Bolão Predicts'} — venha disputar comigo!`)}`

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9600,
        background: 'rgba(3,8,14,0.82)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in-1"
        style={{
          width: '100%', maxWidth: 480,
          background: 'var(--bg-surface)', border: '1.5px solid var(--border)',
          borderRadius: '20px 20px 0 0', padding: '6px 20px calc(24px + env(safe-area-inset-bottom, 0px))',
          boxShadow: '0 -12px 48px rgba(0,0,0,0.5)',
        }}
      >
        <div
          onClick={onClose}
          style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '12px auto 22px', cursor: 'pointer' }}
        />

        {/* ── LOADING ── */}
        {step === 'loading' && (
          <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-cond)', color: 'var(--text-3)', fontSize: 14 }}>
            Verificando suas ligas...
          </div>
        )}

        {/* ── CREATE ── */}
        {step === 'create' && (
          <>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 38, marginBottom: 8 }}>🏆</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text-1)', letterSpacing: '0.04em', lineHeight: 1.1 }}>
                MONTE SUA LIGA
              </div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13.5, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.6 }}>
                Crie um bolão privado, gere o link e chame seus amigos. Cada um faz palpites e você vê o ranking só da sua turma.
              </div>
            </div>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="form-input"
                placeholder='Nome da liga (ex: Galera do Trampo ⚽)'
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                maxLength={60}
                autoFocus
                style={{ fontFamily: 'var(--font-cond)', fontSize: 15, padding: '13px 14px' }}
              />
              {msg && (
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)' }}>{msg}</div>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating || !groupName.trim()}
                style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '0.06em', padding: '14px 0' }}
              >
                {creating ? 'Criando...' : '⚡ Criar Liga e Gerar Link'}
              </button>
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
                Agora não
              </button>
            </form>
          </>
        )}

        {/* ── SHARE ── */}
        {step === 'share' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontSize: 38, marginBottom: 6 }}>🔗</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-1)', letterSpacing: '0.04em', marginBottom: 4 }}>
                {group?.name?.toUpperCase() || 'SUA LIGA'}
              </div>
              {memberCount > 0 && (
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
                  {memberCount} membro{memberCount !== 1 ? 's' : ''}
                  {leadName && ` · líder: ${leadName}`}
                </div>
              )}
            </div>

            {inviteLink && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg-overlay)', borderRadius: 10, padding: '10px 12px', marginBottom: 14,
              }}>
                <span style={{
                  flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-2)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {inviteLink}
                </span>
                <button
                  onClick={copy}
                  style={{
                    flexShrink: 0, padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: copied ? 'var(--win)' : 'var(--accent)', color: '#fff',
                    fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
                    transition: 'background .2s',
                  }}
                >
                  {copied ? '✓ Copiado!' : 'Copiar'}
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <a
                href={waHref} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '13px 0', borderRadius: 11, textDecoration: 'none',
                  background: '#25D366', color: '#fff',
                  fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700,
                }}
              >
                <WhatsAppIcon /> WhatsApp
              </a>
              <a
                href={tgHref} target="_blank" rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '13px 0', borderRadius: 11, textDecoration: 'none',
                  background: '#0088cc', color: '#fff',
                  fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700,
                }}
              >
                <TelegramIcon /> Telegram
              </a>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {allGroups.length > 0 && (
                <Link to="/meus-grupos" onClick={onClose} className="btn btn-ghost btn-sm" style={{ flex: 1, textAlign: 'center' }}>
                  Gerenciar ligas
                </Link>
              )}
              <button onClick={onClose} className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                Pronto!
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
