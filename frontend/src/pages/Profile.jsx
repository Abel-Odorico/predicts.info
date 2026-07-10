import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import { Link } from 'react-router-dom'
import { usePushNotifications } from '../hooks/usePushNotifications'

function relDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Profile() {
  const { user, token, setUser } = useAuth()
  const [tab, setTab] = useState('profile')
  const push = usePushNotifications(token)
  const [achievements, setAchievements] = useState([])
  const [achLoading, setAchLoading] = useState(false)
  const [referral, setReferral] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!token) return
    setAchLoading(true)
    api.get('/achievements', token).then(setAchievements).catch(() => {}).finally(() => setAchLoading(false))
  }, [token])

  useEffect(() => {
    if (!token) return
    api.get('/me/referral', token).then(setReferral).catch(() => {})
  }, [token])

  function copyInviteLink() {
    if (!referral?.invite_url) return
    navigator.clipboard?.writeText(referral.invite_url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const [name, setName]         = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [phone, setPhone]       = useState(user?.phone ?? '')
  const [waOptIn, setWaOptIn]   = useState(user?.whatsapp_opt_in ?? false)
  const [profileMsg, setProfileMsg] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [waLink, setWaLink] = useState(null)
  const [waPrefsSaving, setWaPrefsSaving] = useState(null) // key sendo salvo agora, ou null

  useEffect(() => {
    api.get('/whatsapp/contact').then(r => { if (r?.available) setWaLink(r.wa_link) }).catch(() => {})
  }, [])

  const waPrefs = user?.whatsapp_prefs || {}
  function waPrefOn(key) { return waPrefs[key] !== false } // ausente = ligado (default)

  async function toggleWaPref(key) {
    const next = !waPrefOn(key)
    setWaPrefsSaving(key)
    try {
      const updated = await api.patch('/auth/profile', { whatsapp_prefs: { [key]: next } }, token)
      setUser(updated)
    } catch { /* silencioso — usuário pode tentar de novo */ }
    finally { setWaPrefsSaving(null) }
  }

  const [curPwd, setCurPwd]   = useState('')
  const [newPwd, setNewPwd]   = useState('')
  const [confPwd, setConfPwd] = useState('')
  const [pwdMsg, setPwdMsg]   = useState('')
  const [savingPwd, setSavingPwd] = useState(false)

  if (!token) {
    return (
      <div className="page">
        <div className="bet-empty fade-in-1">
          <h1 className="page-title">MEU PERFIL</h1>
          <p className="page-subtitle" style={{ marginTop: 'var(--s4)' }}>Faça login para editar seu perfil.</p>
          <Link to="/login" className="btn btn-primary btn-lg" style={{ marginTop: 'var(--s6)' }}>Entrar</Link>
        </div>
      </div>
    )
  }

  async function saveProfile(e) {
    e.preventDefault()
    setProfileMsg('')
    setSavingProfile(true)
    try {
      const updated = await api.patch('/auth/profile', {
        name: name.trim() || undefined,
        username: username.trim() || null,
        phone: phone.trim() || null,
        whatsapp_opt_in: phone.trim() ? waOptIn : false,
      }, token)
      setUser(updated)
      setProfileMsg('✓ Perfil atualizado com sucesso')
    } catch (err) {
      setProfileMsg(`✗ ${err.message}`)
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(e) {
    e.preventDefault()
    setPwdMsg('')
    if (newPwd !== confPwd) { setPwdMsg('✗ As senhas não coincidem'); return }
    if (newPwd.length < 8) { setPwdMsg('✗ Senha deve ter ao menos 8 caracteres'); return }
    setSavingPwd(true)
    try {
      await api.patch('/auth/password', { current_password: curPwd, new_password: newPwd }, token)
      setPwdMsg('✓ Senha alterada com sucesso')
      setCurPwd(''); setNewPwd(''); setConfPwd('')
    } catch (err) {
      setPwdMsg(`✗ ${err.message}`)
    } finally {
      setSavingPwd(false)
    }
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="page">
      <div className="fade-in-1">
        <h1 className="page-title">MEU PERFIL</h1>
        <p className="page-subtitle">Gerencie suas informações e segurança de conta</p>
      </div>

      <div className="card mt-6 fade-in-2" style={{ display: 'flex', gap: 'var(--s5)', alignItems: 'center', padding: 'var(--s6) var(--s8)' }}>
        <div className="sidebar__avatar" style={{ width: 52, height: 52, fontSize: 20, flexShrink: 0 }}>
          {initials}
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 18, color: 'var(--text-1)' }}>{user?.name}</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-3)' }}>{user?.email}</div>
          {user?.username && (
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>@{user.username}</div>
          )}
          {user?.phone && (
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{user.phone}</div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--s2)' }}>
          <span className={`badge ${user?.role === 'admin' ? 'badge-live' : 'badge-group'}`}>{user?.role}</span>
          <Link
            to={`/usuarios/${user?.id}/historico`}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11, whiteSpace: 'nowrap' }}
          >
            🏅 Meu Histórico
          </Link>
        </div>
      </div>

      {/* ── Card de Convite / Referral ── */}
      {referral && (
        <div className="card mt-4 fade-in-2" style={{
          border: '1.5px solid rgba(232,196,74,0.25)',
          background: 'linear-gradient(135deg,rgba(232,196,74,0.07) 0%,rgba(232,196,74,0.02) 100%)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 22 }}>⚡</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: '#e8c44a' }}>
                Convide amigos
              </div>
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>
                {referral.invited_count > 0
                  ? `Você já trouxe ${referral.invited_count} predictor${referral.invited_count !== 1 ? 'es' : ''}! 🎉`
                  : 'Seu link de convite pessoal'}
              </div>
            </div>
            {referral.invited_count > 0 && (
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: '#e8c44a', fontWeight: 700 }}>
                {referral.invited_count}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)',
              background: 'var(--bg-overlay)', borderRadius: 8, padding: '8px 10px',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {referral.invite_url}
            </div>
            <button
              onClick={copyInviteLink}
              className="btn btn-sm"
              style={{ background: copied ? 'rgba(46,201,128,0.15)' : 'rgba(232,196,74,0.15)', color: copied ? 'var(--win)' : '#e8c44a', border: '1px solid currentColor', flexShrink: 0 }}
            >
              {copied ? '✓ Copiado' : '📋 Copiar'}
            </button>
          </div>
        </div>
      )}

      <div className="tabs mt-6">
        {[
          { id: 'profile', label: 'Dados do Perfil' },
          { id: 'password', label: 'Senha' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={tab === t.id ? 'active' : ''}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <form onSubmit={saveProfile} className="card mt-4 fade-in-1">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>Dados do Perfil</span>
          </div>
          <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
            <div className="form-group">
              <label className="form-label">Nome de exibição</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Seu nome"
                maxLength={100}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Username <span style={{ color: 'var(--text-4)', fontSize: 11 }}>(opcional · 3–30 chars · letras, números, _ . -)</span></label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontFamily: 'var(--font-data)', fontSize: 14 }}>@</span>
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: 28 }}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="seu_username"
                  maxLength={30}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Celular / WhatsApp</label>
              <input
                type="tel"
                className="form-input"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                autoComplete="tel"
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 13, marginTop: 10, cursor: phone.trim() ? 'pointer' : 'not-allowed', opacity: phone.trim() ? 1 : 0.5 }}>
                <input
                  type="checkbox"
                  checked={waOptIn}
                  disabled={!phone.trim()}
                  onChange={e => setWaOptIn(e.target.checked)}
                />
                📲 Quero apostar por WhatsApp — manda "Brasil 2x1 Argentina" e confirma
              </label>
              {!phone.trim() && (
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                  Precisa cadastrar um telefone pra ativar.
                </div>
              )}
              {user?.whatsapp_opt_in && waLink && (
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                  style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none', background: '#25D366', color: '#073' }}
                >
                  💬 Chamar no WhatsApp
                </a>
              )}
              {user?.whatsapp_opt_in && (
                <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg-overlay)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, fontWeight: 700, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Quais mensagens você quer receber
                  </div>
                  {[
                    { key: 'bet_reminder', label: '⏰ Lembrete de aposta pendente (1h antes do jogo)' },
                    { key: 'bet_confirmation', label: '✅ Confirmação quando eu apostar pelo site' },
                    { key: 'ranking_highlight', label: '🔥 Destaque quando eu entrar no Top 10 do ranking' },
                    { key: 'version_update', label: '🚀 Novidades e atualizações do site' },
                  ].map(({ key, label }) => (
                    <label
                      key={key}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 13,
                        cursor: 'pointer', padding: '5px 0', opacity: waPrefsSaving === key ? 0.5 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={waPrefOn(key)}
                        disabled={waPrefsSaving === key}
                        onChange={() => toggleWaPref(key)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">E-mail <span style={{ color: 'var(--text-4)', fontSize: 11 }}>(não editável)</span></label>
              <input type="email" className="form-input" value={user?.email ?? ''} disabled style={{ opacity: 0.5 }} />
            </div>
            {profileMsg && (
              <p style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: profileMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                {profileMsg}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={savingProfile}>
              {savingProfile ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      )}

      {tab === 'password' && (
        <form onSubmit={savePassword} className="card mt-4 fade-in-1">
          <div className="card__header">
            <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>Alterar Senha</span>
          </div>
          <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
            <div className="form-group">
              <label className="form-label">Senha atual</label>
              <input
                type="password"
                className="form-input"
                value={curPwd}
                onChange={e => setCurPwd(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Nova senha <span style={{ color: 'var(--text-4)', fontSize: 11 }}>(mínimo 8 caracteres)</span></label>
              <input
                type="password"
                className="form-input"
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirmar nova senha</label>
              <input
                type="password"
                className="form-input"
                value={confPwd}
                onChange={e => setConfPwd(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
            {pwdMsg && (
              <p style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: pwdMsg.startsWith('✓') ? 'var(--win)' : 'var(--lose)' }}>
                {pwdMsg}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={savingPwd}>
              {savingPwd ? 'Alterando...' : 'Alterar senha'}
            </button>
          </div>
        </form>
      )}

      {/* ── Push Notifications ─────────────────────────────────── */}
      {(() => {
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
        return (
          <div className="card mt-6 fade-in-3">
            <div className="card__header">
              <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>🔔 Notificações Push</span>
            </div>
            <div className="card__body">
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
                Receba alertas mesmo com o site fechado: resultados de apostas, ranking e lembretes de jogos.
              </p>
              {!push.supported && isIOS && !isStandalone ? (
                <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '12px 14px', fontFamily: 'var(--font-cond)', fontSize: 13 }}>
                  <p style={{ color: 'var(--text-2)', marginBottom: 8, fontWeight: 600 }}>📱 Como ativar no iPhone / iPad:</p>
                  <ol style={{ color: 'var(--text-3)', paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
                    <li>Abra <strong>predicts.info</strong> no <strong>Safari</strong></li>
                    <li>Toque em <strong>Compartilhar</strong> <span style={{ fontSize: 15 }}>⎙</span> na barra inferior</li>
                    <li>Selecione <strong>"Adicionar à Tela de Início"</strong></li>
                    <li>Abra o app instalado e volte aqui para ativar</li>
                  </ol>
                </div>
              ) : !push.supported ? (
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)' }}>
                  Seu navegador não suporta notificações push. Use Chrome, Firefox ou Edge.
                </p>
              ) : push.permission === 'denied' ? (
                <p style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--lose)' }}>
                  Notificações bloqueadas no navegador. Desbloqueie nas configurações do site.
                </p>
              ) : push.subscribed ? (
                <button className="btn btn-ghost btn-sm" onClick={push.unregister}>
                  ✓ Notificações ativas — Desativar
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={push.register}>
                  🔔 Ativar notificações neste dispositivo
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Conquistas ────────────────────────────────────────── */}
      <div className="card mt-6 fade-in-3">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>🏅 Conquistas</span>
        </div>
        <div className="card__body">
          {achLoading ? (
            <Spinner text="Carregando conquistas..." />
          ) : (
            <div className="achievements-grid">
              {achievements.map(a => (
                <div key={a.code} className={`achievement-card${a.unlocked ? ' achievement-card--unlocked' : ''}`}>
                  <div className="achievement-card__icon">{a.icon}</div>
                  <div className="achievement-card__title">{a.title}</div>
                  <div className="achievement-card__desc">{a.desc}</div>
                  {a.unlocked && a.unlocked_at && (
                    <div className="achievement-card__date">{relDate(a.unlocked_at)}</div>
                  )}
                  {!a.unlocked && <div className="achievement-card__lock">🔒</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
