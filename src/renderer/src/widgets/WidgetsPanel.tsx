// Settings → Widgets: the gallery (Install / Remove, permissions asked once
// at install), what each installed widget may do (switch any permission
// off), where it sits, your script tiles, the island's pages and its look.
// All saved in the synced setting island_widgets, so every PC is the same.
import { useEffect, useMemo, useState } from 'react'
import { calendarDay } from '@core/dates'
import { fullGrants, NO_GRANTS, type WidgetData, type WidgetGrants } from '@core/widgets/bridge'
import { PERMISSION_TEXT, type WidgetManifest } from '@core/widgets/manifest'
import { BUILTIN_PAGES, DAY_PART_LABEL, DAY_PARTS, type PageFollow } from '@core/widgets/pages'
import { runScript } from '@core/widgets/scriptRun'
import { cleanScript, SCRIPT_CODE_MAX, SCRIPTS_MAX, type UserScript } from '@core/widgets/scripts'
import { CLOCK_LABEL, CLOCK_STYLES, installWidget, ISLAND_STYLES, ISLAND_THEMES, patchWidget, removeWidget, setGrant, STYLE_LABEL, THEME_LABEL, type IslandLookPrefs, type WidgetsSetting } from '@core/widgets/settings'
import { Icon } from '../Icon'
import { Row, Saved, Segmented, Switch, useSaved } from '../settingsUi'
import { useAction } from '../ui'
import { play } from '../soundKit'
import { GALLERY, MANIFESTS, screenshotOf } from './registry'
import { WidgetFrame } from './WidgetFrame'
import { readWidgets, saveWidgets } from './widgetsFeed'
import './widgets.css'
import './widgetsPanel.css'
import { Select } from '../Select'

const PAGE_LABEL: Record<string, string> = { day: 'Day', music: 'Music', home: 'Home', pc: 'PC', fun: 'Fun', system: 'System', ai: 'AI usage' }
const WIDGET_PAGES = ['home', 'pc', 'fun']

/** Made-up data for the previews (never yours). */
function previewData(): WidgetData {
  const now = Date.now()
  const day = calendarDay(new Date(now))
  return {
    now,
    day,
    today: {
      plan: { now: { title: 'Study block', endsAt: now + 40 * 60_000 }, next: { title: 'Gym', startsAt: now + 2 * 3600_000 } },
      nextEvent: { title: 'Gym', startsAt: now + 2 * 3600_000 },
      focus: { running: null, minutes: 75, goal: 120 },
      mustdos: { done: 2, total: 3 },
      points: { balance: 340, goal: { title: 'New headphones', price: 500 } },
      streak: { days: 12, kind: 'sport' },
      weather: { rainAt: '17:00', rainNow: false, sunset: '16:40', lightLeft: '2 h' }
    }
  }
}
const PREVIEW_THEME = { fg: '#f5f5f6', sub: 'rgb(255 255 255 / 0.56)', acc: '#d4ff3f', line: 'rgb(255 255 255 / 0.1)' }

const SCRIPT_EXAMPLE = `// Show a tile when it's late and focus is short.
const t = life.today
if (life.hour >= 20 && t && t.focus.minutes < t.focus.goal) {
  show(\`\${t.focus.goal - t.focus.minutes} min of focus left\`, '⏳')
}`

