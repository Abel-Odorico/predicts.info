import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

const SCORING_RULES = [
  { pts: '3 pts', title: 'Placar exato', desc: 'Acertou o placar completo e soma a maior pontuacao.' },
  { pts: '1 pt', title: 'Resultado correto', desc: 'Acertou vencedor, empate ou derrota.' },
  { pts: '0 pt', title: 'Sem acerto', desc: 'Nao pontua quando o resultado previsto falha.' },
]

const FLOAT_ITEMS = [
  { text: '78% precisão',        x: 8,  y: 72, delay: 0,    dur: 7   },
  { text: '4.2M predições',       x: 25, y: 55, delay: 1.8,  dur: 8.5 },
  { text: 'Acerto médio 82%',    x: 52, y: 78, delay: 3.2,  dur: 6.5 },
  { text: 'Top 1% global',        x: 72, y: 48, delay: 0.9,  dur: 9   },
  { text: '32 seleções',          x: 15, y: 40, delay: 4.5,  dur: 7.5 },
  { text: '97 países',            x: 62, y: 65, delay: 2.1,  dur: 6   },
  { text: 'Copa do Mundo 2026',  x: 38, y: 85, delay: 5.3,  dur: 8   },
  { text: 'Tempo real',           x: 78, y: 35, delay: 1.2,  dur: 7   },
  { text: '1.2M usuários',        x: 33, y: 60, delay: 6.8,  dur: 6.5 },
]

const TICKER_ITEMS = [
  '78% de precisão média',
  '4.2M predições realizadas',
  '97 países participantes',
  'Copa do Mundo 2026',
  '32 seleções classificadas',
  'Simulador estatístico #1',
  'Rankings atualizados ao vivo',
  'Simulações em tempo real',
]

