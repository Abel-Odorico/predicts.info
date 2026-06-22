import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../stores/authStore'

export function useTrack() {
  const location = useLocation()
  const { user } = useAuth()

  useEffect(() => {
    try {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: location.pathname,
          referrer: document.referrer || '',
          user_id: user?.id ?? null,
        }),
        keepalive: true,
      }).catch(() => {})
    } catch (_) {}
  }, [location.pathname, user?.id])
}
