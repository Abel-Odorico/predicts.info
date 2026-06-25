import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import Layout        from './components/Layout'
import VotacaoBanner from './components/VotacaoBanner'
import Onboarding    from './components/Onboarding'
import Spinner       from './components/Spinner'
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

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Layout />
        <main className="main">
          <VotacaoBanner />
          <ProfileCompletionNotice />
          <Onboarding />
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
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
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
