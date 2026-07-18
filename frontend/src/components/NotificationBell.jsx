import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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

const PAGE_SIZE = 30
const PANEL_WIDTH = 400

const EMPTY_MSG = {
  all:      { icon: '🎉', title: 'Tudo em dia por aqui',              sub: 'Nenhuma notificação para mostrar agora.' },
  bet:      { icon: '⚽', title: 'Nenhuma novidade de apostas',        sub: 'Seus palpites conferidos aparecem aqui.' },
  ranking:  { icon: '🏆', title: 'Sem novidades no ranking',           sub: 'Suba no ranking pra ver alguma coisa por aqui.' },
  reminder: { icon: '⏰', title: 'Sem lembretes por enquanto',         sub: 'Avisamos antes dos próximos jogos começarem.' },
  invite:   { icon: '👥', title: 'Nenhum convite novo',                sub: 'Convites de grupo e bolão aparecem aqui.' },
  update:   { icon: '🚀', title: 'Nenhuma novidade do app',            sub: 'Atualizações do Predicts aparecem por aqui.' },
}

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

function sectionLabel(iso) {
  const d = new Date(iso)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startYesterday = new Date(startToday); startYesterday.setDate(startYesterday.getDate() - 1)
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 7)
  if (d >= startToday) return 'Hoje'
  if (d >= startYesterday) return 'Ontem'
  if (d >= startWeek) return 'Esta semana'
  return 'Anteriores'
}

// Agrupa preservando a ordem (lista já vem mais nova → mais antiga do backend).
function groupBySection(items) {
  const groups = []
  let cur = null
  for (const n of items) {
    const label = sectionLabel(n.created_at)
    if (!cur || cur.label !== label) {
      cur = { label, items: [] }
      groups.push(cur)
    }
    cur.items.push(n)
  }
  return groups
}

function anchoredStyle(rect) {
  const gap = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = rect.right - PANEL_WIDTH
  if (left < 12) left = 12
  if (left + PANEL_WIDTH > vw - 12) left = Math.max(12, vw - 12 - PANEL_WIDTH)

  const spaceBelow = vh - rect.bottom - gap - 12
  const spaceAbove = rect.top - gap - 12
  const wantMax = vh * 0.7

  // Pouco espaço embaixo e mais espaço em cima → abre para cima.
  if (spaceBelow < 240 && spaceAbove > spaceBelow) {
    const maxHeight = Math.max(Math.min(wantMax, spaceAbove), 200)
    return { position: 'fixed', bottom: vh - rect.top + gap, left, width: PANEL_WIDTH, maxHeight }
  }
  const maxHeight = Math.max(Math.min(wantMax, spaceBelow), 200)
  return { position: 'fixed', top: rect.bottom + gap, left, width: PANEL_WIDTH, maxHeight }
}

