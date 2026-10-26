import { Component, type ReactNode } from 'react'
import { life } from './bridge'
import { Icon } from './Icon'

interface Props {
  /** Shown in the message, e.g. "Today". */
  area: string
  children: ReactNode
  onHome?: () => void
}

interface State {
  error: Error | null
  copied: boolean
}

/**
 * Catches a crash inside one section so the rest of Life System keeps
 * working, shows what happened, and saves it to the log.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    life.app.reportError(`${this.props.area}: ${error.message}`, `${error.stack ?? ''}\n${info.componentStack ?? ''}`).catch(() => {})
  }

  private details(): string {
    const e = this.state.error
    return `Life System · ${this.props.area}\n${e?.message}\n\n${e?.stack ?? ''}`
  }

  render() {
    const { error, copied } = this.state
    if (!error) return this.props.children
    return (
      <section className="panel crash" role="alert">
        <div className="crash-icon">
          <Icon name="bolt" size={26} />
        </div>
        <h2>{this.props.area} hit a problem</h2>
        <p className="hint">Nothing was lost: your coins, tasks and apps are fine. The details were saved to the log.</p>
        <code className="crash-msg">{error.message}</code>
        <div className="row center">
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          {this.props.onHome && (
            <button className="btn" onClick={() => { this.setState({ error: null }); this.props.onHome?.() }}>
              Go to Today
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => {
              navigator.clipboard?.writeText(this.details()).then(() => this.setState({ copied: true }), () => {})
            }}
          >
            {copied ? 'Copied' : 'Copy details'}
          </button>
        </div>
      </section>
    )
  }
}

let lastToast = 0

/** Errors outside React (timers, promises) are logged and shown as a short note. */
export function installWindowErrorHandlers(toast: (text: string) => void): () => void {
  const report = (message: string, detail?: string) => {
    life.app.reportError(message, detail).catch(() => {})
    if (Date.now() - lastToast > 8000) {
      lastToast = Date.now()
      toast(`Something went wrong: ${message.slice(0, 120)}. It was saved to the log.`)
    }
  }
  const onError = (e: ErrorEvent) => {
    // ResizeObserver loop warnings are harmless browser noise.
    if (/ResizeObserver loop/.test(e.message)) return
    report(e.message, e.error?.stack)
  }
  const onRejection = (e: PromiseRejectionEvent) => {
    const r = e.reason
    report(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
