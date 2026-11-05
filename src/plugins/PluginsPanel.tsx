// Settings → Plugins: switch each one on or off, fill in its settings, and
// see what it still needs and how its last check went.
import { useEffect, useState } from 'react'
import { life } from '../renderer/src/bridge'
import { Icon } from '../renderer/src/Icon'
import { Saved, Switch, useSaved } from '../renderer/src/settingsUi'
import { timeAgo, useAction } from '../renderer/src/ui'
import { useLive } from '../renderer/src/live'
import { PLUGINS } from './index'
import { listOf } from './store'
import { SETTINGS_EXTRA } from './cards'
import type { Plugin, PluginField } from './types'

type State = Awaited<ReturnType<NonNullable<typeof life.plugins>['state']>>

export function PluginsPanel() {
  const act = useAction()
  const [st, setSt] = useState<State | null>(null)
  const [flash, saved] = useSaved()
  const load = () => void life.plugins?.state().then(setSt).catch(() => {})
  useEffect(load, [])
  useLive(load)
  if (!life.plugins) return null
  if (!st) return <section className="panel"><p className="hint">Loading…</p></section>
  const toggle = async (p: Plugin, on: boolean) => {
    setSt({ ...st, on: { ...st.on, [p.id]: on } })
    await act(() => life.plugins!.setOn(p.id, on))
    saved()
  }
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Plugins
        </h2>
        <Saved show={flash} />
        <button className="btn small ghost" title="Fetch the weather, GitHub, mail and notes now" onClick={() => void act(() => life.plugins!.refresh().then(load), 'Refreshed')}>
          <Icon name="refresh" size={13} /> Refresh now
        </button>
      </header>
      <p className="hint block">Small add-ons that give Ben more to work with. Each one is off until you switch it on. Keys and tokens stay on the server (Vercel); only the names are shown here.</p>
      {PLUGINS.map((p) => (
        <PluginRow key={p.id} p={p} on={!!st.on[p.id]} status={st.status[p.id]} config={st.config[p.id] ?? {}} onToggle={(v) => void toggle(p, v)} onSaved={saved} />
      ))}
    </section>
  )
}

function PluginRow({ p, on, status, config, onToggle, onSaved }: { p: Plugin; on: boolean; status?: State['status'][string]; config: Record<string, unknown>; onToggle: (v: boolean) => void; onSaved: () => void }) {
  const Extra = SETTINGS_EXTRA[p.id]
  const env = p.settings?.env ?? []
  const desktopOnly = p.settings?.desktopOnly && !window.desktop
  return (
    <div className="pl-item">
      <div className="pl-item-head">
        <span className="pl-item-icon">
          <Icon name={p.icon as any} size={16} />
        </span>
        <span className="pl-item-text">
          <b>{p.title}</b>
          <small>{p.about}</small>
          {env.length > 0 && (
            <span className="pl-need">
              Uses {env.map((e, i) => (
                <span key={e}>
                  {i ? ', ' : ''}
                  <code>{e}</code>
                </span>
              ))}{' '}
              in Vercel (server settings).
            </span>
          )}
          {desktopOnly && <span className="pl-need">Works in the Windows app.</span>}
          {on && status && (
            <span className={`pl-status ${status.ok ? '' : 'bad'}`}>
              {status.ok ? 'Last check' : 'Last check failed'} {timeAgo(status.at)}
              {status.note ? `: ${status.note}` : ''}
              {status.need?.length ? ` · Needs ${status.need.join(', ')}` : ''}
            </span>
          )}
        </span>
        <Switch label={`${p.title} on`} on={on} onChange={onToggle} />
      </div>
      {on && p.settings?.fields?.length ? <Fields p={p} config={config} onSaved={onSaved} /> : null}
      {on && Extra ? <Extra /> : null}
    </div>
  )
}

function Fields({ p, config, onSaved }: { p: Plugin; config: Record<string, unknown>; onSaved: () => void }) {
  const act = useAction()
  const show = (f: PluginField) => (f.kind === 'list' ? listOf(config[f.key]).join(', ') : String(config[f.key] ?? ''))
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries((p.settings?.fields ?? []).map((f) => [f.key, show(f)])))
  const save = async () => {
    const next: Record<string, unknown> = { ...config }
    for (const f of p.settings?.fields ?? []) next[f.key] = f.kind === 'list' ? listOf(vals[f.key]) : (vals[f.key] ?? '').trim().slice(0, 200)
    await act(() => life.plugins!.setConfig(p.id, next))
    onSaved()
  }
  const changed = (p.settings?.fields ?? []).some((f) => (vals[f.key] ?? '') !== show(f))
  return (
    <div className="pl-fields">
      {(p.settings?.fields ?? []).map((f) => (
        <label key={f.key} className="pl-field">
          <span>
            {f.label}
            {f.hint ? ` · ${f.hint}` : ''}
          </span>
          <input value={vals[f.key] ?? ''} placeholder={f.placeholder} maxLength={f.kind === 'list' ? 600 : 200} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </label>
      ))}
      {changed && (
        <div className="pl-actions">
          <button className="btn small primary" onClick={() => void save()}>
            Save
          </button>
        </div>
      )}
    </div>
  )
}
