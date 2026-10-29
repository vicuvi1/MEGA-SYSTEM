import { useEffect, useState } from 'react'

export interface PwaInstallState {
  canInstall: boolean
  isStandalone: boolean
  isIOS: boolean
  promptInstall: () => Promise<boolean>
  dismiss: () => void
  isDismissed: boolean
}

export function usePwaInstall(): PwaInstallState {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      const until = localStorage.getItem('life_pwa_dismiss_until')
      return until ? Date.now() < Number(until) : false
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    setIsStandalone(standalone)

    const ua = navigator.userAgent.toLowerCase()
    const ios = /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream
    setIsIOS(ios)

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }

    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setIsStandalone(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const promptInstall = async (): Promise<boolean> => {
    if (!deferredPrompt) return false
    try {
      deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      if (outcome === 'accepted') {
        setIsStandalone(true)
        setDeferredPrompt(null)
        return true
      }
    } catch (e) {
      console.warn('[PWA] prompt error:', e)
    }
    return false
  }

  const dismiss = () => {
    setIsDismissed(true)
    try {
      // Dismiss for 7 days
      localStorage.setItem('life_pwa_dismiss_until', String(Date.now() + 7 * 864e5))
    } catch {}
  }

  const canInstall = !isStandalone && (Boolean(deferredPrompt) || isIOS)

  return {
    canInstall,
    isStandalone,
    isIOS,
    promptInstall,
    dismiss,
    isDismissed
  }
}
