import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useToasts } from '../toast'

const ICONS = { success: '✓', error: '✕', info: 'ℹ' }

function ToastItem({ item, onDismiss }) {
  const [leaving, setLeaving] = useState(false)
  const remainingRef = useRef(item.duration)
  const startRef = useRef(0)
  const timerRef = useRef(null)

  function clear() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  function handleDismiss() {
    if (leaving) return
    clear()
    setLeaving(true)
    setTimeout(() => onDismiss(item.id), 150)
  }

  function startTimer(ms) {
    startRef.current = Date.now()
    clear()
    timerRef.current = setTimeout(handleDismiss, ms)
  }

  function pauseTimer() {
    if (!timerRef.current) return
    clear()
    remainingRef.current = Math.max(remainingRef.current - (Date.now() - startRef.current), 0)
  }

  function resumeTimer() {
    if (leaving) return
    startTimer(remainingRef.current)
  }

  useEffect(() => {
    startTimer(remainingRef.current)
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className={`toast-item toast-item--${item.type} ${leaving ? 'toast-item--leaving' : ''}`}
      role="status"
      aria-live="polite"
      onClick={handleDismiss}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
    >
      <span className="toast-item__icon">{ICONS[item.type] || 'ℹ'}</span>
      <span className="toast-item__msg">{item.msg}</span>
    </div>
  )
}

export default function Toaster() {
  const toasts = useToasts(s => s.toasts)
  const dismiss = useToasts(s => s.dismiss)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="toast-container">
      {toasts.map(item => (
        <ToastItem key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>,
    document.body
  )
}
