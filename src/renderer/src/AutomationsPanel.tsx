// Settings → PC & automation → Automations (AH1–AH22): the "When X, do Y"
// builder (chips, a plain-English sentence, "Test now" as a dry run), your
// webhooks (n8n, Make, Pipedream, Activepieces, Node-RED; Zapier needs a paid
// plan) in the cloud or on this PC, "Connect my n8n", your scripts folder with
// SHA-256 pins, the tools found on this PC, "Pause all", and the run log.
// The server and the desktop keep every address and key: this page only gets
// names and the last 4 characters back.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AUTOMATION_TEMPLATES, cleanAutomation, cleanStep, cleanTrigger, dryRun, fromRecipe, mapParams, newAutoId, PARAM_TYPES, PARAM_LABEL, POWERTOYS_FEATURES, PRESETS, PRESET_IDS, presetWarning,
  RISK_LABEL, sentence, STEP_ICON, STEP_KINDS, STEP_LABEL, TRIGGER_LABEL, TRIGGER_ONS, triggerText, stepText, type Automation, type AutomationStore, type N8nWorkflow, type Param,
  type PresetId, type Risk, type Step, type StepKind, type Trigger, type TriggerOn
} from '@core/automations'
import { CONTEXT_KINDS, CONTEXT_LABEL } from '@core/activityContext'
import { SAFE_LABEL, SAFE_PAGES } from '@core/recipes'
import { Row, Segmented, Switch } from './settingsUi'
import { timeAgo, useAction } from './ui'
import { Icon } from './Icon'
import { life } from './bridge'
import { clearRunLog, deskAuto, flowsCall, loadStore, runLog, saveStore, startRun } from './automationsFeed'
import './automations.css'
import { Select } from './Select'

type HookView = { id: string; label: string; preset: string; hint: string; host: string; hasToken: boolean; at: number }
type Secrets = { hooks: HookView[]; n8n: { on: boolean; host: string; keyHint: string } }
type Local = Secrets & { folder: string | null; windows: boolean; safe: boolean; tools: { ahk: string | null; powertoys: string | null; espanso: string | null } }
type ScriptFile = { file: string; name: string; ext: string; pin: 'pinned' | 'new' | 'changed' }

const ago = (t: number) => timeAgo(new Date(t).toISOString())

// ---------------------------------------------------------------- the builder

function TriggerFields({ t, set }: { t: any; set: (t: any) => void }) {
  const f = (k: string, v: unknown) => set({ ...t, [k]: v })
  switch (t.on as TriggerOn) {
    case 'time':
      return <input className="ai-input au-small" type="time" value={t.at ?? '09:00'} onChange={(e) => f('at', e.target.value)} aria-label="Time" />
    case 'context':
      return (
        <Select className="ai-input au-small" value={t.ctx ?? 'coding'} onChange={(e) => f('ctx', e.target.value)} aria-label="What you start">
          {CONTEXT_KINDS.filter((k) => k !== 'idle').map((k) => (
            <option key={k} value={k}>
              {CONTEXT_LABEL[k]}
            </option>
          ))}
        </Select>
      )
    case 'app:open':
    case 'app:close':
      return <input className="ai-input au-small" value={t.app ?? ''} placeholder="Code" maxLength={40} onChange={(e) => f('app', e.target.value)} aria-label="App name" />
    case 'wifi':
      return <input className="ai-input au-small" value={t.name ?? ''} placeholder="Home-WiFi" maxLength={32} onChange={(e) => f('name', e.target.value)} aria-label="Wi-Fi name" />
    case 'battery':
      return <input className="ai-input au-small" type="number" min={5} max={95} value={t.below ?? 20} onChange={(e) => f('below', Number(e.target.value))} aria-label="Below percent" />
    case 'charger':
      return (
        <Select className="ai-input au-small" value={t.plugged === false ? 'out' : 'in'} onChange={(e) => f('plugged', e.target.value === 'in')} aria-label="Plugged">
          <option value="in">plugged in</option>
          <option value="out">unplugged</option>
        </Select>
      )
    case 'idle':
      return <input className="ai-input au-small" type="number" min={1} max={240} value={t.minutes ?? 10} onChange={(e) => f('minutes', Number(e.target.value))} aria-label="Minutes away" />
    case 'calendar':
      return (
        <>
          <input className="ai-input au-small" value={t.match ?? ''} placeholder="Lecture (empty: any)" maxLength={60} onChange={(e) => f('match', e.target.value)} aria-label="Event name has" />
          <input className="ai-input au-small" type="number" min={0} max={120} value={t.before ?? 5} onChange={(e) => f('before', Number(e.target.value))} aria-label="Minutes before" />
        </>
      )
    case 'clipboard':
      return <input className="ai-input au-small" value={t.pattern ?? ''} placeholder="https:// or /^[A-Z]{3}-\d+$/" maxLength={100} onChange={(e) => f('pattern', e.target.value)} aria-label="Pattern" />
    case 'file':
      return (
        <>
          <input className="ai-input" value={t.folder ?? ''} placeholder="C:\Users\you\Downloads" maxLength={300} onChange={(e) => f('folder', e.target.value)} aria-label="Folder" />
          <input className="ai-input au-small" value={t.ext ?? ''} placeholder=".pdf" maxLength={10} onChange={(e) => f('ext', e.target.value)} aria-label="File type" />
        </>
      )
    default:
      return null
  }
}

