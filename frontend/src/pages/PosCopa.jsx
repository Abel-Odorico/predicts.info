import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, MotionConfig, AnimatePresence } from 'motion/react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import './PosCopa.css'
import PollCard from '../components/poscopa/PollCard'
import { scoringRules, pollOptions } from '../mocks/posCopaMocks'

// ---------------------------------------------------------------------------
// /pos-copa — "estádio à noite, pré-temporada"
//
// Teaser público da fase multi-competições. Único dado REAL gravado aqui é a
// waitlist (POST /waitlist). Animação segue a Regra Zero do Mira: tudo ENTRA
// com coreografia (motion/react) e DEPOIS mantém loop interno perpétuo.
// Assinatura visual: a mini-tabela viva do hero (clubes trocando de posição
// em loop, zonas título/G4/Z4 coloridas) — só existe num produto de palpite.
// ---------------------------------------------------------------------------

const EASE = [0.22, 1, 0.36, 1]

const entrance = (delay = 0) => ({
  initial: { opacity: 0, y: 26 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.6, delay, ease: EASE },
})

// ── Assinatura: mini-tabela viva ──────────────────────────────────────────
// 6 clubes trocam de posição a cada ciclo (FLIP via motion layout).
// Zonas: 1º dourado (título) · 2º-4º verde (G4) · 5º neutro · 6º vermelho (Z4).

const CLUBS = [
  { id: 'FLA', name: 'Flamengo' },
  { id: 'PAL', name: 'Palmeiras' },
  { id: 'BOT', name: 'Botafogo' },
  { id: 'SAO', name: 'São Paulo' },
  { id: 'GRE', name: 'Grêmio' },
  { id: 'CAM', name: 'Atlético-MG' },
]

// ciclo determinístico de classificações (pontos coerentes com a posição)
const TABLE_CYCLE = [
  ['FLA', 'PAL', 'BOT', 'SAO', 'GRE', 'CAM'],
  ['PAL', 'FLA', 'SAO', 'BOT', 'CAM', 'GRE'],
  ['PAL', 'BOT', 'FLA', 'CAM', 'SAO', 'GRE'],
  ['BOT', 'PAL', 'CAM', 'FLA', 'GRE', 'SAO'],
  ['FLA', 'BOT', 'PAL', 'GRE', 'CAM', 'SAO'],
]
const CYCLE_PTS = [
  [68, 66, 61, 57, 52, 48],
  [69, 67, 62, 61, 53, 52],
  [72, 65, 64, 58, 55, 52],
  [74, 70, 66, 64, 56, 55],
  [77, 73, 71, 60, 59, 55],
]

function zoneOf(pos) {
  if (pos === 0) return 'title'
  if (pos <= 3) return 'g4'
  if (pos === 5) return 'z4'
  return 'mid'
}

function LiveTable() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2600)
    return () => clearInterval(id)
  }, [])

  const order = TABLE_CYCLE[tick % TABLE_CYCLE.length]
  const pts = CYCLE_PTS[tick % CYCLE_PTS.length]
  const rodada = 24 + (tick % TABLE_CYCLE.length)

  return (
    <div className="pc-table" aria-label="Prévia animada da tabela do Brasileirão">
      <div className="pc-table__head">
        <span className="pc-table__cast">● SIMULAÇÃO</span>
        <span className="pc-table__round">
          RODADA <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={rodada}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.3 }}
              style={{ display: 'inline-block' }}
            >{rodada}</motion.span>
          </AnimatePresence>
        </span>
      </div>
      {order.map((id, pos) => {
        const club = CLUBS.find((c) => c.id === id)
        return (
          <motion.div
            key={id}
            layout
            transition={{ type: 'tween', duration: 0.7, ease: EASE }}
            className={`pc-table__row pc-table__row--${zoneOf(pos)}`}
          >
            <span className="pc-table__pos">{pos + 1}</span>
            <span className="pc-table__club">{club.name}</span>
            <span className="pc-table__pts">{pts[pos]}</span>
          </motion.div>
        )
      })}
      <div className="pc-table__legend">
        <span className="pc-zone pc-zone--title">Título</span>
        <span className="pc-zone pc-zone--g4">G4</span>
        <span className="pc-zone pc-zone--z4">Z4</span>
      </div>
    </div>
  )
}

// ── Competições ───────────────────────────────────────────────────────────

const COMPETITIONS = [
  { slug: 'copa-2026', emoji: '🏆', name: 'Copa do Mundo 2026', status: 'ativa', desc: 'Mata-mata rolando agora. Palpites abertos até a final.', href: '/dashboard' },
  { slug: 'brasileirao', emoji: '🇧🇷', name: 'Brasileirão Série A', status: 'breve', desc: '38 rodadas, projeção de título, G4 e rebaixamento a cada jogo.' },
  { slug: 'libertadores', emoji: '🌎', name: 'Libertadores', status: 'breve', desc: 'Grupos + mata-mata, simulação de chaveamento até a glória eterna.' },
  { slug: 'copa-do-brasil', emoji: '🏹', name: 'Copa do Brasil', status: 'breve', desc: 'Mata-mata puro, zebras e pênaltis — o caos que o modelo adora.' },
]

