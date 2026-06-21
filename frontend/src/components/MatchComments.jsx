import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

const MAX_LEN = 280

function relTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'agora'
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export default function MatchComments({ matchId }) {
  const { user, token } = useAuth()
  const [comments, setComments] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef(null)

  const fetchComments = useCallback(async () => {
    if (!matchId) return
    try {
      const data = await api.get(`/matches/${matchId}/comments?limit=100`)
      setComments(data)
    } catch {}
  }, [matchId])

  useEffect(() => {
    fetchComments()
    const iv = setInterval(fetchComments, 30000)
    return () => clearInterval(iv)
  }, [fetchComments])

  async function submit(e) {
    e?.preventDefault()
    if (!text.trim() || !token) return
    setSending(true)
    setError('')
    try {
      const c = await api.post(`/matches/${matchId}/comments`, { content: text.trim() }, token)
      setComments(prev => [...prev, c])
      setText('')
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch (err) {
      setError(err.message || 'Erro ao enviar')
    } finally {
      setSending(false)
    }
  }

  async function deleteComment(id) {
    try {
      await api.delete(`/matches/${matchId}/comments/${id}`, token)
      setComments(prev => prev.filter(c => c.id !== id))
    } catch {}
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="match-comments">
      <div className="match-comments__header">
        <span className="match-comments__title">💬 Comentários</span>
        <span className="match-comments__count">{comments.length}</span>
      </div>

      <div className="match-comments__list">
        {comments.length === 0 && (
          <div className="match-comments__empty">Seja o primeiro a comentar!</div>
        )}
        {comments.map(c => (
          <div key={c.id} className={`match-comment-item${c.user_id === user?.id ? ' match-comment-item--mine' : ''}`}>
            <div className="match-comment-item__avatar">{initials(c.user_name)}</div>
            <div className="match-comment-item__body">
              <div className="match-comment-item__meta">
                <span className="match-comment-item__name">{c.user_name}</span>
                <span className="match-comment-item__time">{relTime(c.created_at)}</span>
                {(c.user_id === user?.id || user?.role === 'admin') && (
                  <button className="match-comment-item__del" onClick={() => deleteComment(c.id)} title="Excluir">✕</button>
                )}
              </div>
              <div className="match-comment-item__text">{c.content}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {token ? (
        <form className="match-comment-input" onSubmit={submit}>
          <div className="match-comment-input__avatar">{initials(user?.name)}</div>
          <div className="match-comment-input__field">
            <textarea
              className="match-comment-input__textarea"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Comente sobre a partida… (Enter para enviar)"
              maxLength={MAX_LEN}
              rows={2}
              disabled={sending}
            />
            <div className="match-comment-input__footer">
              {error && <span style={{ color: 'var(--lose)', fontSize: 11 }}>{error}</span>}
              <span className="match-comment-input__counter" style={{ color: text.length > MAX_LEN * 0.9 ? 'var(--lose)' : 'var(--text-4)' }}>
                {text.length}/{MAX_LEN}
              </span>
              <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !text.trim()}>
                {sending ? '...' : 'Enviar'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="match-comments__login">
          <a href="/login" style={{ color: 'var(--accent)' }}>Faça login</a> para comentar.
        </div>
      )}
    </div>
  )
}
