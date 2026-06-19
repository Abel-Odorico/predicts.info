import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setSent(true)
    } catch (e) {
      setErr(e.message || 'Erro ao enviar. Tente novamente.')
    } finally {
      setLoading(false)
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
          {sent ? (
            <div style={{ padding: 'var(--s6)', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 'var(--s4)' }}>📬</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '0.04em', color: 'var(--text-1)', marginBottom: 'var(--s3)' }}>
                E-MAIL ENVIADO
              </div>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
                Se o e-mail <strong style={{ color: 'var(--text-2)' }}>{email}</strong> estiver cadastrado,
                você receberá um link para redefinir sua senha em até 1 minuto.
                Verifique também a caixa de spam.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setSent(false); setEmail('') }}
                >
                  Tentar outro e-mail
                </button>
                <Link to="/login" className="btn btn-primary" style={{ textAlign: 'center' }}>
                  Voltar ao Login
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div style={{ padding: 'var(--s5) var(--s5) var(--s3)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.04em', color: 'var(--text-1)' }}>
                  ESQUECI MINHA SENHA
                </div>
                <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                  Informe seu e-mail e enviaremos um link de redefinição.
                </div>
              </div>

              <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                  <label className="form-label">E-mail</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoFocus
                    autoComplete="email"
                  />
                </div>

                {err && <div className="alert alert-error">{err}</div>}

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || !email.trim()}
                  style={{ marginTop: 'var(--s2)' }}
                >
                  {loading ? 'Enviando...' : 'Enviar Link de Redefinição'}
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
