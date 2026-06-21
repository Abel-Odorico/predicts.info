import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''

  const [validating, setValidating] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [tokenEmail, setTokenEmail] = useState('')
  const [pass, setPass] = useState('')
  const [passConfirm, setPassConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) { setValidating(false); return }
    api.get(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`)
      .then(r => { setTokenValid(true); setTokenEmail(r.email || '') })
      .catch(() => setTokenValid(false))
      .finally(() => setValidating(false))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (pass.length < 6) { setErr('A senha deve ter ao menos 6 caracteres'); return }
    if (pass !== passConfirm) { setErr('As senhas não coincidem'); return }
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: pass })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (e) {
      setErr(e.message || 'Erro ao redefinir. Solicite um novo link.')
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
                Este link de redefinição é inválido ou já expirou.<br />
                Links têm validade de 60 minutos.
              </p>
              <Link to="/esqueci-senha" className="btn btn-primary" style={{ display: 'block', textAlign: 'center' }}>
                Solicitar Novo Link
              </Link>
            </div>
          ) : done ? (
            <div style={{ padding: 'var(--s6)', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 'var(--s4)' }}>✅</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '0.04em', color: 'var(--win)', marginBottom: 'var(--s3)' }}>
                SENHA REDEFINIDA
              </div>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
                Sua senha foi atualizada com sucesso.<br />
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
                  NOVA SENHA
                </div>
                {tokenEmail && (
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                    Conta: <strong style={{ color: 'var(--accent)' }}>{tokenEmail}</strong>
                  </div>
                )}
              </div>

              <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                  <label className="form-label">Nova senha</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Mínimo 6 caracteres"
                    value={pass}
                    onChange={e => setPass(e.target.value)}
                    required
                    autoFocus
                    autoComplete="new-password"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirmar nova senha</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Repita a senha"
                    value={passConfirm}
                    onChange={e => setPassConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                  {passConfirm && pass !== passConfirm && (
                    <div className="field-hint field-hint--error">As senhas não coincidem</div>
                  )}
                  {passConfirm && pass === passConfirm && pass.length >= 6 && (
                    <div className="field-hint field-hint--success">Senhas coincidem ✓</div>
                  )}
                </div>

                {err && <div className="alert alert-error">{err}</div>}

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || pass.length < 6 || pass !== passConfirm}
                  style={{ marginTop: 'var(--s2)' }}
                >
                  {loading ? 'Salvando...' : 'Redefinir Senha'}
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
