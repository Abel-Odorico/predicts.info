import { useEffect, useState } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../stores/authStore'
import { useTrack } from '../hooks/useTrack'
import { useAdSense } from '../hooks/useAdSense'
import { api } from '../api'

const NAV = [
  { to: '/',           icon: '⚽', label: 'Dashboard' },
  { to: '/torneio',    icon: '🏆', label: 'Torneio' },
  { to: '/resultados', icon: '📋', label: 'Resultados' },
  { to: '/grupos',     icon: '🗂', label: 'Grupos' },
  { to: '/apostas',    icon: '🎯', label: 'Apostas' },
  { to: '/ranking',    icon: '🏅', label: 'Ranking' },
  { to: '/meus-grupos', icon: '👥', label: 'Meus Grupos' },
]

const ADMIN_NAV = [
  { to: '/admin',            icon: '🛠', label: 'Painel Admin' },
  { to: '/admin/analytics',  icon: '📊', label: 'Analytics' },
  { to: '/admin/options',    icon: '⚙️', label: 'Configurações' },
]

const LEGAL_NAV = [
  { to: '/privacidade', label: 'Privacidade' },
  { to: '/termos', label: 'Termos' },
  { to: '/sobre', label: 'Sobre' },
  { to: '/contato', label: 'Contato' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [adminOpen, setAdminOpen] = useState(false)
  const [developerCredit, setDeveloperCredit] = useState('PeepConnect - By Abel Odorico')
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light'
    return localStorage.getItem('predicts_theme') || 'light'
  })
  useTrack()
  useAdSense()

  useEffect(() => {
    api.get('/site-config/public')
      .then(cfg => {
        if (cfg.developer_credit) setDeveloperCredit(cfg.developer_credit)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('predicts_theme', theme)
  }, [theme])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const toggleTheme = () => {
    setTheme(current => current === 'light' ? 'dark' : 'light')
  }

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <>
      <header className="mobile-topbar">
        <div className="mobile-topbar__brand">
          <div className="mobile-topbar__logo">PREDICTS</div>
          <div className="mobile-topbar__subtitle">World Cup 2026</div>
        </div>
        <div className="mobile-topbar__actions">
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost btn-sm theme-toggle"
            aria-label={`Ativar tema ${theme === 'light' ? 'escuro' : 'claro'}`}
          >
            <span>{theme === 'light' ? '☀️' : '🌙'}</span>
            <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
          </button>
          {user ? (
            <button
              type="button"
              onClick={handleLogout}
              className="btn btn-ghost btn-sm"
            >
              Sair
            </button>
          ) : (
            <NavLink to="/login" className="btn btn-primary btn-sm">
              Entrar
            </NavLink>
          )}
        </div>
      </header>

      <nav className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__logo">PREDICTS</div>
          <div className="sidebar__subtitle">World Cup 2026</div>
        </div>

        <div className="sidebar__nav">
          {NAV.map(n => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-item__icon">{n.icon}</span>
              <span>{n.label}</span>
            </NavLink>
          ))}
          {user?.role === 'admin' && (
            <>
              <div style={{
                fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: 'var(--text-4)',
                padding: 'var(--s4) var(--s4) var(--s1)',
                borderTop: '1px solid var(--border)', marginTop: 'var(--s2)',
              }}>Admin</div>
              {ADMIN_NAV.map(n => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <span className="nav-item__icon">{n.icon}</span>
                  <span>{n.label}</span>
                </NavLink>
              ))}
            </>
          )}
        </div>

        <div className="sidebar__footer">
          {user ? (
            <div className="sidebar__account">
              <Link to={`/usuarios/${user.id}/historico`} className="sidebar__user">
                <div className="sidebar__avatar">{initials}</div>
                <span className="sidebar__user-name">
                  {user.name}
                </span>
              </Link>
              <NavLink to="/perfil" className={({ isActive }) => `btn btn-ghost btn-sm w-full${isActive ? ' active' : ''}`}>
                ⚙️ Meu Perfil
              </NavLink>
              <button
                onClick={handleLogout}
                className="btn btn-ghost btn-sm w-full"
              >
                Sair
              </button>
            </div>
          ) : (
            <NavLink to="/login" className="btn btn-primary btn-sm w-full">
              Entrar
            </NavLink>
          )}
          <div className="sidebar__legal">
            {LEGAL_NAV.map(item => (
              <NavLink key={item.to} to={item.to} className="sidebar__legal-link">
                {item.label}
              </NavLink>
            ))}
          </div>
          <div className="sidebar__credit">
            <span className="sidebar__credit-label">Desenvolvido por</span>
            <span className="sidebar__credit-value">{developerCredit}</span>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost btn-sm w-full theme-toggle theme-toggle--sidebar"
            aria-label={`Ativar tema ${theme === 'light' ? 'escuro' : 'claro'}`}
          >
            <span>{theme === 'light' ? '☀️' : '🌙'}</span>
            <span>{theme === 'light' ? 'Tema claro ativo' : 'Tema escuro ativo'}</span>
          </button>
        </div>
      </nav>

      {/* Admin flyup menu (mobile) */}
      {user?.role === 'admin' && adminOpen && (
        <div
          onClick={() => setAdminOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 115,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', bottom: 'var(--mobile-nav)', left: 0, right: 0,
              background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
              padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)',
              zIndex: 116,
            }}
          >
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 var(--s2) var(--s1)' }}>Área Admin</div>
            {ADMIN_NAV.map(n => (
              <NavLink
                key={n.to}
                to={n.to}
                end
                onClick={() => setAdminOpen(false)}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                style={{ borderRadius: 'var(--r2)' }}
              >
                <span className="nav-item__icon">{n.icon}</span>
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 13 }}>{n.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <nav className="mobile-bottom-nav" aria-label="Navegacao principal">
        {NAV.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `mobile-bottom-nav__item${isActive ? ' active' : ''}`}
          >
            <span className="mobile-bottom-nav__icon">{n.icon}</span>
            <span className="mobile-bottom-nav__label">{n.label}</span>
          </NavLink>
        ))}
        {user && (
          <NavLink
            to="/perfil"
            className={({ isActive }) => `mobile-bottom-nav__item${isActive ? ' active' : ''}`}
          >
            <span className="mobile-bottom-nav__icon">⚙️</span>
            <span className="mobile-bottom-nav__label">Perfil</span>
          </NavLink>
        )}
        {user && (
          <NavLink
            to={`/usuarios/${user.id}/historico`}
            className={({ isActive }) => `mobile-bottom-nav__item${isActive ? ' active' : ''}`}
          >
            <span className="mobile-bottom-nav__icon">🏅</span>
            <span className="mobile-bottom-nav__label">Histórico</span>
          </NavLink>
        )}
        {user?.role === 'admin' && (
          <button
            onClick={() => setAdminOpen(o => !o)}
            className={`mobile-bottom-nav__item${adminOpen ? ' active' : ''}`}
            style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
          >
            <span className="mobile-bottom-nav__icon">{adminOpen ? '✕' : '🛠'}</span>
            <span className="mobile-bottom-nav__label">Admin</span>
          </button>
        )}
      </nav>
    </>
  )
}
