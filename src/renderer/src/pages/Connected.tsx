import type { ConnectionKind, ConnectionsState } from '@shared/api'
import { life } from '../bridge'
import { Icon, type IconName } from '../Icon'
import { timeAgo, useAction } from '../ui'

interface CardProps {
  kind: ConnectionKind
  title: string
  icon: IconName
  color: string
  found: boolean
  path: string | null
  error: string | null
  connectedSince?: string | null
  what: string
  onState: (s: ConnectionsState) => void
  onWallet: () => void
}

/** Status of one connected app: where its data is, and connect/disconnect. */
export function ConnectCard({ kind, title, icon, color, found, path, error, connectedSince, what, onState, onWallet }: CardProps) {
  const act = useAction()
  const canConnect = kind !== 'man'
  return (
    <section className="panel conn" style={{ ['--c' as string]: color }}>
      <header className="panel-head">
        <h2>
          <span className="conn-icon">
            <Icon name={icon} size={16} />
          </span>
          {title}
        </h2>
        <span className={`chip ${error ? 'warn' : found ? 'ok' : ''}`}>{error ? 'Problem' : !found ? 'Not found' : connectedSince ? 'Connected' : 'Found'}</span>
      </header>
      <p className="hint block">{what}</p>
      <dl className="facts">
        <dt>Data</dt>
        <dd className="mono">{path ?? 'Not found on this PC'}</dd>
        {connectedSince && (
          <>
            <dt>Paying since</dt>
            <dd>{connectedSince}</dd>
          </>
        )}
        {error && (
          <>
            <dt>Problem</dt>
            <dd className="warn-text">{error}</dd>
          </>
        )}
      </dl>
      <div className="row">
        {canConnect && found && !connectedSince && (
          <button className="btn primary" onClick={async () => { const s = await act(() => life.connections.connect(kind as 'waky' | 'finance'), `${kind === 'waky' ? 'Waky' : 'Finance Helper'} connected`); if (s) { onState(s); onWallet() } }}>
            Connect
          </button>
        )}
        {canConnect && connectedSince && (
          <button className="btn ghost" onClick={async () => { const s = await act(() => life.connections.disconnect(kind as 'waky' | 'finance')); if (s) onState(s) }}>
            Disconnect
          </button>
        )}
        <button className="btn ghost" onClick={async () => { const s = await act(() => life.connections.choosePath(kind)); if (s) onState(s) }}>
          {found ? 'Use a different file' : 'Find it…'}
        </button>
      </div>
    </section>
  )
}

export function Connected({ state, onState, onWallet }: { state: ConnectionsState; onState: (s: ConnectionsState) => void; onWallet: () => void }) {
  const act = useAction()
  return (
    <div className="settings">
      <section className="panel slim">
        <div className="row spread">
          <span className="hint">
            Life System reads these apps' files on this PC and pays points for what they record, from the day you connect. Nothing is sent anywhere.
            {state.lastSync && ` Last checked ${timeAgo(state.lastSync)}.`}
          </span>
          <button
            className="btn small"
            onClick={async () => {
              const r = await act(() => life.connections.sync())
              if (r) {
                onState(r.state)
                onWallet()
              }
            }}
          >
            Check now
          </button>
        </div>
      </section>
      <ConnectCard kind="waky" title="Waky" icon="moon" color="#6EE7D8" {...state.waky} what="Wake-ups on time pay +10 and bedtimes on time +5, straight from Waky's check-ins." onState={onState} onWallet={onWallet} />
      <ConnectCard kind="finance" title="Finance Helper" icon="coin" color="#F5C84B" {...state.finance} what="Each day you log spending pays +3, and staying under your daily budget pays +5 once the day is over." onState={onState} onWallet={onWallet} />
      <ConnectCard kind="man" title="MAN (old discipline app)" icon="shield" color="#FF8A3D" {...state.man} what="Used once, to bring your current streak into Discipline. Nothing is paid from it." onState={onState} onWallet={onWallet} />
      <ConnectCard kind={'sport' as any} title="Sport Track" icon="bolt" color="#00F2FE" found={true} path="apps/sport/index.html (Embedded Partition)" error={null} connectedSince="Active & Synced" what="Workout sessions and progress. A logged workout pays a few points." onState={onState} onWallet={onWallet} />
    </div>
  )
}
