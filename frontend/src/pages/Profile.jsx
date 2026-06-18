import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'
import { Link } from 'react-router-dom'

export default function Profile() {
  const { user, token, setUser } = useAuth()
  const [tab, setTab] = useState('profile')

  const [name, setName]         = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [profileMsg, setProfileMsg] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

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
    if (newPwd.length < 6) { setPwdMsg('✗ Senha deve ter ao menos 6 caracteres'); return }
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
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span className={`badge ${user?.role === 'admin' ? 'badge-live' : 'badge-group'}`}>{user?.role}</span>
        </div>
      </div>

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
              <label className="form-label">Nova senha <span style={{ color: 'var(--text-4)', fontSize: 11 }}>(mínimo 6 caracteres)</span></label>
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
    </div>
  )
}
