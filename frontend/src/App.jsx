import { BrowserRouter, Routes, Route } from 'react-router-dom'
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

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Layout />
        <main className="main">
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
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
