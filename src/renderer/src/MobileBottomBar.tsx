import { Icon } from './Icon'
import type { PageId } from './modules'

interface Props {
  page: PageId
  onGo: (p: PageId) => void
  onQuickCommand: () => void
}

export function MobileBottomBar({ page, onGo, onQuickCommand }: Props) {
  return (
    <nav className="mobile-nav-bar" aria-label="Mobile Navigation">
      <button
        type="button"
        className={`mobile-nav-btn ${page === 'today' ? 'active' : ''}`}
        onClick={() => onGo('today')}
      >
        <span className="mobile-nav-icon">
          <Icon name="home" size={20} />
        </span>
        <span>Today</span>
      </button>

      <button
        type="button"
        className={`mobile-nav-btn ${page === 'tasks' ? 'active' : ''}`}
        onClick={() => onGo('tasks')}
      >
        <span className="mobile-nav-icon">
          <Icon name="tasks" size={20} />
        </span>
        <span>Tasks</span>
      </button>

      <button
        type="button"
        className="mobile-nav-action-btn"
        onClick={onQuickCommand}
        title="Quick Command Omnibar"
      >
        <span className="mobile-nav-action-icon">⚡</span>
      </button>

      <button
        type="button"
        className={`mobile-nav-btn ${page === 'discipline' ? 'active' : ''}`}
        onClick={() => onGo('discipline')}
      >
        <span className="mobile-nav-icon">
          <Icon name="shield" size={20} />
        </span>
        <span>Discipline</span>
      </button>

      <button
        type="button"
        className={`mobile-nav-btn ${page === 'money' ? 'active' : ''}`}
        onClick={() => onGo('money')}
      >
        <span className="mobile-nav-icon">
          <Icon name="coin" size={20} />
        </span>
        <span>Money</span>
      </button>
    </nav>
  )
}
