// Settings → Ben on this PC → Smart island: your recipes (SI7). When / If /
// Then from dropdowns, starter templates, on/off per recipe. Safe actions
// only (src/core/recipes.ts); they run in the desktop app. Plus the
// suggestions learning stopped, to turn back on (SI6).
import { useEffect, useState } from 'react'
import { CONTEXT_KINDS, CONTEXT_LABEL, type ContextKind } from '@core/activityContext'
import { cleanRecipe, RECIPE_ON, RECIPE_ON_LABEL, RECIPE_TEMPLATES, recipeText, SAFE_LABEL, SAFE_PAGES, type Recipe, type RecipeOn, type SafeAction } from '@core/recipes'
import { SUGGEST_LABEL, type SuggestKind } from '@core/suggest'
import { life } from './bridge'
import { pausedSuggestions, resumeSuggestion, setRecipes } from './smartIsland'
import { useAction } from './ui'

const ACTS: SafeAction['do'][] = ['focus', 'focusPack', 'blockSites', 'dnd', 'quiet', 'stopFocus', 'note', 'task', 'open', 'windDown', 'offerNote']
const DAYS: { label: string; days: number[] | undefined }[] = [
  { label: 'Every day', days: undefined },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekends', days: [0, 6] }
]
const blankAct = (d: SafeAction['do']): SafeAction =>
  d === 'focus' ? { do: 'focus', subject: 'Focus', minutes: 50 } : d === 'quiet' ? { do: 'quiet', minutes: 60 } : d === 'note' ? { do: 'note', text: 'Meeting notes' } : d === 'task' ? { do: 'task', text: 'Follow up' } : d === 'open' ? { do: 'open', page: 'today' } : ({ do: d } as SafeAction)

export function SmartLearned() {
  const [list, setList] = useState<string[]>(pausedSuggestions)
  if (!list.length) return null
  return (
    <p className="hint small">
      Stopped suggestions:{' '}
      {list.map((k) => (
        <button key={k} className="btn small ghost" onClick={() => (resumeSuggestion(k), setList(pausedSuggestions()))}>
          ↺ {SUGGEST_LABEL[k as SuggestKind] ?? k}
        </button>
      ))}
    </p>
  )
}

