import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import { timeAgo, useAction } from './ui'
import { barFill } from './motionKit'

/** Current update status, kept live by events from the main process. */
export function useUpdates(): [UpdateStatus | null, (s: UpdateStatus) => void] {
  const [s, setS] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    life.updates.status().then(setS)
    life.onUpdate(setS)
  }, [])
  return [s, setS]
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

/** The headline for each state: what it means for you, in one line. */
const HEADLINE: Record<UpdateStatus['state'], (s: UpdateStatus) => [string, string]> = {
  dev: () => ['This is a developer copy', 'Updates only run in the installed app.'],
  idle: () => ['Not checked yet', 'Life System checks on start and every 4 hours.'],
  checking: () => ['Checking for a new version…', 'This takes a few seconds.'],
  'up-to-date': (s) => ["You're up to date", `Version ${s.current} is the newest.`],
  available: (s) => [`Version ${s.latest} is out`, 'It downloads in the background.'],
  downloading: (s) => [`Downloading ${s.latest}…`, `${s.progress}% done. You can keep working.`],
  ready: (s) => [`Version ${s.latest} is ready`, 'Restart to install it. It takes a few seconds and your data stays.'],
  installing: () => ['Installing and restarting…', 'Life System opens again by itself.'],
  error: () => ["Couldn't update", 'Check your connection and try again.']
}

export function UpdatePanel({ status, onStatus }: { status: UpdateStatus | null; onStatus: (s: UpdateStatus) => void }) {
  const act = useAction()
  if (!status) return null
  const busy = ['checking', 'downloading', 'installing'].includes(status.state)
  const [title, sub] = HEADLINE[status.state](status)
  const tone = status.state === 'ready' || status.state === 'available' ? 'new' : status.state === 'error' ? 'bad' : status.state === 'up-to-date' ? 'ok' : ''
  return (
    <section className="panel up">
      <div className={`up-hero ${tone}`}>
        <span className={`up-icon ${busy ? 'spin' : ''}`} aria-hidden>
          <Icon name={status.state === 'up-to-date' ? 'check' : 'refresh'} size={20} />
        </span>
        <div className="up-text">
          <b>{title}</b>
          <span>{sub}</span>
        </div>
        <div className="up-actions">
          {status.state === 'ready' ? (
            <button className="btn primary" onClick={async () => { const s = await act(() => life.updates.run()); if (s) onStatus(s) }}>
              Restart and update
            </button>
          ) : (
            <button className="btn" disabled={busy || status.state === 'dev'} onClick={async () => { const s = await act(() => life.updates.check()); if (s) onStatus(s) }}>
              Check now
            </button>
          )}
        </div>
      </div>
      {status.state === 'downloading' && (
        <div className="bar update-bar pbar">
          <i style={barFill(status.progress / 100)} />
        </div>
      )}
      <dl className="up-facts">
        <div>
          <dt>This version</dt>
          <dd>{status.current}</dd>
        </div>
        <div>
          <dt>Newest</dt>
          <dd>{status.latest ?? '—'}</dd>
        </div>
        <div>
          <dt>Last checked</dt>
          <dd>{status.checkedAt ? timeAgo(status.checkedAt) : 'not yet'}</dd>
        </div>
      </dl>
      {status.error && <p className="hint block warn-text">{status.error}</p>}
      <p className="hint up-note">
        New versions download by themselves. If you don't restart, the update installs the next time you quit.
        {status.state === 'ready' && ' '}
        {status.state === 'ready' && (
          <button className="link-btn" disabled={busy} onClick={async () => { const s = await act(() => life.updates.check()); if (s) onStatus(s) }}>
            Check again
          </button>
        )}
      </p>
    </section>
  )
}