// ── Modal de detalhe (corpo completo + data/hora completa) ──────────────────
function NotificationDetailModal({ n, onClose }) {
  const meta = TYPE_META[n.type] || { icon: '🔔', color: 'var(--accent)', label: '' }
  const fullDate = n.created_at ? new Date(n.created_at).toLocaleString('pt-BR') : ''

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="pop-backdrop" style={{ zIndex: 'var(--z-popup-top)' }} onClick={onClose}>
      <div className="pop-card fade-in-1" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Fechar" className="pop-close">✕</button>
        <div className="notif-detail">
          <div className="notif-detail__icon" style={{ color: meta.color }}>{meta.icon}</div>
          <div className="notif-detail__title">{n.title}</div>
          {n.body && <div className="notif-detail__body">{n.body}</div>}
          <div className="notif-detail__time">{meta.label}{meta.label ? ' · ' : ''}{fullDate || relTime(n.created_at)}</div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function NotificationBell() {
  const { token, user } = useAuth()
  const bellRef = useRef(null)
  const prevCountRef = useRef(0)
  const initRef = useRef(false)

  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 600)

  const [count, setCount] = useState(0)
  const [pulse, setPulse] = useState(false)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState('all')
  const [detail, setDetail] = useState(null)

  const [competition, setCompetition] = useState(null)
  const [showCompPopup, setShowCompPopup] = useState(false)

  const fetchCount = useCallback(async () => {
    if (!token) return
    try {
      const r = await api.get('/notifications/unread-count', token)
      const next = r.count || 0
      if (initRef.current && next > prevCountRef.current) setPulse(true)
      initRef.current = true
      prevCountRef.current = next
      setCount(next)
    } catch {}
  }, [token])

  const fetchList = useCallback(async (offset) => {
    if (!token) return
    if (offset === 0) setLoading(true); else setLoadingMore(true)
    try {
      const r = await api.get(`/notifications?limit=${PAGE_SIZE}&offset=${offset}`, token)
      const list = r.items || []
      setTotal(r.total || 0)
      setItems(prev => (offset === 0 ? list : [...prev, ...list]))
    } catch {} finally {
      setLoading(false)
      setLoadingMore(false)
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
    if (!pulse) return
    const t = setTimeout(() => setPulse(false), 400)
    return () => clearTimeout(t)
  }, [pulse])

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth <= 600) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!open) return
    fetchList(0)
    function updateAnchor() {
      if (bellRef.current) setAnchor(bellRef.current.getBoundingClientRect())
    }
    updateAnchor()
    window.addEventListener('resize', updateAnchor)
    window.addEventListener('scroll', updateAnchor, true)
    return () => {
      window.removeEventListener('resize', updateAnchor)
      window.removeEventListener('scroll', updateAnchor, true)
    }
  }, [open, fetchList])

  useEffect(() => {
    function onKey(e) {
      if (!open) return
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const markRead = useCallback(async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`, {}, token)
      setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setCount(c => Math.max(0, c - 1))
      prevCountRef.current = Math.max(0, prevCountRef.current - 1)
    } catch {}
  }, [token])

  async function markAllRead() {
    try {
      await api.patch('/notifications/read-all', {}, token)
      setItems(prev => prev.map(n => ({ ...n, read: true })))
      setCount(0)
      prevCountRef.current = 0
    } catch {}
  }

  function openItem(n) {
    setDetail(n)
    if (!n.read) markRead(n.id)
  }

  function toggleOpen() {
    setOpen(o => {
      const next = !o
      if (next && bellRef.current) setAnchor(bellRef.current.getBoundingClientRect())
      return next
    })
  }

  const filtered = useMemo(() => filterByType(items, filter), [items, filter])
  const sections = useMemo(() => groupBySection(filtered), [filtered])
  const unreadCount = items.filter(n => !n.read).length
  const emptyMsg = EMPTY_MSG[filter] || EMPTY_MSG.all

  if (!user) return null

  const panelStyle = isMobile ? undefined : anchoredStyle(anchor || { top: 60, right: 16, bottom: 60, left: 16, width: 0 })

  const panelBody = (
    <>
      <div className="notif-panel__header">
        <div>
          <div className="notif-panel__title">Notificações</div>
          {unreadCount > 0 && (
            <div className="notif-panel__sub">{unreadCount} pendente{unreadCount !== 1 ? 's' : ''}</div>
          )}
        </div>
        <div className="notif-panel__actions">
          {unreadCount > 0 && (
            <button className="notif-mark-all" onClick={markAllRead}>Marcar tudo</button>
          )}
          <button className="notif-close" onClick={() => setOpen(false)} aria-label="Fechar">✕</button>
        </div>
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

      {competition && (
        <button className="notif-comp-banner" onClick={() => setShowCompPopup(true)}>
          <span className="notif-comp-banner__icon">⚡</span>
          <span className="notif-comp-banner__label">{competition.name}</span>
          <span className="notif-comp-banner__arrow">→</span>
        </button>
      )}

      {loading && (
        <div className="notif-loading">
          <span>Carregando…</span>
        </div>
      )}

      {!loading && sections.length === 0 && (
        <div className="notif-empty">
          <div className="notif-empty__icon">{emptyMsg.icon}</div>
          <div className="notif-empty__title">{emptyMsg.title}</div>
          <div className="notif-empty__sub">{emptyMsg.sub}</div>
        </div>
      )}

      {!loading && sections.length > 0 && (
        <div className="notif-list">
          {sections.map(group => (
            <div key={group.label}>
              <div className="notif-section__header">{group.label}</div>
              {group.items.map(n => {
                const meta = TYPE_META[n.type] || { icon: '🔔', color: 'var(--accent)', label: '' }
                return (
                  <button
                    key={n.id}
                    className={`notif-item${!n.read ? ' notif-item--unread' : ''}`}
                    onClick={() => openItem(n)}
                  >
                    {!n.read && <span className="notif-item__dot" />}
                    <span className="notif-item__icon" style={{ color: meta.color }}>{meta.icon}</span>
                    <span className="notif-item__body">
                      <span className="notif-item__title">{n.title}</span>
                      {n.body && <span className="notif-item__snippet">{n.body}</span>}
                      <span className="notif-item__time">{relTime(n.created_at)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {!loading && items.length < total && (
        <div className="notif-footer">
          <button className="notif-load-more" onClick={() => fetchList(items.length)} disabled={loadingMore}>
            {loadingMore ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      )}
    </>
  )

  const portal = createPortal(
    <>
      {open && (
        <div
          className={`notif-scrim${isMobile ? ' notif-scrim--sheet' : ''}`}
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
        <div
          className={isMobile ? 'notif-sheet' : 'notif-panel'}
          style={panelStyle}
          onClick={e => e.stopPropagation()}
        >
          {panelBody}
        </div>
      )}
    </>,
    document.body
  )

  return (
    <>
      <button
        ref={bellRef}
        className="notif-bell"
        onClick={toggleOpen}
        title="Notificações"
        aria-label={`Notificações${count > 0 ? ` (${count} não lidas)` : ''}`}
      >
        <span className="notif-bell__icon">🔔</span>
        {count > 0 && (
          <span className={`notif-bell__badge${pulse ? ' notif-bell__badge--pulse' : ''}`}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {portal}
      {detail && <NotificationDetailModal n={detail} onClose={() => setDetail(null)} />}
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
