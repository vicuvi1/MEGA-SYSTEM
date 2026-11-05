// "Go back one version" from the crash screen: the desktop installs the
// previous release and restarts; the website's offline helper serves the
// version before this one until a newer version than this one is published.
declare const __BUILD_ID__: string
const MINE = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : ''
/** The version you went back from (the website), until a newer one is out. */
export const BACK_KEY = 'life_went_back_from'

/** Use the newest version again (after going back). */
export function backToNewest(): void {
  try {
    localStorage.removeItem(BACK_KEY)
  } catch {
    /* fine */
  }
  navigator.serviceWorker?.controller?.postMessage({ type: 'rollback-off' })
  setTimeout(() => window.location.reload(), 300)
}

/** Can this app go back a version from here? */
export const canGoBack = (): boolean => (typeof window !== 'undefined' && !!window.desktop?.rollback) || (typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller && !!MINE)

/** Asks for the previous version. Resolves with a short message when it can't. */
export async function goBackOneVersion(): Promise<string | null> {
  if (window.desktop?.rollback) {
    const r = await window.desktop.rollback()
    return r.ok ? null : r.error ?? 'Could not go back'
  }
  const sw = navigator.serviceWorker?.controller
  if (!sw || !MINE) return 'Going back works once the app has been opened at least twice'
  const ok = await new Promise<boolean>((resolve) => {
    const on = (e: MessageEvent) => {
      if (e.data?.type !== 'rollback') return
      navigator.serviceWorker.removeEventListener('message', on)
      resolve(!!e.data.ok)
    }
    navigator.serviceWorker.addEventListener('message', on)
    sw.postMessage({ type: 'rollback', bad: MINE })
    setTimeout(() => resolve(false), 4000)
  })
  if (!ok) return 'No earlier version is saved on this device yet'
  try {
    localStorage.setItem(BACK_KEY, MINE)
  } catch {
    /* the helper still knows */
  }
  window.location.reload()
  return null
}