const SAFE_SIMPLE = ['focusPack', 'blockSites', 'dnd', 'quiet', 'stopFocus', 'windDown', 'moveCard', 'open'] as const

function StepFields({ s, set, hooks, scripts }: { s: any; set: (s: any) => void; hooks: { value: string; label: string; preset: string }[]; scripts: ScriptFile[] }) {
  const f = (k: string, v: unknown) => set({ ...s, [k]: v })
  switch (s.do as StepKind) {
    case 'webhook':
      return (
        <>
          <Select className="ai-input" value={s.hook ? `${s.where}:${s.hook}` : ''} onChange={(e) => {
            const [where, hook] = e.target.value.split(':')
            set({ ...s, where, hook, preset: hooks.find((h) => h.value === e.target.value)?.preset ?? 'custom' })
          }} aria-label="Which webhook">
            <option value="">Pick a saved webhook…</option>
            {hooks.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </Select>
          {s.preset === 'n8n' && (
            <label className="hint small au-check">
              <input type="checkbox" checked={!!s.wait} onChange={(e) => f('wait', e.target.checked)} /> Wait for the run to finish (the flow answers with its executionId)
            </label>
          )}
        </>
      )
    case 'safe':
      return (
        <>
          <Select className="ai-input" value={s.act?.do ?? 'focusPack'} onChange={(e) => f('act', { do: e.target.value, ...(e.target.value === 'quiet' ? { minutes: 60 } : e.target.value === 'open' ? { page: 'today' } : {}) })} aria-label="Recipe action">
            {SAFE_SIMPLE.map((k) => (
              <option key={k} value={k}>
                {SAFE_LABEL[k]}
              </option>
            ))}
          </Select>
          {s.act?.do === 'quiet' && <input className="ai-input au-small" type="number" min={5} max={240} value={s.act.minutes ?? 60} onChange={(e) => f('act', { do: 'quiet', minutes: Number(e.target.value) })} aria-label="Minutes" />}
          {s.act?.do === 'open' && (
            <Select className="ai-input au-small" value={s.act.page} onChange={(e) => f('act', { do: 'open', page: e.target.value })} aria-label="Page">
              {SAFE_PAGES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          )}
        </>
      )
    case 'telegram':
    case 'ntfy':
    case 'todoist':
    case 'type':
      return <input className="ai-input" value={s.text ?? ''} maxLength={s.do === 'type' ? 300 : 500} placeholder={s.do === 'telegram' ? 'Done: {{result.text}}' : s.do === 'todoist' ? 'Read {{topic}} tomorrow' : 'Text ({{name}} fills a value)'} onChange={(e) => f('text', e.target.value)} aria-label="Text" />
    case 'note':
      return (
        <>
          <input className="ai-input au-small" value={s.title ?? ''} maxLength={60} placeholder="Inbox" onChange={(e) => f('title', e.target.value)} aria-label="Note title" />
          <input className="ai-input" value={s.text ?? ''} maxLength={500} placeholder="{{trigger.clip}}" onChange={(e) => f('text', e.target.value)} aria-label="Line" />
        </>
      )
    case 'url':
      return <input className="ai-input" value={s.url ?? ''} maxLength={500} placeholder="https://… or {{result.url}}" onChange={(e) => f('url', e.target.value)} aria-label="Link" />
    case 'focus':
      return (
        <>
          <input className="ai-input au-small" value={s.subject ?? ''} maxLength={60} placeholder="Study" onChange={(e) => f('subject', e.target.value)} aria-label="Subject" />
          <input className="ai-input au-small" type="number" min={5} max={180} value={s.minutes ?? 25} onChange={(e) => f('minutes', Number(e.target.value))} aria-label="Minutes" />
        </>
      )
    case 'music':
      return <input className="ai-input" value={s.station ?? ''} maxLength={60} placeholder="Lo-fi" onChange={(e) => f('station', e.target.value)} aria-label="Station" />
    case 'script':
    case 'ahk': {
      const list = scripts.filter((x) => (s.do === 'ahk' ? x.ext === '.ahk' : x.ext !== '.ahk'))
      return (
        <>
          <Select className="ai-input" value={s.file ?? ''} onChange={(e) => f('file', e.target.value)} aria-label="Script">
            <option value="">{list.length ? 'Pick a script…' : 'Choose your scripts folder below first'}</option>
            {list.map((x) => (
              <option key={x.file} value={x.file}>
                {x.name}
              </option>
            ))}
          </Select>
          <input className="ai-input" value={(s.args ?? []).join(' | ')} maxLength={400} placeholder="Arguments, split by |  (e.g. {{topic}} | -Force)" onChange={(e) => f('args', e.target.value.split('|').map((x) => x.trim()).filter(Boolean))} aria-label="Arguments" />
        </>
      )
    }
    case 'workspace': {
      const ws = s.ws ?? { apps: [], links: [], files: [] }
      const w = (k: string, v: unknown) => f('ws', { ...ws, [k]: v })
      const lines = (x: string) => x.split(/[\n,]+/).map((y) => y.trim()).filter(Boolean)
      return (
        <div className="au-col">
          <input className="ai-input" value={(ws.apps ?? []).join(', ')} placeholder="Apps: Code, Spotify, Obsidian" onChange={(e) => w('apps', lines(e.target.value))} aria-label="Apps" />
          <textarea className="ai-input" rows={2} value={(ws.links ?? []).join('\n')} placeholder="https links, one per line" onChange={(e) => w('links', lines(e.target.value))} aria-label="Links" />
          <textarea className="ai-input" rows={2} value={(ws.files ?? []).join('\n')} placeholder="Files (full paths), one per line" onChange={(e) => w('files', lines(e.target.value))} aria-label="Files" />
          <input className="ai-input" value={ws.folder ?? ''} placeholder="A folder (full path)" onChange={(e) => w('folder', e.target.value)} aria-label="Folder" />
          <label className="hint small au-check">
            <input type="checkbox" checked={!!ws.focus} onChange={(e) => w('focus', e.target.checked ? { subject: 'Focus', minutes: 50 } : undefined)} /> Start a 50 min focus too
          </label>
        </div>
      )
    }
    case 'powertoys':
      return (
        <Select className="ai-input" value={s.feature ?? 'run'} onChange={(e) => f('feature', e.target.value)} aria-label="PowerToys feature">
          {Object.entries(POWERTOYS_FEATURES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      )
    case 'espanso':
      return (
        <Select className="ai-input" value={s.cmd ?? 'search'} onChange={(e) => f('cmd', e.target.value)} aria-label="Espanso">
          <option value="search">Open its search</option>
          <option value="toggle">Switch it on / off</option>
        </Select>
      )
  }
}

function Editor({ start, hooks, scripts, hint, onSave, onCancel }: { start: Automation; hooks: { value: string; label: string; preset: string }[]; scripts: ScriptFile[]; hint: (id: string) => string; onSave: (a: Automation) => void; onCancel: () => void }) {
  const [d, setD] = useState<any>(() => JSON.parse(JSON.stringify(start)))
  const [test, setTest] = useState<string[] | null>(null)
  const clean = useMemo(() => cleanAutomation(d), [d])
  const dropped = (d.steps?.length ?? 0) - (clean?.steps.length ?? 0) + ((d.when?.length ?? 0) - (clean?.when.length ?? 0))
  const set = (k: string, v: unknown) => setD((x: any) => ({ ...x, [k]: v }))
  const values = useMemo(() => (clean ? mapParams(clean.params, Object.fromEntries(clean.params.map((p) => [p.key, p.def ?? (p.type === 'number' ? 1 : p.type === 'bool' ? true : p.type === 'choice' ? p.choices?.[0] : `(${p.label})`)]))).values : {}), [clean])
  return (
    <div className="au-editor">
      <div className="au-sentence">
        <span className="au-word">When</span>
        {(d.when ?? []).map((t: any, i: number) => (
          <span key={i} className="au-chip">
            {cleanTrigger(t) ? triggerText(cleanTrigger(t)!) : TRIGGER_LABEL[t.on as TriggerOn]}
            <button type="button" aria-label="Remove" onClick={() => set('when', d.when.filter((_: unknown, j: number) => j !== i))}>
              ✕
            </button>
          </span>
        ))}
        {(d.when?.length ?? 0) < 3 && (
          <Select className="au-add" value="" onChange={(e) => e.target.value && set('when', [...(d.when ?? []), { on: e.target.value }])} aria-label="Add a trigger">
            <option value="">{d.when?.length ? '＋ or…' : '＋ something happens (or only a tap)'}</option>
            {TRIGGER_ONS.map((o) => (
              <option key={o} value={o}>
                {TRIGGER_LABEL[o]}
              </option>
            ))}
          </Select>
        )}
        <span className="au-word">do</span>
        {(d.steps ?? []).map((s: any, i: number) => (
          <span key={i} className="au-chip do">
            {STEP_ICON[s.do as StepKind]} {cleanStep(s) ? stepText(cleanStep(s)!, hint) : STEP_LABEL[s.do as StepKind]}
            <button type="button" aria-label="Remove" onClick={() => set('steps', d.steps.filter((_: unknown, j: number) => j !== i))}>
              ✕
            </button>
          </span>
        ))}
        {(d.steps?.length ?? 0) < 5 && (
          <Select className="au-add" value="" onChange={(e) => e.target.value && set('steps', [...(d.steps ?? []), { do: e.target.value, ...(e.target.value === 'safe' ? { act: { do: 'focusPack' } } : {}) }])} aria-label="Add a step">
            <option value="">{d.steps?.length ? '＋ then…' : '＋ an action'}</option>
            {STEP_KINDS.map((k) => (
              <option key={k} value={k}>
                {STEP_LABEL[k]}
              </option>
            ))}
          </Select>
        )}
      </div>
      <p className="au-summary">{clean ? sentence(clean, hint) : 'Add at least one action.'}</p>
      {dropped > 0 && <p className="hint small warn-text">Finish the parts in red: an unfinished part is left out when you save.</p>}
      {(d.when ?? []).map((t: any, i: number) => (
        <Row key={`t${i}`} title={TRIGGER_LABEL[t.on as TriggerOn]}>
          <div className={`au-fields ${cleanTrigger(t) ? '' : 'bad'}`}>
            <TriggerFields t={t} set={(nt) => set('when', d.when.map((x: unknown, j: number) => (j === i ? nt : x)))} />
          </div>
        </Row>
      ))}
      {(d.steps ?? []).map((s: any, i: number) => (
        <Row key={`s${i}`} title={`${i + 1}. ${STEP_LABEL[s.do as StepKind]}`} hint={i > 0 ? 'Use {{result.text}} or {{result.url}} from the step before. If a step fails, the rest stop.' : undefined}>
          <div className={`au-fields ${cleanStep(s) ? '' : 'bad'}`}>
            <StepFields s={s} set={(ns) => set('steps', d.steps.map((x: unknown, j: number) => (j === i ? ns : x)))} hooks={hooks} scripts={scripts} />
          </div>
        </Row>
      ))}
      <Row title="Name and icon">
        <div className="au-fields">
          <input className="ai-input au-icon" value={d.icon ?? ''} maxLength={4} onChange={(e) => set('icon', e.target.value)} aria-label="Icon" />
          <input className="ai-input" value={d.name ?? ''} maxLength={40} onChange={(e) => set('name', e.target.value)} aria-label="Name" />
        </div>
      </Row>
      <Row title="Small form before a run" hint="Up to 3 things the island asks before it runs (it remembers your last answers). “Selected text” and “Clipboard” are read from the PC. Use them as {{name}}.">
        <div className="au-col">
          {(d.params ?? []).map((p: Param, i: number) => (
            <div key={i} className="au-fields">
              <input className="ai-input au-small" value={p.key} maxLength={24} onChange={(e) => set('params', d.params.map((x: Param, j: number) => (j === i ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') } : x)))} aria-label="Name in the template" />
              <input className="ai-input au-small" value={p.label} maxLength={40} onChange={(e) => set('params', d.params.map((x: Param, j: number) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Label" />
              <Select className="ai-input au-small" value={p.type} onChange={(e) => set('params', d.params.map((x: Param, j: number) => (j === i ? { ...x, type: e.target.value } : x)))} aria-label="Type">
                {PARAM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PARAM_LABEL[t]}
                  </option>
                ))}
              </Select>
              {p.type === 'choice' && <input className="ai-input au-small" value={(p.choices ?? []).join(', ')} placeholder="a, b, c" onChange={(e) => set('params', d.params.map((x: Param, j: number) => (j === i ? { ...x, choices: e.target.value.split(',').map((c) => c.trim()) } : x)))} aria-label="Choices" />}
              <button type="button" className="btn small ghost" onClick={() => set('params', d.params.filter((_: unknown, j: number) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          {(d.params?.length ?? 0) < 4 && (
            <button type="button" className="btn small ghost" onClick={() => set('params', [...(d.params ?? []), { key: `p${(d.params?.length ?? 0) + 1}`, label: 'Topic', type: 'text' }])}>
              ＋ Ask for something
            </button>
          )}
        </div>
      </Row>
      <Row title="Before it runs" hint="Scripts always ask; typing and workspaces ask when a trigger or Ben starts them.">
        <Segmented label="Before it runs" value={d.risk as Risk} options={(['safe', 'ask', 'confirm'] as Risk[]).map((r) => [r, RISK_LABEL[r]])} onChange={(r) => set('risk', r)} />
      </Row>
      <Row title="On the island" hint="A one-tap button on the island; favourites come first.">
        <div className="au-fields">
          <Switch label="Island button" on={!!d.pin} onChange={(v) => set('pin', v)} />
          <label className="hint small au-check">
            <input type="checkbox" checked={!!d.fav} onChange={(e) => set('fav', e.target.checked)} /> Favourite
          </label>
        </div>
      </Row>
      <Row title="Ben may run it" hint="Ben can run it when you ask him, with the same rules: if it should ask, the island asks you first.">
        <Switch label="Ben may run it" on={!!d.ben} onChange={(v) => set('ben', v)} />
      </Row>
      {test && (
        <ul className="au-test">
          {test.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="row">
        <button type="button" className="btn primary" disabled={!clean} onClick={() => clean && onSave(clean)}>
          Save
        </button>
        <button type="button" className="btn small ghost" disabled={!clean} onClick={() => clean && setTest(['Test now (nothing is sent, nothing runs):', ...dryRun(clean, values, { hint, trigger: { file: 'example.pdf', clip: 'copied text', app: 'Code', wifi: 'Home', event: 'Lecture' } })])}>
          Test now
        </button>
        <button type="button" className="btn small ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the panel

export function AutomationsPanel() {
  const act = useAction()
  const desk = window.desktop
  const [store, setStore] = useState<AutomationStore | null>(null)
  const [cloud, setCloud] = useState<Secrets | null>(null)
  const [local, setLocal] = useState<Local | null>(null)
  const [scripts, setScripts] = useState<ScriptFile[]>([])
  const [editing, setEditing] = useState<Automation | null>(null)
  const [hookForm, setHookForm] = useState({ where: 'cloud' as 'cloud' | 'local', preset: 'n8n' as PresetId, label: '', url: '', token: '', header: '' })
  const [n8n, setN8n] = useState({ where: 'cloud' as 'cloud' | 'local', base: '', key: '' })
  const [flows, setFlows] = useState<{ where: 'cloud' | 'local'; list: N8nWorkflow[] } | null>(null)
  const [preview, setPreview] = useState<{ file: string; text: string; sha?: string } | null>(null)
  const [log, setLog] = useState(runLog())
  const [err, setErr] = useState<string | null>(null)

  const loadScripts = useCallback(() => {
    if (desk?.auto) void deskAuto('scripts').then((r) => setScripts(r?.files ?? []), () => {})
  }, [desk])
  useEffect(() => {
    void loadStore(true).then(setStore)
    flowsCall({ action: 'get' }).then(setCloud, (e) => setErr((e as Error).message))
    if (desk?.auto) void deskAuto('view').then(setLocal, () => {})
    loadScripts()
  }, [desk, loadScripts])

  const hookOptions = useMemo(
    () => [
      ...(cloud?.hooks ?? []).map((h) => ({ value: `cloud:${h.id}`, label: `${h.label || h.host} (${PRESETS[h.preset as PresetId]?.label ?? 'webhook'} ${h.hint})`, preset: h.preset })),
      ...(local?.hooks ?? []).map((h) => ({ value: `local:${h.id}`, label: `${h.label || h.host} (on this PC, ${h.hint})`, preset: h.preset }))
    ],
    [cloud, local]
  )
  const hint = useCallback((id: string) => {
    const h = cloud?.hooks.find((x) => x.id === id) ?? local?.hooks.find((x) => x.id === id)
    return h ? `${h.label || h.host} ${h.hint}` : ''
  }, [cloud, local])

  // One "Saved" note in the panel's own flow (never a pile of toasts over the page): a new one replaces the last.
  const [note, setNote] = useState<string | null>(null)
  const noteTimer = useRef<number | null>(null)
  const flash = (text: string) => {
    if (noteTimer.current) clearTimeout(noteTimer.current)
    setNote(text)
    noteTimer.current = window.setTimeout(() => setNote(null), 2500)
  }
  useEffect(() => () => void (noteTimer.current && clearTimeout(noteTimer.current)), [])
  const save = async (next: AutomationStore, ok?: string) => {
    const r = await act(() => saveStore(next))
    if (r) {
      setStore(r)
      if (ok) flash(ok)
    }
    return r
  }
  const upsert = async (a: Automation) => store ? save({ ...store, list: store.list.some((x) => x.id === a.id) ? store.list.map((x) => (x.id === a.id ? a : x)) : [...store.list, a] }, 'Saved') : undefined
  const blank = (over: Partial<Automation> = {}): Automation => ({ id: newAutoId(), name: '', icon: '', on: true, steps: [], params: [], risk: 'ask', when: [], pin: true, fav: false, ben: false, ranOnce: false, ...over }) as Automation

  const addHook = async () => {
    const body = { url: hookForm.url, token: hookForm.token || undefined, header: hookForm.header || undefined, preset: hookForm.preset, label: hookForm.label }
    const r = await act(() => (hookForm.where === 'cloud' ? flowsCall({ action: 'hookSet', ...body }) : deskAuto('hookSet', { ...body, key: hookForm.token })), 'Saved: the address is kept safe, this page only sees its end')
    if (!r) return
    hookForm.where === 'cloud' ? setCloud(r) : setLocal({ ...local!, ...r })
    if (r.warning) setErr(r.warning)
    setHookForm({ ...hookForm, label: '', url: '', token: '', header: '' })
    // Straight into a new island button that runs it.
    setEditing(blank({ name: hookForm.label || PRESETS[hookForm.preset].label, steps: [{ do: 'webhook', hook: r.id, where: hookForm.where, preset: hookForm.preset }], risk: 'safe' }))
  }
  const n8nCall = (where: 'cloud' | 'local', body: any) => (where === 'cloud' ? flowsCall(body) : deskAuto(body.action, body))
  const connectN8n = async () => {
    const r = await act(() => n8nCall(n8n.where, { action: 'n8nSet', base: n8n.base, key: n8n.key }), 'Connected to n8n')
    if (!r) return
    n8n.where === 'cloud' ? setCloud(r) : setLocal({ ...local!, ...r })
    setFlows({ where: n8n.where, list: r.workflows ?? [] })
    setN8n({ ...n8n, key: '' })
  }
  const useFlow = async (where: 'cloud' | 'local', w: N8nWorkflow) => {
    const r = await act(() => n8nCall(where, { action: 'n8nUse', path: w.hooks[0].path, label: w.name }))
    if (!r) return
    where === 'cloud' ? setCloud(r) : setLocal({ ...local!, ...r })
    setEditing(blank({ name: w.name.slice(0, 40), icon: '⚡', steps: [{ do: 'webhook', hook: r.id, where, preset: 'n8n' }], risk: 'safe' }))
  }
  const moveRecipes = async () => {
    if (!store) return
    const recipes = (await life.recipes?.list().catch(() => [])) ?? []
    const add = recipes.map(fromRecipe).filter((a): a is Automation => !!a && !store.list.some((x) => x.id === a.id))
    if (!add.length) return setErr('No recipes to move (or they are here already)')
    await save({ ...store, list: [...store.list, ...add] }, `${add.length} recipe${add.length > 1 ? 's' : ''} copied here; switch the old ones off in Smart island`)
  }

  if (!store) return <p className="hint small">Loading…</p>
  return (
    <>
      <section className="panel">
        <header className="panel-head au-head">
          <h2>
            <Icon name="bolt" /> Automations
          </h2>
          <span className={`au-saved ${note ? 'on' : ''}`} role="status" aria-live="polite">
            {note ? `✓ ${note}` : ''}
          </span>
        </header>
        <p className="hint block">“When X, do Y”, or a one-tap button on the island. Flows in n8n, Make, Pipedream, Activepieces or Node-RED, your own scripts, a workspace, a message to you. Nothing runs from a trigger more than once in 30 seconds.</p>
        <Row title="Pause all automations" hint="Triggers and Ben stop; your island taps still work.">
          <Switch label="Pause all automations" on={store.paused} onChange={(v) => void save({ ...store, paused: v }, v ? 'All automations paused' : 'Automations on again')} />
        </Row>
        {err && (
          <p className="hint small warn-text" role="status">
            {err}
          </p>
        )}
        {editing ? (
          <Editor start={editing} hooks={hookOptions} scripts={scripts} hint={hint} onCancel={() => setEditing(null)} onSave={(a) => void upsert(a).then((r) => r && setEditing(null))} />
        ) : (
          <>
            <ul className="ai-list au-list">
              {store.list.map((a) => (
                <li key={a.id}>
                  <span className="ai-name">
                    {a.icon} <b>{a.name}</b>
                    {a.byBen && <small> · Ben's idea</small>}
                    <small>{sentence(a, hint)}</small>
                  </span>
                  <div className="row">
                    {a.when.length > 0 && <Switch label={`Triggers of ${a.name}`} on={a.on} onChange={(v) => void upsert({ ...a, on: v })} />}
                    <button type="button" className={`btn small ghost ${a.pin ? 'on' : ''}`} title="Island button" onClick={() => void upsert({ ...a, pin: !a.pin })}>
                      {a.pin ? '📌 On the island' : 'Pin'}
                    </button>
                    <button type="button" className="btn small ghost" title="Favourite" onClick={() => void upsert({ ...a, fav: !a.fav })}>
                      {a.fav ? '★' : '☆'}
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => void act(() => startRun(a, {}, 'tap'), (s) => String(s))}>
                      Run
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setEditing(a)}>
                      Edit
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => void save({ ...store, list: store.list.filter((x) => x.id !== a.id) }, 'Removed')}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {!store.list.length && <p className="hint small">No automations yet. Start from a template, or connect a flow below.</p>}
            <div className="row">
              <button type="button" className="btn primary" onClick={() => setEditing(blank())}>
                ＋ New automation
              </button>
              <Select className="ai-input au-small" value="" onChange={(e) => {
                const t = AUTOMATION_TEMPLATES[Number(e.target.value)]
                if (t) setEditing(blank({ pin: false, ...t.make() }))
              }} aria-label="Start from a template">
                <option value="">From a template…</option>
                {AUTOMATION_TEMPLATES.map((t, i) => (
                  <option key={t.label} value={i}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <button type="button" className="btn small ghost" onClick={() => void moveRecipes()}>
                Copy my Smart island recipes here
              </button>
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="link" /> Your flows (webhooks)
          </h2>
        </header>
        <p className="hint block">Paste a flow's webhook address once. Cloud addresses are kept on the server; ones on your own PC or network (a local n8n or Node-RED) are kept on this PC, locked to your Windows account. This page only sees the last 4 characters.</p>
        <ul className="ai-list">
          {(cloud?.hooks ?? []).map((h) => (
            <li key={h.id}>
              <span className="ai-name">
                ☁️ {h.label || h.host} <small>{PRESETS[h.preset as PresetId]?.label} · {h.host} {h.hint}{h.hasToken ? ' · key saved' : ''}</small>
              </span>
              <button type="button" className="btn small ghost" onClick={() => void act(() => flowsCall({ action: 'hookRemove', id: h.id }), 'Removed').then((r) => r && setCloud(r))}>
                Remove
              </button>
            </li>
          ))}
          {(local?.hooks ?? []).map((h) => (
            <li key={h.id}>
              <span className="ai-name">
                🖥 {h.label || h.host} <small>On this PC · {h.host} {h.hint}{h.hasToken ? ' · key saved' : ''}</small>
              </span>
              <button type="button" className="btn small ghost" onClick={() => void act(() => deskAuto('hookRemove', { id: h.id }), 'Removed').then((r) => r && setLocal({ ...local!, ...r }))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <Row title="Service" hint={PRESETS[hookForm.preset].how}>
          <Select className="ai-input" value={hookForm.preset} onChange={(e) => setHookForm({ ...hookForm, preset: e.target.value as PresetId, where: PRESETS[e.target.value as PresetId].local && hookForm.where === 'local' ? 'local' : hookForm.where })} aria-label="Service">
            {PRESET_IDS.map((p) => (
              <option key={p} value={p}>
                {PRESETS[p].label}
                {PRESETS[p].paid ? ' (needs a paid plan)' : ''}
              </option>
            ))}
          </Select>
        </Row>
        {desk?.auto && (
          <Row title="Where it runs">
            <Segmented label="Where it runs" value={hookForm.where} options={[['cloud', 'On the internet'], ['local', 'On this PC / my network']]} onChange={(w) => setHookForm({ ...hookForm, where: w })} />
          </Row>
        )}
        <Row title="Name">
          <input className="ai-input" value={hookForm.label} maxLength={40} placeholder="Daily report" onChange={(e) => setHookForm({ ...hookForm, label: e.target.value })} aria-label="Webhook name" />
        </Row>
        <Row title="Address" hint={hookForm.url && hookForm.where === 'cloud' ? presetWarning(hookForm.preset, hookForm.url) ?? undefined : undefined}>
          <input className="ai-input" value={hookForm.url} maxLength={500} placeholder={hookForm.where === 'local' ? 'http://localhost:5678/webhook/report' : PRESETS[hookForm.preset].example} onChange={(e) => setHookForm({ ...hookForm, url: e.target.value.trim() })} aria-label="Webhook address" />
        </Row>
        <Row title="Key (optional)" hint="Sent as “Authorization: Bearer …” (or the header you name, like n8n's Header Auth). Never shown again.">
          <div className="au-fields">
            <input className="ai-input" type="password" autoComplete="off" value={hookForm.token} maxLength={2000} onChange={(e) => setHookForm({ ...hookForm, token: e.target.value.trim() })} aria-label="Webhook key" />
            {hookForm.where === 'cloud' && <input className="ai-input au-small" value={hookForm.header} maxLength={40} placeholder="Header name" onChange={(e) => setHookForm({ ...hookForm, header: e.target.value.trim() })} aria-label="Header name" />}
          </div>
        </Row>
        <div className="row">
          <button type="button" className="btn primary" disabled={!hookForm.url} onClick={() => void addHook()}>
            Save and make a button
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="spark" /> Connect my n8n
          </h2>
        </header>
        <p className="hint block">Your n8n's address and an API key (n8n → Settings → n8n API). See your workflows, switch them on or off, and make any with a Webhook node into an island button. Failed runs of a cloud n8n reach you on Telegram and ntfy, once each.</p>
        {cloud?.n8n.on && (
          <p className="hint small">
            ☁️ Connected: {cloud.n8n.host} (key {cloud.n8n.keyHint}){' '}
            <button type="button" className="btn small ghost" onClick={() => void act(() => flowsCall({ action: 'n8nList' })).then((r) => r && setFlows({ where: 'cloud', list: r.workflows }))}>
              Workflows
            </button>
            <button type="button" className="btn small ghost" onClick={() => void act(() => flowsCall({ action: 'n8nSet', off: true }), 'Disconnected').then((r) => r && setCloud(r))}>
              Disconnect
            </button>
          </p>
        )}
        {local?.n8n.on && (
          <p className="hint small">
            🖥 On this PC: {local.n8n.host} (key {local.n8n.keyHint}){' '}
            <button type="button" className="btn small ghost" onClick={() => void act(() => deskAuto('n8nList')).then((r) => r && setFlows({ where: 'local', list: r.workflows }))}>
              Workflows
            </button>
            <button type="button" className="btn small ghost" onClick={() => void act(() => deskAuto('n8nSet', { off: true }), 'Disconnected').then((r) => r && setLocal({ ...local, ...r }))}>
              Disconnect
            </button>
          </p>
        )}
        {desk?.auto && (
          <Row title="Where it runs">
            <Segmented label="Where n8n runs" value={n8n.where} options={[['cloud', 'On the internet'], ['local', 'On this PC / my network']]} onChange={(w) => setN8n({ ...n8n, where: w })} />
          </Row>
        )}
        <Row title="Address">
          <input className="ai-input" value={n8n.base} maxLength={300} placeholder={n8n.where === 'local' ? 'http://localhost:5678' : 'https://n8n.example.com'} onChange={(e) => setN8n({ ...n8n, base: e.target.value.trim() })} aria-label="n8n address" />
        </Row>
        <Row title="API key">
          <input className="ai-input" type="password" autoComplete="off" value={n8n.key} maxLength={2000} onChange={(e) => setN8n({ ...n8n, key: e.target.value.trim() })} aria-label="n8n API key" />
        </Row>
        <div className="row">
          <button type="button" className="btn primary" disabled={!n8n.base} onClick={() => void connectN8n()}>
            Connect
          </button>
        </div>
        {flows && (
          <ul className="ai-list">
            {flows.list.map((w) => (
              <li key={w.id}>
                <span className="ai-name">
                  {w.name} <small>{w.hooks.length ? `Webhook: /${w.hooks[0].path}` : 'No Webhook node'}</small>
                </span>
                <div className="row">
                  <Switch label={`${w.name} on`} on={w.active} onChange={(v) => void act(() => n8nCall(flows.where, { action: 'n8nActivate', id: w.id, on: v }), v ? 'Switched on' : 'Switched off').then((r) => r && setFlows({ ...flows, list: r.workflows }))} />
                  {w.hooks.length > 0 && (
                    <button type="button" className="btn small ghost" onClick={() => void useFlow(flows.where, w)}>
                      Make a button
                    </button>
                  )}
                </div>
              </li>
            ))}
            {!flows.list.length && <li className="hint small">No workflows.</li>}
          </ul>
        )}
      </section>

      {desk?.auto && local && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="list" /> My scripts and tools
            </h2>
          </header>
          <p className="hint block">Only .ps1, .bat, .py (and .ahk with AutoHotkey) right inside ONE folder you choose. Each file is allowed after you see the exact command; if the file changes, it asks again. Every run asks first, stops after 60 s and shows up to 4 KB of what it printed.</p>
          {!local.windows && <p className="hint small">Scripts and tools work on Windows only.</p>}
          <Row title="Scripts folder" hint={local.folder ?? 'Not chosen'}>
            <button type="button" className="btn small ghost" onClick={() => void act(() => deskAuto('scriptsFolder')).then((r) => r && (setLocal({ ...local, ...r }), loadScripts()))}>
              Choose…
            </button>
          </Row>
          <ul className="ai-list">
            {scripts.map((f) => (
              <li key={f.file}>
                <span className="ai-name">
                  📜 {f.name} <small>{f.pin === 'pinned' ? 'Allowed' : f.pin === 'changed' ? '⚠ Changed since you allowed it' : 'Not allowed yet'}</small>
                </span>
                <div className="row">
                  <button type="button" className="btn small ghost" onClick={() => void act(() => deskAuto('scriptPreview', { file: f.file, args: [] })).then((r) => r && setPreview({ file: f.file, text: r.problem ? `⚠ ${r.problem}` : r.preview, sha: r.hash }))}>
                    Look
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => setEditing(blank({ name: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 40), steps: [{ do: f.ext === '.ahk' ? 'ahk' : 'script', file: f.file, args: [] } as Step], risk: 'confirm' }))}>
                    Make a button
                  </button>
                  {f.pin !== 'new' && (
                    <button type="button" className="btn small ghost" onClick={() => void act(() => deskAuto('scriptUnpin', { file: f.file }), 'It will ask again').then(loadScripts)}>
                      Forget
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {preview && (
            <div className="au-preview">
              <p className="hint small">Dry run: this exact command would run (nothing has run):</p>
              <code>{preview.text}</code>
              <div className="row">
                {preview.sha && (
                  <button type="button" className="btn small primary" onClick={() => void act(() => deskAuto('scriptPin', { file: preview.file, sha: preview.sha }), 'Allowed (this exact version)').then(() => (setPreview(null), loadScripts()))}>
                    Allow this version
                  </button>
                )}
                <button type="button" className="btn small ghost" onClick={() => setPreview(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
          <Row title="Found on this PC" hint="Never installed by Life System: only used if you have them.">
            <span className="hint small">
              AutoHotkey {local.tools.ahk ? '✅' : '—'} · PowerToys {local.tools.powertoys ? '✅' : '—'} · Espanso {local.tools.espanso ? '✅' : '—'}
            </span>
          </Row>
        </section>
      )}

      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="clock" /> Run log
          </h2>
        </header>
        <p className="hint block">The last runs on this device. Keys, tokens and long codes are removed; selected text is cut short.</p>
        <ul className="ai-list">
          {log.slice(0, 30).map((l) => (
            <li key={l.id}>
              <span className="ai-name">
                {l.ok ? '✅' : '⛔'} {l.name}
                <small>
                  {ago(l.at)} · {l.source} · {l.ms} ms{l.why ? ` · ${l.why}` : l.text ? ` · ${l.text.slice(0, 80)}` : ''}
                  {Object.keys(l.values).length ? ` · ${JSON.stringify(l.values).slice(0, 80)}` : ''}
                </small>
              </span>
            </li>
          ))}
          {!log.length && <li className="hint small">Nothing has run yet.</li>}
        </ul>
        {log.length > 0 && (
          <div className="row">
            <button type="button" className="btn small ghost" onClick={() => (clearRunLog(), setLog([]))}>
              Clear the log
            </button>
          </div>
        )}
      </section>
    </>
  )
}
