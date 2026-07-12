import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { api, CONF_HEX } from '../api'
import Spinner from '../components/Spinner'
import MyChampionCard from '../components/MyChampionCard'
import LiveClassificationCard from '../components/LiveClassificationCard'
import { InstallAppPopup, CompetitionPopup } from '../components/AppPopups'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import LigaFlowModal from '../components/LigaFlowModal'
import { PT_NAMES } from '../utils/teamNames'
import { useAuth } from '../stores/authStore'
import { useCountdown, CountdownDisplay } from '../hooks/useCountdown.jsx'
import BattleHistoryCard from '../components/BattleHistoryCard'

const PHASE_LABELS = { r32: '16avos', r16: 'Oitavas', qf: 'Quartas', sf: 'Semi', '3rd': '3º Lugar', final: 'Final' }

const CONV_DISMISS_KEY    = 'predicts_conv_popup_v1'
const INSTALL_BANNER_KEY  = 'predicts_install_banner_v1'

const INSTALL_BANNER_DAYS = 30   // reaparece a cada 30 dias
const INSTALL_BANNER_X    = 60   // dismiss manual → 60 dias

// Teaser do Brasileirão → /brasileirao (página real, ainda não é a guia principal). Dismiss persiste em localStorage.
const BR_TEASER_KEY = 'predicts_br_teaser_v1'

function BrasileiraoTeaser({ navigate }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(BR_TEASER_KEY) === '1')
  if (hidden) return null

  function dismiss(e) {
    e.stopPropagation()
    localStorage.setItem(BR_TEASER_KEY, '1')
    setHidden(true)
  }

  return (
    <button
      type="button"
      onClick={() => navigate('/brasileirao')}
      style={{
        width: '100%', margin: '12px 0', padding: '14px 16px',
        background: 'linear-gradient(135deg, #0b4d1f 0%, #063616 100%)',
        border: '1.5px solid rgba(46,204,113,0.55)', borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', textAlign: 'left', position: 'relative',
      }}
    >
      <span style={{ fontSize: 28, flexShrink: 0 }}>🇧🇷</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: '#2ecc71', letterSpacing: '0.08em' }}>
          NOVO
        </div>
        <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: '#fff', marginTop: 2 }}>
          Brasileirão no Predicts
        </div>
        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
          Tabela, projeção de título/G4/rebaixamento e palpite por rodada. Confere →
        </div>
      </div>
      <span
        onClick={dismiss}
        role="button"
        aria-label="Dispensar"
        style={{
          position: 'absolute', top: 6, right: 10, fontSize: 16,
          color: 'rgba(255,255,255,0.55)', padding: 4, lineHeight: 1,
        }}
      >
        ×
      </span>
    </button>
  )
}

function InstallBanner() {
  const { install, isStandalone, installed, hasPrompt } = useInstallPrompt()
  const [showPopup, setShowPopup] = useState(false)
  const [visible,   setVisible]   = useState(false)

  useEffect(() => {
    if (isStandalone || installed) return
    const v = localStorage.getItem(INSTALL_BANNER_KEY)
    if (v && Date.now() < parseInt(v, 10)) return
    // primeira exibição ou 30 dias passados — agenda próxima em 30 dias
    localStorage.setItem(INSTALL_BANNER_KEY, String(Date.now() + INSTALL_BANNER_DAYS * 86400000))
    setVisible(true)
  }, [isStandalone, installed])

  if (!visible) return null

  function handleInstall() {
    if (hasPrompt) install()
    else setShowPopup(true)
  }

  function handleDismiss() {
    // × explícito → reseta janela para 60 dias a partir de agora
    localStorage.setItem(INSTALL_BANNER_KEY, String(Date.now() + INSTALL_BANNER_X * 86400000))
    setVisible(false)
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0',
        background: 'rgba(15,122,120,0.08)', border: '1px solid rgba(15,122,120,0.25)',
        borderRadius: 12, padding: '12px 14px',
      }}>
        <span style={{ fontSize: 24, flexShrink: 0 }}>📲</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>
            Instale o app
          </div>
          <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)' }}>
            Acesso rápido + notificações de jogos
          </div>
        </div>
        <button
          onClick={handleInstall}
          style={{
            flexShrink: 0, padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--accent)', color: '#fff',
            fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
          }}
        >
          Instalar
        </button>
        <button
          onClick={handleDismiss}
          style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'var(--bg-overlay)', color: 'var(--text-4)', fontSize: 14, lineHeight: 1,
          }}
          aria-label="Fechar"
        >×</button>
      </div>
      {showPopup && <InstallAppPopup onClose={() => setShowPopup(false)} />}
    </>
  )
}

