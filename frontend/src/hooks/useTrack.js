import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function useTrack() {
  const location = useLocation()
  useEffect(() => {
    try {
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: location.pathname, referrer: document.referrer || '' }),
        keepalive: true,
      }).catch(() => {})
    } catch (_) {}
  }, [location.pathname])
}
