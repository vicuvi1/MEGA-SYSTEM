// Custom Center (docs/areas/custom.md): build and customise your own stuff.
// Widgets (counters, timers, countdowns, checklists, rings, clocks) and where
// they sit (island pill, open island, app home), one-tap actions, reminder
// rules, modes with schedules, the looks, templates and a file to export or
// import. Every change shows at once and can be undone. The data model and the
// rules are pure in src/core/custom; this page only edits and previews.
import { useEffect, useMemo, useState } from 'react'
import {
  activeLayout, activeMode, applyTemplate, checksDone, cleanReminder, cleanWidget, DEFAULT_GATE, exportName, exportSetup, fireInput, importSetup, newId, nextFire, nextModeChange, noteFired, reminderGate, ruleText, SLOT_LABEL, stepText, STEP_LABEL, TEMPLATES, toggleCheck,
  widgetState, windowText, WIDGET_KINDS, WIDGET_LABEL, ACTION_PAGES, SOUND_KINDS,
  type ActionStep, type Background, type CustomAction, type CustomSetup, type Looks, type Mode, type ModeWindow, type RealNumbers, type ReminderRule, type Slot, type StepKind, type Widget, type WidgetKind
} from '@core/custom'
import { PageTabs, TabPanel, usePageTab, type PageTab } from '../PageTabs'
import { Select } from '../Select'
import { Row, Segmented, Switch } from '../settingsUi'
import { useToast } from '../ui'
import { changeSetup, changeState, loadCustom, undoSetup, useCustom } from '../custom/customStore'
import { readReal, runAction, tapCounter } from '../custom/runner'
import { LayoutBoard } from '../custom/LayoutBoard'
import { looksStyle, PillPreview, WidgetCard } from '../custom/views'
import { playLocal, saveImage, saveSound } from '../custom/localFiles'
import { backgroundCss } from '../custom/CustomBackground'
import { useLive } from '../live'
import { life } from '../bridge'
import '../custom/custom.css'

const TABS: PageTab[] = [
  { id: 'build', label: 'Build' },
  { id: 'actions', label: 'Actions' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'modes', label: 'Modes' },
  { id: 'looks', label: 'Looks' },
  { id: 'templates', label: 'Templates' },
  { id: 'file', label: 'Export' }
]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const hm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const whenText = (t: number | null, now: number) => {
  if (t == null) return 'Not planned'
  if (t <= now + 30_000) return 'Due now'
  const sameDay = new Date(t).toDateString() === new Date(now).toDateString()
  return sameDay ? `Next at ${hm(t)}` : `Next ${new Date(t).toLocaleDateString('en-GB', { weekday: 'short' })} ${hm(t)}`
}

/** Today's real numbers (water, reps, a running timer), kept fresh while the page is open. */
function useReal(): RealNumbers {
  const [real, setReal] = useState<RealNumbers>({})
  useEffect(() => {
    let live = true
    const read = () => void readReal().then((r) => live && setReal(r))
    read()
    const evs = ['life-body-changed', 'life-water-changed', 'life-focus-changed']
    evs.forEach((e) => window.addEventListener(e, read))
    return () => {
      live = false
      evs.forEach((e) => window.removeEventListener(e, read))
    }
  }, [])
  return real
}

/** The clock: once a second only while a timer runs (requestAnimationFrame stops when hidden), else once a minute. */
function useNow(fast: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!fast) {
      const id = window.setInterval(() => setNow(Date.now()), 60_000)
      return () => window.clearInterval(id)
    }
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (t - last > 1000) (last = t), setNow(Date.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fast])
  return now
}

export function CustomCenter() {
  const { setup, state, loaded, newer, undo } = useCustom()
  const toast = useToast()
  const real = useReal()
  const now = useNow(!!real.focus)
  const [tab, setTab] = usePageTab('custom', TABS.map((t) => t.id), 'build')
  const active = useMemo(() => activeLayout(setup, now), [setup, now])
  const [editing, setEditing] = useState<string | null>(null)
  const editMode = setup.modes.find((m) => m.id === (editing ?? active.mode.id)) ?? active.mode
  useEffect(() => void loadCustom(), [])
  useLive(() => void loadCustom())

  /** Changes the set-up at once; an Undo toast takes it back. */
  const change = async (fn: (s: CustomSetup) => CustomSetup, said: string) => {
    try {
      await changeSetup(fn)
      toast(said, 'good', { label: 'Undo', run: () => void undoSetup() })
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const changeMode = (id: string, fn: (m: Mode) => Mode, said: string) => change((s) => ({ ...s, modes: s.modes.map((m) => (m.id === id ? fn(m) : m)) }), said)
  const ctx = { setup, state, real, now }

  if (!loaded) return <div className="cc-page"><div className="panel cc-loading">Loading your set-up…</div></div>

  return (
    <div className="cc-page" style={looksStyle(active.looks)}>
      {newer && <div className="panel cc-warn">Your set-up was saved by a newer version of Life System. Update this app to change it here.</div>}
      <div className="cc-top">
        <div className="cc-modes" role="radiogroup" aria-label="Mode">
          {setup.modes.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={active.mode.id === m.id} className={`cc-mode-chip ${active.mode.id === m.id ? 'on' : ''}`} onClick={() => change((s) => ({ ...s, manual: { mode: m.id, at: Date.now(), until: null } }), `${m.name} mode on`)}>
              <span aria-hidden="true">{m.icon}</span> {m.name}
            </button>
          ))}
          {setup.manual && (
            <button type="button" className="btn ghost cc-auto" onClick={() => change((s) => ({ ...s, manual: null }), 'Modes follow the schedule again')}>
              Back to schedule
            </button>
          )}
        </div>
        <div className="cc-top-end">
          <small className="hint" data-testid="cc-mode-why">
            {active.why === 'manual' ? 'Picked by you' : active.why === 'schedule' ? 'On by schedule' : 'Your base mode'}
            {(() => {
              const t = nextModeChange(setup.modes, now)
              return t ? ` · changes at ${hm(t)}` : ''
            })()}
          </small>
          <button type="button" className="btn" disabled={!undo} onClick={() => void undoSetup()} title="Take back the last change">
            Undo
          </button>
        </div>
      </div>

      <PageTabs page="custom" label="Custom Center views" tabs={TABS} value={tab} onChange={setTab} />

      <TabPanel page="custom" id="build" value={tab}>
        <BuildTab setup={setup} ctx={ctx} mode={editMode} activeId={active.mode.id} onEditMode={setEditing} change={change} changeMode={changeMode} toast={toast} />
      </TabPanel>
      <TabPanel page="custom" id="actions" value={tab}>
        <ActionsTab setup={setup} change={change} toast={toast} />
      </TabPanel>
      <TabPanel page="custom" id="reminders" value={tab}>
        <RemindersTab setup={setup} ctx={ctx} active={active.reminders.map((r) => r.id)} change={change} toast={toast} />
      </TabPanel>
      <TabPanel page="custom" id="modes" value={tab}>
        <ModesTab setup={setup} activeId={active.mode.id} change={change} changeMode={changeMode} />
      </TabPanel>
      <TabPanel page="custom" id="looks" value={tab}>
        <LooksTab setup={setup} change={change} changeMode={changeMode} toast={toast} />
      </TabPanel>
      <TabPanel page="custom" id="templates" value={tab}>
        <TemplatesTab setup={setup} change={change} onApplied={() => setTab('build')} />
      </TabPanel>
      <TabPanel page="custom" id="file" value={tab}>
        <FileTab setup={setup} change={change} toast={toast} />
      </TabPanel>
    </div>
  )
}

