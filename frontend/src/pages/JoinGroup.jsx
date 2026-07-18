import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import Spinner from '../components/Spinner'

export default function JoinGroup() {
  const { token: joinToken } = useParams()
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const byId = searchParams.get('by')
  const [group,   setGroup]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error,   setError]   = useState('')
  const [joined,  setJoined]  = useState(!!location.state?.justJoined)
  const [pendingApproval, setPendingApproval] = useState(!!location.state?.pendingApproval)

  useEffect(() => {
    api.get(`/user-groups/join/${joinToken}`)
      .then(setGroup)
      .catch(err => setError(err.message || 'Link inválido ou expirado.'))
      .finally(() => setLoading(false))
  }, [joinToken])

  async function handleJoin() {
    if (!token) {
      sessionStorage.setItem('join_token', joinToken)
      if (byId) sessionStorage.setItem('join_by', byId)
      navigate('/login')
      return
    }
    setJoining(true)
    setError('')
    try {
      const qs = byId ? `?by=${byId}` : ''
      const res = await api.post(`/user-groups/join/${joinToken}${qs}`, {}, token)
      if (res?.status === 'pending_approval') setPendingApproval(true)
      else setJoined(true)
    } catch (e) {
      const msg = e.message || ''
      if (msg.includes('já faz parte')) {
        setJoined(true)
      } else {
        setError(msg || 'Erro ao entrar no grupo.')
      }
    } finally {
      setJoining(false)
    }
  }

  if (loading) return <Spinner text="Carregando convite..." />

  if (error && !group) {
    return (
      <div className="page">
        <div className="card fade-in-1" style={{ textAlign: 'center', padding: 'var(--s24)' }}>
          <div style={{ fontSize: 48, marginBottom: 'var(--s8)' }}>🔗</div>
          <h1 className="page-title">Link inválido</h1>
          <p className="page-subtitle">{error}</p>
          <Link to="/ranking" className="btn btn-primary btn-sm mt-4">Ver Ranking</Link>
        </div>
      </div>
    )
  }

  if (pendingApproval) {
    return (
      <div className="page">
        <div className="card fade-in-1" style={{ textAlign: 'center', padding: 'var(--s24)' }}>
          <div style={{ fontSize: 48, marginBottom: 'var(--s8)' }}>⏳</div>
          <h1 className="page-title">Pedido enviado</h1>
          <p className="page-subtitle">
            Esse link não é do dono do grupo <strong>{group?.group_name}</strong> — seu pedido de entrada foi enviado e precisa ser aprovado por ele.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 'var(--s8)', flexWrap: 'wrap' }}>
            <Link to="/meus-grupos" className="btn btn-primary">Ver meus grupos</Link>
          </div>
        </div>
      </div>
    )
  }

  if (joined) {
    return (
      <div className="page">
        <div className="card fade-in-1" style={{ textAlign: 'center', padding: 'var(--s24)' }}>
          <div style={{ fontSize: 48, marginBottom: 'var(--s8)' }}>🏆</div>
          <h1 className="page-title">Você entrou!</h1>
          <p className="page-subtitle">Agora você faz parte do grupo <strong>{group?.group_name}</strong></p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 'var(--s8)', flexWrap: 'wrap' }}>
            <Link to="/apostas" className="btn btn-primary">Fazer apostas</Link>
            <Link to="/meus-grupos" className="btn btn-ghost">Ver meus grupos</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="card fade-in-1" style={{ textAlign: 'center', padding: 'var(--s24)' }}>
        <div style={{ fontSize: 48, marginBottom: 'var(--s8)' }}>⚽</div>
        <h1 className="page-title">{group?.group_name}</h1>
        <p className="page-subtitle" style={{ marginBottom: 'var(--s8)' }}>
          {group?.member_count} participante{group?.member_count !== 1 ? 's' : ''} · Bolão Predicts
        </p>

        {error && (
          <div style={{ color: 'var(--lose)', fontFamily: 'var(--font-data)', fontSize: 13, marginBottom: 'var(--s6)' }}>
            {error}
          </div>
        )}

        {!token ? (
          <div>
            <p style={{ color: 'var(--text-3)', fontFamily: 'var(--font-body)', fontSize: 14, marginBottom: 'var(--s8)' }}>
              Faça login ou crie uma conta para participar deste bolão.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={handleJoin}>
                Entrar / Criar conta
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-primary btn-lg"
            onClick={handleJoin}
            disabled={joining}
          >
            {joining ? 'Entrando...' : '🏅 Entrar no Bolão'}
          </button>
        )}
      </div>
    </div>
  )
}
