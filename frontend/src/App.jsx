import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard   from './pages/Dashboard'
import MatchSim    from './pages/MatchSim'
import Tournament  from './pages/Tournament'
import Groups      from './pages/Groups'
import Ranking     from './pages/Ranking'
import Bets        from './pages/Bets'
import Admin       from './pages/Admin'
import Login       from './pages/Login'
import UserHistory    from './pages/UserHistory'
import Results        from './pages/Results'
import AdminOptions   from './pages/AdminOptions'
import Analytics      from './pages/Analytics'
import Privacy        from './pages/Privacy'
import Terms          from './pages/Terms'
import About          from './pages/About'
import Contact        from './pages/Contact'
import UserGroups     from './pages/UserGroups'
import GroupRanking   from './pages/GroupRanking'
import JoinGroup      from './pages/JoinGroup'
import Profile        from './pages/Profile'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword  from './pages/ResetPassword'
import { useAuth } from './stores/authStore'
import { api } from './api'

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Layout />
        <main className="main">
          <ProfileCompletionNotice />
          <Routes>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/dashboard"   element={<Dashboard />} />
            <Route path="/partida/:id" element={<MatchSim />} />
            <Route path="/torneio"     element={<Tournament />} />
            <Route path="/grupos"      element={<Groups />} />
            <Route path="/resultados"  element={<Results />} />
            <Route path="/apostas"     element={<Bets />} />
            <Route path="/ranking"     element={<Ranking />} />
            <Route path="/meus-grupos" element={<UserGroups />} />
            <Route path="/meus-grupos/:groupId" element={<GroupRanking />} />
            <Route path="/bolao/:token" element={<JoinGroup />} />
            <Route path="/usuarios/:userId/historico" element={<UserHistory />} />
            <Route path="/admin"         element={<Admin />} />
            <Route path="/admin/options"    element={<AdminOptions />} />
            <Route path="/admin/analytics"  element={<Analytics />} />
            <Route path="/login"       element={<Login />} />
            <Route path="/privacidade" element={<Privacy />} />
            <Route path="/termos"      element={<Terms />} />
            <Route path="/sobre"       element={<About />} />
            <Route path="/contato"     element={<Contact />} />
            <Route path="/perfil"         element={<Profile />} />
            <Route path="/esqueci-senha"  element={<ForgotPassword />} />
            <Route path="/redefinir-senha" element={<ResetPassword />} />
          </Routes>
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
