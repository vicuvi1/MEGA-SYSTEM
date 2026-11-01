// Shared building blocks (styles in design.css). Use these on every page so
// sections, rows, labels and empty screens look the same everywhere.
import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function Card({ title, icon, actions, children, className = '', flat }: { title?: ReactNode; icon?: IconName; actions?: ReactNode; children?: ReactNode; className?: string; flat?: boolean }) {
  return (
    <section className={`card ${flat ? 'flat' : ''} ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && (
            <h2>
              {icon && <Icon name={icon} size={16} />} {title}
            </h2>
          )}
          {actions && <div className="actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function ListRow({ lead, title, meta, trail, done, onClick, className = '' }: { lead?: ReactNode; title: ReactNode; meta?: ReactNode; trail?: ReactNode; done?: boolean; onClick?: () => void; className?: string }) {
  return (
    <li className={`list-row ${done ? 'done' : ''} ${onClick ? 'clickable' : ''} ${className}`} onClick={onClick}>
      {lead !== undefined && <span className="lr-lead">{lead}</span>}
      <span className="lr-main">
        <span className="lr-title">{title}</span>
        {meta && <span className="lr-meta">{meta}</span>}
      </span>
      {trail && <span className="lr-trail">{trail}</span>}
    </li>
  )
}

export function Chip({ children, tone, on, color, onClick, title }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'muted'; on?: boolean; color?: string; onClick?: () => void; title?: string }) {
  const cls = `chip ${tone ?? ''} ${on ? 'on' : ''}`
  const dot = color ? <i className="dot" style={{ ['--c' as string]: color }} /> : null
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={title} aria-pressed={on}>
      {dot}
      {children}
    </button>
  ) : (
    <span className={cls} title={title}>
      {dot}
      {children}
    </span>
  )
}

export function EmptyState({ icon = 'spark', title, children, action, compact }: { icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <span className="es-icon">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <b>{title}</b>
        {children && <p>{children}</p>}
        {action}
      </div>
    </div>
  )
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  )
}
