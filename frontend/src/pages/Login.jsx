import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

const SCORING_RULES = [
  { pts: '3 pts', title: 'Placar exato', desc: 'Acertou o placar completo e soma a maior pontuacao.' },
  { pts: '1 pt', title: 'Resultado correto', desc: 'Acertou vencedor, empate ou derrota.' },
  { pts: '0 pt', title: 'Sem acerto', desc: 'Nao pontua quando o resultado previsto falha.' },
]

export default function Login() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode]     = useState('login')
  const [email, setEmail]   = useState('')
  const [pass, setPass]     = useState('')
  const [name, setName]     = useState('')
  const [err, setErr]       = useState('')
  const [loading, setLoad]  = useState(false)

  if (user) {
    navigate('/')
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    setLoad(true)
    try {
      if (mode === 'login') {
        const data = await api.login(email, pass)
        const me = await api.get('/auth/me', data.access_token)
        login(me, data.access_token)
        navigate('/')
      } else {
        await api.post('/auth/register', { email, password: pass, name })
        const data = await api.login(email, pass)
        const me = await api.get('/auth/me', data.access_token)
        login(me, data.access_token)
        navigate('/')
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoad(false)
    }
  }

  return (
    <div className="page login-shell">
      <div className="login-box">
        <div className="login-brand fade-in-1">
          <div className="login-brand__logo">COPA 2026</div>
          <div className="login-brand__subtitle">Simulador Estatístico</div>
        </div>

        <div className="card card--accent fade-in-2">
          <div className="login-tabs">
            {[
              { id: 'login', label: 'Entrar' },
              { id: 'register', label: 'Criar Conta' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => { setMode(t.id); setErr('') }}
                className={mode === t.id ? 'active' : ''}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {mode === 'register' && (
              <div className="form-group">
                <label className="form-label">Nome</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Seu nome"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required={mode === 'register'}
                  autoComplete="name"
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">E-mail</label>
              <input
                type="email"
                className="form-input"
                placeholder="email@exemplo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Senha</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={pass}
                onChange={e => setPass(e.target.value)}
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {err && <div className="alert alert-error">{err}</div>}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ marginTop: 'var(--s2)' }}
              disabled={loading}
            >
              {loading
                ? 'Aguarde...'
                : mode === 'login' ? 'Entrar' : 'Criar Conta'}
            </button>

            {mode === 'register' && (
              <div className="register-explainer">
                <div className="register-explainer__title">Como funciona a pontuacao das apostas</div>
                <div className="guide-rules">
                  {SCORING_RULES.map(rule => (
                    <div key={rule.title} className="guide-rule">
                      <span className="guide-rule__pts">{rule.pts}</span>
                      <div>
                        <div className="guide-rule__title">{rule.title}</div>
                        <div className="guide-rule__desc">{rule.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 'var(--s4)' }} className="fade-in-3">
          <Link to="/" style={{
            fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)',
            textDecoration: 'none', letterSpacing: '0.04em'
          }}>
            ← Voltar sem entrar
          </Link>
        </div>
      </div>
    </div>
  )
}
