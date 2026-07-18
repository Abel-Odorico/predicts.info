import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'
import { CompetitionPopup } from './AppPopups'

const TYPE_META = {
  bet_exact:      { icon: '🎯', color: '#0f7a78', label: 'Aposta' },
  bet_correct:    { icon: '✅', color: '#2ec980', label: 'Aposta' },
  bet_wrong:      { icon: '❌', color: '#e85252', label: 'Aposta' },
  ranking_top3:   { icon: '🏆', color: '#f59e0b', label: 'Ranking' },
  bet_reminder:   { icon: '⏰', color: '#a78bfa', label: 'Lembrete' },
  poll_reminder:  { icon: '📊', color: '#06b6d4', label: 'Pesquisa' },
  version_update: { icon: '🚀', color: '#10b981', label: 'Update' },
  group_invite:   { icon: '👥', color: '#4a90e8', label: 'Convite' },
  group_join_request:  { icon: '🔔', color: '#4a90e8', label: 'Pedido' },
  group_join_approved: { icon: '✅', color: '#2ec980', label: 'Aprovado' },
  group_join_rejected: { icon: '🚫', color: '#e85252', label: 'Recusado' },
  champion_bonus: { icon: '🏆', color: '#e8a030', label: 'Bônus' },
  champion_remind:{ icon: '🏅', color: '#e8a030', label: 'Campeão' },
}

const FILTERS = [
  { id: 'all',      label: 'Todas' },
  { id: 'bet',      label: '⚽ Apostas' },
  { id: 'ranking',  label: '🏆 Ranking' },
  { id: 'reminder', label: '⏰ Lembretes' },
  { id: 'invite',   label: '👥 Convites' },
  { id: 'update',   label: '🚀 Updates' },
]

function relTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'agora'
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

function filterByType(items, filter) {
  if (filter === 'all') return items
  if (filter === 'bet')      return items.filter(n => n.type.startsWith('bet_e') || n.type.startsWith('bet_c') || n.type.startsWith('bet_w'))
  if (filter === 'ranking')  return items.filter(n => n.type === 'ranking_top3')
  if (filter === 'reminder') return items.filter(n => n.type === 'bet_reminder' || n.type === 'poll_reminder')
  if (filter === 'invite')   return items.filter(n => n.type === 'group_invite' || n.type.startsWith('group_join_'))
  if (filter === 'update')   return items.filter(n => n.type === 'version_update')
  return items
}

// Pendentes primeiro (na ordem que vieram, mais novas primeiro), depois lidas.
// A ordem é congelada ao abrir/trocar filtro — marcar como lida não reordena
// a fila embaixo do usuário no meio da navegação.
function buildQueue(items, filter) {
  const filtered = filterByType(items, filter)
  const unread = filtered.filter(n => !n.read)
  const read   = filtered.filter(n => n.read)
  return [...unread, ...read].map(n => n.id)
}

