import { useEffect, useState, useCallback } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../stores/authStore'
import { useTrack } from '../hooks/useTrack'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { api } from '../api'
import ShareModal from './ShareModal'
import AppPopups, { InstallAppPopup } from './AppPopups'
import NotificationBell from './NotificationBell'
import LiveFloating from './LiveFloating'
import {
  IconClipboardList, IconTrophy, IconTable, IconFlame, IconTarget, IconPodium,
  IconUsers, IconCrown, IconBallot, IconCircleUser, IconFileText, IconBookOpen,
  IconNewspaper, IconLayoutDashboard, IconBarChart, IconSettings, IconHistory,
} from './icons'

function WaIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="#25D366" style={{ verticalAlign: '-2px' }} aria-label="WhatsApp">
      <path d="M16.04 2.67C8.65 2.67 2.65 8.67 2.65 16.05c0 2.37.62 4.68 1.8 6.72L2.53 29.33l6.73-1.87a13.36 13.36 0 006.77 1.85h.01c7.39 0 13.39-6 13.39-13.38 0-3.57-1.39-6.93-3.92-9.46a13.28 13.28 0 00-9.47-3.8zm0 24.48h-.01a11.1 11.1 0 01-5.67-1.55l-.41-.24-4 1.1 1.07-3.9-.26-.4a11.1 11.1 0 01-1.71-5.9c0-6.14 5-11.14 11.15-11.14 2.98 0 5.78 1.16 7.88 3.27a11.06 11.06 0 013.26 7.88c0 6.14-5.01 11.14-11.15 11.14v.01zm6.11-8.35c-.33-.17-1.97-.97-2.28-1.08-.31-.11-.53-.17-.75.17-.22.33-.86 1.08-1.06 1.31-.19.22-.39.25-.72.08-.33-.17-1.4-.51-2.66-1.63-.98-.88-1.65-1.96-1.84-2.29-.19-.33-.02-.51.15-.68.15-.15.33-.39.5-.58.17-.2.22-.33.33-.55.11-.22.06-.42-.03-.58-.08-.17-.75-1.8-1.03-2.47-.27-.65-.55-.56-.75-.57-.19-.01-.42-.01-.64-.01-.22 0-.58.08-.89.42-.31.33-1.17 1.14-1.17 2.79 0 1.64 1.2 3.22 1.37 3.45.17.22 2.36 3.6 5.71 5.05.8.34 1.42.55 1.9.71.8.25 1.53.22 2.11.13.64-.1 1.97-.8 2.25-1.58.28-.77.28-1.44.2-1.58-.08-.14-.31-.22-.64-.39z" />
    </svg>
  )
}

const THEMES = ['light', 'dark', 'system']
const THEME_META = {
  light:  { icon: <SunIcon />,     label: 'Claro'   },
  dark:   { icon: <MoonIcon />,    label: 'Escuro'  },
  system: { icon: <SystemIcon />,  label: 'Sistema' },
}

const NAV_DRAWER = [
  { to: '/resultados', icon: <IconClipboardList />, label: 'Resultados',    featured: true  },
  { to: '/torneio',    icon: <IconTrophy />,         label: 'Torneio',       featured: true  },
  { to: '/decisivos',  icon: <IconFlame />,          label: 'Decisivos',     featured: true  },
  { to: '/meus-grupos',icon: <IconUsers />,          label: 'Meus Grupos',   featured: true  },
  { to: '/grupos',     icon: <IconTable />,          label: 'Classificação', featured: false },
  { to: '/brasileirao',icon: '🇧🇷',                   label: 'Brasileirão',   featured: true  },
  { to: '/campeao',    icon: <IconCrown />,          label: 'Campeão',       featured: false },
  { to: '/votacao',    icon: <IconBallot />,         label: 'Votação',       featured: false },
  { to: '/perfil',     icon: <IconCircleUser />,     label: 'Meu Perfil',    featured: false },
  { to: '/regras',     icon: <IconFileText />,       label: 'Regras',        featured: false },
  { to: '/historia',   icon: <IconBookOpen />,       label: 'História',      featured: false },
]

