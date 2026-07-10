import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import Spinner from '../components/Spinner'

export default function AlterarTelefone() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''

  const [validating, setValidating] = useState(true)
  const [tokenValid, setTokenValid] = useState(false)
  const [currentPhone, setCurrentPhone] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) { setValidating(false); return }
    api.get(`/auth/account-action/validate?token=${encodeURIComponent(token)}&action=phone`)
      .then(r => { setTokenValid(true); setCurrentPhone(r.phone || '') })
      .catch(() => setTokenValid(false))
      .finally(() => setValidating(false))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (newPhone.replace(/\D/g, '').length < 10) { setErr('Informe um telefone válido (com DDD)'); return }
    setLoading(true)
    try {
      await api.post('/auth/change-phone', { token, new_phone: newPhone })
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
                Este link de atualização de telefone é inválido ou já expirou.<br />
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
                TELEFONE ATUALIZADO
              </div>
              <p style={{ fontFamily: 'var(--font-cond)', fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
                Seu telefone foi atualizado com sucesso.<br />
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
                  NOVO TELEFONE
                </div>
                {currentPhone && (
                  <div style={{ fontFamily: 'var(--font-cond)', fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                    Telefone atual: <strong style={{ color: 'var(--accent)' }}>{currentPhone}</strong>
                  </div>
                )}
              </div>

              <form onSubmit={handleSubmit} className="login-form">
                <div className="form-group">
                  <label className="form-label">Novo telefone (WhatsApp)</label>
                  <input
                    type="tel"
                    className="form-input"
                    placeholder="(11) 91234-5678"
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    required
                    autoFocus
                    autoComplete="tel"
                  />
                </div>

                {err && <div className="alert alert-error">{err}</div>}

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || newPhone.replace(/\D/g, '').length < 10}
                  style={{ marginTop: 'var(--s2)' }}
                >
                  {loading ? 'Salvando...' : 'Atualizar Telefone'}
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
