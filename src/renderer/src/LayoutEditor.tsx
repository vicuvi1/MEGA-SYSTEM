// Settings → Today screen & pages: which Today sections show, in what order,
// and which pages appear in the menus. Kept on this device (uiPrefs).
import { MODULES, SYSTEM_PAGES } from './modules'
import { Icon } from './Icon'
import { ReorderList, Row, Saved, Switch, useSaved } from './settingsUi'
import { TODAY_SECTIONS, todayLayout, useUiPrefs } from './uiPrefs'

export function LayoutEditor() {
  const [ui, setUi] = useUiPrefs()
  const [flash, saved] = useSaved()
  const layout = todayLayout(ui)
  const info = (id: string) => TODAY_SECTIONS.find((x) => x.id === id)!

  const hidden = new Set(ui.hiddenPages ?? [])
  const togglePage = (id: string) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setUi({ hiddenPages: [...next] })
  }
  const pages = [...MODULES, ...SYSTEM_PAGES].filter((m, i, all) => m.phase === 0 && m.id !== 'today' && m.id !== 'settings' && all.findIndex((x) => x.id === m.id) === i)

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="sliders" /> Today screen & pages
        </h2>
        <Saved show={flash} />
        <button className="btn small ghost" onClick={() => (setUi({ today: [], hiddenPages: [] }), saved())}>
          Reset
        </button>
      </header>
      <Row title="Today's sections" hint="Show only what you use. Drag to change the order." />
      <ReorderList
        label="Today sections"
        items={layout.map((x) => ({ id: x.id, label: info(x.id).label, hint: info(x.id).hint, on: x.on }))}
        onChange={(next) => (setUi({ today: next.map((x) => ({ id: x.id as any, on: x.on })) }), saved())}
      />
      <Row title="Pages in the menu" hint="Hidden pages stay one search away (Ctrl K)." />
      <div className="sx-pages">
        {pages.map((m) => (
          <Row key={m.id} title={m.label}>
            <Switch label={`Show ${m.label} in the menu`} on={!hidden.has(m.id)} onChange={() => (togglePage(m.id), saved())} />
          </Row>
        ))}
      </div>
    </section>
  )
}
