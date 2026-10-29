import { Icon, type IconName } from './Icon'
import type { PageId } from './modules'

interface Props {
  page: PageId
  onGo: (p: PageId) => void
}

interface NavTab {
  id: PageId
  label: string
  icon: IconName
}

const TABS: NavTab[] = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'discipline', label: 'Discipline', icon: 'shield' },
  { id: 'money', label: 'Money', icon: 'coin' },
  { id: 'settings', label: 'Settings', icon: 'gear' }
]

export function MobileBottomBar({ page, onGo }: Props) {
  return (
    <nav className="mobile-nav-bar" aria-label="Mobile Navigation">
      {TABS.map((tab) => {
        const isActive = page === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            className={`mobile-nav-btn ${isActive ? 'active' : ''}`}
            onClick={() => onGo(tab.id)}
          >
            <span className="mobile-nav-icon">
              <Icon name={tab.icon} size={20} />
            </span>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