// ── O que muda ────────────────────────────────────────────────────────────

const FEATURES = [
  { icon: '📈', title: 'Projeção da tabela', desc: 'Monte Carlo sobre as rodadas restantes: % de título, G4 e rebaixamento de cada clube, recalculado a cada resultado.' },
  { icon: '🗓️', title: 'Palpite por rodada', desc: 'Aposte a rodada inteira de uma vez. Pontuação e ranking contínuos a temporada toda — sem esperar 4 anos.' },
  { icon: '👥', title: 'Bolões que não acabam', desc: 'Seu grupo da Copa continua no Brasileirão. Ranking por competição e geral da temporada.' },
  { icon: '💬', title: 'Bot no WhatsApp', desc: 'Manda "Flamengo 2x1 Palmeiras" e pronto. Ranking, projeções e resultado na hora, direto no chat.' },
]

// Projeção teaser — barras com entrada coreografada + shimmer perpétuo
const PROJECTION = [
  { label: 'Título', value: 54, zone: 'title' },
  { label: 'G4 · Libertadores', value: 78, zone: 'g4' },
  { label: 'Rebaixamento', value: 12, zone: 'z4' },
]

function ProjectionCard() {
  return (
    <div className="pc-proj">
      <div className="pc-proj__head">
        <span className="pc-proj__club">SEU CLUBE</span>
        <span className="pc-proj__note">exemplo de projeção</span>
      </div>
      {PROJECTION.map((p, i) => (
        <div key={p.label} className="pc-proj__item">
          <div className="pc-proj__label">
            <span>{p.label}</span>
            <span className="pc-proj__value">{p.value}%</span>
          </div>
          <div className="pc-proj__track">
            <motion.div
              className={`pc-proj__bar pc-proj__bar--${p.zone}`}
              initial={{ width: 0 }}
              whileInView={{ width: `${p.value}%` }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 1.1, delay: 0.25 + i * 0.18, ease: EASE }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Waitlist (único bloco com dado REAL) ──────────────────────────────────

function WaitlistCard() {
  const { user, token } = useAuth()
  const [email, setEmail] = useState('')
  const [state, setState] = useState('idle') // idle | loading | done | already | error
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    if (!token) return
    api.get('/waitlist/status?competition=brasileirao', token)
      .then((d) => { if (d.joined) setState('already') })
      .catch(() => {})
  }, [token])

  async function join(e) {
    e?.preventDefault()
    setState('loading')
    setErrMsg('')
    try {
      const d = await api.post(
        '/waitlist',
        { competition: 'brasileirao', email: user ? undefined : email.trim() },
        token,
      )
      setState(d.already ? 'already' : 'done')
    } catch (err) {
      setErrMsg(err.message || 'Não deu certo. Tenta de novo.')
      setState('error')
    }
  }

  const joined = state === 'done' || state === 'already'

  return (
    <motion.div className="pc-waitlist" {...entrance()}>
      <div className="pc-waitlist__pitch" aria-hidden="true" />
      <motion.div
        className="pc-waitlist__icon"
        initial={{ scale: 0, rotate: -30 }}
        whileInView={{ scale: 1, rotate: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
      >
        🔔
      </motion.div>
      <h2 className="pc-waitlist__title">Quero ser avisado quando o Brasileirão chegar</h2>
      <p className="pc-waitlist__sub">
        Palpites por rodada, projeção de título, G4 e rebaixamento — te avisamos no lançamento.
      </p>
      {joined ? (
        <motion.p
          className="pc-waitlist__done"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          ✅ {state === 'already' ? 'Você já está na lista!' : 'Pronto, você está na lista!'} Te avisamos no lançamento.
        </motion.p>
      ) : (
        <form className="pc-waitlist__form" onSubmit={join}>
          {!user && (
            <input
              type="email"
              required
              className="pc-waitlist__input"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={state === 'loading'}
            />
          )}
          <button type="submit" className="pc-btn pc-btn--primary pc-btn--pulse" disabled={state === 'loading'}>
            {state === 'loading' ? 'Enviando…' : user ? 'Me avisa quando lançar' : 'Entrar na lista'}
          </button>
        </form>
      )}
      {state === 'error' && <p className="pc-waitlist__error">{errMsg}</p>}
      {!user && !joined && (
        <p className="pc-waitlist__hint">
          Já tem conta? <Link to="/login">Entra</Link> e participa com 1 clique.
        </p>
      )}
    </motion.div>
  )
}

// ── Página ────────────────────────────────────────────────────────────────

function scrollToSection(id, opts) {
  document.getElementById(id)?.scrollIntoView({ block: 'start', ...opts })
}

export default function PosCopa() {
  // página carrega via React.lazy — refaz o scroll do #hash pós-mount
  useEffect(() => {
    if (!window.location.hash) return
    const id = window.location.hash.slice(1)
    requestAnimationFrame(() => scrollToSection(id))
  }, [])

  const heroStagger = useMemo(() => ({
    hidden: {},
    show: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
  }), [])
  const heroItem = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE } },
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="pc-page">
        {/* ---------- hero ---------- */}
        <header className="pc-hero">
          <div className="pc-hero__flood" aria-hidden="true" />
          <div className="pc-hero__grid">
            <motion.div className="pc-hero__copy" variants={heroStagger} initial="hidden" animate="show">
              <motion.p className="pc-hero__eyebrow" variants={heroItem}>
                <span className="pc-hero__beta">BETA</span> Predicts.info · próxima temporada
              </motion.p>
              <motion.h1 className="pc-hero__title" variants={heroItem}>
                O jogo<br /><em>não para</em>
              </motion.h1>
              <motion.p className="pc-hero__subtitle" variants={heroItem}>
                Depois da final, a bola segue rolando: Brasileirão, Libertadores e Copa do Brasil
                com os mesmos palpites, simulações e bolões da Copa.
              </motion.p>
              <motion.div className="pc-hero__ctas" variants={heroItem}>
                <button type="button" className="pc-btn pc-btn--primary pc-btn--pulse" onClick={() => scrollToSection('avise-me', { behavior: 'smooth' })}>
                  🔔 Me avisa quando lançar
                </button>
                <a href="#competicoes" className="pc-btn pc-btn--outline" onClick={(e) => { e.preventDefault(); scrollToSection('competicoes', { behavior: 'smooth' }) }}>
                  Ver competições
                </a>
              </motion.div>
            </motion.div>
            <motion.div
              className="pc-hero__table"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.35, ease: EASE }}
            >
              <LiveTable />
            </motion.div>
          </div>
        </header>

        {/* ---------- competições ---------- */}
        <section id="competicoes" className="pc-section">
          <motion.h2 className="pc-section__title" {...entrance()}>Competições</motion.h2>
          <motion.p className="pc-section__subtitle" {...entrance(0.08)}>
            Copa do Mundo ativa hoje. O resto da temporada chegando.
          </motion.p>
          <div className="pc-comp-grid">
            {COMPETITIONS.map((c, i) => (
              <motion.div key={c.slug} className={`pc-comp pc-comp--${c.status}`} {...entrance(0.1 + i * 0.09)}>
                <div className="pc-comp__top">
                  <span className="pc-comp__emoji">{c.emoji}</span>
                  {c.status === 'ativa'
                    ? <span className="pc-comp__badge pc-comp__badge--live">AO VIVO</span>
                    : <span className="pc-comp__badge">EM BREVE</span>}
                </div>
                <h3 className="pc-comp__name">{c.name}</h3>
                <p className="pc-comp__desc">{c.desc}</p>
                {c.status === 'ativa'
                  ? <Link to={c.href} className="pc-comp__cta">Palpitar agora →</Link>
                  : <button type="button" className="pc-comp__cta pc-comp__cta--ghost" onClick={() => scrollToSection('avise-me', { behavior: 'smooth' })}>Entrar na lista →</button>}
              </motion.div>
            ))}
          </div>
        </section>

        {/* ---------- o que muda ---------- */}
        <section className="pc-section">
          <motion.h2 className="pc-section__title" {...entrance()}>O que chega com a temporada</motion.h2>
          <div className="pc-next">
            <motion.div className="pc-next__proj" {...entrance(0.1)}>
              <ProjectionCard />
            </motion.div>
            <div className="pc-next__features">
              {FEATURES.map((f, i) => (
                <motion.div key={f.title} className="pc-feature" {...entrance(0.12 + i * 0.08)}>
                  <span className="pc-feature__icon">{f.icon}</span>
                  <div>
                    <h3 className="pc-feature__title">{f.title}</h3>
                    <p className="pc-feature__desc">{f.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- pontuação ---------- */}
        <section className="pc-section">
          <motion.h2 className="pc-section__title" {...entrance()}>A pontuação que você já conhece</motion.h2>
          <motion.p className="pc-section__subtitle" {...entrance(0.08)}>
            Mesma regra da Copa, em todas as competições.
          </motion.p>
          <div className="pc-score-grid">
            {scoringRules.map((r, i) => (
              <motion.div key={r.key} className={`pc-score ${r.bonus ? 'pc-score--bonus' : ''}`} {...entrance(0.1 + i * 0.08)}>
                <span className="pc-score__pts">{r.points}<em>pts</em></span>
                <span className="pc-score__label">{r.label}</span>
                <span className="pc-score__example">
                  {r.example
                    ? `palpite ${r.example.pred[0]}x${r.example.pred[1]} · placar ${r.example.result[0]}x${r.example.result[1]}`
                    : 'bônus da temporada'}
                </span>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ---------- waitlist (dado real) ---------- */}
        <section id="avise-me" className="pc-section">
          <WaitlistCard />
        </section>

        {/* ---------- enquete ---------- */}
        <section id="beta" className="pc-section">
          <motion.div {...entrance()}>
            <PollCard options={pollOptions} />
          </motion.div>
        </section>

        <footer className="pc-footer">
          <span className="pc-footer__beta">🧪 beta</span>
          Página em evolução — a Copa 2026 continua como competição principal até a final.
          <Link to="/" className="pc-footer__link">← voltar pra Copa</Link>
        </footer>
      </div>
    </MotionConfig>
  )
}
