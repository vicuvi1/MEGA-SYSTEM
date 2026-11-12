// The module switch (core/modules.ts) in the app: a page of a module that is off, and a gate that
// mounts a background part only while its module is on (unmounted = its timers stop).
import type { ReactNode } from 'react'
import { moduleDef, type ModuleId } from '@core/modules'
import { life } from './bridge'
import { Icon } from './Icon'
import { useModules } from './useModules'
import { useAction } from './ui'

/** Children only while the module is on: off, they are not mounted, so none of their timers or reads run. */
export function ModuleGate({ id, children }: { id: ModuleId; children: ReactNode }) {
  const mods = useModules()
  return mods[id] ? <>{children}</> : null
}

/** Shown instead of a page whose module is off: one line and one button that turns it back on. */
export function ModuleOff({ id }: { id: ModuleId }) {
  const act = useAction()
  const m = moduleDef(id)
  return (
    <section className="panel module-off" data-testid="module-off" data-module={id} style={{ maxWidth: 560, margin: '48px auto', textAlign: 'center' }}>
      <h2 style={{ justifyContent: 'center' }}>
        <Icon name="sliders" /> {m.label} is switched off
      </h2>
      <p className="hint block">{m.line}</p>
      <p className="hint block">Nothing was deleted. Turn it on and it comes back with all its data.</p>
      <button className="btn primary" data-testid="module-off-on" onClick={() => void act(() => life.modules!.set(id, true), `${m.label} is on`)}>
        Turn {m.label} on
      </button>
    </section>
  )
}
