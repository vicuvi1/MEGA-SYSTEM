import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import { timeAgo, useAction } from './ui'

/** Current update status, kept live by events from the main process. */
export function useUpdates(): [UpdateStatus | null, (s: UpdateStatus) => void] {
  const [s, setS] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    life.updates.status().then(setS)
    life.onUpdate(setS)
  }, [])
  return [s, setS]
}

const LABEL: Record<UpdateStatus['state'], string> = {
  dev: 'Dev copy',
  idle: 'Not checked yet',
  checking: 'Checking…',
  'up-to-date': 'Up to date',
  available: 'New version ready to download',
  downloading: 'Downloading…',
  ready: 'Downloaded, restart to finish',
  installing: 'Installing and restarting…',
  error: 'Could not update'
}

export function UpdateChip({ status, onClick }: { status: UpdateStatus | null; onClick: () => void }) {
  if (!status || !['available', 'downloading', 'ready'].includes(status.state)) return null
  return (
    <button className="chip update-chip" onClick={onClick} title={`Version ${status.latest} is ready`}>
      <Icon name="spark" size={14} />
      {status.state === 'downloading' ? `Updating ${status.progress}%` : `Update to ${status.latest}`}
    </button>
  )
}

export function UpdatePanel({ status, onStatus }: { status: UpdateStatus | null; onStatus: (s: UpdateStatus) => void }) {
  const act = useAction()
  if (!status) return null
  const busy = ['checking', 'downloading', 'installing'].includes(status.state)
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Updates
        </h2>
        <span className={`chip ${status.state === 'up-to-date' ? 'ok' : status.state === 'error' ? 'warn' : ''}`}>{LABEL[status.state]}</span>
      </header>
      <dl className="facts">
        <dt>This version</dt>
        <dd>{status.current}</dd>
        {status.latest && (
          <>
            <dt>Newest on GitHub</dt>
            <dd>{status.latest}</dd>
          </>
        )}
        {status.checkedAt && (
          <>
            <dt>Last checked</dt>
            <dd>{timeAgo(status.checkedAt)}</dd>
          </>
        )}
        {status.error && (
          <>
            <dt>Note</dt>
            <dd className="warn-text">{status.error}</dd>
          </>
        )}
      </dl>
      {status.state === 'downloading' && (
        <div className="bar update-bar">
          <i style={{ width: `${status.progress}%` }} />
        </div>
      )}
      <p className="hint block">Life System checks GitHub on start and every 4 hours. Updating downloads the new version, installs it quietly and restarts. Your data stays.</p>
      <div className="row">
        <button className="btn primary" disabled={busy || status.state === 'dev'} onClick={async () => { const s = await act(() => life.updates.run()); if (s) onStatus(s) }}>
          {status.state === 'ready' ? 'Restart and update' : 'Update now'}
        </button>
        <button className="btn ghost" disabled={busy || status.state === 'dev'} onClick={async () => { const s = await act(() => life.updates.check()); if (s) onStatus(s) }}>
          Check for updates
        </button>
      </div>
    </section>
  )
}