export function IslandRecipesPanel() {
  const act = useAction()
  const [list, setList] = useState<Recipe[] | null>(null)
  const [edit, setEdit] = useState<Recipe | null>(null)
  useEffect(() => {
    life.recipes?.list().then(setList, () => setList([]))
  }, [])
  if (!life.recipes) return null
  if (!list) return <p className="hint small">Loading recipes…</p>
  const save = async (next: Recipe[]) => {
    const saved = await life.recipes!.save(next)
    setList(saved)
    setRecipes(saved)
  }
  const put = (r: Recipe) => {
    const c = cleanRecipe(r)
    if (!c) return void act(async () => null, 'That recipe needs a when and at least one action')
    void save(list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c])
    setEdit(null)
  }
  return (
    <div className="pc-recipes">
      <h4 className="pc-h">Recipes</h4>
      {list.length === 0 && <p className="hint small">No recipes yet. Start from one below.</p>}
      <ul className="bk-list">
        {list.map((r) => (
          <li key={r.id}>
            <span>
              <b>{r.name}</b>
              {r.byBen ? ' · from Ben' : ''}
            </span>
            <small>{recipeText(r)}</small>
            <span className="row">
              <button className={`btn small ${r.on ? '' : 'ghost'}`} onClick={() => void save(list.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)))}>
                {r.on ? 'On' : 'Off'}
              </button>
              <button className="btn small ghost" onClick={() => setEdit(r)}>
                Edit
              </button>
              <button className="btn small ghost" onClick={() => void save(list.filter((x) => x.id !== r.id))}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="row">
        <select
          value=""
          aria-label="Add from a template"
          onChange={(e) => {
            const t = RECIPE_TEMPLATES.find((x) => x.id === e.target.value)
            if (t) setEdit({ ...t, id: `r${Date.now().toString(36)}`, on: true })
          }}
        >
          <option value="">＋ Add from a template…</option>
          {RECIPE_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn small ghost" onClick={() => setEdit({ id: `r${Date.now().toString(36)}`, name: 'My recipe', on: true, when: { on: 'context', ctx: 'coding' }, then: [blankAct('focus')], confirmFirst: false, ranOnce: false })}>
          ＋ New
        </button>
      </div>
      {edit && <RecipeEditor r={edit} onSave={put} onCancel={() => setEdit(null)} />}
    </div>
  )
}

function RecipeEditor({ r, onSave, onCancel }: { r: Recipe; onSave: (r: Recipe) => void; onCancel: () => void }) {
  const [x, setX] = useState<Recipe>(r)
  const days = DAYS.findIndex((d) => (d.days ?? []).join() === (x.if?.days ?? []).join())
  const setIf = (patch: Partial<NonNullable<Recipe['if']>>) => setX({ ...x, if: { ...(x.if ?? {}), ...patch } })
  const setAct = (i: number, a: SafeAction) => setX({ ...x, then: x.then.map((y, j) => (j === i ? a : y)) })
  return (
    <div className="pc-recipe-edit">
      <label className="pc-list">
        <span>Name</span>
        <input value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} />
      </label>
      <label className="pc-list">
        <span>When</span>
        <select value={x.when.on} onChange={(e) => setX({ ...x, when: { on: e.target.value as RecipeOn, ...(e.target.value === 'context' ? { ctx: 'coding' as ContextKind } : e.target.value === 'time' ? { at: '22:30' } : {}) } })}>
          {RECIPE_ON.map((o) => (
            <option key={o} value={o}>
              {RECIPE_ON_LABEL[o]}
            </option>
          ))}
        </select>
        {x.when.on === 'context' && (
          <select value={x.when.ctx} onChange={(e) => setX({ ...x, when: { on: 'context', ctx: e.target.value as ContextKind } })}>
            {CONTEXT_KINDS.filter((k) => k !== 'idle').map((k) => (
              <option key={k} value={k}>
                {CONTEXT_LABEL[k].toLowerCase()}
              </option>
            ))}
          </select>
        )}
        {x.when.on === 'time' && <input type="time" value={x.when.at} onChange={(e) => setX({ ...x, when: { on: 'time', at: e.target.value } })} />}
      </label>
      <label className="pc-list">
        <span>If</span>
        <select value={Math.max(0, days)} onChange={(e) => setIf({ days: DAYS[Number(e.target.value)].days })}>
          {DAYS.map((d, i) => (
            <option key={d.label} value={i}>
              {d.label}
            </option>
          ))}
        </select>
        <input type="time" aria-label="From" value={x.if?.from ?? ''} onChange={(e) => setIf({ from: e.target.value || undefined, to: x.if?.to ?? (e.target.value ? '23:59' : undefined) })} />
        <input type="time" aria-label="To" value={x.if?.to ?? ''} onChange={(e) => setIf({ to: e.target.value || undefined })} />
        <label>
          <input type="checkbox" checked={!!x.if?.noTimer} onChange={(e) => setIf({ noTimer: e.target.checked || undefined })} /> no timer running
        </label>
      </label>
      {x.then.map((a, i) => (
        <label key={i} className="pc-list">
          <span>{i ? 'And' : 'Then'}</span>
          <select value={a.do} onChange={(e) => setAct(i, blankAct(e.target.value as SafeAction['do']))}>
            {ACTS.map((d) => (
              <option key={d} value={d}>
                {SAFE_LABEL[d]}
              </option>
            ))}
          </select>
          {a.do === 'focus' && (
            <>
              <input value={a.subject} aria-label="Subject" onChange={(e) => setAct(i, { ...a, subject: e.target.value })} />
              <input type="number" min={5} max={180} value={a.minutes} aria-label="Minutes" onChange={(e) => setAct(i, { ...a, minutes: Number(e.target.value) })} />
            </>
          )}
          {a.do === 'quiet' && <input type="number" min={5} max={240} value={a.minutes} aria-label="Minutes" onChange={(e) => setAct(i, { ...a, minutes: Number(e.target.value) })} />}
          {(a.do === 'note' || a.do === 'task') && <input value={a.text} aria-label="Text" onChange={(e) => setAct(i, { ...a, text: e.target.value })} />}
          {a.do === 'open' && (
            <select value={a.page} onChange={(e) => setAct(i, { do: 'open', page: e.target.value as (typeof SAFE_PAGES)[number] })}>
              {SAFE_PAGES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <button className="btn small ghost" onClick={() => setX({ ...x, then: x.then.filter((_, j) => j !== i) })} aria-label="Remove">
            ✕
          </button>
        </label>
      ))}
      <div className="row">
        {x.then.length < 5 && (
          <button className="btn small ghost" onClick={() => setX({ ...x, then: [...x.then, blankAct('quiet')] })}>
            ＋ Action
          </button>
        )}
        <label>
          <input type="checkbox" checked={x.confirmFirst} onChange={(e) => setX({ ...x, confirmFirst: e.target.checked })} /> ask me every time
        </label>
      </div>
      <p className="hint small">{recipeText(x)}</p>
      <div className="row">
        <button className="btn small" onClick={() => onSave(x)}>
          Save
        </button>
        <button className="btn small ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