export function WidgetsPanel() {
  const act = useAction()
  const [flash, saved] = useSaved()
  const [s, setS] = useState<WidgetsSetting | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  useEffect(() => void readWidgets(true).then(setS).catch(() => setS(null)), [])
  if (!s) return <section className="panel"><p className="hint">Loading…</p></section>
  const save = async (next: WidgetsSetting) => {
    setS(next)
    await act(() => saveWidgets(next))
    saved()
  }
  const installed = (id: string) => s.installed.find((w) => w.id === id)
  return (
    <>
      <section className="panel wg-panel">
        <header className="panel-head">
          <h2><Icon name="spark" /> Widgets</h2>
          <Saved show={flash} />
        </header>
        <p className="hint block">
          Small add-ons for the island’s pages. Each one runs in its own locked box: it can’t see your data, the app, your PIN or your sign-in, only what you allow below. Installs are pinned to the exact code you saw: if a widget changes, you reinstall it.
        </p>
        <h3 className="wg-h">Gallery</h3>
        <div className="wg-gallery">
          {GALLERY.map((g) => {
            const m = MANIFESTS[g.id]
            const inst = installed(g.id)
            const shot = screenshotOf(g.id)
            return (
              <article key={g.id} className="wg-card">
                <div className={`wg-preview wg-${m.size}`}>
                  <div className="wg-grid">
                    <WidgetFrame manifest={m} sha256={g.sha256} grants={{ ...NO_GRANTS, read: true, sound: m.permissions.includes('sound') }} config={g.id === 'countdown' ? { date: inFuture(23), label: 'Exam' } : {}} data={previewData()} theme={PREVIEW_THEME} onCall={async (c) => (c.op === 'sound' ? (play('success'), true) : Promise.reject(new Error('Only on the island')))} />
                  </div>
                </div>
                <div className="wg-card-text">
                  <b>{g.name} <small>v{g.version} · {g.author}</small></b>
                  <small>{g.about}</small>
                  <small className="wg-perms">{m.permissions.length ? `Asks for: ${m.permissions.join(', ')}` : 'Asks for nothing'} · {m.size}</small>
                  {shot && <a className="wg-shot" href={shot} target="_blank" rel="noreferrer">Screenshot</a>}
                </div>
                {inst ? (
                  <button className="btn small ghost" onClick={() => void save(removeWidget(s, g.id))}>Remove</button>
                ) : (
                  <button className="btn small primary" onClick={() => setAsking(g.id)}>Install</button>
                )}
                {asking === g.id && (
                  <InstallAsk
                    m={m}
                    onCancel={() => setAsking(null)}
                    onInstall={(grants, page) => {
                      setAsking(null)
                      void save(installWidget(s, m, g.sha256, page, new Date(), grants))
                    }}
                  />
                )}
              </article>
            )
          })}
        </div>
        <p className="hint block">
          Make your own: see <code>widgets/README.md</code> in the app’s code on GitHub. New widgets come by pull request, are checked, and ship with an app update.
        </p>
      </section>

      {s.installed.length > 0 && (
        <section className="panel wg-panel">
          <header className="panel-head"><h2><Icon name="check" /> Your widgets</h2></header>
          {s.installed.map((w) => {
            const m = MANIFESTS[w.id]
            if (!m) return <Row key={w.id} title={w.id} hint="This app version doesn’t have it." />
            return <InstalledRow key={w.id} m={m} grants={w.grants} page={w.page} config={w.config} onGrant={(g) => void save(setGrant(s, m, w.id, g))} onPatch={(p) => void save(patchWidget(s, m, w.id, p))} />
          })}
        </section>
      )}

      <ScriptsSection s={s} save={save} />
      <PagesSection s={s} save={save} />
      <LookSection s={s} save={save} />
    </>
  )
}

const inFuture = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)