function ConversionPopup({ top3, onClose }) {
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(3,8,14,0.78)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in-1"
        style={{
          width: '100%', maxWidth: 440,
          background: 'var(--bg-card)', border: '1.5px solid var(--accent)',
          borderRadius: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
          overflow: 'hidden', position: 'relative',
        }}
      >
        {/* Header accent bar */}
        <div style={{ height: 4, background: 'linear-gradient(90deg, var(--accent) 0%, #d4af37 100%)' }} />

        <button
          onClick={onClose}
          aria-label="Fechar"
          style={{
            position: 'absolute', top: 14, right: 14, zIndex: 2,
            width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
            background: 'var(--bg-overlay)', color: 'var(--text-2)', fontSize: 15, lineHeight: 1,
          }}
        >×</button>

        <div style={{ padding: '20px 22px 22px' }}>
          {/* Eyebrow */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 6 }}>
            🏆 COPA DO MUNDO 2026 · FASE ELIMINATÓRIA
          </div>

          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-1)', margin: '0 0 4px', letterSpacing: '0.03em', lineHeight: 1.15 }}>
            Quem vai chegar à Final?
          </h2>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Acompanhe o caminho de cada seleção até o título. Faça seus palpites, entre no bolão e compita com amigos.
          </p>

          {/* Top 3 favoritos */}
          {top3.length > 0 && (
            <div style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', letterSpacing: '0.08em', marginBottom: 10 }}>
                FAVORITOS AO TÍTULO
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {top3.map((t, i) => (
                  <div key={t.code} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, minWidth: 22, color: i === 0 ? 'var(--accent)' : 'var(--text-4)' }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                    </span>
                    {t.flag_url && <img src={t.flag_url} alt={t.code} style={{ width: 28, height: 20, objectFit: 'cover', borderRadius: 2 }} />}
                    <span style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 14, flex: 1, color: 'var(--text-1)' }}>
                      {PT_NAMES[t.code] || t.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: i === 0 ? 'var(--accent)' : 'var(--text-3)' }}>
                      {t.prob_title?.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA principal */}
          <Link
            to="/login?tab=register"
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '100%', padding: '12px 0', borderRadius: 10, marginBottom: 8,
              background: 'var(--accent)', color: '#fff', textDecoration: 'none',
              fontFamily: 'var(--font-cond)', fontSize: 15, fontWeight: 700, letterSpacing: '0.04em',
            }}
          >
            Criar conta grátis e fazer palpites →
          </Link>

          {/* CTAs secundários */}
          <div style={{ display: 'flex', gap: 8 }}>
            <Link
              to="/torneio"
              onClick={onClose}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '9px 0', borderRadius: 8, textDecoration: 'none',
                background: 'var(--bg-overlay)', color: 'var(--text-2)',
                fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, border: '1px solid var(--border)',
              }}
            >
              📅 Ver confrontos
            </Link>
            <Link
              to="/login"
              onClick={onClose}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '9px 0', borderRadius: 8, textDecoration: 'none',
                background: 'var(--bg-overlay)', color: 'var(--text-2)',
                fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600, border: '1px solid var(--border)',
              }}
            >
              Já tenho conta
            </Link>
          </div>

          <div style={{ marginTop: 12, textAlign: 'center', fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)' }}>
            100% gratuito · sem anúncios intrusivos
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function Dashboard() {
  const { token }                     = useAuth()
  const [matches, setMatches]         = useState([])
  const [results, setResults]         = useState([])
  const [userBetsMap, setUserBetsMap] = useState({})
  const [tourney, setTourney]         = useState(null)
  const [liveGames, setLiveGames]     = useState([])
  const [calendar, setCalendar]       = useState([])
  const [topBettors, setTopBettors]   = useState([])
  const [liveBets, setLiveBets]       = useState({})
  const [appVersion, setAppVersion]   = useState(null)
  const [competition, setCompetition] = useState(null)
  const [awards, setAwards]           = useState(null)
  const [loading, setLoading]         = useState(true)
  const [showConvPopup,  setShowConvPopup]  = useState(false)
  const [showLigaModal,  setShowLigaModal]  = useState(false)
  const [showCompPopup,  setShowCompPopup]  = useState(false)
  const [goalFlash, setGoalFlash] = useState({})
  const prevScoresRef = useRef({})
  const navigate = useNavigate()
  const compCountdown = useCountdown(competition?.start_date)

  // Popup de conversão: só para anônimos, 10s de delay, dismiss por 3 dias
  useEffect(() => {
    if (token) return
    const dismissed = localStorage.getItem(CONV_DISMISS_KEY)
    if (dismissed) {
      const until = parseInt(dismissed, 10)
      if (Date.now() < until) return
    }
    const t = setTimeout(() => setShowConvPopup(true), 10000)
    return () => clearTimeout(t)
  }, [token])

  function closeConvPopup() {
    localStorage.setItem(CONV_DISMISS_KEY, String(Date.now() + 3 * 24 * 60 * 60 * 1000))
    setShowConvPopup(false)
  }

  useEffect(() => {
    let mounted = true

    // Detecta gol comparando placar do poll anterior — mesma lógica do LiveFloating
    function detectGoals(games) {
      const flashed = []
      for (const g of games) {
        if (g.status !== 'live') continue
        const k = `${g.team_a}-${g.team_b}`
        const sa = g.score_a ?? 0
        const sb = g.score_b ?? 0
        const prev = prevScoresRef.current[k]
        if (prev && (sa > prev.sa || sb > prev.sb)) flashed.push(k)
        prevScoresRef.current[k] = { sa, sb }
      }
      if (flashed.length) {
        setGoalFlash(f => {
          const next = { ...f }
          flashed.forEach(k => { next[k] = true })
          return next
        })
        setTimeout(() => {
          setGoalFlash(f => {
            const next = { ...f }
            flashed.forEach(k => { delete next[k] })
            return next
          })
        }, 2800)
      }
    }

    async function loadAll() {
      try {
        const [sched, done, tour, live, fullCalendar] = await Promise.all([
          api.get('/matches?status=scheduled&limit=50'),
          api.get('/matches?status=finished&limit=10'),
          api.get('/tournament/simulate?n=50000'),
          api.get('/live/world-cup'),
          api.get('/matches/calendar'),
        ])
        if (!mounted) return
        setMatches(sched)
        setResults(done)
        setTourney(tour)
        const games = live?.games || []
        detectGoals(games)
        setLiveGames(games)
        setCalendar(fullCalendar?.days || [])
        api.get('/ranking?limit=8').then(bettors => {
          if (!mounted) return
          setTopBettors(Array.isArray(bettors) ? bettors.filter(b => b.total_points > 0) : [])
        }).catch(() => {})
        api.get('/version/latest').then(v => { if (mounted) setAppVersion(v) }).catch(() => {})
        api.get('/competition/active').then(c => { if (mounted) setCompetition(c || null) }).catch(() => {})
        api.get('/tournament/awards').then(a => { if (mounted) setAwards(a) }).catch(() => {})
        if (token) {
          api.get('/bets/mine', token).then(myBets => {
            if (!mounted || !Array.isArray(myBets)) return
            setUserBetsMap(Object.fromEntries(myBets.map(b => [b.match_id, b])))
          }).catch(() => {})
        }
        const liveMatchIds = games.filter(g => g.status === 'live' && g.match_id).map(g => g.match_id)
        if (liveMatchIds.length > 0) {
          Promise.all(liveMatchIds.map(id => api.get(`/matches/${id}/live-bets`, token).catch(() => null)))
            .then(results => {
              if (!mounted) return
              const map = {}
              results.forEach(r => { if (r) map[r.match_id] = r.bets })
              setLiveBets(map)
            })
        }
      } catch (error) {
        console.error(error)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    async function refreshLive() {
      try {
        const [live, fullCalendar] = await Promise.all([
          api.get('/live/world-cup'),
          api.get('/matches/calendar'),
        ])
        if (!mounted) return
        const games = live?.games || []
        detectGoals(games)
        setLiveGames(games)
        setCalendar(fullCalendar?.days || [])
        const liveMatchIds = games.filter(g => g.status === 'live' && g.match_id).map(g => g.match_id)
        if (liveMatchIds.length > 0) {
          Promise.all(liveMatchIds.map(id => api.get(`/matches/${id}/live-bets`, token).catch(() => null)))
            .then(results => {
              if (!mounted) return
              const map = {}
              results.forEach(r => { if (r) map[r.match_id] = r.bets })
              setLiveBets(map)
            })
        }
      } catch (error) {
        console.error(error)
      }
    }

    loadAll()
    const intervalId = window.setInterval(refreshLive, 10000)
    return () => {
      mounted = false
      window.clearInterval(intervalId)
    }
  }, [])

  if (loading) return <Spinner text="Carregando dados da Copa..." />

  const _mdTime = (m) => m.match_date
    ? new Date(m.match_date.endsWith('Z') ? m.match_date : m.match_date + 'Z').getTime()
    : Infinity
  const _now = Date.now()

  const dayKey = m => {
    if (!m.match_date) return '?'
    const d = new Date(m.match_date.endsWith('Z') ? m.match_date : m.match_date + 'Z')
    return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  }
  const dayLabel = key => {
    if (key === '?') return '—'
    const d = new Date(key + 'T12:00:00')
    const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    const tomorrowKey = new Date(_now + 86400000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    if (key === todayKey) return 'Hoje'
    if (key === tomorrowKey) return 'Amanhã'
    const dow = d.toLocaleDateString('pt-BR', { weekday: 'long' })
    const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    return `${dow.charAt(0).toUpperCase() + dow.slice(1)}, ${date}`
  }
  const buildByDay = arr => {
    const days = []
    let lastK = null
    arr.forEach(m => {
      const k = dayKey(m)
      if (k !== lastK) { days.push({ key: k, matches: [] }); lastK = k }
      days[days.length - 1].matches.push(m)
    })
    return days
  }
  const DayHeader = ({ label, count, suffix, isToday, first }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s2) var(--s4)', background: isToday ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface-2)', borderTop: first ? 'none' : '2px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 700, color: isToday ? 'var(--accent)' : 'var(--text-1)', letterSpacing: 0.3 }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-4)', marginLeft: 'auto' }}>{count} {suffix || (count === 1 ? 'partida' : 'partidas')}</span>
    </div>
  )
  const featured = [...matches]
    .filter(m => _mdTime(m) >= _now)
    .sort((a, b) => _mdTime(a) - _mdTime(b))[0] || matches[0]
  const top5 = tourney?.teams?.slice(0, 5) || []
  const topProb = top5[0]?.prob_title || 1
  const liveNow = liveGames.filter(game => game.status === 'live')
  const todaysGames = liveGames
  const totalCalendarMatches = calendar.reduce((sum, day) => sum + day.matches.length, 0)
  const liveUpdatedAt = liveGames.length > 0 ? 'Feed ativo' : 'Sem feed'
  const highlightedGames = [...liveGames]
    .sort((a, b) => {
      const statusWeight = s => s.status === 'live' ? 0 : s.status === 'scheduled' ? 1 : 2
      const channelCount = game => game.channels?.length || 0
      return statusWeight(a) - statusWeight(b) || channelCount(b) - channelCount(a)
    })
    .slice(0, 3)

  const top3 = tourney?.teams?.slice(0, 3) || []

  return (
    <div className="page">

      {showConvPopup && <ConversionPopup top3={top3} onClose={closeConvPopup} />}
      {showLigaModal && <LigaFlowModal token={token} onClose={() => setShowLigaModal(false)} />}

      {/* Hero para usuários não logados */}
      {!token && !loading && (
        <div className="fade-in-1" style={{
          background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%)',
          border: 'none',
          borderRadius: 14, padding: '20px 22px', marginBottom: 'var(--s5)',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.75)', letterSpacing: '0.1em', marginBottom: 6 }}>
            🏆 COPA DO MUNDO 2026 · SIMULADOR + BOLÃO ONLINE
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: '#ffffff', margin: '0 0 6px', letterSpacing: '0.03em', lineHeight: 1.2 }}>
            Faça palpites · Entre no bolão · Acompanhe a Copa
          </h2>
          <p style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'rgba(255,255,255,0.85)', margin: '0 0 14px', lineHeight: 1.5 }}>
            Palpite no placar dos jogos, escolha seu campeão e vice, veja o caminho de cada seleção até a final e compita com amigos no bolão gratuito.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/login?tab=register" style={{
              padding: '9px 18px', borderRadius: 8, background: '#fff', color: 'var(--accent)',
              textDecoration: 'none', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 700,
            }}>
              Criar conta grátis →
            </Link>
            <Link to="/torneio" style={{
              padding: '9px 18px', borderRadius: 8, background: 'rgba(255,255,255,0.18)', color: '#fff',
              textDecoration: 'none', fontFamily: 'var(--font-cond)', fontSize: 13, fontWeight: 600,
              border: '1px solid rgba(255,255,255,0.35)',
            }}>
              📅 Ver confrontos
            </Link>
            <Link to="/login" style={{
              padding: '9px 18px', borderRadius: 8, background: 'transparent', color: 'rgba(255,255,255,0.75)',
              textDecoration: 'none', fontFamily: 'var(--font-cond)', fontSize: 13,
            }}>
              Entrar
            </Link>
          </div>
        </div>
      )}

      <div className="fade-in-1">
        <div className="dash-header">
          <div>
            <h1 className="page-title">COPA DO MUNDO 2026</h1>
            <p className="page-subtitle">
              Elo · xG · Poisson · Dixon-Coles · Monte Carlo
              {appVersion?.version && (
                <span style={{
                  marginLeft: 10, fontFamily: 'var(--font-mono)', fontSize: 10,
                  color: 'var(--accent)', background: 'rgba(15,122,120,0.12)',
                  border: '1px solid rgba(15,122,120,0.25)',
                  padding: '1px 7px', borderRadius: 4, letterSpacing: '0.04em',
                }}>v{appVersion.version}</span>
              )}
            </p>
            {appVersion?.title && appVersion.version !== '1.0.0' && (
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', marginTop: 2, letterSpacing: '0.04em' }}>
                🚀 {appVersion.title}
                <span style={{ marginLeft: 8, color: 'var(--text-4)' }}>· by Peep</span>
              </p>
            )}
          </div>
          <div className="dash-nav-btns">
            <a href="/" className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>
              🌐 Início
            </a>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => navigate('/grupos')}>
              🗂 Grupos
            </button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => navigate('/meus-grupos')}>
              👥 Meus Grupos
            </button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => navigate('/changelog')}>
              📋 Changelog
            </button>
          </div>
        </div>
      </div>

      <MyChampionCard compact />

      <InstallBanner />

      <BrasileiraoTeaser navigate={navigate} />

      {/* ── Competição de Fase ── */}
      {competition && (() => {
        const isFuture = compCountdown && !compCountdown.started
        return (
          <button
            type="button"
            onClick={() => setShowCompPopup(true)}
            style={{
              width: '100%', margin: '12px 0', padding: '14px 16px',
              background: 'linear-gradient(135deg, #7a5a00 0%, #5a4000 100%)',
              border: '1.5px solid rgba(232,196,74,0.6)', borderRadius: 12,
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: 28, flexShrink: 0 }}>⚡</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: '#e8c44a', letterSpacing: '0.08em' }}>
                {isFuture ? 'EM BREVE' : 'NOVA FASE DA COMPETIÇÃO'}
              </div>
              <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 15, color: '#fff', marginTop: 2 }}>
                {competition.name}
              </div>
              {isFuture && compCountdown
                ? <CountdownDisplay timeLeft={compCountdown} style={{ marginTop: 4 }} />
                : competition.promo_text && (
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 }}>
                    {competition.promo_text}
                  </div>
                )
              }
            </div>
            <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: '#e8c44a', flexShrink: 0 }}>Ver →</span>
          </button>
        )
      })()}

      {showCompPopup && competition && (
        <CompetitionPopup
          competition={competition}
          onClose={() => setShowCompPopup(false)}
          showRankingLink
        />
      )}

      {token && (
        <button
          type="button"
          onClick={() => setShowLigaModal(true)}
          style={{
            width: '100%', margin: '12px 0', padding: '13px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'linear-gradient(135deg, rgba(15,122,120,0.18) 0%, rgba(15,122,120,0.10) 100%)',
            border: '1.5px solid rgba(15,122,120,0.55)', borderRadius: 12,
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 26, flexShrink: 0 }}>🏆</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--accent)', letterSpacing: '0.06em' }}>
              MONTE SUA LIGA PRIVADA
            </div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              Convide amigos e dispute só com sua turma
            </div>
          </div>
          <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)', flexShrink: 0 }}>Criar →</span>
        </button>
      )}

      <LiveClassificationCard />

      <div className="card fade-in-1 mt-6">
        <div className="card__body" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
          <div className="stack gap-2">
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)' }}>
              Painel Ao Vivo do Sistema
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
              <span className="badge badge-group">{todaysGames.length} jogos hoje</span>
              <span className="badge badge-group">{liveNow.length} ao vivo</span>
              <span className="badge badge-group">{calendar.length} dias no calendario</span>
              <span className="badge badge-group">{totalCalendarMatches} jogos no calendario</span>
              <span className="badge badge-group">{liveUpdatedAt}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-grid mt-8">
        <div className="stack gap-6">
          {featured && (
            <div className="card card--accent fade-in-2">
              <div className="card__header">
                <div className="row-wrap">
                  <span className="badge badge-group">Grupo {featured.group_name}</span>
                  <span
                    className="section-title"
                    style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}
                  >
                    Próxima Partida em Destaque
                  </span>
                </div>
                <Link to={`/partida/${featured.id}`} className="btn btn-primary btn-sm">
                  Simular ▶
                </Link>
              </div>

              <div className="card__body">
                <div className="featured-teams">
                  <TeamBig team={featured.team_a} />
                  <div className="featured-vs">
                    <div className="featured-vs__date">
                      {featured.match_date
                        ? new Date(featured.match_date.endsWith('Z') ? featured.match_date : featured.match_date + 'Z').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
                        : '—'}
                    </div>
                    <div className="featured-vs__label">VS</div>
                  </div>
                  <TeamBig team={featured.team_b} />
                </div>
                <div style={{ marginTop: 'var(--s4)' }}>
                  <BattleHistoryCard teamACode={featured.team_a.code} teamBCode={featured.team_b.code} />
                </div>
              </div>
            </div>
          )}

          <CopaFinalStretch matches={matches} />

          {liveNow.length > 0 && (
            <div className="card fade-in-2">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  {liveNow.length === 1 ? 'Jogo Acontecendo Agora' : `${liveNow.length} Jogos Ao Vivo`}
                </span>
                <span className="badge badge-live">Ao vivo</span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {liveNow.map((game, index) => {
                  const scored = !!goalFlash[`${game.team_a}-${game.team_b}`]
                  return (
                  <div key={`live-${game.team_a}-${game.team_b}-${index}`}
                    onClick={() => game.match_id && navigate(`/partida/${game.match_id}`)}
                    style={{
                      ...(index > 0 ? { marginTop: 'var(--s4)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--border)' } : {}),
                      ...(game.match_id ? { cursor: 'pointer' } : {})
                    }}
                  >
                    <div className="now-playing-card now-playing-card--live">
                      <div className="now-playing-card__team">
                        {game.team_a_flag && <img src={game.team_a_flag} alt={game.team_a} className="match-card__flag" />}
                        <span>{game.team_a}</span>
                      </div>
                      <div className="now-playing-card__center" style={{ position: 'relative' }}>
                        <div className={`now-playing-card__score${scored ? ' now-playing-card__score--goal' : ''}`}>
                          {game.score_a ?? '-'}:{game.score_b ?? '-'}
                        </div>
                        <div className="now-playing-card__status">{game.status_raw || 'Ao vivo'}</div>
                        {scored && (
                          <div className="goal-celebration" aria-hidden="true">
                            <span className="goal-celebration__net">🥅</span>
                            <span className="goal-celebration__ball">⚽</span>
                            <span className="goal-celebration__text">GOL!</span>
                          </div>
                        )}
                      </div>
                      <div className="now-playing-card__team now-playing-card__team--right">
                        <span>{game.team_b}</span>
                        {game.team_b_flag && <img src={game.team_b_flag} alt={game.team_b} className="match-card__flag" />}
                      </div>
                    </div>
                    {/* Venue + channels */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
                      {(game.city || game.venue) && (
                        <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-4)', letterSpacing: '0.04em' }}>
                          📍 {[game.city, game.venue].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {game.channels?.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {game.channels.slice(0, 5).map(ch => (
                            ch.img_url
                              ? <img key={ch.nome} src={ch.img_url} alt={ch.nome} title={ch.nome} style={{ height: 18, width: 'auto', objectFit: 'contain', borderRadius: 3, opacity: 0.85 }} />
                              : <span key={ch.nome} style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-3)' }}>{ch.nome}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {todaysGames.length > 0 && (
            <div className="card fade-in-2">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Jogos de Hoje
                </span>
                <span className="badge badge-group">{todaysGames.length} jogos</span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {todaysGames.map((game, index) => {
                  const scored = !!goalFlash[`${game.team_a}-${game.team_b}`]
                  return (
                  <div key={`${game.team_a}-${game.team_b}-today-${index}`} className={`live-score-row${scored ? ' live-score-row--goal' : ''}`} onClick={() => game.match_id && navigate(`/partida/${game.match_id}`)} style={game.match_id ? { cursor: 'pointer' } : {}}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                      {game.team_a_flag && <img src={game.team_a_flag} alt={game.team_a} className="match-card__flag" />}
                      <div>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 600 }}>{game.team_a}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{game.time_label}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className={`live-score-row__score${scored ? ' live-score-row__score--goal' : ''}`}>
                        {scored && <span className="live-score-row__goal-badge">⚽ GOL!</span>}
                        {game.score_a ?? '-'}:{game.score_b ?? '-'}
                      </div>
                      <div className="live-score-row__status">
                        <StatusBadge game={game} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 600 }}>{game.team_b}</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                          {game.channels?.length > 0
                            ? game.channels.slice(0, 3).map(ch =>
                                ch.img_url
                                  ? <img key={ch.nome} src={ch.img_url} alt={ch.nome} title={ch.nome} style={{ height: 14, width: 'auto', objectFit: 'contain', borderRadius: 2, opacity: 0.75 }} />
                                  : <span key={ch.nome} style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>{ch.nome}</span>
                              )
                            : <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>—</span>}
                        </div>
                      </div>
                      {game.team_b_flag && <img src={game.team_b_flag} alt={game.team_b} className="match-card__flag" />}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="card fade-in-3">
            <div className="card__header">
              <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                Próximas Partidas
              </span>
            </div>
            {(() => {
              const sorted = [...matches]
                .filter(m => m.id !== featured?.id)
                .sort((a, b) => _mdTime(a) - _mdTime(b))

              if (sorted.length === 0) return (
                <p style={{ padding: 'var(--s6)', color: 'var(--text-3)', textAlign: 'center', fontFamily: 'var(--font-cond)' }}>
                  Sem partidas agendadas
                </p>
              )

              return buildByDay(sorted).map(({ key, matches: dayMatches }, di) => {
                const label = dayLabel(key)
                return (
                  <div key={key} style={{ marginTop: di > 0 ? 'var(--s3)' : 0 }}>
                    <DayHeader label={label} count={dayMatches.length} isToday={label === 'Hoje'} first={di === 0} />
                    {dayMatches.map(m => <MatchRow key={m.id} match={m} />)}
                  </div>
                )
              })
            })()}
          </div>

          {liveGames.length > 0 && (
            <div className="card fade-in-4">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Calendário e Tempo Real
                </span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {liveGames.map((game, index) => {
                  const scored = !!goalFlash[`${game.team_a}-${game.team_b}`]
                  return (
                  <div key={`${game.team_a}-${game.team_b}-${index}`} className={`live-score-row${scored ? ' live-score-row--goal' : ''}`} onClick={() => game.match_id && navigate(`/partida/${game.match_id}`)} style={game.match_id ? { cursor: 'pointer' } : {}}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                      {game.team_a_flag && <img src={game.team_a_flag} alt={game.team_a} className="match-card__flag" />}
                      <div>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 600 }}>{game.team_a}</div>
                        <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{game.date_label} · {game.time_label}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div className={`live-score-row__score${scored ? ' live-score-row__score--goal' : ''}`}>
                        {scored && <span className="live-score-row__goal-badge">⚽ GOL!</span>}
                        {game.score_a ?? '-'}:{game.score_b ?? '-'}
                      </div>
                      <div className="live-score-row__status">
                        <StatusBadge game={game} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--font-cond)', fontSize: 14, fontWeight: 600 }}>{game.team_b}</div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                          {game.channels?.length > 0
                            ? game.channels.slice(0, 3).map(ch =>
                                ch.img_url
                                  ? <img key={ch.nome} src={ch.img_url} alt={ch.nome} title={ch.nome} style={{ height: 14, width: 'auto', objectFit: 'contain', borderRadius: 2, opacity: 0.75 }} />
                                  : <span key={ch.nome} style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>{ch.nome}</span>
                              )
                            : <span style={{ fontFamily: 'var(--font-cond)', fontSize: 10, color: 'var(--text-4)' }}>—</span>}
                        </div>
                      </div>
                      {game.team_b_flag && <img src={game.team_b_flag} alt={game.team_b} className="match-card__flag" />}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {highlightedGames.length > 0 && (
            <div className="card fade-in-4">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Destaques da Copa
                </span>
              </div>
              <div className="card__body" style={{ paddingTop: 'var(--s3)', paddingBottom: 'var(--s3)' }}>
                {highlightedGames.map((game, index) => (
                  <div key={`${game.team_a}-${game.team_b}-highlight-${index}`} className="highlight-row" onClick={() => game.match_id && navigate(`/partida/${game.match_id}`)} style={game.match_id ? { cursor: 'pointer' } : {}}>
                    <div>
                      <div className="highlight-row__teams">{game.team_a} vs {game.team_b}</div>
                      <div className="highlight-row__meta">{game.time_label} · {game.channels?.map(c => c.nome).filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="highlight-row__status">
                      {(game.score_a != null || game.score_b != null) ? `${game.score_a ?? '-'}:${game.score_b ?? '-'}` : (game.status_raw || 'Agendado')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="card fade-in-4">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Últimos Resultados
                </span>
                <Link to="/palpites" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Ver palpites →</Link>
              </div>
              {buildByDay([...results].sort((a, b) => _mdTime(b) - _mdTime(a))).map(({ key, matches: dayMatches }, di) => {
                const label = dayLabel(key)
                return (
                  <div key={key} style={{ marginTop: di > 0 ? 'var(--s3)' : 0 }}>
                    <DayHeader label={label} count={dayMatches.length} suffix={dayMatches.length === 1 ? 'resultado' : 'resultados'} isToday={label === 'Hoje'} first={di === 0} />
                    {dayMatches.map(m => <MatchRow key={m.id} match={m} done bet={userBetsMap[m.id] || null} />)}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="stack gap-6">
          {topBettors.length > 0 && (
            <TopBettorsCard bettors={topBettors} />
          )}

          {awards && <TournamentAwardsCard awards={awards} />}

          {/* ── Bracket CTA ── */}
          <div className="card fade-in-2" style={{
            border: '1.5px solid var(--accent)',
            background: 'var(--accent-dim)',
          }}>
            <div className="card__body" style={{ padding: 'var(--s4)' }}>
              <div style={{ display:'flex', alignItems:'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                <span style={{ fontSize: 28 }}>⚔️</span>
                <div>
                  <div style={{ fontFamily:'var(--font-display)', fontSize:16, letterSpacing:'0.05em', color:'var(--text-1)' }}>CHAVEAMENTO</div>
                  <div style={{ fontFamily:'var(--font-cond)', fontSize:12, color:'var(--text-2)' }}>Mata-mata · Lado A vs Lado B</div>
                </div>
              </div>
              <Link to="/torneio" className="btn btn-primary w-full" style={{ fontSize:13 }}>
                Ver Chaveamento →
              </Link>
            </div>
          </div>

          {/* ── Consultar Resultados CTA ── */}
          <div className="card fade-in-2" style={{
            border: '1.5px solid var(--accent)',
            background: 'var(--accent-dim)',
          }}>
            <div className="card__body" style={{ padding: 'var(--s4)' }}>
              <div style={{ display:'flex', alignItems:'center', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                <span style={{ fontSize: 28 }}>📋</span>
                <div>
                  <div style={{ fontFamily:'var(--font-display)', fontSize:16, letterSpacing:'0.05em', color:'var(--text-1)' }}>RESULTADOS</div>
                  <div style={{ fontFamily:'var(--font-cond)', fontSize:12, color:'var(--text-2)' }}>Busque por seleção, grupo ou data</div>
                </div>
              </div>
              <Link to="/resultados" className="btn btn-primary w-full" style={{ fontSize:13 }}>
                Consultar Resultados →
              </Link>
            </div>
          </div>

          <div className="card fade-in-2">
            <div className="card__header">
              <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                🏆 Favoritos ao Título
              </span>
            </div>
            <div className="card__body" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
              {top5.map((t, i) => (
                <div key={t.code} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--s3)',
                  padding: 'var(--s3) 0',
                  borderBottom: i < 4 ? '1px solid var(--border)' : 'none'
                }}>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: 22,
                    color: i === 0 ? 'var(--accent)' : 'var(--text-4)',
                    minWidth: 24
                  }}>{i + 1}</span>
                  {t.flag_url && <img src={t.flag_url} alt={t.code} className="match-card__flag" style={{ flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {PT_NAMES[t.code] || t.name}
                    </div>
                    <div style={{
                      height: 4, background: 'var(--bg-overlay)',
                      borderRadius: 2, marginTop: 4, overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${(t.prob_title / topProb) * 100}%`,
                        background: CONF_HEX[t.confederation] || 'var(--accent)',
                        borderRadius: 2,
                        transition: 'width 600ms ease'
                      }} />
                    </div>
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-data)', fontSize: 15, fontWeight: 600,
                    color: 'var(--accent)'
                  }}>
                    {t.prob_title.toFixed(1)}%
                  </span>
                </div>
              ))}
              {tourney && (
                <div style={{ marginTop: 'var(--s4)', textAlign: 'center' }}>
                  <Link to="/torneio" className="btn btn-ghost btn-sm w-full">
                    Ver todas as 48 seleções →
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Stats card */}
          {tourney && (
            <div className="card fade-in-3">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Simulação
                </span>
              </div>
              <div className="card__body stack gap-3" style={{ paddingTop: 'var(--s4)', paddingBottom: 'var(--s4)' }}>
                <StatRow label="Simulações" value={tourney.simulations.toLocaleString('pt-BR')} />
                <StatRow label="Tempo" value={`${tourney.elapsed_ms}ms`} />
                <StatRow label="Do cache" value={tourney.cached ? 'Sim' : 'Não'} />
                <StatRow label="Seleções" value="48" />
              </div>
            </div>
          )}

          {calendar.length > 0 && (
            <div className="card fade-in-3">
              <div className="card__header">
                <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                  Calendário Completo
                </span>
                <span className="badge badge-group">{calendar.length} dias · {totalCalendarMatches} jogos</span>
              </div>
              <div className="card__body">
                {calendar.map(day => (
                  <div key={day.date} style={{ marginBottom: 'var(--s4)' }}>
                    <div className="calendar-day__title">{formatCalendarDate(day.date)}</div>
                    <div className="stack gap-2" style={{ marginTop: 'var(--s2)' }}>
                      {day.matches.map(match => (
                        <div key={match.id} className="calendar-row" onClick={() => typeof match.id === 'number' && navigate(`/partida/${match.id}`)}>
                          <div className="calendar-row__teams">
                            {match.team_a.flag_url && <img src={match.team_a.flag_url} alt={match.team_a.code} className="match-card__flag" />}
                            {PT_NAMES[match.team_a.code] || match.team_a.code}
                            {' vs '}
                            {PT_NAMES[match.team_b.code] || match.team_b.code}
                            {match.team_b.flag_url && <img src={match.team_b.flag_url} alt={match.team_b.code} className="match-card__flag" />}
                          </div>
                          <div className="calendar-row__meta">{match.city} · {match.venue}</div>
                          <div className="calendar-row__status">
                            {match.live_score_a != null || match.live_score_b != null
                              ? `${match.live_score_a ?? '-'}:${match.live_score_b ?? '-'} · ${match.status_raw || match.status}`
                              : (match.status_raw || match.status)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CopaFinalStretch({ matches }) {
  const upcoming = [...matches]
    .filter(m => m.status === 'scheduled')
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))

  if (!upcoming.length) return null

  return (
    <div className="card card--accent fade-in-2">
      <div className="card__header">
        <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
          🏆 Reta Final da Copa
        </span>
        <span className="badge badge-group">{upcoming.length} jogo{upcoming.length !== 1 ? 's' : ''} restante{upcoming.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="card__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
        {upcoming.map((m, i) => (
          <CopaFinalStretchCard key={m.id} match={m} index={i} />
        ))}
      </div>
    </div>
  )
}

function CopaFinalStretchCard({ match, index }) {
  const countdown = useCountdown(match.match_date)
  const phaseTag = PHASE_LABELS[match.phase] || match.phase || '—'

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, delay: index * 0.12, ease: [0.22, 1, 0.36, 1] }}
      style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        padding: 'var(--s4)', background: 'var(--bg-overlay)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s3)', flexWrap: 'wrap', gap: 8 }}>
        <span className="badge badge-group">{phaseTag}</span>
        {countdown && !countdown.started && (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
              color: '#e8c44a', background: 'rgba(232,196,74,0.12)',
              borderRadius: 999, padding: '3px 10px',
              animation: 'copa-stretch-pulse 2.4s ease-in-out infinite',
            }}
          >
            ⏳ {countdown.days > 0 ? `${countdown.days}d ${countdown.hours}h` : `${countdown.hours}h ${countdown.mins}m`}
          </span>
        )}
      </div>

      <div className="featured-teams">
        <TeamBig team={match.team_a} />
        <div className="featured-vs">
          <div className="featured-vs__date">
            {new Date(match.match_date.endsWith('Z') ? match.match_date : match.match_date + 'Z')
              .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
          </div>
          <div className="featured-vs__label">VS</div>
        </div>
        <TeamBig team={match.team_b} />
      </div>

      <div style={{ marginTop: 'var(--s3)' }}>
        <BattleHistoryCard teamACode={match.team_a.code} teamBCode={match.team_b.code} />
      </div>

      <Link to={`/partida/${match.id}`} className="btn btn-primary btn-sm" style={{ marginTop: 'var(--s3)', width: '100%', textAlign: 'center' }}>
        Ver simulação ▶
      </Link>
    </motion.div>
  )
}

function TeamBig({ team }) {
  return (
    <div className="team-big">
      {team.flag_url && (
        <img src={team.flag_url} alt={team.code} className="team-big__flag" />
      )}
      <div className="team-big__code">{PT_NAMES[team.code] || team.code}</div>
      <div className="team-big__meta">Elo {Math.round(team.elo_rating)}</div>
    </div>
  )
}

function MatchRow({ match, done, bet }) {
  const navigate = useNavigate()
  const isLive = match.status === 'live'
  const hasLiveScore = match.live_score_a != null || match.live_score_b != null
  const scoreLabel = done && match.result
    ? `${match.result.score_a}–${match.result.score_b}`
    : hasLiveScore
      ? `${match.live_score_a ?? '-'}–${match.live_score_b ?? '-'}`
      : 'vs'
  const _md = match.match_date
    ? new Date(match.match_date.endsWith('Z') ? match.match_date : match.match_date + 'Z')
    : null
  const matchTime = _md ? _md.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null
  const matchDateStr = _md ? _md.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : null

  const betBadge = done && bet
    ? bet.result === 'exact'   ? { label: '🎯 +3', color: 'var(--accent)' }
    : bet.result === 'correct' ? { label: '✅ +1', color: 'var(--win)' }
    : bet.result === 'wrong'   ? { label: '❌ 0',  color: 'var(--lose)' }
    : { label: `${bet.score_a}–${bet.score_b} ⏳`, color: 'var(--text-3)' }
    : done && !bet ? { label: '— sem palpite', color: 'var(--text-4)' }
    : null

  const PHASE_LABELS = { r32: '16avos', r16: 'Oitavas', qf: 'Quartas', sf: 'Semi', '3rd': '3º Lugar', final: 'Final' }
  const phaseTag = match.group_name
    ? `G${match.group_name}`
    : (PHASE_LABELS[match.phase] || match.phase || '—')

  return (
    <div className="match-card" onClick={() => navigate(`/partida/${match.id}`)}>
      <span className="match-card__group">{phaseTag}</span>
      <div className="match-card__teams">
        <div className="match-card__team">
          {match.team_a.flag_url && (
            <img src={match.team_a.flag_url} alt={match.team_a.code} className="match-card__flag" />
          )}
          <span>{PT_NAMES[match.team_a.code] || match.team_a.code}</span>
        </div>
        <span className="match-card__sep">
          {scoreLabel}
          {!done && !isLive && matchTime && (
            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-4)', fontFamily: 'var(--font-mono)', marginTop: 2, lineHeight: 1 }}>
              {matchDateStr} {matchTime}
            </span>
          )}
        </span>
        <div className="match-card__team">
          {match.team_b.flag_url && (
            <img src={match.team_b.flag_url} alt={match.team_b.code} className="match-card__flag" />
          )}
          <span>{PT_NAMES[match.team_b.code] || match.team_b.code}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexShrink: 0 }}>
        {betBadge && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: betBadge.color, whiteSpace: 'nowrap' }}>
            {betBadge.label}
          </span>
        )}
        {done ? <span className="badge badge-done">FIM</span> : isLive ? <span className="badge badge-live">{match.status_raw || 'Ao vivo'}</span> : <span className="match-card__arrow">›</span>}
      </div>
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-data)', fontSize: 13, color: 'var(--text-1)' }}>
        {value}
      </span>
    </div>
  )
}

function formatCalendarDate(value) {
  if (!value || value === 'sem-data') return 'Sem data'
  const date = new Date(`${value}T00:00:00`)
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(date)
}

function StatusBadge({ game }) {
  if (game.status === 'live') {
    return <span className="badge badge-live">{game.status_raw || 'Ao vivo'}</span>
  }
  if (game.status === 'finished') {
    return <span className="badge badge-done">{game.status_raw || 'Fim'}</span>
  }
  return <span className="badge badge-group">{game.status_raw || 'Agendado'}</span>
}

const MEDAL = ['🥇', '🥈', '🥉']

function TopBettorsCard({ bettors }) {
  const [idx, setIdx]       = useState(0)
  const [visible, setVisible] = useState(true)
  const timerRef            = useRef(null)

  const maxPts = bettors[0]?.total_points || 1

  function goTo(next) {
    setVisible(false)
    setTimeout(() => {
      setIdx(next)
      setVisible(true)
    }, 220)
  }

  useEffect(() => {
    if (bettors.length < 2) return
    timerRef.current = setInterval(() => {
      setIdx(prev => {
        const next = (prev + 1) % bettors.length
        setVisible(false)
        setTimeout(() => setVisible(true), 220)
        return next
      })
    }, 3500)
    return () => clearInterval(timerRef.current)
  }, [bettors.length])

  const b = bettors[idx]
  if (!b) return null

  const accuracy = b.total_bets > 0 ? Math.round(((b.exact_scores + b.correct_results) / b.total_bets) * 100) : 0
  const ptsWidth  = Math.round((b.total_points / maxPts) * 100)

  return (
    <div className="card fade-in-2" style={{ overflow: 'hidden' }}>
      <div className="card__header">
        <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
          🎯 Melhores Apostadores
        </span>
        <Link to="/ranking" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
          Ver todos →
        </Link>
      </div>

      {/* dots nav */}
      <div style={{ display: 'flex', gap: 5, justifyContent: 'center', padding: '0 var(--s4) var(--s2)' }}>
        {bettors.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            style={{
              width: i === idx ? 18 : 6,
              height: 6,
              borderRadius: 3,
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              background: i === idx ? 'var(--accent)' : 'var(--border)',
              transition: 'width 300ms ease, background 300ms ease',
            }}
          />
        ))}
      </div>

      <div
        className="card__body"
        style={{
          paddingTop: 'var(--s3)',
          paddingBottom: 'var(--s4)',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(6px)',
          transition: 'opacity 220ms ease, transform 220ms ease',
        }}
      >
        {/* position + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>
            {MEDAL[idx] || `#${idx + 1}`}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 17,
              color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }}>
              {b.name}
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {b.total_bets} aposta{b.total_bets !== 1 ? 's' : ''} · {accuracy}% acertos
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--accent)', lineHeight: 1 }}>
              {b.total_points}
            </div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>pts</div>
          </div>
        </div>

        {/* points bar */}
        <div style={{ height: 5, background: 'var(--bg-overlay)', borderRadius: 3, overflow: 'hidden', marginBottom: 'var(--s4)' }}>
          <div style={{
            height: '100%',
            width: `${ptsWidth}%`,
            background: 'var(--accent)',
            borderRadius: 3,
            transition: 'width 400ms ease',
          }} />
        </div>

        {/* stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--s2)', textAlign: 'center' }}>
          <div style={{ background: 'var(--bg-overlay)', borderRadius: 8, padding: 'var(--s3) var(--s2)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--win)' }}>{b.exact_scores}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Exatos</div>
          </div>
          <div style={{ background: 'var(--bg-overlay)', borderRadius: 8, padding: 'var(--s3) var(--s2)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-2)' }}>{b.correct_results}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Acertos</div>
          </div>
          <div style={{ background: 'var(--bg-overlay)', borderRadius: 8, padding: 'var(--s3) var(--s2)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-2)' }}>{b.total_bets}</div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>Apostas</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Tournament Awards Card ───────────────────────────────────────────────────

const AWARD_TABS = [
  { key: 'scorers',  label: '⚽ Artilheiros' },
  { key: 'attack',   label: '🔥 Ataque' },
  { key: 'defense',  label: '🛡 Defesa' },
  { key: 'gk',       label: '🧤 Goleiros' },
]

function TournamentAwardsCard({ awards }) {
  const [tab, setTab] = useState('scorers')
  const [expanded, setExpanded] = useState(false)

  const scorers  = awards?.top_scorers  || []
  const attack   = awards?.best_attack  || []
  const defense  = awards?.best_defense || []
  const gk       = awards?.best_gk      || []

  const visibleScorers = expanded ? scorers : scorers.slice(0, 5)

  return (
    <div className="card fade-in-2">
      <div className="card__header">
        <span className="section-title" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
          📊 Estatísticas do Torneio
        </span>
        {awards?.updated_at && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>
            {awards.cached ? '↻' : '🔴'} {new Date(awards.updated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '0 var(--s4) var(--s2)', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {AWARD_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setExpanded(false) }}
            style={{
              padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 11, whiteSpace: 'nowrap',
              fontFamily: 'var(--font-cond)', fontWeight: tab === t.key ? 700 : 400,
              background: tab === t.key ? 'var(--accent)' : 'var(--bg-overlay)',
              color: tab === t.key ? '#fff' : 'var(--text-3)',
              transition: 'all 200ms ease',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card__body" style={{ paddingTop: 'var(--s2)', paddingBottom: 'var(--s3)' }}>
        {tab === 'scorers' && (
          <div>
            {visibleScorers.map((s, i) => (
              <div key={s.player + s.team} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 0',
                borderBottom: i < visibleScorers.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{
                  fontFamily: 'var(--font-display)', fontSize: 16, minWidth: 20, textAlign: 'right',
                  color: i === 0 ? 'var(--accent)' : i === 1 ? '#c0a060' : i === 2 ? '#9aada0' : 'var(--text-4)',
                }}>{s.position}</span>
                {s.flag_url
                  ? <img src={s.flag_url} alt={s.team} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />
                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', minWidth: 20 }}>{s.team}</span>
                }
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.player}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>
                    {s.team_name || s.team}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-data)', fontSize: 16, fontWeight: 700, color: 'var(--accent)', minWidth: 24, textAlign: 'right' }}>
                  {s.goals}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>gols</span>
              </div>
            ))}
            {scorers.length > 5 && (
              <button
                onClick={() => setExpanded(e => !e)}
                style={{ marginTop: 8, width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)' }}
              >
                {expanded ? '▲ Mostrar menos' : `▼ Ver todos os ${scorers.length} artilheiros`}
              </button>
            )}
          </div>
        )}

        {tab === 'attack' && (
          <div>
            {attack.slice(0, 8).map((t, i) => (
              <div key={t.team} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                borderBottom: i < Math.min(attack.length, 8) - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, minWidth: 18, color: i === 0 ? 'var(--accent)' : 'var(--text-4)' }}>{i + 1}</span>
                {t.flag_url
                  ? <img src={t.flag_url} alt={t.team} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />
                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', minWidth: 20 }}>{t.team}</span>
                }
                <div style={{ flex: 1, fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {PT_NAMES[t.team] || t.name}
                </div>
                <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>{t.goals_scored}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>gols</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', minWidth: 40, textAlign: 'right' }}>
                  ({t.avg_scored}/j)
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'defense' && (
          <div>
            {defense.slice(0, 8).map((t, i) => (
              <div key={t.team} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                borderBottom: i < Math.min(defense.length, 8) - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, minWidth: 18, color: i === 0 ? 'var(--accent)' : 'var(--text-4)' }}>{i + 1}</span>
                {t.flag_url
                  ? <img src={t.flag_url} alt={t.team} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />
                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', minWidth: 20 }}>{t.team}</span>
                }
                <div style={{ flex: 1, fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {PT_NAMES[t.team] || t.name}
                </div>
                <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 15, color: 'var(--win)' }}>{t.goals_conceded}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)' }}>sofridos</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-3)', minWidth: 40, textAlign: 'right' }}>
                  ({t.avg_conceded}/j)
                </span>
              </div>
            ))}
          </div>
        )}

        {tab === 'gk' && (
          <div>
            {gk.length === 0 && (
              <div style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-4)', textAlign: 'center', padding: '12px 0' }}>
                Nenhum clean sheet registrado ainda
              </div>
            )}
            {gk.map((t, i) => (
              <div key={t.team} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                borderBottom: i < gk.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, minWidth: 18, color: i === 0 ? 'var(--accent)' : 'var(--text-4)' }}>{i + 1}</span>
                {t.flag_url
                  ? <img src={t.flag_url} alt={t.team} style={{ width: 20, height: 14, objectFit: 'cover', borderRadius: 2, flexShrink: 0 }} />
                  : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-4)', minWidth: 20 }}>{t.team}</span>
                }
                <div style={{ flex: 1, fontFamily: 'var(--font-cond)', fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {PT_NAMES[t.team] || t.name}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 15, color: 'var(--accent)' }}>{t.clean_sheets}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-4)' }}>clean sheets</div>
                </div>
                <div style={{ textAlign: 'right', minWidth: 36 }}>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: 12, color: 'var(--text-3)' }}>{t.avg_conceded}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-4)' }}>gc/j</div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-4)', textAlign: 'center' }}>
              Ranking por seleção (clean sheets da equipe)
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
