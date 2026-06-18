import { useEffect } from 'react'

let _injected = false

export function useAdSense() {
  useEffect(() => {
    if (_injected) return
    fetch('/api/site-config/public')
      .then(r => r.json())
      .then(cfg => {
        if (cfg.adsense_enabled !== 'true' || !cfg.adsense_publisher_id) return
        if (_injected) return
        _injected = true
        const pid = cfg.adsense_publisher_id
        // meta tag
        const meta = document.createElement('meta')
        meta.name = 'google-adsense-account'
        meta.content = pid
        document.head.appendChild(meta)
        // script
        const s = document.createElement('script')
        s.async = true
        s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${pid}`
        s.crossOrigin = 'anonymous'
        document.head.appendChild(s)
      })
      .catch(() => {})
  }, [])
}