function InstallAsk({ m, onInstall, onCancel }: { m: WidgetManifest; onInstall: (g: WidgetGrants, page: string) => void; onCancel: () => void }) {
  const [g, setG] = useState<WidgetGrants>(() => fullGrants(m))
  const [page, setPage] = useState('home')
  return (
    <div className="wg-ask" role="dialog" aria-label={`Install ${m.name}`}>
      <b>Install {m.name}?</b>
      {m.permissions.length === 0 ? <small>It asks for nothing: it only shows things by itself.</small> : <small>It asks to:</small>}
      {m.permissions.map((p) => (
        <label key={p} className="wg-ask-row">
          <input type="checkbox" checked={p === 'network' ? g.network.length > 0 : !!g[p]} onChange={(e) => setG({ ...g, [p]: p === 'network' ? (e.target.checked ? [...m.hosts] : []) : e.target.checked })} />
          <span>
            {PERMISSION_TEXT[p]}
            {p === 'network' && <code> {m.hosts.join(', ')}</code>}
          </span>
        </label>
      ))}
      <label className="wg-ask-row">
        <span>On the island page</span>
        <Select value={page} onChange={(e) => setPage(e.target.value)}>
          {WIDGET_PAGES.map((p) => <option key={p} value={p}>{PAGE_LABEL[p]}</option>)}
        </Select>
      </label>
      <div className="wg-ask-actions">
        <button className="btn small primary" onClick={() => onInstall(g, page)}>Install</button>
        <button className="btn small ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function InstalledRow({ m, grants, page, config, onGrant, onPatch }: { m: WidgetManifest; grants: WidgetGrants; page: string; config: Record<string, string>; onGrant: (g: Partial<WidgetGrants>) => void; onPatch: (p: { page?: string; config?: Record<string, string> }) => void }) {
  const [cfg, setCfg] = useState(config)
  return (
    <div className="pl-item">
      <div className="pl-item-head">
        <span className="pl-item-text">
          <b>{m.name}</b>
          <small>{m.about}</small>
        </span>
        <Select aria-label={`${m.name}: island page`} value={page} onChange={(e) => onPatch({ page: e.target.value })}>
          {WIDGET_PAGES.map((p) => <option key={p} value={p}>{PAGE_LABEL[p]}</option>)}
        </Select>
      </div>
      {m.permissions.map((p) => (
        <Row key={p} title={PERMISSION_TEXT[p]} hint={p === 'network' ? m.hosts.join(', ') : undefined}>
          <Switch label={`${m.name}: ${p}`} on={p === 'network' ? grants.network.length > 0 : !!grants[p]} onChange={(on) => onGrant(p === 'network' ? { network: on ? [...m.hosts] : [] } : { [p]: on })} />
        </Row>
      ))}
      {m.settings.length > 0 && (
        <div className="pl-fields">
          {m.settings.map((f) => (
            <label key={f.key} className="pl-field">
              <span>{f.label}</span>
              <input type={f.kind === 'date' ? 'date' : 'text'} value={cfg[f.key] ?? ''} placeholder={f.placeholder} maxLength={80} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })} onBlur={() => onPatch({ config: cfg })} />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function ScriptsSection({ s, save }: { s: WidgetsSetting; save: (n: WidgetsSetting) => Promise<void> }) {
  const [edit, setEdit] = useState<UserScript | null>(null)
  const [test, setTest] = useState<string>('')
  const put = (sc: UserScript) => void save({ ...s, scripts: [...s.scripts.filter((x) => x.id !== sc.id), sc] })
  const tryIt = async (sc: UserScript) => {
    setTest('Running…')
    const d = new Date()
    const r = await runScript(sc, { now: Date.now(), hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay(), today: previewData().today }, {
      makeWorker: (src) => {
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
        const w = new Worker(url)
        URL.revokeObjectURL(url)
        return { postMessage: (m) => w.postMessage(m), onMessage: (fn) => void (w.onmessage = (e) => fn(e.data)), terminate: () => w.terminate() }
      },
      onCall: async () => Promise.reject(new Error('A test run doesn’t fetch or add anything'))
    })
    setTest(r.error ? `⚠ ${r.error}` : r.show ? `Shows: ${r.show.icon} ${r.show.text}${r.notify ? ` · notice: ${r.notify}` : ''} (${r.ms} ms, with made-up data)` : `Shows nothing right now (${r.ms} ms)${r.notify ? ` · notice: ${r.notify}` : ''}`)
  }
  return (
    <section className="panel wg-panel">
      <header className="panel-head"><h2><Icon name="bolt" /> Script tiles</h2></header>
      <p className="hint block">
        “Show X when Y”: a few lines of JavaScript that run on their own in a locked box (no page, no storage, no internet unless you list sites), stopped after a quarter of a second. They get <code>life.hour</code>, <code>life.today</code> and can call <code>show(text, icon)</code>, <code>notify(text)</code>, <code>addTask(text)</code> (asks you) and <code>await fetch(url)</code>.
      </p>
      {s.scripts.map((sc) => (
        <Row key={sc.id} title={`${sc.icon} ${sc.name}`} hint={`${PAGE_LABEL[sc.page] ?? sc.page} page · every ${Math.round(sc.every / 60)} min${sc.hosts.length ? ` · sites: ${sc.hosts.join(', ')}` : ''}`}>
          <button className="btn small ghost" onClick={() => setEdit(sc)}>Edit</button>
          <Switch label={`${sc.name} on`} on={sc.on} onChange={(on) => put({ ...sc, on })} />
        </Row>
      ))}
      {!edit && s.scripts.length < SCRIPTS_MAX && <button className="btn small" onClick={() => setEdit(cleanScript({ id: `s${Date.now().toString(36).slice(-6)}`, name: 'Focus left', icon: '⏳', code: SCRIPT_EXAMPLE, page: 'pc', every: 300 }))}>+ New script tile</button>}
      {edit && (
        <div className="wg-script-edit">
          <div className="pl-fields">
            <label className="pl-field"><span>Name</span><input value={edit.name} maxLength={30} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="pl-field"><span>Icon</span><input value={edit.icon} maxLength={4} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} /></label>
            <label className="pl-field"><span>Page</span><Select value={edit.page} onChange={(e) => setEdit({ ...edit, page: e.target.value })}>{WIDGET_PAGES.map((p) => <option key={p} value={p}>{PAGE_LABEL[p]}</option>)}</Select></label>
            <label className="pl-field"><span>Every (minutes)</span><input type="number" min={1} max={60} value={Math.round(edit.every / 60)} onChange={(e) => setEdit({ ...edit, every: Number(e.target.value) * 60 })} /></label>
            <label className="pl-field"><span>Sites it may fetch (https, comma separated; empty = none)</span><input value={edit.hosts.join(', ')} onChange={(e) => setEdit({ ...edit, hosts: e.target.value.split(/[,\s]+/).filter(Boolean) })} /></label>
          </div>
          <label className="wg-ask-row"><input type="checkbox" checked={edit.add} onChange={(e) => setEdit({ ...edit, add: e.target.checked })} /> <span>May ask to add tasks (you confirm each)</span></label>
          <textarea className="wg-code" spellCheck={false} value={edit.code} maxLength={SCRIPT_CODE_MAX} rows={8} onChange={(e) => setEdit({ ...edit, code: e.target.value })} aria-label="Script code" />
          <small className="hint">{edit.code.length}/{SCRIPT_CODE_MAX} characters</small>
          {test && <p className="hint block">{test}</p>}
          <div className="wg-ask-actions">
            <button className="btn small primary" onClick={() => { const c = cleanScript(edit); if (c) put(c); setEdit(null); setTest('') }}>Save</button>
            <button className="btn small" onClick={() => { const c = cleanScript(edit); if (c) void tryIt(c) }}>Test run</button>
            <button className="btn small ghost" onClick={() => (setEdit(null), setTest(''))}>Cancel</button>
            {s.scripts.some((x) => x.id === edit.id) && <button className="btn small ghost danger" onClick={() => { void save({ ...s, scripts: s.scripts.filter((x) => x.id !== edit.id) }); setEdit(null) }}>Delete</button>}
          </div>
        </div>
      )}
    </section>
  )
}

function PagesSection({ s, save }: { s: WidgetsSetting; save: (n: WidgetsSetting) => Promise<void> }) {
  const p = s.pages
  const ids = p.order.map((x) => x.id)
  const move = (id: string, d: number) => {
    const i = ids.indexOf(id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    const order = p.order.slice()
    ;[order[i], order[j]] = [order[j], order[i]]
    void save({ ...s, pages: { ...p, order } })
  }
  const pageOpts = useMemo(() => p.order.filter((x) => x.on).map((x) => x.id), [p.order])
  return (
    <section className="panel wg-panel">
      <header className="panel-head"><h2><Icon name="expand" /> Island pages</h2></header>
      <p className="hint block">Swipe between them in the opened island, scroll sideways (or Shift + wheel), or press Ctrl+← / Ctrl+→. Only the page you see runs.</p>
      {p.order.map((x, i) => (
        <Row key={x.id} title={PAGE_LABEL[x.id] ?? x.id} hint={(BUILTIN_PAGES as readonly string[]).includes(x.id) ? undefined : 'Added by another part of the app'}>
          <button className="btn small ghost" aria-label="Earlier" disabled={i === 0} onClick={() => move(x.id, -1)}>↑</button>
          <button className="btn small ghost" aria-label="Later" disabled={i === p.order.length - 1} onClick={() => move(x.id, 1)}>↓</button>
          <Switch label={`${x.id} page on`} on={x.on} disabled={x.id === 'day'} onChange={(on) => void save({ ...s, pages: { ...p, order: p.order.map((y) => (y.id === x.id ? { ...y, on } : y)) } })} />
        </Row>
      ))}
      <Row title="Opens on" hint="The page the island opens with">
        <Segmented<PageFollow> label="Opens on" value={p.follow} options={[['off', 'Last page'], ['time', 'Time of day'], ['profile', 'Island profile']]} onChange={(follow) => void save({ ...s, pages: { ...p, follow } })} />
      </Row>
      {p.follow === 'time' && DAY_PARTS.map((d) => (
        <Row key={d} title={DAY_PART_LABEL[d]}>
          <Select value={p.byTime[d]} onChange={(e) => void save({ ...s, pages: { ...p, byTime: { ...p.byTime, [d]: e.target.value } } })}>
            {pageOpts.map((id) => <option key={id} value={id}>{PAGE_LABEL[id] ?? id}</option>)}
          </Select>
        </Row>
      ))}
      {p.follow === 'profile' && ['work', 'study', 'gaming', 'night'].map((pr) => (
        <Row key={pr} title={`Profile: ${pr}`}>
          <Select value={p.byProfile[pr] ?? 'day'} onChange={(e) => void save({ ...s, pages: { ...p, byProfile: { ...p.byProfile, [pr]: e.target.value } } })}>
            {pageOpts.map((id) => <option key={id} value={id}>{PAGE_LABEL[id] ?? id}</option>)}
          </Select>
        </Row>
      ))}
    </section>
  )
}

function LookSection({ s, save }: { s: WidgetsSetting; save: (n: WidgetsSetting) => Promise<void> }) {
  const l = s.look
  const set = (patch: Partial<IslandLookPrefs>) => void save({ ...s, look: { ...l, ...patch } })
  return (
    <section className="panel wg-panel">
      <header className="panel-head"><h2><Icon name="spark" /> Island look</h2></header>
      <p className="hint block">How the island looks on every PC (where it sits stays per PC).</p>
      <Row title="Shape" hint="Notch sits on the top edge of the screen like a camera notch">
        <Segmented label="Shape" value={l.style} options={ISLAND_STYLES.map((x) => [x, STYLE_LABEL[x].split(' (')[0]] as [typeof x, string])} onChange={(style) => set({ style })} />
      </Row>
      <Row title="Thin bar while a window is maximized" hint="It gets out of the way; hover it to open">
        <Switch label="Thin bar while a window is maximized" on={l.maxBar} onChange={(maxBar) => set({ maxBar })} />
      </Row>
      <Row title="Open on hover" hint="The whole panel opens when the mouse rests on it; moving away or Esc closes it">
        <Switch label="Open on hover" on={l.hoverOpen} onChange={(hoverOpen) => set({ hoverOpen })} />
      </Row>
      <Row title="Clock in the pill">
        <Segmented label="Clock" value={l.clock} options={CLOCK_STYLES.map((x) => [x, CLOCK_LABEL[x]] as [typeof x, string])} onChange={(clock) => set({ clock })} />
        {l.clock !== 'off' && <input type="color" aria-label="Clock colour" value={l.clockColor || '#f5f5f6'} onChange={(e) => set({ clockColor: e.target.value })} />}
      </Row>
      <Row title="Theme">
        <div className="wg-themes" role="radiogroup" aria-label="Island theme">
          {ISLAND_THEMES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={l.theme === t} className={`wg-theme th-${t} ${l.theme === t ? 'on' : ''}`} onClick={() => set({ theme: t })}>
              <i />
              {THEME_LABEL[t]}
            </button>
          ))}
        </div>
      </Row>
    </section>
  )
}