const ADMIN_NAV = [
  { to: '/admin',           icon: <IconLayoutDashboard />, label: 'Painel Admin'   },
  { to: '/admin/whatsapp',  icon: <WaIcon />,               label: 'WhatsApp'      },
  { to: '/admin/bots',      icon: '🤖',                     label: 'Bot Squad'     },
  { to: '/admin/sistema',   icon: '🧬',                     label: 'Sistema'       },
  { to: '/admin/logs',      icon: '🪵',                     label: 'Logs'          },
  { to: '/admin/analytics', icon: <IconBarChart />,         label: 'Analytics'     },
  { to: '/admin/options',   icon: <IconSettings />,         label: 'Configurações' },
]

const LEGAL_NAV = [
  { to: '/privacidade', label: 'Privacidade' },
  { to: '/termos',      label: 'Termos'      },
  { to: '/sobre',       label: 'Sobre'       },
  { to: '/contato',     label: 'Contato'     },
]

function resolveTheme(mode) {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

export default function Layout() {
  const { user, logout, setUser, token } = useAuth()
  const navigate = useNavigate()
  const [developerCredit, setDeveloperCredit] = useState('PeepConnect - By Abel Odorico')
  const [drawerOpen, setDrawerOpen]   = useState(false)
  const [shareOpen,  setShareOpen]    = useState(false)
  const [offline, setOffline]         = useState(!navigator.onLine)
  const { canInstall, install, isIOS, isStandalone, installed, hasPrompt } = useInstallPrompt()
  const [showInstallModal, setShowInstallModal] = useState(false)
  const showInstallBtn = !isStandalone && !installed
  const [inviteCount, setInviteCount] = useState(0)

  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('predicts_theme') || 'system'
  })

  useTrack()

  useEffect(() => {
    const on  = () => setOffline(false)
    const off = () => setOffline(true)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Apply theme + OS listener
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme))
    localStorage.setItem('predicts_theme', theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  // Sync theme from user preference on login
  useEffect(() => {
    if (user?.theme && THEMES.includes(user.theme)) {
      setThemeState(user.theme)
    }
  }, [user?.id])

  useEffect(() => {
    api.get('/site-config/public')
      .then(cfg => { if (cfg.developer_credit) setDeveloperCredit(cfg.developer_credit) })
      .catch(() => {})
  }, [])

  // Poll pending group invites every 5 min
  useEffect(() => {
    if (!token) { setInviteCount(0); return }
    function fetchInvites() {
      api.get('/user-groups', token)
        .then(res => setInviteCount((res?.pending_invites ?? []).length))
        .catch(() => {})
    }
    fetchInvites()
    const id = setInterval(fetchInvites, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [token])

  const cycleTheme = useCallback(() => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    setThemeState(next)
    if (user) {
      api.patch('/auth/theme', { theme: next })
        .then(updated => setUser(updated))
        .catch(() => {})
    }
  }, [theme, user, setUser])

  const handleLogout = () => {
    logout()
    navigate('/login')
    setDrawerOpen(false)
  }

  const closeDrawer = () => setDrawerOpen(false)

  const initials = user?.name
    ? (user.name || '').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <>
      {/* ── Offline banner ───────────────────────────── */}
      {offline && (
        <div className="offline-banner" role="alert">
          <span>📶</span>
          <span>Você está offline — dados podem estar desatualizados</span>
        </div>
      )}

      {/* ── Desktop sidebar ──────────────────────────── */}
      <nav className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__logo">PREDICTS</div>
          <div className="sidebar__subtitle">Simulador Estatístico</div>
        </div>

        <div className="sidebar__nav">
          {[
            { to: '/',             icon: '⚽',                  label: 'Dashboard',    end: true },
            { to: '/resultados',   icon: <IconClipboardList />, label: 'Resultados'        },
            { to: '/torneio',      icon: <IconTrophy />,        label: 'Torneio'           },
            { to: '/grupos',       icon: <IconTable />,         label: 'Classificação'     },
            { to: '/decisivos',    icon: <IconFlame />,         label: 'Decisivos'         },
            { to: '/apostas',      icon: <IconTarget />,        label: 'Palpites'          },
            { to: '/ranking',      icon: <IconPodium />,        label: 'Ranking'           },
            { to: '/meus-grupos',  icon: <IconUsers />,         label: 'Meus Grupos'       },
            { to: '/brasileirao',  icon: '🇧🇷',                  label: 'Brasileirão'       },
            ...(user ? [{ to: `/usuarios/${user.id}/historico`, icon: <IconHistory />, label: 'Histórico' }] : []),
          ].map(n => (
            <NavLink
              key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span className="nav-item__icon">{n.icon}</span>
              <span style={{ flex: 1 }}>{n.label}</span>
              {n.to === '/meus-grupos' && inviteCount > 0 && (
                <span style={{ minWidth: 18, height: 18, borderRadius: 9, background: 'var(--lose)', color: '#fff', fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-cond)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                  {inviteCount}
                </span>
              )}
            </NavLink>
          ))}
          {/* Página estática (fora do SPA) — <a> normal, recarrega a página */}
          <a href="/noticias" className="nav-item">
            <span className="nav-item__icon"><IconNewspaper /></span>
            <span style={{ flex: 1 }}>Notícias</span>
          </a>
          {user?.role === 'admin' && (
            <>
              <div style={{
                fontFamily: 'var(--font-cond)', fontSize: 9, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: 'var(--text-4)',
                padding: 'var(--s4) var(--s4) var(--s1)',
                borderTop: '1px solid var(--border)', marginTop: 'var(--s2)',
              }}>Admin</div>
              {ADMIN_NAV.map(n => (
                <NavLink key={n.to} to={n.to} end
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
                <span className="sidebar__user-name">{user.name}</span>
              </Link>
              <div style={{ padding: '0 0 4px' }}><NotificationBell /></div>
              <NavLink to="/perfil" className={({ isActive }) => `btn btn-ghost btn-sm w-full${isActive ? ' active' : ''}`}>
                ⚙️ Meu Perfil
              </NavLink>
              <NavLink to={`/usuarios/${user.id}/historico`} className={({ isActive }) => `btn btn-ghost btn-sm w-full${isActive ? ' active' : ''}`}>
                📜 Histórico
              </NavLink>
              <button onClick={handleLogout} className="btn btn-ghost btn-sm w-full">Sair</button>
            </div>
          ) : (
            <NavLink to="/login" className="btn btn-primary btn-sm w-full">Entrar</NavLink>
          )}
          <div className="sidebar__legal">
            {LEGAL_NAV.map(item => (
              <NavLink key={item.to} to={item.to} className="sidebar__legal-link">{item.label}</NavLink>
            ))}
          </div>
          <div className="sidebar__credit">
            <span className="sidebar__credit-label">Desenvolvido por</span>
            <span className="sidebar__credit-value">{developerCredit}</span>
          </div>
          {showInstallBtn && (
            <button
              type="button"
              onClick={() => hasPrompt ? install() : setShowInstallModal(true)}
              className="btn btn-sm w-full pwa-install-btn"
            >
              📲 Instalar App
            </button>
          )}
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="btn btn-sm w-full"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, marginBottom: 6 }}
          >
            🔗 Compartilhar o Bolão
          </button>
          <button
            type="button" onClick={cycleTheme}
            className="btn btn-ghost btn-sm w-full theme-toggle theme-toggle--sidebar"
          >
            <span>{THEME_META[theme].icon}</span>
            <span>Tema {THEME_META[theme].label}</span>
          </button>
        </div>
      </nav>

      {/* ── Mobile topbar ────────────────────────────── */}
      <header className="mobile-topbar">
        <div className="mobile-topbar__brand">
          <div className="mobile-topbar__logo">PREDICTS</div>
          <div className="mobile-topbar__subtitle">
            {user?.name ? `Olá, ${user.name.split(' ')[0]}` : 'Simulador Estatístico'}
          </div>
        </div>
        <div className="mobile-topbar__actions">
          <button
            type="button" onClick={cycleTheme}
            className="mobile-topbar__theme-btn"
            title={`Tema atual: ${THEME_META[theme].label}`}
          >
            {THEME_META[theme].icon}
          </button>
          {user && <NotificationBell />}
          {user ? (
            <Link to="/perfil" className="mobile-topbar__avatar" title={user.name}>
              {initials}
            </Link>
          ) : (
            <NavLink to="/login" className="btn btn-primary btn-sm">Entrar</NavLink>
          )}
        </div>
      </header>

      {/* ── Mobile drawer backdrop ───────────────────── */}
      {drawerOpen && (
        <div className="mobile-drawer-backdrop" onClick={closeDrawer} />
      )}

      {/* ── Mobile drawer ────────────────────────────── */}
      <div className={`mobile-drawer${drawerOpen ? ' mobile-drawer--open' : ''}`}>
        <div className="mobile-drawer__handle" onClick={closeDrawer} />

        <div className="mobile-drawer__section-label" style={{ marginTop: 0 }}>Navegar</div>
        <div className="mobile-drawer__grid mobile-drawer__grid--featured">
          {NAV_DRAWER.filter(n => n.featured).map(n => (
            <NavLink
              key={n.to} to={n.to}
              onClick={closeDrawer}
              className={({ isActive }) => `mobile-drawer__item mobile-drawer__item--featured${isActive ? ' active' : ''}`}
              style={{ position: 'relative' }}
            >
              <span className="mobile-drawer__item-icon">{n.icon}</span>
              <span className="mobile-drawer__item-label">{n.label}</span>
              {n.to === '/meus-grupos' && inviteCount > 0 && (
                <span style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--lose)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {inviteCount}
                </span>
              )}
            </NavLink>
          ))}
        </div>
        <div className="mobile-drawer__grid">
          {NAV_DRAWER.filter(n => !n.featured).map(n => (
            <NavLink
              key={n.to} to={n.to}
              onClick={closeDrawer}
              className={({ isActive }) => `mobile-drawer__item${isActive ? ' active' : ''}`}
            >
              <span className="mobile-drawer__item-icon">{n.icon}</span>
              <span className="mobile-drawer__item-label">{n.label}</span>
            </NavLink>
          ))}
          {user && (
            <NavLink
              to={`/usuarios/${user.id}/historico`}
              onClick={closeDrawer}
              className={({ isActive }) => `mobile-drawer__item${isActive ? ' active' : ''}`}
            >
              <span className="mobile-drawer__item-icon"><IconHistory /></span>
              <span className="mobile-drawer__item-label">Histórico</span>
            </NavLink>
          )}
          {/* Página estática (fora do SPA) — <a> normal, recarrega a página */}
          <a href="/noticias" className="mobile-drawer__item" onClick={closeDrawer}>
            <span className="mobile-drawer__item-icon">📰</span>
            <span className="mobile-drawer__item-label">Notícias</span>
          </a>
        </div>

        {user?.role === 'admin' && (
          <>
            <div className="mobile-drawer__section-label">Admin</div>
            <div className="mobile-drawer__grid">
              {ADMIN_NAV.map(n => (
                <NavLink
                  key={n.to} to={n.to} end
                  onClick={closeDrawer}
                  className={({ isActive }) => `mobile-drawer__item${isActive ? ' active' : ''}`}
                >
                  <span className="mobile-drawer__item-icon">{n.icon}</span>
                  <span className="mobile-drawer__item-label">{n.label}</span>
                </NavLink>
              ))}
            </div>
          </>
        )}

        <div className="mobile-drawer__footer" style={{ flexDirection: 'column', gap: 8 }}>
          {user && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 4 }}>
              <NotificationBell />
            </div>
          )}
          {showInstallBtn && (
            <button
              onClick={() => { closeDrawer(); hasPrompt ? install() : setShowInstallModal(true) }}
              className="btn btn-sm w-full pwa-install-btn"
            >
              📲 Instalar App
            </button>
          )}
          <button
            type="button"
            onClick={() => { setDrawerOpen(false); setShareOpen(true) }}
            className="btn btn-sm w-full"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700 }}
          >
            🔗 Compartilhar o Bolão
          </button>
          {user ? (
            <button onClick={handleLogout} className="mobile-drawer__logout">
              <LogoutIcon /> Sair da conta
            </button>
          ) : (
            <NavLink to="/login" onClick={closeDrawer} className="btn btn-primary" style={{ flex: 1, textAlign: 'center' }}>
              Entrar
            </NavLink>
          )}
        </div>
      </div>

      {/* ── Share modal ──────────────────────────────── */}
      {shareOpen && <ShareModal onClose={() => { setShareOpen(false); setDrawerOpen(false) }} token={token} />}

      {/* ── Popups (novidades de versão + palpite de campeão) ── */}
      <AppPopups />

      {/* ── Popup manual instalar app (Android sem beforeinstallprompt / iOS) ── */}
      {showInstallModal && <InstallAppPopup onClose={() => setShowInstallModal(false)} />}

      {/* ── Widget jogo ao vivo flutuante (global, todas as páginas) ── */}
      <LiveFloating />

      {/* ── Mobile dock ──────────────────────────────── */}
      <nav className="mobile-dock" aria-label="Navegação principal">
        <NavLink to="/" end className={({ isActive }) => `mobile-dock__item${isActive ? ' active' : ''}`}>
          <span className="mobile-dock__icon">⚽</span>
          <span className="mobile-dock__label">Dashboard</span>
        </NavLink>

        <NavLink to="/apostas" className={({ isActive }) => `mobile-dock__item${isActive ? ' active' : ''}`}>
          <span className="mobile-dock__icon"><IconTarget size={20} /></span>
          <span className="mobile-dock__label">Palpites</span>
        </NavLink>

        {/* FAB central */}
        <div className="mobile-dock__fab-wrap">
          <button
            onClick={() => setDrawerOpen(o => !o)}
            className={`mobile-fab${drawerOpen ? ' mobile-fab--open' : ''}`}
            aria-label="Menu"
          >
            {drawerOpen ? <CloseIcon /> : <GridIcon />}
          </button>
        </div>

        <NavLink to="/ranking" className={({ isActive }) => `mobile-dock__item${isActive ? ' active' : ''}`}>
          <span className="mobile-dock__icon"><IconPodium size={20} /></span>
          <span className="mobile-dock__label">Ranking</span>
        </NavLink>

        <NavLink to="/meus-grupos" className={({ isActive }) => `mobile-dock__item${isActive ? ' active' : ''}`}>
          <span className="mobile-dock__icon"><IconUsers size={20} /></span>
          <span className="mobile-dock__label">Grupos</span>
          {inviteCount > 0 && <span className="mobile-dock__badge">{inviteCount}</span>}
        </NavLink>
      </nav>
    </>
  )
}

