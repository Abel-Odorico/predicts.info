import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import './PosCopa.css'
import CompetitionCard from '../components/poscopa/CompetitionCard'
import MatchCard from '../components/poscopa/MatchCard'
import PredictionCard from '../components/poscopa/PredictionCard'
import ScoringExample from '../components/poscopa/ScoringExample'
import NewsImpactCard from '../components/poscopa/NewsImpactCard'
import PollCard from '../components/poscopa/PollCard'
import {
  competitions, openMatches, myPredictions, leaderboardTypes, leaderboardsByFilter,
  scoringRules, simulators, newsImpact, pollOptions, futureNav,
} from '../mocks/posCopaMocks'

// ---------------------------------------------------------------------------
// /pos-copa — página PARALELA de desenvolvimento (branch feature/multi-competitions-beta)
//
// Objetivo: validar visual + estrutura da fase multi-competições do Predicts.info
// sem tocar na home atual (Dashboard.jsx) nem em nenhuma rota existente.
// Todos os dados aqui são MOCK (ver frontend/src/mocks/posCopaMocks.js).
// Nada nesta página lê ou grava no backend ainda.
// ---------------------------------------------------------------------------

const EVOLUTION_ICON = { up: '▲', down: '▼', flat: '·' }

// cor de cada competição (definida em posCopaMocks.js) reaproveitada nos
// cards de jogo, pra cada competição manter identidade visual própria
const compColorMap = Object.fromEntries(competitions.map((c) => [c.slug, c.color]))

function getCompColor(slug) {
  const color = compColorMap[slug]
  if (!color && import.meta.env.DEV) {
    console.warn(`[pos-copa] sem cor pra competitionSlug "${slug}" — checa se bate com competitions[].slug`)
  }
  return color
}

// usado tanto no scroll de deep-link (#hash) quanto no clique dos CTAs, pra
// as duas formas de navegar dentro da página irem sempre pro mesmo lugar
function scrollToSection(id, opts) {
  document.getElementById(id)?.scrollIntoView({ block: 'start', ...opts })
}

// Waitlist do Brasileirão — único bloco da página que grava dado REAL
// (POST /waitlist). Logado entra com 1 clique; anônimo deixa e-mail.
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
    <div className="pc-waitlist">
      <div className="pc-waitlist__icon">🔔</div>
      <h2 className="pc-waitlist__title">Quero ser avisado quando o Brasileirão chegar</h2>
      <p className="pc-waitlist__sub">
        Palpites por rodada, projeção de título, G4 e rebaixamento — te avisamos no lançamento.
      </p>
      {joined ? (
        <p className="pc-waitlist__done">
          ✅ {state === 'already' ? 'Você já está na lista!' : 'Pronto, você está na lista!'} Te avisamos no lançamento.
        </p>
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
          <button type="submit" className="pc-btn pc-btn--primary" disabled={state === 'loading'}>
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
    </div>
  )
}

