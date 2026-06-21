import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

function _urlB64ToUint8(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export function usePushNotifications(token) {
  const [supported,  setSupported]  = useState(false)
  const [permission, setPermission] = useState('default')
  const [subscribed, setSubscribed] = useState(false)
  const [vapidKey,   setVapidKey]   = useState('')

  useEffect(() => {
    setSupported('serviceWorker' in navigator && 'PushManager' in window)
    if (typeof Notification !== 'undefined') setPermission(Notification.permission)
    api.get('/push/vapid-key').then(r => setVapidKey(r.publicKey || '')).catch(() => {})
  }, [])

  // Detect if already subscribed
  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.getRegistration().then(async reg => {
      if (!reg) return
      const sub = await reg.pushManager?.getSubscription()
      setSubscribed(!!sub)
    }).catch(() => {})
  }, [supported])

  const register = useCallback(async () => {
    if (!supported || !token || !vapidKey) return
    const perm = await Notification.requestPermission()
    setPermission(perm)
    if (perm !== 'granted') return

    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlB64ToUint8(vapidKey),
      })
    }
    if (sub) {
      const key  = sub.getKey('p256dh')
      const auth = sub.getKey('auth')
      await api.post('/push/subscribe', {
        endpoint: sub.endpoint,
        p256dh:  key  ? btoa(String.fromCharCode(...new Uint8Array(key)))  : '',
        auth:    auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : '',
      }, token)
      setSubscribed(true)
    }
  }, [supported, token, vapidKey])

  const unregister = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager?.getSubscription()
      if (sub) {
        await api.delete('/push/subscribe', token)
        await sub.unsubscribe()
      }
    } catch {}
    setSubscribed(false)
  }, [token])

  return { supported, permission, subscribed, register, unregister, vapidKey }
}
