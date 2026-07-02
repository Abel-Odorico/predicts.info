import { useEffect, useState } from 'react'
import { api } from '../api'

let _cfgPromise = null
function loadPublicConfig() {
  if (!_cfgPromise) {
    _cfgPromise = api.get('/site-config/public').catch(() => ({}))
  }
  return _cfgPromise
}

/**
 * Bloco manual do AdSense. Renderiza <ins class="adsbygoogle"> real
 * usando client/slot vindos de /site-config (admin -> Configurações -> AdSense).
 * Sem slot ID cadastrado, não renderiza nada (Auto Ads continua funcionando sozinho).
 */
export default function AdSlot({ slot, format = 'auto', style, className = '' }) {
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    let alive = true
    loadPublicConfig().then(c => { if (alive) setCfg(c) })
    return () => { alive = false }
  }, [])

  const slotId = cfg?.[`adsense_slot_${slot}`]
  const ready = cfg && cfg.adsense_enabled === 'true' && cfg.adsense_publisher_id && slotId

  useEffect(() => {
    if (!ready) return
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch { /* script ainda não carregou / bloqueado por ad blocker */ }
  }, [ready, slot])

  if (!ready) return null

  return (
    <ins
      className={`adsbygoogle ${className}`}
      style={style || { display: 'block' }}
      data-ad-client={cfg.adsense_publisher_id}
      data-ad-slot={slotId}
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  )
}
