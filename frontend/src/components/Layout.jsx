import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../stores/authStore'

const NAV = [
  { to: '/',        icon: '⚽', label: 'Dashboard' },
  { to: '/torneio',    icon: '🏆', label: 'Torneio' },
  { to: '/resultados', icon: '📋', label: 'Resultados' },
  { to: '/grupos',     icon: '🗂', label: 'Grupos' },
  { to: '/apostas',    icon: '🎯', label: 'Apostas' },
  { to: '/ranking',    icon: '🏅', label: 'Ranking' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
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
            <NavLink
              to="/admin"
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-item__icon">⚙️</span>
              <span>Admin</span>
            </NavLink>
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
        </div>
      </nav>

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
        {user?.role === 'admin' && (
          <NavLink
            to="/admin"
            className={({ isActive }) => `mobile-bottom-nav__item${isActive ? ' active' : ''}`}
          >
            <span className="mobile-bottom-nav__icon">⚙️</span>
            <span className="mobile-bottom-nav__label">Admin</span>
          </NavLink>
        )}
      </nav>
    </>
  )
}
