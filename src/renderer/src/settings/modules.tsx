// Settings → Modules (owner, 2026-11-12; core/modules.ts): one switch per part of the app.
// Off means off: gone from the menu, Ctrl+K, Today, the island and notifications, and its
// background jobs stop on this PC and on the server. Nothing is deleted: on again, it is back
// at once with all its data.
import { MODULE_LIST, type ModuleId } from '@core/modules'
import { life } from '../bridge'
import { Switch } from '../settingsUi'
import { Icon } from '../Icon'
import { useModules } from '../useModules'
import { useToast } from '../ui'
import './modules.css'

export function ModulesSettings() {
  const mods = useModules()
  const toast = useToast()
  const set = async (id: ModuleId, on: boolean, label: string) => {
    const next = await life.modules?.set(id, on).catch(() => null)
    if (next) toast(on ? `${label} is on, with all its data` : `${label} is off. Nothing was deleted`, 'good')
    else toast(`Couldn't change ${label}. Try again`, 'bad')
  }
  const onCount = MODULE_LIST.filter((m) => mods[m.id]).length
  return (
    <section className="panel" data-testid="modules">
      <header className="panel-head">
        <h2>
          <Icon name="sliders" /> Modules
        </h2>
        <span className="chip ok">
          {onCount} of {MODULE_LIST.length} on
        </span>
      </header>
      <p className="hint block">
        A module that is off is really off: it leaves the menu, search, Today, the island and notifications, and its background jobs stop here and on the server. Its bot commands say it is switched off. Nothing is deleted: turn it on and it comes back at once with all its data.
      </p>
      <ul className="mod-list">
        {MODULE_LIST.map((m) => (
          <li key={m.id} className={mods[m.id] ? 'on' : ''} data-module={m.id}>
            <div className="mod-text">
              <b>{m.label}</b>
              <span>{m.line}</span>
            </div>
            {m.locked ? (
              <span className="chip" title="Today is the home page and is always on">
                Always on
              </span>
            ) : (
              <Switch on={!!mods[m.id]} label={m.label} onChange={(v) => void set(m.id, v, m.label)} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
