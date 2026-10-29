import { usePwaInstall } from './usePwaInstall'
import { Icon } from './Icon'

export function PwaInstallBanner() {
  const { canInstall, isStandalone, isIOS, promptInstall, dismiss, isDismissed } = usePwaInstall()

  if (isStandalone || isDismissed || !canInstall) {
    return null
  }

  return (
    <div className="pwa-install-banner" role="banner">
      <div className="pwa-banner-left">
        <div className="pwa-banner-icon">
          <img src="/icon.png" alt="Life System" width={34} height={34} style={{ borderRadius: '8px' }} />
        </div>
        <div className="pwa-banner-text">
          <div className="pwa-banner-title">
            <span>Install Life System App</span>
            <span className="pwa-banner-tag">PWA</span>
          </div>
          <p className="pwa-banner-desc">
            {isIOS ? (
              <span>
                Tap <b>Share</b> <span style={{ fontSize: '14px' }}>📤</span> &rarr; <b>Add to Home Screen</b> <span style={{ fontSize: '14px' }}>➕</span> for full-screen offline mode.
              </span>
            ) : (
              <span>Install as a native full-screen app for instant 0ms launch & offline reliability.</span>
            )}
          </p>
        </div>
      </div>

      <div className="pwa-banner-actions">
        {!isIOS && (
          <button className="btn-pwa-install" onClick={promptInstall}>
            <Icon name="bolt" size={14} />
            <span>Install App</span>
          </button>
        )}
        <button className="btn-pwa-dismiss" onClick={dismiss} title="Dismiss for 7 days" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  )
}