export default function PosCopa() {
  const [leaderboardFilter, setLeaderboardFilter] = useState('geral')

  // troca por fetch real quando integrar: GET /leaderboards?competition=${leaderboardFilter}
  const leaderboardTop = leaderboardsByFilter[leaderboardFilter] || leaderboardsByFilter.geral

  const filteredLabel = useMemo(
    () => leaderboardTypes.find((t) => t.id === leaderboardFilter)?.label ?? 'Ranking geral',
    [leaderboardFilter],
  )

  // Página carrega via React.lazy — o scroll nativo do navegador pro #hash
  // dispara antes do chunk montar e cai em posição errada. Refaz o scroll
  // depois que o conteúdo já está no DOM.
  useEffect(() => {
    if (!window.location.hash) return
    const id = window.location.hash.slice(1)
    requestAnimationFrame(() => scrollToSection(id))
  }, [])

  // CTA dos cards de competição: ativa manda pra jogos abertos, em-breve
  // manda pro CTA de beta lá embaixo (ainda sem captura real de e-mail/lead)
  function handleCompetitionCta(competition) {
    scrollToSection(competition.status === 'ativa' ? 'jogos' : 'beta', { behavior: 'smooth' })
  }

  return (
    <div className="pc-page">
      <div className="pc-dev-banner">
        🧪 Página de desenvolvimento — <code>/pos-copa</code> · branch <code>feature/multi-competitions-beta</code> · dados mockados, home atual intacta
      </div>

      {/* ---------- nav futura (mockup, não substitui o Layout atual) ---------- */}
      <nav className="pc-future-nav">
        <div className="pc-future-nav__brand">predicts<span>.info</span></div>
        <ul className="pc-future-nav__links">
          {futureNav.map((item) => (
            <li key={item.label} className={item.children ? 'pc-future-nav__has-children' : ''}>
              <span>{item.label}</span>
              {item.children && (
                <ul className="pc-future-nav__dropdown">
                  {item.children.map((c) => <li key={c.slug}>{c.label}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* ---------- 1. hero ---------- */}
      <header className="pc-hero">
        <div className="pc-hero__floaters" aria-hidden="true">
          <span className="pc-floater pc-floater--1">⚽ 54%</span>
          <span className="pc-floater pc-floater--2">🏆 #1</span>
          <span className="pc-floater pc-floater--3">📊 +25 pts</span>
          <span className="pc-floater pc-floater--4">🛡️ Brasileirão</span>
        </div>
        <p className="pc-hero__eyebrow">Predicts.info · próxima fase</p>
        <h1 className="pc-hero__title">Predicts.info continua depois da Copa</h1>
        <p className="pc-hero__subtitle">
          Palpite, simule e dispute rankings nos maiores campeonatos de futebol: Brasileirão,
          Libertadores, Copa do Brasil e muito mais.
        </p>
        <div className="pc-hero__ctas">
          <a href="#competicoes" className="pc-btn pc-btn--primary">Ver competições</a>
          <a href="#jogos" className="pc-btn pc-btn--outline">Palpitar agora</a>
          <a href="#ranking" className="pc-btn pc-btn--ghost">Entrar no ranking</a>
        </div>
      </header>

      {/* ---------- 2. competições ---------- */}
      <section id="competicoes" className="pc-section">
        <h2 className="pc-section__title">Competições</h2>
        <p className="pc-section__subtitle">Copa do Mundo ativa hoje. Brasileirão, Libertadores e Copa do Brasil chegando.</p>
        <div className="pc-grid pc-grid--4">
          {competitions.map((c) => <CompetitionCard key={c.id} competition={c} onCta={handleCompetitionCta} />)}
        </div>
      </section>

      {/* ---------- 3. jogos abertos ---------- */}
      <section id="jogos" className="pc-section">
        <h2 className="pc-section__title">Jogos abertos para palpites</h2>
        <p className="pc-section__subtitle">Estrutura pronta para dados reais — hoje exibindo exemplos mockados.</p>
        <div className="pc-grid pc-grid--3">
          {openMatches.map((m) => <MatchCard key={m.id} match={m} compColor={getCompColor(m.competitionSlug)} />)}
        </div>
      </section>

      {/* ---------- 4. meus palpites ---------- */}
      <section className="pc-section">
        <h2 className="pc-section__title">Meus palpites</h2>
        <p className="pc-section__subtitle">Pendentes e já pontuados, de todas as competições, num só lugar.</p>
        <div className="pc-grid pc-grid--3">
          {myPredictions.map((p) => <PredictionCard key={p.id} prediction={p} />)}
        </div>
      </section>

      {/* ---------- 5. rankings ---------- */}
      <section id="ranking" className="pc-section">
        <h2 className="pc-section__title">Rankings</h2>
        <p className="pc-section__subtitle">Preparado para múltiplas competições, temporadas e bolões privados.</p>
        <div className="pc-lb-filters">
          {leaderboardTypes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`pc-lb-filter ${leaderboardFilter === t.id ? 'pc-lb-filter--active' : ''}`}
              onClick={() => setLeaderboardFilter(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="pc-lb">
          <div className="pc-lb__podium">
            {leaderboardTop.slice(0, 3).map((u) => (
              <div key={u.rank} className={`pc-lb__podium-slot pc-lb__podium-slot--${u.rank}`}>
                <span className="pc-lb__podium-rank">#{u.rank}</span>
                <span className="pc-lb__podium-name">{u.name}</span>
                <span className="pc-lb__podium-pts">{u.points} pts</span>
              </div>
            ))}
          </div>
          <ol className="pc-lb__list">
            {leaderboardTop.map((u) => {
              const tone = u.evolution > 0 ? 'up' : u.evolution < 0 ? 'down' : 'flat'
              return (
                <li key={u.rank} className="pc-lb__row">
                  <span className="pc-lb__row-rank">{u.rank}</span>
                  <span className="pc-lb__row-name">{u.name}</span>
                  <span className="pc-lb__row-hits">{u.exactHits} exatos</span>
                  <span className={`pc-lb__row-evo pc-lb__row-evo--${tone}`}>{EVOLUTION_ICON[tone]}</span>
                  <span className="pc-lb__row-pts">{u.points} pts</span>
                </li>
              )
            })}
          </ol>
          <p className="pc-lb__caption">Exibindo: {filteredLabel} (mock)</p>
        </div>
      </section>

      {/* ---------- 6. pontuação ---------- */}
      <section className="pc-section">
        <h2 className="pc-section__title">Como funciona a pontuação</h2>
        <p className="pc-section__subtitle">Regra atual do Predicts — valores não mudam sem validação com a base de usuários.</p>
        <div className="pc-grid pc-grid--4">
          {scoringRules.map((r) => <ScoringExample key={r.key} rule={r} />)}
        </div>
      </section>

      {/* ---------- 7. simuladores ---------- */}
      <section className="pc-section">
        <h2 className="pc-section__title">Simuladores por competição</h2>
        <div className="pc-sim-grid">
          {simulators.map((s) => (
            <div key={s.slug} className="pc-sim-col">
              <h3>{s.competition}</h3>
              <ul>
                {s.cards.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- 8. notícias com impacto ---------- */}
      <section id="noticias" className="pc-section">
        <h2 className="pc-section__title">Notícias que impactam probabilidades</h2>
        <p className="pc-section__subtitle">Espaço preparado para conectar notícia a variação de modelo — hoje com exemplos mockados.</p>
        <div className="pc-grid pc-grid--3">
          {newsImpact.map((n) => <NewsImpactCard key={n.id} item={n} />)}
        </div>
      </section>

      {/* ---------- 9. waitlist (dado real, não mock) ---------- */}
      <section id="avise-me" className="pc-section">
        <WaitlistCard />
      </section>

      {/* ---------- 10. enquete + beta ---------- */}
      <section id="beta" className="pc-section">
        <PollCard options={pollOptions} />
      </section>

      {/* ---------- nota de desenvolvimento (só nesta página beta) ---------- */}
      <section className="pc-devnote">
        <h3>Nota de desenvolvimento</h3>
        <p>
          Página isolada, sem alterar <code>Dashboard.jsx</code> nem rotas existentes. Dados 100% mockados
          (<code>src/mocks/posCopaMocks.js</code>). Próximos passos: validar layout/textos, testar mobile,
          conectar <code>competitions</code>/<code>matches</code>/<code>leaderboards</code>/<code>news_items</code> reais,
          só então avaliar merge com a home principal — Copa do Mundo 2026 continua como competição dentro do menu.
        </p>
        <Link to="/" className="pc-devnote__link">← voltar para a home atual</Link>
      </section>
    </div>
  )
}
