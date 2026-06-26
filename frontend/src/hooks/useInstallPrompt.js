import { useState, useEffect } from 'react'

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || navigator.standalone === true
    setIsIOS(ios)
    setIsStandalone(standalone)

    const handler = e => {
      e.preventDefault()
      setPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => { setInstalled(true); setPrompt(null) })

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const install = async () => {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setPrompt(null)
  }

  // Show button if: prompt available OR iOS (not standalone, not already installed)
  const canInstall = !isStandalone && !installed && (!!prompt || isIOS)
  const hasPrompt  = !!prompt

  return { canInstall, install, isIOS, installed, isStandalone, hasPrompt }
}
