import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { useAuth } from '../stores/authStore'

const TYPE_META = {
  bet_exact:      { icon: '🎯', color: '#0f7a78', label: 'Aposta' },
  bet_correct:    { icon: '✅', color: '#2ec980', label: 'Aposta' },
  bet_wrong:      { icon: '❌', color: '#e85252', label: 'Aposta' },
  ranking_top3:   { icon: '🏆', color: '#f59e0b', label: 'Ranking' },
  bet_reminder:   { icon: '⏰', color: '#a78bfa', label: 'Lembrete' },
  poll_reminder:  { icon: '📊', color: '#06b6d4', label: 'Pesquisa' },
  version_update: { icon: '🚀', color: '#10b981', label: 'Update' },
}

const FILTERS = [
  { id: 'all',      label: 'Todas' },
  { id: 'bet',      label: '⚽ Apostas' },
  { id: 'ranking',  label: '🏆 Ranking' },
  { id: 'reminder', label: '⏰ Lembretes' },
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

function filterByTab(items, tab) {
  if (tab === 'unread') return items.filter(n => !n.read)
  return items.filter(n => n.read)
}

function filterByType(items, filter) {
  if (filter === 'all') return items
  if (filter === 'bet')      return items.filter(n => n.type.startsWith('bet_e') || n.type.startsWith('bet_c') || n.type.startsWith('bet_w'))
  if (filter === 'ranking')  return items.filter(n => n.type === 'ranking_top3')
  if (filter === 'reminder') return items.filter(n => n.type === 'bet_reminder' || n.type === 'poll_reminder')
  if (filter === 'update')   return items.filter(n => n.type === 'version_update')
  return items
}

export default function NotificationBell() {
  const { token, user } = useAuth()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('unread')
  const [filter, setFilter] = useState('all')

  const fetchCount = useCallback(async () => {
    if (!token) return
    try {
      const r = await api.get('/notifications/unread-count', token)
      setCount(r.count || 0)
    } catch {}
  }, [token])

  const fetchAll = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const r = await api.get('/notifications?limit=100', token)
      setItems(r.items || [])
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
    if (!open) return
    fetchAll()
  }, [open, fetchAll])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function markRead(id) {
    try {
      await api.patch(`/notifications/${id}/read`, {}, token)
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setCount(c => Math.max(0, c - 1))
    } catch {}
  }

  async function markAllRead() {
    try {
      await api.patch('/notifications/read-all', {}, token)
      setItems(prev => prev.map(n => ({ ...n, read: true })))
      setCount(0)
    } catch {}
  }

  if (!user) return null

  const displayed = filterByType(filterByTab(items, tab), filter)
  const unreadCount = items.filter(n => !n.read).length
  const readCount   = items.filter(n => n.read).length

  const portal = createPortal(
    <>
      {/* Backdrop — no body, escapes any transform stacking context */}
      {open && <div className="notif-backdrop" onClick={() => setOpen(false)} />}

      {/* Panel */}
      <div className={`notif-panel${open ? ' notif-panel--open' : ''}`}>
        <div className="notif-panel__header">
          <div>
            <div className="notif-panel__title">Notificações</div>
            {count > 0 && (
              <div className="notif-panel__sub">{count} não lida{count !== 1 ? 's' : ''}</div>
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

        <div className="notif-tabs">
          <button
            className={`notif-tab${tab === 'unread' ? ' notif-tab--active' : ''}`}
            onClick={() => setTab('unread')}
          >
            Não lidas {unreadCount > 0 && <span className="notif-tab__count">{unreadCount}</span>}
          </button>
          <button
            className={`notif-tab${tab === 'read' ? ' notif-tab--active' : ''}`}
            onClick={() => setTab('read')}
          >
            Lidas {readCount > 0 && <span className="notif-tab__count">{readCount}</span>}
          </button>
        </div>

        <div className="notif-filters">
          {FILTERS.map(f => (
            <button
              key={f.id}
              className={`notif-filter${filter === f.id ? ' notif-filter--active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="notif-list">
          {loading && (
            <div className="notif-empty">
              <div className="notif-empty__icon">⏳</div>
              <div>Carregando...</div>
            </div>
          )}

          {!loading && displayed.length === 0 && (
            <div className="notif-empty">
              <div className="notif-empty__icon">{tab === 'unread' ? '✨' : '📭'}</div>
              <div className="notif-empty__title">
                {tab === 'unread' ? 'Nenhuma notificação nova' : 'Nenhuma notificação lida'}
              </div>
              <div className="notif-empty__sub">
                {tab === 'unread' ? 'Você está em dia!' : 'As notificações lidas aparecem aqui.'}
              </div>
            </div>
          )}

          {!loading && displayed.map(n => {
            const meta = TYPE_META[n.type] || { icon: '🔔', color: 'var(--accent)', label: '' }
            return (
              <div
                key={n.id}
                className={`notif-item${!n.read ? ' notif-item--unread' : ''}`}
                onClick={() => !n.read && markRead(n.id)}
                role={!n.read ? 'button' : undefined}
                tabIndex={!n.read ? 0 : undefined}
              >
                <div className="notif-item__icon" style={{ color: meta.color }}>
                  {meta.icon}
                </div>
                <div className="notif-item__body">
                  <div className="notif-item__title">{n.title}</div>
                  {n.body && <div className="notif-item__sub">{n.body}</div>}
                  <div className="notif-item__time">{relTime(n.created_at)}</div>
                </div>
                {!n.read && <span className="notif-item__dot" style={{ background: meta.color }} />}
              </div>
            )
          })}
        </div>
      </div>
    </>,
    document.body
  )

  return (
    <>
      {/* Bell button stays in-place inside whatever parent */}
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
    </>
  )
}
