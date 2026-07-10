import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

export default function AlterarEmail() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''

  const [validating, setValidating] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [currentEmail, setCurrentEmail] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) { setValidating(false); return }
    api.get(`/auth/account-action/validate?token=${encodeURIComponent(token)}&action=email`)
      .then(r => { setTokenValid(true); setCurrentEmail(r.email || '') })
      .catch(() => setTokenValid(false))
      .finally(() => setValidating(false))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!newEmail.includes('@')) { setErr('Informe um e-mail válido'); return }
    setLoading(true)
    try {
      await api.post('/auth/change-email', { token, new_email: newEmail })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (e) {
      setErr(e.message || 'Erro ao atualizar. Solicite um novo link.')
    } finally {
      setLoading(false)
    }
  }

  if (validating) return (
    <div className="page login-shell">
      <div className="login-box">
        <div className="login-brand fade-in-1">
          <div className="login-brand__logo">PREDICTS</div>
          <div className="login-brand__subtitle">Simulador Estatístico</div>
        </div>
        <div className="card card--accent fade-in-2" style={{ padding: 'var(--s8)', textAlign: 'center' }}>
          <Spinner text="Verificando link..." />
        </div>
      </div>
    </div>
  )

  return (
    <div className="page login-shell">
      <div className="login-box">
        <div className="login-brand fade-in-1">
          <div className="login-brand__logo">PREDICTS</div>
          <div className="login-brand__subtitle">Simulador Estatístico</div>
        </div>

        <div className="card card--accent fade-in-2">
          {!token || !tokenValid ? (
            <div style={{ padding: 'var(--s6)', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 'var(--s4)' }}>🔗</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.04em', color: 'var(--lose)', marginBottom: 'var(--s3)' }}>
                LINK INVÁLIDO
              </div>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
                Este link de atualização de e-mail é inválido ou já expirou.<br />
                Peça ao administrador para enviar um novo link.
              </p>
              <Link to="/login" className="btn btn-primary" style={{ display: 'block', textAlign: 'center' }}>
                Ir para o Login
              </Link>
            </div>
          ) : done ? (
            <div style={{ padding: 'var(--s6)', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 'var(--s4)' }}>✅</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '0.04em', color: 'var(--win)', marginBottom: 'var(--s3)' }}>
                E-MAIL ATUALIZADO
              </div>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
                Seu e-mail foi atualizado com sucesso.<br />
                Redirecionando para o login...
              </p>
              <Link to="/login" className="btn btn-primary" style={{ display: 'block', textAlign: 'center' }}>
                Ir para o Login
              </Link>
            </div>
          ) : (
            <>
              <div style={{ padding: 'var(--s5) var(--s5) var(--s3)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.04em', color: 'var(--text-1)' }}>
                  NOVO E-MAIL
                </div>
                {currentEmail && (
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                    E-mail atual: <strong style={{ color: 'var(--accent)' }}>{currentEmail}</strong>
                  </div>
                )}
              </div>

              <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                  <label className="form-label">Novo e-mail</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="seuemail@exemplo.com"
                    value={newEmail}
                    onChange={e => setNewEmail(e.target.value)}
                    required
                    autoFocus
                    autoComplete="email"
                  />
                </div>

                {err && <div className="alert alert-error">{err}</div>}

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || !newEmail.includes('@')}
                  style={{ marginTop: 'var(--s2)' }}
                >
                  {loading ? 'Salvando...' : 'Atualizar E-mail'}
                </button>
              </form>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 'var(--s4)' }} className="fade-in-3">
          <Link to="/login" style={{
            fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)',
            textDecoration: 'none', letterSpacing: '0.04em'
          }}>
            ← Voltar ao login
          </Link>
        </div>
      </div>
    </div>
  )
}
