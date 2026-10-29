import { Icon } from './Icon'
import type { PageId } from './modules'

interface Props {
  page: PageId
  onGo: (p: PageId) => void
  onQuickCommand: () => void
}

function haptic(ms = 12) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(ms)
    } catch {}
  }
}

export function MobileBottomBar({ page, onGo, onQuickCommand }: Props) {
  const handleNav = (p: PageId) => {
    haptic(10)
    onGo(p)
  }

  const handleAction = () => {
    haptic(18)
    onQuickCommand()
  }

  return (
    <nav className="mobile-nav-bar" aria-label="Mobile Navigation">
      <button
        type="button"
        className={`mobile-nav-btn ${page === 'today' ? 'active' : ''}`}
        onClick={() => handleNav('today')}
      >
        <span className="mobile-nav-icon">
          <Icon name="home" size={19} />
        </span>
        <span>Today</span>
      </button>

      <button
        type="button"
        className={`mobile-nav-btn ${page === 'sleep' ? 'active' : ''}`}
        onClick={() => handleNav('sleep')}
      >
        <span className="mobile-nav-icon">
          <Icon name="moon" size={19} />
        </span>
        <span>Sleep</span>
      </button>

      <button
        type="button"
        className={`mobile-nav-btn ${page === 'discipline' ? 'active' : ''}`}
        onClick={() => handleNav('discipline')}
      >
        <span className="mobile-nav-icon">
          <Icon name="shield" size={19} />
        </span>
        <span>Discipline</span>
      </button>

      <button
        type="button"
        className="mobile-nav-action-btn"
        onClick={handleAction}
        title="Quick Command Omnibar"
      >
        <span className="mobile-nav-action-icon">⚡</span>
      </button>

      <button
        type="button"
        className={`mobile-nav-btn ${page === 'body' ? 'active' : ''}`}
        onClick={() => handleNav('body')}
      >
        <span className="mobile-nav-icon">
          <Icon name="bolt" size={19} />
        </span>
        <span>Sport</span>
      </button>

      <button
        type="button"
        className={`mobile-nav-btn ${page === 'money' ? 'active' : ''}`}
        onClick={() => handleNav('money')}
      >
        <span className="mobile-nav-icon">
          <Icon name="coin" size={19} />
        </span>
        <span>Money</span>
      </button>
    </nav>
  )
}