// ── Icon components ────────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4"/>
      <line x1="12" y1="2" x2="12" y2="4"/>
      <line x1="12" y1="20" x2="12" y2="22"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="2" y1="12" x2="4" y2="12"/>
      <line x1="20" y1="12" x2="22" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  )
}

function SystemIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  )
}

function GridIcon() {
  /* Bola de futebol desenhada nativa em 24×24 */
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
      {/* bola branca */}
      <circle cx="12" cy="12" r="10" fill="white" opacity="0.96"/>
      {/* patch central — pentágono */}
      <polygon points="12,5.5 14.9,7.7 13.8,11 10.2,11 9.1,7.7" fill="#063330"/>
      {/* patch inferior */}
      <polygon points="10.2,13 13.8,13 15,16.2 12,18.2 9,16.2" fill="#063330" opacity="0.7"/>
      {/* patch esquerda-cima */}
      <polygon points="9.1,7.7 6.5,9.5 5.2,12.5 7.5,13.8 10.2,11" fill="#063330" opacity="0.55"/>
      {/* patch direita-cima */}
      <polygon points="14.9,7.7 17.5,9.5 18.8,12.5 16.5,13.8 13.8,11" fill="#063330" opacity="0.55"/>
      {/* contorno sutil */}
      <circle cx="12" cy="12" r="10" stroke="rgba(6,51,48,0.15)" strokeWidth="0.5" fill="none"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
}