function FloatingStats() {
  return (
    <div className="lbg__floats">
      {FLOAT_ITEMS.map((item, i) => (
        <span
          key={i}
          className="lbg__float-item"
          style={{
            left: `${item.x}%`,
            top: `${item.y}%`,
            '--delay': `${item.delay}s`,
            '--dur': `${item.dur}s`,
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  )
}

function LiveBars() {
  const bars = [0.45, 0.80, 0.35, 1.0, 0.65, 0.75, 0.55, 0.90, 0.40, 0.70, 0.85, 0.50, 0.60, 0.95, 0.30]
  return (
    <div className="lbg__bars">
      {bars.map((h, i) => (
        <div
          key={i}
          className="lbg__bar"
          style={{ '--bar-h': `${h * 100}%`, '--i': i }}
        />
      ))}
    </div>
  )
}

function StatsTicker() {
  const repeated = [...TICKER_ITEMS, ...TICKER_ITEMS]
  return (
    <div className="login-ticker">
      <div className="login-ticker__track">
        {repeated.map((item, i) => (
          <span key={i} className="login-ticker__item">
            <span className="login-ticker__dot" />
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function Login({ initialMode = 'login' }) {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode]     = useState(initialMode)
  const [email, setEmail]   = useState('')
  const [pass, setPass]     = useState('')
  const [name, setName]     = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone]   = useState('')
  const [waOptIn, setWaOptIn] = useState(false)
  const [usernameStatus, setUsernameStatus] = useState(null)
  const [checkingUsername, setCheckingUsername] = useState(false)
  const [err, setErr]       = useState('')
  const [loading, setLoad]  = useState(false)
  const refId = typeof window !== 'undefined' ? localStorage.getItem('predicts_ref') : null

  const normalizedUsername = username.trim().toLowerCase().replace(/^@+/, '')
  const usernameUnavailable = mode === 'register' && usernameStatus && usernameStatus.available === false
  const usernameInvalid = mode === 'register' && normalizedUsername.length > 0 && normalizedUsername.length < 3
  const registerBlocked = mode === 'register' && (!normalizedUsername || usernameInvalid || usernameUnavailable || checkingUsername)

  useEffect(() => {
    if (mode !== 'register') {
      setUsernameStatus(null)
      setCheckingUsername(false)
      return
    }
    if (!normalizedUsername || normalizedUsername.length < 3) {
      setUsernameStatus(null)
      setCheckingUsername(false)
      return
    }
    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setCheckingUsername(true)
      try {
        const result = await api.get(`/auth/username/check?username=${encodeURIComponent(normalizedUsername)}`)
        if (!cancelled) setUsernameStatus(result)
      } catch (error) {
        if (!cancelled) setUsernameStatus({ available: false, message: error.message, suggestions: [] })
      } finally {
        if (!cancelled) setCheckingUsername(false)
      }
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [mode, normalizedUsername])

  // Redireciona pós-login num effect, não no corpo do render — chamar navigate()
  // direto no render (fora de effect) violava a regra de hooks: esse early-return
  // ficava ANTES do useEffect do username, então rodava menos hooks nesse render
  // que no anterior assim que `user` virava truthy (React error #300, intermitente
  // logo após o login, "carrega e apaga").
  useEffect(() => {
    if (!user) return
    const pendingJoin = sessionStorage.getItem('join_token')
    if (!pendingJoin) { navigate('/'); return }
    const pendingJoinBy = sessionStorage.getItem('join_by')
    sessionStorage.removeItem('join_token')
    sessionStorage.removeItem('join_by')
    const qs = pendingJoinBy ? `?by=${pendingJoinBy}` : ''
    api.post(`/user-groups/join/${pendingJoin}${qs}`, {}, useAuth.getState().token)
      .then(res => navigate(`/bolao/${pendingJoin}`, { state: res?.status === 'pending_approval' ? { pendingApproval: true } : { justJoined: true } }))
      .catch(() => navigate(`/bolao/${pendingJoin}`))
  }, [user, navigate])

  if (user) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    setLoad(true)
    try {
      const pendingJoin = sessionStorage.getItem('join_token')
      const pendingJoinBy = sessionStorage.getItem('join_by')
      if (mode === 'login') {
        const data = await api.login(email, pass)
        const me = await api.get('/auth/me', data.access_token)
        login(me, data.access_token)
        if (pendingJoin) {
          sessionStorage.removeItem('join_token')
          sessionStorage.removeItem('join_by')
          try {
            const qs = pendingJoinBy ? `?by=${pendingJoinBy}` : ''
            const res = await api.post(`/user-groups/join/${pendingJoin}${qs}`, {}, data.access_token)
            navigate(`/bolao/${pendingJoin}`, { state: res?.status === 'pending_approval' ? { pendingApproval: true } : { justJoined: true } })
          } catch (_) {
            navigate(`/bolao/${pendingJoin}`)
          }
        } else {
          navigate('/')
        }
      } else {
        if (pass.length < 8) { setErr('A senha deve ter ao menos 8 caracteres'); setLoad(false); return }
        const refPayload = refId ? { referred_by: parseInt(refId, 10) } : {}
        await api.post('/auth/register', { email, password: pass, name, username: normalizedUsername, phone, whatsapp_opt_in: waOptIn, ...refPayload })
        const data = await api.login(email, pass)
        const me = await api.get('/auth/me', data.access_token)
        login(me, data.access_token)
        if (pendingJoin) {
          sessionStorage.removeItem('join_token')
          sessionStorage.removeItem('join_by')
          try {
            const qs = pendingJoinBy ? `?by=${pendingJoinBy}` : ''
            const res = await api.post(`/user-groups/join/${pendingJoin}${qs}`, {}, data.access_token)
            navigate(`/bolao/${pendingJoin}`, { state: res?.status === 'pending_approval' ? { pendingApproval: true } : { justJoined: true } })
          } catch (_) {
            navigate(`/bolao/${pendingJoin}`)
          }
        } else {
          navigate('/apostas')
        }
      }
    } catch (e) {
      if (e.detail?.suggestions?.length) {
        setUsernameStatus({ available: false, suggestions: e.detail.suggestions, username: e.detail.username })
      }
      setErr(e.message)
    } finally {
      setLoad(false)
    }
  }

  return (
    <div className="login-shell">

      {/* Animated background canvas */}
      <div className="lbg" aria-hidden="true">
        <div className="lbg__glow" />
        <FloatingStats />
        <LiveBars />
      </div>

      {/* Desktop left panel — brand + stats */}
      <div className="login-left" aria-hidden="true">
        <div className="login-hero-brand">
          <div className="login-hero-brand__word">
            {'PREDICTS'.split('').map((l, i) => (
              <span key={i} className="login-hero-brand__letter" style={{ '--i': i }}>{l}</span>
            ))}
          </div>
          <div className="login-hero-brand__line" />
          <div className="login-hero-brand__sub">Simulador Estatístico · Copa 2026 + Brasileirão</div>
        </div>
        <StatsTicker />
      </div>

      {/* Form panel */}
      <div className="login-right">
        <div className="login-box">

          {/* Mobile-only brand */}
          <div className="login-brand login-brand--mobile fade-in-1">
            <div className="login-brand__logo">PREDICTS</div>
            <div className="login-brand__subtitle">Simulador Estatístico</div>
          </div>

          <div className="card card--accent login-card fade-in-2">
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

              {mode === 'register' && (
                <>
                  <div className="form-group">
                    <label className="form-label">Usuário <span style={{ color: 'var(--text-4)', fontSize: 11 }}>(3–30 chars)</span></label>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontFamily: 'var(--font-data)', fontSize: 14 }}>@</span>
                      <input
                        type="text"
                        className="form-input"
                        style={{ paddingLeft: 28 }}
                        placeholder="seu_usuario"
                        value={username}
                        onChange={e => { setUsername(e.target.value); setErr('') }}
                        required
                        maxLength={30}
                        autoComplete="username"
                      />
                    </div>
                    <UsernameAvailability
                      checking={checkingUsername}
                      invalid={usernameInvalid}
                      status={usernameStatus}
                      onPick={value => { setUsername(value); setUsernameStatus({ username: value, available: true, suggestions: [] }); setErr('') }}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Celular / WhatsApp</label>
                    <input
                      type="tel"
                      className="form-input"
                      placeholder="(11) 99999-9999"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      required
                      autoComplete="tel"
                    />
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--text-3)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={waOptIn}
                        onChange={e => setWaOptIn(e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      Quero receber avisos e apostar pelo WhatsApp neste número
                    </label>
                  </div>
                </>
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
                className="btn btn-primary login-submit-btn"
                style={{ marginTop: 'var(--s2)' }}
                disabled={loading || registerBlocked}
              >
                {loading
                  ? 'Aguarde...'
                  : mode === 'login' ? 'Entrar' : 'Criar Conta'}
              </button>

              {mode === 'login' && (
                <div style={{ textAlign: 'center', marginTop: 'var(--s2)' }}>
                  <Link
                    to="/esqueci-senha"
                    style={{
                      fontFamily: 'var(--font-cond)', fontSize: 13,
                      color: 'var(--text-3)', textDecoration: 'none',
                      letterSpacing: '0.03em',
                    }}
                  >
                    Esqueci minha senha
                  </Link>
                </div>
              )}

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
    </div>
  )
}


function UsernameAvailability({ checking, invalid, status, onPick }) {
  if (invalid) {
    return <div className="field-hint field-hint--error">Use ao menos 3 caracteres.</div>
  }
  if (checking) {
    return <div className="field-hint">Verificando disponibilidade...</div>
  }
  if (!status) return null
  if (status.available) {
    return <div className="field-hint field-hint--success">@{status.username} disponível.</div>
  }
  return (
    <div className="field-hint field-hint--error">
      <div>Usuário já está em uso.</div>
      {status.suggestions?.length > 0 && (
        <div className="username-suggestions">
          {status.suggestions.map(suggestion => (
            <button key={suggestion} type="button" className="username-suggestion" onClick={() => onPick(suggestion)}>
              @{suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
