import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../stores/authStore'

export function useTrack() {
  const location = useLocation()
  const { user } = useAuth()

  useEffect(() => {
    try {
      const qs = new URLSearchParams(location.search)
      const utmSource = qs.get('utm_source')
      if (utmSource) {
        sessionStorage.setItem('predicts_utm_source', utmSource)
        const utmCampaign = qs.get('utm_campaign')
        if (utmCampaign) sessionStorage.setItem('predicts_utm_campaign', utmCampaign)
      }
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: location.pathname,
          referrer: document.referrer || '',
          user_id: user?.id ?? null,
          standalone: window.matchMedia?.('(display-mode: standalone)').matches
            || window.navigator.standalone === true,
          utm_source: sessionStorage.getItem('predicts_utm_source') || null,
          utm_campaign: sessionStorage.getItem('predicts_utm_campaign') || null,
        }),
        keepalive: true,
      }).catch(() => {})
    } catch (_) {}
  }, [location.pathname, user?.id])
}
