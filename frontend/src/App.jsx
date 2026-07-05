import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import Layout        from './components/Layout'
import VotacaoBanner from './components/VotacaoBanner'
import Onboarding    from './components/Onboarding'
import Spinner       from './components/Spinner'
import AdSlot        from './components/AdSlot'
import { useAuth }   from './stores/authStore'
import { api }       from './api'

const Dashboard     = lazy(() => import('./pages/Dashboard'))
const MatchSim      = lazy(() => import('./pages/MatchSim'))
const Tournament    = lazy(() => import('./pages/Tournament'))
const Groups        = lazy(() => import('./pages/Groups'))
const Decisivos     = lazy(() => import('./pages/Decisivos'))
const Ranking       = lazy(() => import('./pages/Ranking'))
const Bets          = lazy(() => import('./pages/Bets'))
const Admin         = lazy(() => import('./pages/Admin'))
const Login         = lazy(() => import('./pages/Login'))
const UserHistory   = lazy(() => import('./pages/UserHistory'))
const Results       = lazy(() => import('./pages/Results'))
const AdminOptions  = lazy(() => import('./pages/AdminOptions'))
const Analytics     = lazy(() => import('./pages/Analytics'))
const Privacy       = lazy(() => import('./pages/Privacy'))
const Terms         = lazy(() => import('./pages/Terms'))
const About         = lazy(() => import('./pages/About'))
const Contact       = lazy(() => import('./pages/Contact'))
const UserGroups    = lazy(() => import('./pages/UserGroups'))
const GroupRanking  = lazy(() => import('./pages/GroupRanking'))
const JoinGroup     = lazy(() => import('./pages/JoinGroup'))
const Profile       = lazy(() => import('./pages/Profile'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword  = lazy(() => import('./pages/ResetPassword'))
const Votacao       = lazy(() => import('./pages/Votacao'))
const Regras        = lazy(() => import('./pages/Regras'))
const Changelog     = lazy(() => import('./pages/Changelog'))
const ChampionPick  = lazy(() => import('./pages/ChampionPick'))
const PosCopa       = lazy(() => import('./pages/PosCopa'))

function RefCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')
    if (ref && /^\d+$/.test(ref)) {
      localStorage.setItem('predicts_ref', ref)
    }
  }, [])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <RefCapture />
      <div className="app">
        <Layout />
        <main className="main">
          <PullToRefresh />
          <UpdateBanner />
          <VotacaoBanner />
          <ProfileCompletionNotice />
          <Onboarding />
          <AdSlotByRoute slot="header" />
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/"            element={<Dashboard />} />
              <Route path="/dashboard"   element={<Dashboard />} />
              <Route path="/partida/:id" element={<MatchSim />} />
              <Route path="/torneio"     element={<Tournament />} />
              <Route path="/grupos"      element={<Groups />} />
              <Route path="/decisivos"   element={<Decisivos />} />
              <Route path="/resultados"  element={<Results />} />
              <Route path="/apostas"     element={<Bets />} />
              <Route path="/ranking"     element={<Ranking />} />
              <Route path="/meus-grupos" element={<UserGroups />} />
              <Route path="/meus-grupos/:groupId" element={<GroupRanking />} />
              <Route path="/bolao/:token" element={<JoinGroup />} />
              <Route path="/usuarios/:userId/historico" element={<UserHistory />} />
              <Route path="/admin"            element={<Admin />} />
              <Route path="/admin/options"    element={<AdminOptions />} />
              <Route path="/admin/analytics"  element={<Analytics />} />
              <Route path="/login"            element={<Login />} />
              <Route path="/entrar"           element={<Login initialMode="register" />} />
              <Route path="/privacidade"      element={<Privacy />} />
              <Route path="/termos"           element={<Terms />} />
              <Route path="/sobre"            element={<About />} />
              <Route path="/contato"          element={<Contact />} />
              <Route path="/perfil"           element={<Profile />} />
              <Route path="/esqueci-senha"    element={<ForgotPassword />} />
              <Route path="/redefinir-senha"  element={<ResetPassword />} />
              <Route path="/votacao"          element={<Votacao />} />
              <Route path="/regras"           element={<Regras />} />
              <Route path="/changelog"        element={<Changelog />} />
              <Route path="/campeao"          element={<ChampionPick />} />
              <Route path="/pos-copa"         element={<PosCopa />} />
            </Routes>
          </Suspense>
          <AdSlotByRoute slot="content" />
        </main>
      </div>
    </BrowserRouter>
  )
}

function AdSlotByRoute({ slot }) {
  const { pathname } = useLocation()
  return <AdSlot key={`${slot}-${pathname}`} slot={slot} style={{ display: 'block', margin: '16px 0' }} />
}