export default function NotificationBell() {
  const { token, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [queueIds, setQueueIds] = useState([])
  const [index, setIndex] = useState(0)
  const [competition, setCompetition] = useState(null)
  const [showCompPopup, setShowCompPopup] = useState(false)

  const fetchCount = useCallback(async () => {
    if (!token) return
    try {
      const r = await api.get('/notifications/unread-count', token)
      setCount(r.count || 0)
    } catch {}
  }, [token])

  const fetchAll = useCallback(async (activeFilter) => {
    if (!token) return
    setLoading(true)
    try {
      const r = await api.get('/notifications?limit=100', token)
      const list = r.items || []
      setItems(list)
      setQueueIds(buildQueue(list, activeFilter))
      setIndex(0)
    } catch {} finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!user) return
    fetchCount()
    const interval = setInterval(fetchCount, 60000)
    return () => clearInterval(interval)
  }, [user, fetchCount])

  useEffect(() => {
    api.get('/competition/active').then(c => setCompetition(c || null)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!open) return
    fetchAll(filter)
  }, [open, fetchAll]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = useMemo(
    () => items.find(n => n.id === queueIds[index]) || null,
    [items, queueIds, index]
  )

  const markRead = useCallback(async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`, {}, token)
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setCount(c => Math.max(0, c - 1))
    } catch {}
  }, [token])

  // Cada notificação vista (pousou no índice) marca como lida na hora — não repete.
  useEffect(() => {
    if (!open || !current || current.read) return
    markRead(current.id)
  }, [open, current, markRead])

  async function markAllRead() {
    try {
      await api.patch('/notifications/read-all', {}, token)
      setItems(prev => prev.map(n => ({ ...n, read: true })))
      setCount(0)
    } catch {}
  }

  function changeFilter(f) {
    setFilter(f)
    setQueueIds(buildQueue(items, f))
    setIndex(0)
  }

  function goPrev() { setIndex(i => Math.max(0, i - 1)) }
  function goNext() { setIndex(i => Math.min(queueIds.length - 1, i + 1)) }

  useEffect(() => {
    function onKey(e) {
      if (!open) return
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, queueIds.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null

  const unreadCount = items.filter(n => !n.read).length
  const meta = current ? (TYPE_META[current.type] || { icon: '🔔', color: 'var(--accent)', label: '' }) : null
  const fullDate = current?.created_at ? new Date(current.created_at).toLocaleString('pt-BR') : ''

  const portal = createPortal(
    <>
      {open && <div className="notif-backdrop" onClick={() => setOpen(false)} />}

      {open && (
        <div className="notif-modal" onClick={() => setOpen(false)}>
          <div className="notif-modal__card" onClick={e => e.stopPropagation()}>
            <div className="notif-panel__header">
              <div>
                <div className="notif-panel__title">Notificações</div>
                {unreadCount > 0 && (
                  <div className="notif-panel__sub">{unreadCount} pendente{unreadCount !== 1 ? 's' : ''}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {unreadCount > 0 && (
                  <button className="notif-mark-all" onClick={markAllRead}>
                    Marcar tudo
                  </button>
                )}
                <button className="notif-close" onClick={() => setOpen(false)}>✕</button>
              </div>
            </div>

            <div className="notif-filters">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  className={`notif-filter${filter === f.id ? ' notif-filter--active' : ''}`}
                  onClick={() => changeFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {competition && (
              <button
                onClick={() => setShowCompPopup(true)}
                style={{
                  margin: '10px 20px 0', padding: '10px 12px',
                  background: 'linear-gradient(135deg,rgba(232,196,74,0.13) 0%,rgba(232,196,74,0.04) 100%)',
                  border: '1.5px solid rgba(232,196,74,0.3)', borderRadius: 10,
                  display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>⚡</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-cond)', fontWeight: 700, fontSize: 12.5, color: '#e8c44a', lineHeight: 1.2 }}>
                    {competition.name}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-cond)', fontSize: 11, color: '#e8c44a', flexShrink: 0 }}>→</span>
              </button>
            )}

            {loading && (
              <div className="notif-empty">
                <div className="notif-empty__icon">⏳</div>
                <div>Carregando...</div>
              </div>
            )}

            {!loading && queueIds.length === 0 && (
              <div className="notif-empty">
                <div className="notif-empty__icon">✨</div>
                <div className="notif-empty__title">Nenhuma notificação</div>
                <div className="notif-empty__sub">Você está em dia!</div>
              </div>
            )}

            {!loading && current && (
              <>
                <div className="notif-progress">
                  <span>{index + 1} de {queueIds.length}</span>
                  <span className={`notif-progress__state notif-progress__state--${current.read ? 'read' : 'unread'}`}>
                    {current.read ? 'LIDA' : 'PENDENTE'}
                  </span>
                </div>

                <div className="notif-card">
                  <div className="notif-card__icon" style={{ color: meta.color }}>{meta.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="notif-card__title">{current.title}</div>
                    {current.body && <div className="notif-card__body">{current.body}</div>}
                    <div className="notif-card__time">{meta.label} · {fullDate || relTime(current.created_at)}</div>
                  </div>
                </div>

                <div className="notif-nav">
                  <button className="notif-nav__arrow" onClick={goPrev} disabled={index === 0} aria-label="Anterior">
                    ◀
                  </button>
                  <div className="notif-nav__dots">
                    {queueIds.map((id, i) => {
                      const n = items.find(x => x.id === id)
                      return (
                        <span
                          key={id}
                          className={`notif-nav__dot${i === index ? ' notif-nav__dot--current' : n && !n.read ? ' notif-nav__dot--unread' : ''}`}
                          onClick={() => setIndex(i)}
                        />
                      )
                    })}
                  </div>
                  <button className="notif-nav__arrow" onClick={goNext} disabled={index >= queueIds.length - 1} aria-label="Próxima">
                    ▶
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>,
    document.body
  )

  return (
    <>
      <button
        className="notif-bell"
        onClick={() => setOpen(o => !o)}
        title="Notificações"
        aria-label={`Notificações${count > 0 ? ` (${count} não lidas)` : ''}`}
      >
        <span className="notif-bell__icon">🔔</span>
        {count > 0 && (
          <span className="notif-bell__badge">{count > 99 ? '99+' : count}</span>
        )}
      </button>

      {portal}
      {showCompPopup && competition && (
        <CompetitionPopup
          competition={competition}
          onClose={() => setShowCompPopup(false)}
          showRankingLink
        />
      )}
    </>
  )
}
