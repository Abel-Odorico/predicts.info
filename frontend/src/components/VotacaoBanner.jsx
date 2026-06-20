import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

const HIDE_PATHS = ['/votacao', '/login', '/esqueci-senha', '/redefinir-senha']

export default function VotacaoBanner() {
  const { user, token } = useAuth()
  const location = useLocation()
  const [poll, setPoll] = useState(null)
  const [myVote, setMyVote] = useState(null)
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('votacao_dismissed') === '1'
  )

  useEffect(() => {
    api.get('/poll/active').then(setPoll).catch(() => {})
  }, [])

  useEffect(() => {
    if (token && poll?.is_open) {
      api.get('/poll/my-vote', token).then(setMyVote).catch(() => {})
    }
  }, [token, poll?.is_open])

  if (HIDE_PATHS.some(p => location.pathname.startsWith(p))) return null
  if (!poll || !poll.is_open) return null
  if (dismissed) return null

  const voted = myVote?.voted

  if (voted) return null

  function dismiss() {
    sessionStorage.setItem('votacao_dismissed', '1')
    setDismissed(true)
  }

  function fmtDeadline(dt) {
    if (!dt) return ''
    const d = new Date(dt + 'Z')
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })
  }

  return (
    <div className="votacao-banner" role="alert">
      <div className="votacao-banner__icon">⚠️</div>
      <div className="votacao-banner__body">
        <strong>Consulta oficial aberta</strong>
        <span>
          Sua opinião sobre o sistema de pontuação do bolão.
          Prazo: {fmtDeadline(poll.closes_at)}.
        </span>
      </div>
      <Link to="/votacao" className="btn btn-primary btn-sm votacao-banner__cta">
        Votar agora
      </Link>
      <button
        className="votacao-banner__close"
        onClick={dismiss}
        aria-label="Fechar aviso"
      >
        ✕
      </button>
    </div>
  )
}
