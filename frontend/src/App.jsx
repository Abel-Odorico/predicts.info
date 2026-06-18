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
import UserHistory from './pages/UserHistory'
import Results     from './pages/Results'

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Layout />
        <main className="main">
          <Routes>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/partida/:id" element={<MatchSim />} />
            <Route path="/torneio"     element={<Tournament />} />
            <Route path="/grupos"      element={<Groups />} />
            <Route path="/resultados"  element={<Results />} />
            <Route path="/apostas"     element={<Bets />} />
            <Route path="/ranking"     element={<Ranking />} />
            <Route path="/usuarios/:userId/historico" element={<UserHistory />} />
            <Route path="/admin"       element={<Admin />} />
            <Route path="/login"       element={<Login />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