// ── Banner de atualização do PWA ──────────────────────────────────────────────
function UpdateBanner() {
  const [show, setShow] = useState(false)
  const [version, setVersion] = useState(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const handler = async () => {
      setShow(true)
      try {
        const v = await api.get('/version/latest')
        setVersion(v)
      } catch {}
    }
    window.addEventListener('sw-update-ready', handler)
    return () => window.removeEventListener('sw-update-ready', handler)
  }, [])

  if (!show) return null

  const changes = version?.changes || []

  return (
    <div style={{
      position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 68px)',
      left: 12, right: 12, zIndex: 8500,
      background: 'var(--bg-card)',
      border: '2px solid var(--accent)',
      borderRadius: 14,
      boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
      animation: 'fadeSlideUp 350ms cubic-bezier(.22,.68,0,1.2)',
      overflow: 'hidden',
    }}>
      {/* row principal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px' }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>🚀</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 14, color: 'var(--text-1)', lineHeight: 1.2 }}>
            {version ? `v${version.version} — ${version.title}` : 'Nova versão disponível'}
          </div>
          {!expanded && changes.length > 0 && (
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {changes[0]}
            </div>
          )}
        </div>
        {changes.length > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-overlay)', color: 'var(--text-3)', cursor: 'pointer', fontSize: 11,
            }}
          >{expanded ? '▲' : '▼'}</button>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            flexShrink: 0, padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff',
            fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
          }}
        >Atualizar</button>
        <button
          onClick={() => setShow(false)}
          style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'var(--bg-overlay)', color: 'var(--text-4)', fontSize: 14,
          }}
        >×</button>
      </div>

      {/* changelog expandido */}
      {expanded && changes.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px 14px' }}>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {changes.map((c, i) => (
              <li key={i} style={{ display: 'flex', gap: 8, fontFamily: 'var(--font-cond)', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.4 }}>
                <span style={{ color: 'var(--accent)', flexShrink: 0 }}>＋</span>{c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Pull-to-refresh no PWA standalone ─────────────────────────────────────────
function PullToRefresh() {
  const [pullY, setPullY] = useState(0)
  const [state, setState] = useState('idle') // idle | pulling | releasing | refreshing
  const startYRef = useRef(0)
  const THRESHOLD = 72

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || !!window.navigator.standalone
    if (!isStandalone) return

    function onTouchStart(e) {
      if (window.scrollY > 2) return
      startYRef.current = e.touches[0].clientY
      setState('pulling')
    }

    function onTouchMove(e) {
      if (!startYRef.current) return
      const delta = e.touches[0].clientY - startYRef.current
      if (delta <= 0) { setPullY(0); return }
      // ease resistance beyond threshold
      const y = delta < THRESHOLD ? delta : THRESHOLD + (delta - THRESHOLD) * 0.3
      setPullY(Math.min(y, THRESHOLD + 30))
      if (delta > 8) e.preventDefault()
    }

    function onTouchEnd() {
      if (!startYRef.current) return
      startYRef.current = 0
      if (pullY >= THRESHOLD) {
        setState('refreshing')
        setPullY(THRESHOLD)
        setTimeout(() => window.location.reload(), 500)
      } else {
        setState('releasing')
        setPullY(0)
        setTimeout(() => setState('idle'), 300)
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove',  onTouchMove,  { passive: false })
    document.addEventListener('touchend',   onTouchEnd)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove',  onTouchMove)
      document.removeEventListener('touchend',   onTouchEnd)
    }
  }, [pullY])

  if (state === 'idle') return null

  const progress = Math.min(pullY / THRESHOLD, 1)
  const isReady  = progress >= 1 || state === 'refreshing'

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
      height: pullY,
      background: 'var(--bg-card)',
      borderBottom: `2px solid ${isReady ? 'var(--accent)' : 'var(--border)'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
      transition: state === 'releasing' ? 'height 250ms ease, border-color 200ms' : 'border-color 200ms',
    }}>
      {state === 'refreshing' ? (
        <span style={{ fontSize: 20, animation: 'spinCW 0.5s linear infinite', display: 'block' }}>↻</span>
      ) : (
        <span style={{
          fontSize: 18, display: 'block', opacity: progress,
          transform: `rotate(${progress * 180}deg)`,
          transition: 'transform 100ms',
          color: isReady ? 'var(--accent)' : 'var(--text-3)',
        }}>↓</span>
      )}
    </div>
  )
}

function ProfileCompletionNotice() {
  const { user } = useAuth()
  const location = useLocation()
  const [noticeConfig, setNoticeConfig] = useState(null)

  useEffect(() => {
    api.get('/site-config/public')
      .then(setNoticeConfig)
      .catch(() => setNoticeConfig({}))
  }, [])

  if (!user || location.pathname === '/login' || noticeConfig === null) return null

  const cfg = noticeConfig
  const enabled = cfg.user_notice_enabled !== 'false'
  if (!enabled) return null

  const targetUrl = cfg.user_notice_url || '/perfil'
  if (location.pathname === targetUrl) return null

  const missingUsername = !user.username
  const missingPhone = !user.phone
  const profileOnly = cfg.user_notice_profile_only !== 'false'
  if (profileOnly && !missingUsername && !missingPhone) return null

  const missingItems = [
    missingUsername ? 'escolher seu @usuário' : null,
    missingPhone ? 'cadastrar seu celular' : null,
  ].filter(Boolean)

  const fallbackItems = 'escolher seu @usuário e cadastrar seu celular'
  const itemText = missingItems.length > 0 ? missingItems.join(' e ') : fallbackItems
  const title = cfg.user_notice_title || 'Complete seu perfil'
  const body = (cfg.user_notice_text || 'Agora você pode {itens} para deixar sua conta mais fácil de encontrar nos bolões.')
    .replace('{itens}', itemText)
  const buttonText = cfg.user_notice_button || 'Atualizar perfil'
  const isExternal = /^https?:\/\//.test(targetUrl)

  return (
    <div className="profile-completion-notice" role="status">
      <div className="profile-completion-notice__icon">@</div>
      <div className="profile-completion-notice__copy">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      {isExternal ? (
        <a href={targetUrl} className="btn btn-primary btn-sm profile-completion-notice__action">
          {buttonText}
        </a>
      ) : (
        <Link to={targetUrl} className="btn btn-primary btn-sm profile-completion-notice__action">
          {buttonText}
        </Link>
      )}
    </div>
  )
}