type Change = (fn: (s: CustomSetup) => CustomSetup, said: string) => Promise<void>
type ChangeMode = (id: string, fn: (m: Mode) => Mode, said: string) => Promise<void>
type Toast = ReturnType<typeof useToast>
type Ctx = { setup: CustomSetup; state: typeof import('@core/custom').EMPTY_STATE; real: RealNumbers; now: number }

// ---------------------------------------------------------------- Build

function BuildTab({ setup, ctx, mode, activeId, onEditMode, change, changeMode, toast }: { setup: CustomSetup; ctx: Ctx; mode: Mode; activeId: string; onEditMode: (id: string) => void; change: Change; changeMode: ChangeMode; toast: Toast }) {
  const [edit, setEdit] = useState<Widget | null>(null)
  const looks = { ...setup.looks, ...mode.looks }
  const view = (w: Widget) => widgetState(w, ctx)
  const list = (ids: string[]) => ids.map((id) => setup.widgets.find((w) => w.id === id)).filter((w): w is Widget => !!w)
  const save = (w: Widget, isNew: boolean) => {
    const clean = cleanWidget(w)
    if (!clean) return
    setEdit(null)
    void change((s) => ({ ...s, widgets: isNew ? [...s.widgets, clean] : s.widgets.map((x) => (x.id === clean.id ? clean : x)) }), isNew ? `${clean.title} added` : `${clean.title} saved`)
  }
  const remove = (w: Widget) => change((s) => ({ ...s, widgets: s.widgets.filter((x) => x.id !== w.id) }), `${w.title} removed`)
  const tap = async (w: Widget, n: number) => {
    if (w.kind !== 'counter') return
    try {
      const r = await tapCounter(w, n)
      toast(r.said, 'good', { label: 'Undo', run: () => void r.undo() })
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const startTimer = async (w: Widget) => {
    if (w.kind !== 'timer') return
    const r = await runAction({ id: w.id, name: w.title, icon: w.icon, steps: [{ do: 'focus', minutes: w.focusMin, subject: w.subject }] })
    toast(r.said, 'good', r.undo ? { label: 'Undo', run: () => void r.undo!() } : undefined)
  }
  const check = (w: Widget, item: string) => w.kind === 'checklist' && void changeState((s) => toggleCheck(s, w, item, Date.now()))

  return (
    <div className="cc-build">
      <section className="panel cc-preview" aria-label="Live preview">
        <header className="panel-head">
          <h2>Live preview</h2>
          <div className="cc-inline">
            <span className="hint">Mode</span>
            <Select aria-label="Mode to edit" value={mode.id} onChange={(e) => onEditMode(e.target.value)}>
              {setup.modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.id === activeId ? ' (on now)' : ''}
                </option>
              ))}
            </Select>
          </div>
        </header>
        <PillPreview items={list(mode.layout.pill).map(view)} open={list(mode.layout.island).map(view)} looks={looks} />
        <h3 className="cc-sub">App home</h3>
        <div className="cc-home" data-testid="cc-home">
          {list(mode.layout.home).map((w) => (
            <WidgetCard key={w.id} v={view(w)} numbers={looks.font.numbers}>
              {w.kind === 'counter' && (
                <div className="cc-steps">
                  {w.steps.map((n) => (
                    <button key={n} type="button" className="btn cc-step" onClick={() => void tap(w, n)} aria-label={`Add ${n} to ${w.title}`}>
                      +{n}
                    </button>
                  ))}
                </div>
              )}
              {w.kind === 'timer' && (
                <button type="button" className="btn primary cc-step" onClick={() => void startTimer(w)} disabled={!!ctx.real.focus}>
                  {ctx.real.focus ? 'Running' : `Start ${w.focusMin} min`}
                </button>
              )}
              {w.kind === 'checklist' && (
                <ul className="cc-checks">
                  {w.items.map((it) => {
                    const done = checksDone(ctx.state, w, ctx.now).includes(it.id)
                    return (
                      <li key={it.id}>
                        <label>
                          <input type="checkbox" checked={!!done} onChange={() => check(w, it.id)} /> {it.text}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </WidgetCard>
          ))}
          {!mode.layout.home.length && <p className="hint">Drag widgets to “App home” below to see them here.</p>}
        </div>
      </section>

      <section className="panel" aria-label="Place your widgets">
        <header className="panel-head">
          <h2>Where they sit · {mode.name}</h2>
        </header>
        <LayoutBoard widgets={setup.widgets} layout={mode.layout} onChange={(l, said) => void changeMode(mode.id, (m) => ({ ...m, layout: l }), said)} onFull={(s: Slot) => toast(`${SLOT_LABEL[s]} is full: take one out first`, 'bad')} />
      </section>

      <section className="panel" aria-label="Your widgets">
        <header className="panel-head">
          <h2>Your widgets</h2>
        </header>
        <div className="cc-add" role="group" aria-label="Add a widget">
          {WIDGET_KINDS.map((k) => (
            <button key={k} type="button" className="btn" data-add={k} onClick={() => setEdit(blankWidget(k))}>
              + {WIDGET_LABEL[k]}
            </button>
          ))}
        </div>
        {edit && <WidgetForm key={edit.id} w={edit} widgets={setup.widgets} isNew={!setup.widgets.some((x) => x.id === edit.id)} onSave={save} onCancel={() => setEdit(null)} />}
        <ul className="cc-list">
          {setup.widgets.map((w) => (
            <li key={w.id} data-widget-row={w.id}>
              <span aria-hidden="true">{w.icon}</span>
              <b>{w.title}</b>
              <small className="hint">{WIDGET_LABEL[w.kind]}{w.kind === 'counter' && w.track !== 'none' ? (w.track === 'water' ? ' · logs water' : ' · logs to Sport Track') : ''}</small>
              <span className="cc-grow" />
              <button type="button" className="btn ghost" onClick={() => setEdit(w)}>Edit</button>
              <button type="button" className="btn ghost" onClick={() => void remove(w)} aria-label={`Remove ${w.title}`}>Remove</button>
            </li>
          ))}
          {!setup.widgets.length && <li className="hint">No widgets yet. Add one above, or start from a template.</li>}
        </ul>
      </section>
    </div>
  )
}

function blankWidget(kind: WidgetKind): Widget {
  const id = newId('w')
  const base = { id, icon: { counter: '💪', timer: '⏱', countdown: '📅', checklist: '✅', ring: '◔', clock: '🕰' }[kind], color: null }
  return cleanWidget({ ...base, kind, title: { counter: 'Push-ups', timer: 'Focus', countdown: 'Exam', checklist: 'Today', ring: 'Progress', clock: 'Clock' }[kind], goal: 100, steps: [10, 25, 50], focusMin: 50, breakMin: 10, date: new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10), items: [{ id: 'a', text: 'First thing' }] })!
}

function WidgetForm({ w: initial, widgets, isNew, onSave, onCancel }: { w: Widget; widgets: Widget[]; isNew: boolean; onSave: (w: Widget, isNew: boolean) => void; onCancel: () => void }) {
  const [w, setW] = useState<any>(initial)
  const set = (patch: Record<string, unknown>) => setW((x: any) => ({ ...x, ...patch }))
  return (
    <form className="cc-form" data-testid="cc-widget-form" onSubmit={(e) => (e.preventDefault(), onSave(w, isNew))}>
      <h3 className="cc-sub">{isNew ? 'New' : 'Edit'} {WIDGET_LABEL[w.kind as WidgetKind].toLowerCase()}</h3>
      <div className="cc-grid">
        <label>Name<input className="sx-input" name="title" value={w.title} maxLength={40} onChange={(e) => set({ title: e.target.value })} /></label>
        <label>Icon<input className="sx-input cc-short" value={w.icon} maxLength={4} onChange={(e) => set({ icon: e.target.value })} /></label>
        <label>Colour
          <span className="cc-inline">
            <input type="color" value={w.color ?? '#b8f53d'} onChange={(e) => set({ color: e.target.value })} aria-label="Widget colour" />
            {w.color && <button type="button" className="btn ghost" onClick={() => set({ color: null })}>Accent</button>}
          </span>
        </label>
        {w.kind === 'counter' && (
          <>
            <label>Goal<input className="sx-input cc-short" name="goal" type="number" min={1} value={w.goal} onChange={(e) => set({ goal: Number(e.target.value) })} /></label>
            <label>Buttons (e.g. 10, 25, 50)<input className="sx-input" name="steps" value={Array.isArray(w.steps) ? w.steps.join(', ') : w.steps} onChange={(e) => set({ steps: e.target.value.split(/[ ,]+/).map(Number).filter((n) => n > 0) })} /></label>
            <label>Unit<input className="sx-input cc-short" value={w.unit} maxLength={12} onChange={(e) => set({ unit: e.target.value })} /></label>
            <label>New day at<input className="sx-input cc-short" type="time" value={w.resetAt} onChange={(e) => set({ resetAt: e.target.value })} /></label>
            <label>Counts
              <Select aria-label="What it counts" value={w.track} onChange={(e) => set({ track: e.target.value, unit: e.target.value === 'water' ? 'ml' : w.unit })}>
                <option value="none">Only here (no points)</option>
                <option value="reps">Sport Track reps (its own rules)</option>
                <option value="water">Water (the water log)</option>
              </Select>
            </label>
            {w.track === 'reps' && <label>Sport Track exercise<input className="sx-input" name="exercise" value={w.exercise} placeholder="pushups" onChange={(e) => set({ exercise: e.target.value })} /></label>}
          </>
        )}
        {w.kind === 'timer' && (
          <>
            <label>Focus (min)<input className="sx-input cc-short" name="focusMin" type="number" min={5} max={180} value={w.focusMin} onChange={(e) => set({ focusMin: Number(e.target.value) })} /></label>
            <label>Break (min)<input className="sx-input cc-short" name="breakMin" type="number" min={1} max={60} value={w.breakMin} onChange={(e) => set({ breakMin: Number(e.target.value) })} /></label>
            <label>Long rest (min)<input className="sx-input cc-short" type="number" min={0} max={90} value={w.restMin} onChange={(e) => set({ restMin: Number(e.target.value) })} /></label>
            <label>Timer name<input className="sx-input" value={w.subject} maxLength={40} onChange={(e) => set({ subject: e.target.value })} /></label>
          </>
        )}
        {w.kind === 'countdown' && <label>Date<input className="sx-input" name="date" type="date" value={w.date} onChange={(e) => set({ date: e.target.value })} /></label>}
        {w.kind === 'ring' && (
          <label>Shows
            <Select aria-label="What the ring shows" value={w.of} placeholder="Pick a counter or checklist" onChange={(e) => set({ of: e.target.value })}>
              {widgets.filter((x) => x.kind === 'counter' || x.kind === 'checklist').map((x) => (
                <option key={x.id} value={x.id}>{x.title}</option>
              ))}
            </Select>
          </label>
        )}
        {w.kind === 'checklist' && (
          <>
            <label className="cc-wide">Items (one per line)<textarea className="sx-input" rows={4} value={w.items.map((i: any) => i.text).join('\n')} onChange={(e) => set({ items: e.target.value.split('\n').map((t, i) => ({ id: w.items[i]?.id ?? `i${i}`, text: t })) })} /></label>
            <label>New day at<input className="sx-input cc-short" type="time" value={w.resetAt} onChange={(e) => set({ resetAt: e.target.value })} /></label>
          </>
        )}
      </div>
      <div className="cc-inline">
        <button type="submit" className="btn primary">{isNew ? 'Add widget' : 'Save'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- Actions

const STEP_KINDS: StepKind[] = ['focus', 'music', 'quiet', 'dnd', 'stopFocus', 'mode', 'open', 'count']

function defaultStep(kind: StepKind, setup: CustomSetup): ActionStep | null {
  switch (kind) {
    case 'focus': return { do: 'focus', minutes: 50, subject: 'Study' }
    case 'stopFocus': return { do: 'stopFocus' }
    case 'music': return { do: 'music', station: 'Lo-fi' }
    case 'quiet': return { do: 'quiet', minutes: 50 }
    case 'dnd': return { do: 'dnd' }
    case 'mode': return setup.modes[0] ? { do: 'mode', mode: setup.modes[0].id } : null
    case 'open': return { do: 'open', page: 'today' }
    case 'count': {
      const c = setup.widgets.find((w) => w.kind === 'counter')
      return c ? { do: 'count', widget: c.id, amount: 10 } : null
    }
  }
}

function ActionsTab({ setup, change, toast }: { setup: CustomSetup; change: Change; toast: Toast }) {
  const [draft, setDraft] = useState<CustomAction | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // What the last run did stays on the page, with its own Undo (10 minutes for the timer and quiet time).
  const [ran, setRan] = useState<{ said: string; undo: (() => Promise<void>) | null } | null>(null)
  const run = async (a: CustomAction) => {
    setBusy(a.id)
    try {
      const r = await runAction(a)
      setRan(r)
      toast(r.said, 'good')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(null)
    }
  }
  const setStep = (i: number, s: ActionStep | null) => draft && setDraft({ ...draft, steps: s ? draft.steps.map((x, j) => (j === i ? s : x)) : draft.steps.filter((_, j) => j !== i) })
  return (
    <div className="cc-col">
      <section className="panel">
        <header className="panel-head">
          <h2>Your actions</h2>
          <button type="button" className="btn primary" onClick={() => setDraft({ id: newId('a'), name: 'Start study', icon: '📚', steps: [{ do: 'focus', minutes: 50, subject: 'Study' }] })}>+ New action</button>
        </header>
        <p className="hint block">One button that does several things, using only the app's own switches: the focus timer, music, quiet time, Do Not Disturb, a mode, a page, a counter. Never a script.</p>
        {ran && (
          <p className="cc-ran" data-testid="cc-ran" role="status">
            {ran.said}
            {ran.undo && (
              <button type="button" className="btn ghost" onClick={() => void ran.undo!().then(() => (setRan(null), toast('Taken back', 'good')))}>
                Undo
              </button>
            )}
          </p>
        )}
        <ul className="cc-list">
          {setup.actions.map((a) => (
            <li key={a.id} data-action={a.id}>
              <span aria-hidden="true">{a.icon}</span>
              <b>{a.name}</b>
              <small className="hint">{a.steps.map((s) => stepText(s, setup)).join(' · ')}</small>
              <span className="cc-grow" />
              <button type="button" className="btn primary" disabled={busy === a.id} onClick={() => void run(a)}>Run</button>
              <button type="button" className="btn ghost" onClick={() => setDraft(a)}>Edit</button>
              <button type="button" className="btn ghost" onClick={() => void change((s) => ({ ...s, actions: s.actions.filter((x) => x.id !== a.id) }), `${a.name} removed`)}>Remove</button>
            </li>
          ))}
          {!setup.actions.length && <li className="hint">No actions yet.</li>}
        </ul>
      </section>
      {draft && (
        <section className="panel cc-form" data-testid="cc-action-form">
          <div className="cc-grid">
            <label>Name<input className="sx-input" name="actionName" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>Icon<input className="sx-input cc-short" value={draft.icon} maxLength={4} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} /></label>
          </div>
          <ol className="cc-steplist">
            {draft.steps.map((s, i) => (
              <li key={i}>
                <StepEditor step={s} setup={setup} onChange={(x) => setStep(i, x)} />
                <button type="button" className="btn ghost" onClick={() => setStep(i, null)} aria-label={`Remove step ${i + 1}`}>✕</button>
              </li>
            ))}
          </ol>
          <div className="cc-add" role="group" aria-label="Add a step">
            {STEP_KINDS.map((k) => (
              <button key={k} type="button" className="btn" data-step={k} disabled={draft.steps.length >= 6 || !defaultStep(k, setup)} onClick={() => setDraft({ ...draft, steps: [...draft.steps, defaultStep(k, setup)!] })}>
                + {STEP_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="cc-inline">
            <button type="button" className="btn primary" disabled={!draft.steps.length} onClick={() => (void change((s) => ({ ...s, actions: s.actions.some((x) => x.id === draft.id) ? s.actions.map((x) => (x.id === draft.id ? draft : x)) : [...s.actions, draft] }), `${draft.name} saved`), setDraft(null))}>Save action</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  )
}

function StepEditor({ step, setup, onChange }: { step: ActionStep; setup: CustomSetup; onChange: (s: ActionStep) => void }) {
  const num = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || lo))
  switch (step.do) {
    case 'focus':
      return <span className="cc-inline">Focus <input className="sx-input cc-short" type="number" aria-label="Minutes" value={step.minutes} onChange={(e) => onChange({ ...step, minutes: num(e.target.value, 5, 180) })} /> min on <input className="sx-input" aria-label="Subject" value={step.subject} onChange={(e) => onChange({ ...step, subject: e.target.value.slice(0, 40) })} /></span>
    case 'quiet':
      return <span className="cc-inline">Quiet the island <input className="sx-input cc-short" type="number" aria-label="Minutes" value={step.minutes} onChange={(e) => onChange({ ...step, minutes: num(e.target.value, 5, 240) })} /> min <small className="hint">(desktop)</small></span>
    case 'music':
      return <span className="cc-inline">Play <input className="sx-input" aria-label="Station" value={step.station} onChange={(e) => onChange({ ...step, station: e.target.value.slice(0, 40) })} /></span>
    case 'mode':
      return <span className="cc-inline">Switch to <Select aria-label="Mode" value={step.mode} onChange={(e) => onChange({ ...step, mode: e.target.value })}>{setup.modes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></span>
    case 'open':
      return <span className="cc-inline">Open <Select aria-label="Page" value={step.page} onChange={(e) => onChange({ ...step, page: e.target.value })}>{ACTION_PAGES.map((p) => <option key={p} value={p}>{p}</option>)}</Select></span>
    case 'count':
      return <span className="cc-inline">Add <input className="sx-input cc-short" type="number" aria-label="Amount" value={step.amount} onChange={(e) => onChange({ ...step, amount: Number(e.target.value) || 1 })} /> to <Select aria-label="Counter" value={step.widget} onChange={(e) => onChange({ ...step, widget: e.target.value })}>{setup.widgets.filter((w) => w.kind === 'counter').map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}</Select></span>
    default:
      return <span>{stepText(step, setup)}{step.do === 'dnd' ? ' (desktop)' : ''}</span>
  }
}

// ---------------------------------------------------------------- Reminders

function RemindersTab({ setup, ctx, active, change, toast }: { setup: CustomSetup; ctx: Ctx; active: string[]; change: Change; toast: Toast }) {
  const [draft, setDraft] = useState<ReminderRule | null>(null)
  const [pc, setPc] = useState<number | null>(null)
  useEffect(() => {
    // How long you have been at this PC (the desktop's idle time), for "at the PC" rules; the website counts from page open.
    const opened = Date.now()
    const read = async () => {
      const idle = await (window.desktop as any)?.idleSeconds?.().catch(() => null)
      setPc(typeof idle === 'number' ? (idle > 300 ? null : opened) : opened)
    }
    void read()
  }, [])
  const gateNow = (r: ReminderRule) => {
    const f = fireInput(ctx.state, r.id, ctx.now, pc)
    return reminderGate(r, f.todayCount, { now: ctx.now, call: false, focus: !!ctx.real.focus, quiet: false, bedtime: null, wake: null, lastInterruptAt: 0, gapMin: DEFAULT_GATE.gapMin, shownToday: 0, dayCap: DEFAULT_GATE.dayCap })
  }
  const done = (r: ReminderRule) => {
    void changeState((s) => noteFired(s, r.id, Date.now()))
    const w = r.log && setup.widgets.find((x) => x.id === r.log!.widget)
    if (w?.kind === 'counter') void tapCounter(w, r.log!.amount).then((x) => toast(x.said, 'good', { label: 'Undo', run: () => void x.undo() })).catch((e) => toast(e.message, 'bad'))
    else toast(`${r.text}: done`, 'good')
  }
  return (
    <div className="cc-col">
      <section className="panel">
        <header className="panel-head">
          <h2>Your reminders</h2>
          <button type="button" className="btn primary" onClick={() => setDraft(cleanReminder({ id: newId('r'), text: '20 push-ups', icon: '💪', kind: 'every', everyMin: 45, atPc: true })!)}>+ New reminder</button>
        </header>
        <p className="hint block">Your own rules. They keep the island's protections: nothing in a call or a meeting, during a focus timer, in quiet hours or after bedtime, a gap between reminders, and a daily limit.</p>
        <ul className="cc-list">
          {setup.reminders.map((r) => {
            const next = nextFire(r, ctx.now, fireInput(ctx.state, r.id, ctx.now, pc))
            const g = gateNow(r)
            return (
              <li key={r.id} data-reminder={r.id}>
                <Switch label={`${r.text} on`} on={r.on} onChange={(v) => void change((s) => ({ ...s, reminders: s.reminders.map((x) => (x.id === r.id ? { ...x, on: v } : x)) }), v ? 'Reminder on' : 'Reminder off')} />
                <span aria-hidden="true">{r.icon}</span>
                <b>{r.text}</b>
                <small className="hint">{ruleText(r)}{active.includes(r.id) ? '' : ' · not in this mode'}</small>
                <span className="cc-grow" />
                <small className="cc-next" data-testid="cc-next-fire">{whenText(next, ctx.now)}{next != null && next <= ctx.now + 30_000 && !g.show ? ` · ${g.why === 'focus' ? 'waits for your timer' : 'waiting'}` : ''}</small>
                <button type="button" className="btn ghost" onClick={() => done(r)}>Done</button>
                <button type="button" className="btn ghost" onClick={() => setDraft(r)}>Edit</button>
                <button type="button" className="btn ghost" onClick={() => void change((s) => ({ ...s, reminders: s.reminders.filter((x) => x.id !== r.id) }), 'Reminder removed')}>Remove</button>
              </li>
            )
          })}
          {!setup.reminders.length && <li className="hint">No reminders yet.</li>}
        </ul>
      </section>
      {draft && (
        <section className="panel cc-form" data-testid="cc-reminder-form">
          <div className="cc-grid">
            <label>What<input className="sx-input" name="reminderText" value={draft.text} maxLength={80} onChange={(e) => setDraft({ ...draft, text: e.target.value })} /></label>
            <label>Icon<input className="sx-input cc-short" value={draft.icon} maxLength={4} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} /></label>
            <label>When<Segmented label="When" value={draft.kind} options={[['every', 'Every N min'], ['at', 'At a time']]} onChange={(v) => setDraft({ ...draft, kind: v })} /></label>
            {draft.kind === 'every' ? (
              <>
                <label>Every (min)<input className="sx-input cc-short" name="everyMin" type="number" min={10} max={480} value={draft.everyMin} onChange={(e) => setDraft({ ...draft, everyMin: Number(e.target.value) })} /></label>
                <label className="cc-inline">Only at the PC <Switch label="Only at the PC" on={draft.atPc} onChange={(v) => setDraft({ ...draft, atPc: v })} /></label>
                <label>From<input className="sx-input cc-short" type="time" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
                <label>Until<input className="sx-input cc-short" type="time" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
              </>
            ) : (
              <label>At<input className="sx-input cc-short" name="at" type="time" value={draft.at} onChange={(e) => setDraft({ ...draft, at: e.target.value })} /></label>
            )}
            <label>At most a day<input className="sx-input cc-short" type="number" min={1} max={24} value={draft.cap} onChange={(e) => setDraft({ ...draft, cap: Number(e.target.value) })} /></label>
            <DaysPicker days={draft.days} onChange={(d) => setDraft({ ...draft, days: d })} />
            <label>“Done” also adds
              <Select aria-label="Done also adds to" value={draft.log?.widget ?? ''} onChange={(e) => setDraft({ ...draft, log: e.target.value ? { widget: e.target.value, amount: draft.log?.amount ?? 20 } : null })}>
                <option value="">Nothing</option>
                {setup.widgets.filter((w) => w.kind === 'counter').map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
              </Select>
            </label>
            {draft.log && <label>Amount<input className="sx-input cc-short" type="number" min={1} value={draft.log.amount} onChange={(e) => setDraft({ ...draft, log: { ...draft.log!, amount: Number(e.target.value) || 1 } })} /></label>}
          </div>
          <div className="cc-inline">
            <button type="button" className="btn primary" onClick={() => {
              const r = cleanReminder(draft)
              if (!r) return toast('Write what to remind you of', 'bad')
              void change((s) => ({ ...s, reminders: s.reminders.some((x) => x.id === r.id) ? s.reminders.map((x) => (x.id === r.id ? r : x)) : [...s.reminders, r] }), 'Reminder saved')
              setDraft(null)
            }}>Save reminder</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  )
}

function DaysPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <div className="cc-days" role="group" aria-label="Days (none = every day)">
      {DAY_NAMES.map((n, i) => (
        <button key={n} type="button" aria-pressed={days.includes(i)} className={`cc-day ${days.includes(i) ? 'on' : ''}`} onClick={() => onChange(days.includes(i) ? days.filter((d) => d !== i) : [...days, i].sort())}>
          {n}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Modes

function ModesTab({ setup, activeId, change, changeMode }: { setup: CustomSetup; activeId: string; change: Change; changeMode: ChangeMode }) {
  const add = () => {
    const id = newId('m')
    void change((s) => ({ ...s, modes: [...s.modes, { id, name: 'New mode', icon: '✦', layout: { pill: [], island: [], home: [] }, looks: {}, background: null, desktopWallpaper: null, reminders: [], schedule: [] }] }), 'Mode added')
  }
  return (
    <div className="cc-col">
      <p className="hint block">A mode switches the whole look: its widgets, looks, sounds, background and reminders. It turns on by its times, or with one tap at the top. A mode you tap stays on until the next scheduled one starts.</p>
      {setup.modes.map((m) => (
        <section key={m.id} className={`panel cc-mode ${m.id === activeId ? 'is-on' : ''}`} data-mode={m.id}>
          <header className="panel-head">
            <h2>
              <input className="sx-input cc-short" aria-label="Mode icon" value={m.icon} maxLength={4} onChange={(e) => void changeMode(m.id, (x) => ({ ...x, icon: e.target.value }), 'Icon saved')} />
              <input className="sx-input" aria-label="Mode name" defaultValue={m.name} maxLength={24} onBlur={(e) => e.target.value !== m.name && void changeMode(m.id, (x) => ({ ...x, name: e.target.value }), 'Name saved')} />
              {m.id === activeId && <small className="cc-badge">On now</small>}
            </h2>
            <div className="cc-inline">
              {setup.baseMode === m.id ? <small className="hint">Base mode</small> : <button type="button" className="btn ghost" onClick={() => void change((s) => ({ ...s, baseMode: m.id }), `${m.name} is the base mode`)}>Make base</button>}
              {setup.modes.length > 1 && <button type="button" className="btn ghost" onClick={() => void change((s) => ({ ...s, modes: s.modes.filter((x) => x.id !== m.id) }), `${m.name} removed`)}>Remove</button>}
            </div>
          </header>
          <Row title="Times" hint={m.schedule.length ? m.schedule.map(windowText).join(' · ') : 'Only when you tap it'}>
            <button type="button" className="btn" onClick={() => void changeMode(m.id, (x) => ({ ...x, schedule: [...x.schedule, { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' }].slice(0, 6) }), 'Time added')}>+ Time</button>
          </Row>
          {m.schedule.map((w, i) => (
            <WindowEditor key={i} w={w} onChange={(nw) => void changeMode(m.id, (x) => ({ ...x, schedule: nw ? x.schedule.map((y, j) => (j === i ? nw : y)) : x.schedule.filter((_, j) => j !== i) }), nw ? 'Time saved' : 'Time removed')} />
          ))}
          <Row title="Reminders in this mode" hint="None picked = all that are on">
            <div className="cc-days">
              {setup.reminders.map((r) => (
                <button key={r.id} type="button" aria-pressed={m.reminders.includes(r.id)} className={`cc-day ${m.reminders.includes(r.id) ? 'on' : ''}`} onClick={() => void changeMode(m.id, (x) => ({ ...x, reminders: x.reminders.includes(r.id) ? x.reminders.filter((y) => y !== r.id) : [...x.reminders, r.id] }), 'Reminders saved')}>
                  {r.icon} {r.text}
                </button>
              ))}
              {!setup.reminders.length && <small className="hint">No reminders yet</small>}
            </div>
          </Row>
          <Row title="Widgets" hint={`${m.layout.pill.length} in the pill · ${m.layout.island.length} in the open island · ${m.layout.home.length} on home (Build tab)`} />
          <Row title="Windows wallpaper" hint={m.desktopWallpaper ? 'Picked; the desktop app will use it in a later update' : 'Saved for a later desktop update'}>
            <ImagePick label="Pick a picture" onPicked={(ref) => void changeMode(m.id, (x) => ({ ...x, desktopWallpaper: { image: ref } }), 'Wallpaper saved for this mode')} />
          </Row>
        </section>
      ))}
      <button type="button" className="btn" onClick={add} disabled={setup.modes.length >= 8}>+ New mode</button>
    </div>
  )
}

function WindowEditor({ w, onChange }: { w: ModeWindow; onChange: (w: ModeWindow | null) => void }) {
  return (
    <div className="cc-window">
      <DaysPicker days={w.days} onChange={(d) => onChange({ ...w, days: d })} />
      <label className="cc-inline">From <input className="sx-input cc-short" type="time" value={w.from} onChange={(e) => e.target.value && onChange({ ...w, from: e.target.value })} /></label>
      <label className="cc-inline">Until <input className="sx-input cc-short" type="time" value={w.to} onChange={(e) => onChange({ ...w, to: e.target.value })} /></label>
      <button type="button" className="btn ghost" onClick={() => onChange({ ...w, to: '' })} title="Until the next mode starts">No end</button>
      <button type="button" className="btn ghost" onClick={() => onChange(null)} aria-label="Remove this time">✕</button>
    </div>
  )
}

function ImagePick({ label, onPicked }: { label: string; onPicked: (ref: string) => void }) {
  const toast = useToast()
  return (
    <label className="btn cc-file">
      {label}
      <input type="file" accept="image/*" onChange={async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        try {
          onPicked(await saveImage(f))
        } catch (err) {
          toast((err as Error).message, 'bad')
        }
      }} />
    </label>
  )
}

// ---------------------------------------------------------------- Looks

function LooksTab({ setup, change, changeMode, toast }: { setup: CustomSetup; change: Change; changeMode: ChangeMode; toast: Toast }) {
  const [target, setTarget] = useState<string>('all')
  const mode = setup.modes.find((m) => m.id === target)
  const looks: Looks = mode ? { ...setup.looks, ...mode.looks } : setup.looks
  const bg: Background = (mode?.background ?? setup.background)
  const setPart = <K extends keyof Looks>(k: K, v: Looks[K]) => (mode ? changeMode(mode.id, (m) => ({ ...m, looks: { ...m.looks, [k]: v } }), 'Look saved') : change((s) => ({ ...s, looks: { ...s.looks, [k]: v } }), 'Look saved'))
  const setBg = (b: Partial<Background>) => (mode ? changeMode(mode.id, (m) => ({ ...m, background: { ...bg, ...b } }), 'Background saved') : change((s) => ({ ...s, background: { ...s.background, ...b } }), 'Background saved'))
  const L = looks
  return (
    <div className="cc-col">
      <div className="cc-inline">
        <span className="hint">Change the look for</span>
        <Select aria-label="Look for" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="all">Every mode</option>
          {setup.modes.map((m) => <option key={m.id} value={m.id}>{m.name} only</option>)}
        </Select>
        {mode && (Object.keys(mode.looks).length > 0 || mode.background) && <button type="button" className="btn ghost" onClick={() => void changeMode(mode.id, (m) => ({ ...m, looks: {}, background: null }), 'This mode uses the common look again')}>Use the common look</button>}
      </div>

      <section className="panel" data-testid="cc-background">
        <header className="panel-head"><h2>App background</h2></header>
        <Row title="Background" hint="Behind every page of the app. The page colour stays on top so text is easy to read">
          <Segmented label="Background" value={bg.kind} options={[['none', 'None'], ['gradient', 'Gradient'], ['image', 'Picture']]} onChange={(v) => (v === 'image' && !bg.image ? toast('Pick a picture first', 'info') : void setBg({ kind: v }))} />
        </Row>
        {(
          <>
            <Row title="Colours" hint="Two or three, with the angle">
              <span className="cc-inline">
                {bg.colors.map((c, i) => <input key={i} type="color" value={c} aria-label={`Colour ${i + 1}`} onChange={(e) => void setBg({ colors: bg.colors.map((x, j) => (j === i ? e.target.value : x)) })} />)}
                {bg.colors.length < 3 ? <button type="button" className="btn ghost" onClick={() => void setBg({ colors: [...bg.colors, '#203a43'] })}>+</button> : <button type="button" className="btn ghost" onClick={() => void setBg({ colors: bg.colors.slice(0, 2) })}>−</button>}
                <input type="range" min={0} max={360} step={15} value={bg.angle} aria-label="Angle" onChange={(e) => void setBg({ angle: Number(e.target.value) })} />
              </span>
            </Row>
            <Row title="Slow drift" hint="The gradient moves very slowly (never when your system asks for less motion)">
              <Switch label="Slow drift" on={bg.animate} onChange={(v) => void setBg({ animate: v })} />
            </Row>
            <Row title="Picture" hint="Kept on this device only">
              <ImagePick label="Pick a picture" onPicked={(ref) => void setBg({ kind: 'image', image: ref })} />
            </Row>
            <Row title="Strength" hint="How much shows through">
              <input type="range" min={0.1} max={0.4} step={0.05} value={bg.strength} aria-label="Strength" onChange={(e) => void setBg({ strength: Number(e.target.value) })} />
            </Row>
            <div className="cc-bg-sample" style={{ backgroundImage: backgroundCss({ ...bg, kind: bg.kind === 'image' ? 'gradient' : bg.kind }, null) ?? undefined }} aria-hidden="true" />
          </>
        )}
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Island</h2></header>
        <Row title="Size"><Segmented label="Size" value={L.island.size} options={[['s', 'Small'], ['m', 'Medium'], ['l', 'Large']]} onChange={(v) => void setPart('island', { ...L.island, size: v })} /></Row>
        <Row title="Shape"><Segmented label="Shape" value={L.island.shape} options={[['notch', 'Notch'], ['capsule', 'Capsule'], ['bar', 'Thin bar']]} onChange={(v) => void setPart('island', { ...L.island, shape: v })} /></Row>
        <Row title="Corners"><input type="range" min={0} max={32} value={L.island.radius} aria-label="Corners" onChange={(e) => void setPart('island', { ...L.island, radius: Number(e.target.value) })} /></Row>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Motion</h2></header>
        <Row title="Style"><Segmented label="Motion style" value={L.motion.style} options={[['spring', 'Spring'], ['smooth', 'Smooth'], ['snappy', 'Snappy'], ['off', 'Off']]} onChange={(v) => void setPart('motion', { ...L.motion, style: v })} /></Row>
        <Row title="Speed"><input type="range" min={0.5} max={2} step={0.1} value={L.motion.speed} aria-label="Speed" onChange={(e) => void setPart('motion', { ...L.motion, speed: Number(e.target.value) })} /></Row>
        <Row title="Bounce"><input type="range" min={0} max={1} step={0.05} value={L.motion.bounce} aria-label="Bounce" onChange={(e) => void setPart('motion', { ...L.motion, bounce: Number(e.target.value) })} /></Row>
        {(['open', 'notify', 'celebrate'] as const).map((ev) => (
          <Row key={ev} title={{ open: 'When it opens', notify: 'When something comes in', celebrate: 'When you finish something' }[ev]}>
            <Segmented label={`Motion ${ev}`} value={L.motion.events[ev]} options={[['spring', 'Spring'], ['smooth', 'Smooth'], ['snappy', 'Snappy'], ['off', 'Off']]} onChange={(v) => void setPart('motion', { ...L.motion, events: { ...L.motion.events, [ev]: v } })} />
          </Row>
        ))}
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Colours and text</h2></header>
        <Row title="Accent"><input type="color" value={L.colors.accent} aria-label="Accent colour" onChange={(e) => void setPart('colors', { ...L.colors, accent: e.target.value })} /></Row>
        <Row title="Glow"><input type="range" min={0} max={1} step={0.05} value={L.colors.glow} aria-label="Glow" onChange={(e) => void setPart('colors', { ...L.colors, glow: Number(e.target.value) })} /></Row>
        <Row title="Glass blur" hint="12 px at most"><input type="range" min={0} max={12} value={L.colors.blur} aria-label="Glass blur" onChange={(e) => void setPart('colors', { ...L.colors, blur: Number(e.target.value) })} /></Row>
        <Row title="Theme"><Segmented label="Island theme" value={L.colors.theme} options={[['auto', 'Like the app'], ['dark', 'Dark'], ['light', 'Light']]} onChange={(v) => void setPart('colors', { ...L.colors, theme: v })} /></Row>
        <Row title="Font"><Segmented label="Font" value={L.font.family} options={[['system', 'System'], ['rounded', 'Rounded'], ['mono', 'Mono'], ['serif', 'Serif']]} onChange={(v) => void setPart('font', { ...L.font, family: v })} /></Row>
        <Row title="Numbers"><Segmented label="Numbers" value={L.font.numbers} options={[['plain', 'Plain'], ['tabular', 'Even width'], ['segment', 'Digital']]} onChange={(v) => void setPart('font', { ...L.font, numbers: v })} /></Row>
        <Row title="Celebration"><Segmented label="Celebration" value={L.celebrate} options={[['confetti', 'Confetti'], ['burst', 'Burst'], ['glow', 'Glow'], ['none', 'None']]} onChange={(v) => void setPart('celebrate', v)} /></Row>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Clock</h2></header>
        <Row title="Style"><Segmented label="Clock style" value={L.clock.style} options={[['digital', 'Digital'], ['analog', 'Analog']]} onChange={(v) => void setPart('clock', { ...L.clock, style: v })} /></Row>
        <Row title="24-hour"><Switch label="24-hour" on={L.clock.h24} onChange={(v) => void setPart('clock', { ...L.clock, h24: v })} /></Row>
        <Row title="Seconds"><Switch label="Seconds" on={L.clock.seconds} onChange={(v) => void setPart('clock', { ...L.clock, seconds: v })} /></Row>
        <Row title="Date"><Switch label="Date" on={L.clock.date} onChange={(v) => void setPart('clock', { ...L.clock, date: v })} /></Row>
        <Row title="Second time zone" hint="e.g. Europe/London or America/New_York">
          <input className="sx-input" defaultValue={L.clock.zone2} placeholder="None" onBlur={(e) => {
            const z = e.target.value.trim()
            try {
              if (z) new Intl.DateTimeFormat('en', { timeZone: z })
              void setPart('clock', { ...L.clock, zone2: z })
            } catch {
              toast("That time zone isn't known", 'bad')
            }
          }} />
        </Row>
      </section>

      <section className="panel">
        <header className="panel-head"><h2>Sounds</h2></header>
        <Row title="Pack"><Segmented label="Sound pack" value={L.sounds.pack} options={[['default', 'Default'], ['soft', 'Soft'], ['arcade', 'Arcade'], ['glass', 'Glass'], ['off', 'Off']]} onChange={(v) => void setPart('sounds', { ...L.sounds, pack: v })} /></Row>
        <Row title="Volume"><input type="range" min={0} max={1} step={0.05} value={L.sounds.volume} aria-label="Volume" onChange={(e) => void setPart('sounds', { ...L.sounds, volume: Number(e.target.value) })} /></Row>
        {SOUND_KINDS.map((k) => (
          <Row key={k} title={k[0].toUpperCase() + k.slice(1)} hint={L.sounds.files[k] ? 'Your own sound (this device)' : undefined}>
            <span className="cc-inline">
              <input type="range" min={0} max={1} step={0.05} value={L.sounds.kinds[k]} aria-label={`${k} volume`} onChange={(e) => void setPart('sounds', { ...L.sounds, kinds: { ...L.sounds.kinds, [k]: Number(e.target.value) } })} />
              <label className="btn ghost cc-file">Upload
                <input type="file" accept="audio/*" onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  try {
                    const ref = await saveSound(f)
                    void setPart('sounds', { ...L.sounds, files: { ...L.sounds.files, [k]: ref } })
                  } catch (err) {
                    toast((err as Error).message, 'bad')
                  }
                }} />
              </label>
              {L.sounds.files[k] && <button type="button" className="btn ghost" onClick={() => void playLocal(L.sounds.files[k]!, L.sounds.volume * L.sounds.kinds[k])}>▶</button>}
            </span>
          </Row>
        ))}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Templates and file

function TemplatesTab({ setup, change, onApplied }: { setup: CustomSetup; change: Change; onApplied: () => void }) {
  return (
    <div className="cc-templates">
      {TEMPLATES.map((t) => (
        <section key={t.id} className="panel cc-template" data-template={t.id}>
          <h2><span aria-hidden="true">{t.icon}</span> {t.name}</h2>
          <p className="hint">{t.blurb}</p>
          <small className="hint">{t.widgets.length} widgets · {t.actions.length} action · {t.reminders.length} reminder{t.mode.schedule.length ? ` · ${t.mode.schedule.map(windowText).join(', ')}` : ''}</small>
          <button type="button" className="btn primary" onClick={() => (void change((s) => applyTemplate(s, t.id, Date.now()).setup, `${t.name} added: change anything you like`), onApplied())}>
            Use {t.name}
          </button>
        </section>
      ))}
      <p className="hint">A template adds a copy as a new mode. Nothing of yours is replaced. {setup.modes.length >= 8 ? 'You have the most modes (8): remove one first.' : ''}</p>
    </div>
  )
}

function FileTab({ setup, change, toast }: { setup: CustomSetup; change: Change; toast: Toast }) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const doExport = () => {
    const text = exportSetup(setup, Date.now())
    const a = document.createElement('a')
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`
    a.download = exportName(Date.now())
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast('Your set-up is saved as a file', 'good')
  }
  return (
    <div className="cc-col">
      <section className="panel">
        <header className="panel-head"><h2>Export</h2></header>
        <p className="hint block">A file with your widgets, actions, reminders, modes and looks. Pictures and sounds you uploaded stay on this device.</p>
        <button type="button" className="btn primary" data-testid="cc-export" onClick={doExport}>Export to a file</button>
      </section>
      <section className="panel">
        <header className="panel-head"><h2>Import</h2></header>
        <p className="hint block">Replaces your set-up with the one in the file (Undo brings yours back). The file is checked first; nothing in it is ever run.</p>
        <label className="btn cc-file">
          Import a file
          <input type="file" accept="application/json,.json" data-testid="cc-import" onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const r = importSetup(await f.text().catch(() => ''))
            if (!r.ok) return setStatus({ ok: false, text: r.why }), toast(r.why, 'bad')
            const said = `Imported: ${r.counts.widgets} widgets, ${r.counts.actions} actions, ${r.counts.reminders} reminders, ${r.counts.modes} modes`
            setStatus({ ok: true, text: said })
            void change(() => r.setup, said)
          }} />
        </label>
        {status && <p className={`cc-status ${status.ok ? 'ok' : 'bad'}`} data-testid="cc-file-status" role="status">{status.text}</p>}
      </section>
      {!life.custom && <p className="hint">This copy of the app can't save a set-up.</p>}
      <small className="hint">Mode now: {activeMode(setup, Date.now()).mode.name}</small>
    </div>
  )
}
