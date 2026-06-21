import { useState, useEffect } from 'react'
import { api } from '../api'

export function usePushNotifications(token) {
  const [supported,  setSupported]  = useState(false)
  const [permission, setPermission] = useState('default')
  const [subscribed, setSubscribed] = useState(false)

  useEffect(() => {
    setSupported('serviceWorker' in navigator && 'PushManager' in window)
    if (typeof Notification !== 'undefined') setPermission(Notification.permission)
  }, [])

  async function register() {
    if (!supported || !token) return
    const perm = await Notification.requestPermission()
    setPermission(perm)
    if (perm !== 'granted') return

    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true })
    }
    if (sub) {
      const key  = sub.getKey('p256dh')
      const auth = sub.getKey('auth')
      await api.post('/push/subscribe', {
        endpoint: sub.endpoint,
        p256dh:  key  ? btoa(String.fromCharCode(...new Uint8Array(key)))  : '',
        auth:    auth ? btoa(String.fromCharCode(...new Uint8Array(auth))) : '',
      }, token)
    }
    setSubscribed(true)
  }

  async function unregister() {
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager?.getSubscription()
      if (sub) {
        await api.delete('/push/subscribe', token)
        await sub.unsubscribe()
      }
    } catch {}
    setSubscribed(false)
  }

  return { supported, permission, subscribed, register, unregister }
}
