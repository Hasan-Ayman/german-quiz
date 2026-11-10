import { useEffect, useRef, useState } from 'react'

export function useAppUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const requestedUpdate = useRef(false)
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
    const serviceWorker = navigator.serviceWorker
    let registration: ServiceWorkerRegistration | undefined
    let active = true
    const base = import.meta.env.BASE_URL

    function checkWaiting() {
      if (active && registration?.waiting && serviceWorker.controller) {
        setWaiting(registration.waiting)
      }
    }
    function watchInstall() {
      registration?.installing?.addEventListener('statechange', checkWaiting)
    }
    function controllerChanged() {
      if (requestedUpdate.current) window.location.reload()
      else if (active) setWaiting(null)
    }
    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {})
    }
    serviceWorker.addEventListener('controllerchange', controllerChanged)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    void serviceWorker.register(base + 'sw.js', { scope: base, updateViaCache: 'none' }).then(result => {
      if (!active) return
      registration = result
      checkWaiting()
      watchInstall()
      registration.addEventListener('updatefound', watchInstall)
    }).catch(() => {
      // The browser can still use the app online if service workers are unavailable.
    })
    return () => {
      active = false
      registration?.removeEventListener('updatefound', watchInstall)
      serviceWorker.removeEventListener('controllerchange', controllerChanged)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  return waiting ? () => {
    requestedUpdate.current = true
    waiting.postMessage('ACTIVATE_UPDATE')
  } : null
}
