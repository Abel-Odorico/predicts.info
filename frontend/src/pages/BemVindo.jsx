import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../stores/authStore'

const ONBOARDED_KEY = 'predicts-onboarded'

const STEPS = [
  {
    icon: '🎯',
    title: 'Dê seu palpite',
    body: 'Escolha o placar de cada jogo antes de a bola rolar. No mata-mata, você também aposta quem avança se der prorrogação ou pênaltis.',
  },
  {
    icon: '🔮',
    title: 'Use o simulador',
    body: 'Cada partida tem probabilidades calculadas com Elo, xG e 1 milhão de simulações Monte Carlo — além de análise por IA pra embasar seu palpite.',
  },
  {
    icon: '🏆',
    title: 'Suba no ranking',
    body: 'Quanto mais preciso o palpite, mais pontos. Dispute o ranking geral e crie bolões privados pra tirar onda com os amigos.',
  },
]

const SCORING = [
  { pts: 25, label: 'Placar exato' },
  { pts: 18, label: 'Vencedor + gols do vencedor' },
  { pts: 15, label: 'Vencedor + diferença de gols' },
  { pts: 12, label: 'Vencedor + gols do perdedor' },
  { pts: 10, label: 'Só o vencedor (ou empate certo)' },
  { pts: '+10', label: 'Bônus: quem avança nos pênaltis' },
]

const DESTINOS = [
  { icon: '🎯', title: 'Palpites', desc: 'Aposte nos próximos jogos', to: '/apostas' },
  { icon: '🔮', title: 'Simulador', desc: 'Probabilidades por partida', to: '/' },
  { icon: '🏆', title: 'Ranking', desc: 'Veja quem tá na frente', to: '/ranking' },
  { icon: '👥', title: 'Bolões', desc: 'Grupos privados com amigos', to: '/meus-grupos' },
  { icon: '⚔️', title: 'Torneio', desc: 'Chaveamento e grupos da Copa', to: '/torneio' },
  { icon: '📜', title: 'Regras', desc: 'Pontuação em detalhes', to: '/regras' },
]

export default function BemVindo() {
  const { token } = useAuth()

  useEffect(() => {
    localStorage.setItem(ONBOARDED_KEY, '1')
    window.scrollTo(0, 0)
  }, [])

  return (
    <div className="page">
      {/* Hero */}
      <div className="fade-in-1" style={{ textAlign: 'center', padding: 'var(--s8) 0 var(--s6)' }}>
        <div style={{ fontSize: 56, lineHeight: 1 }}>🏆</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 6vw, 40px)', color: 'var(--text-1)', margin: 'var(--s3) 0 var(--s2)' }}>
          Bem-vindo ao Predicts!
        </h1>
        <p style={{ fontFamily: 'var(--font-cond)', fontSize: 15, color: 'var(--text-2)', maxWidth: 520, margin: '0 auto' }}>
          O simulador estatístico da Copa do Mundo 2026. Palpite, dispute com amigos e prove que entende de futebol.
        </p>
      </div>

      {/* Passos */}
      <div className="fade-in-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s3)' }}>
        {STEPS.map((s, i) => (
          <div key={s.title} className="card" style={{ padding: 'var(--s5)', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 10, right: 14, fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--bg-overlay)', fontWeight: 900 }}>{i + 1}</div>
            <div style={{ fontSize: 30 }}>{s.icon}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-1)', margin: 'var(--s2) 0' }}>{s.title}</div>
            <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{s.body}</div>
          </div>
        ))}
      </div>

      {/* Pontuação */}
      <div className="card mt-4 fade-in-3">
        <div className="card__header">
          <span className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>Como você pontua</span>
          <Link to="/regras" style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--accent)' }}>regras completas →</Link>
        </div>
        <div className="card__body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--s2)' }}>
          {SCORING.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: '8px 10px', borderRadius: 10, background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 900, color: 'var(--win)', minWidth: 40, textAlign: 'center' }}>{s.pts}</span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.3 }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* CTA principal */}
      <div className="fade-in-3" style={{ textAlign: 'center', margin: 'var(--s6) 0' }}>
        {token ? (
          <Link to="/apostas" className="btn btn-primary btn-lg" style={{ fontFamily: 'var(--font-display)', fontWeight: 900, letterSpacing: '0.06em' }}>
            🎯 Fazer meus palpites
          </Link>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--s3)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/entrar" className="btn btn-primary btn-lg" style={{ fontFamily: 'var(--font-display)', fontWeight: 900, letterSpacing: '0.06em' }}>
              Criar conta grátis
            </Link>
            <Link to="/login" className="btn btn-ghost btn-lg">Já tenho conta</Link>
          </div>
        )}
      </div>

      {/* Explorar */}
      <div className="fade-in-4">
        <span className="section-title">Explore o Predicts</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
          {DESTINOS.map(d => (
            <Link key={d.to + d.title} to={d.to} className="card" style={{ padding: 'var(--s4)', textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 4, transition: 'transform .15s' }}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.currentTarget.style.transform = ''}>
              <span style={{ fontSize: 24 }}>{d.icon}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text-1)' }}>{d.title}</span>
              <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: 'var(--text-3)' }}>{d.desc}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
