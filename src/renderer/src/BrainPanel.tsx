// Ben's brain: which model he thinks with (any OpenRouter model, searched in
// a dropdown with its price), and what it costs: today, 7 and 30 days, by
// model, the last calls, and what's left on your OpenRouter balance.
import { useEffect, useMemo, useRef, useState } from 'react'
import { currentSession } from './web/session'
import { Icon } from './Icon'
import { useToast } from './ui'

export interface ModelInfo {
  id: string
  name: string
  in: number | null
  out: number | null
  context: number | null
  tools: boolean
  reasoning: boolean
}
interface Status {
  model: string | null
  chosen: { chat: string | null; deep: string | null }
  auto: { chat: string | null; deep: string | null }
  /** Newer models than the pinned ones Ben uses (LT9): shown, never switched to by themselves. */
  newer?: { chat: string | null; deep: string | null }
}
interface Totals {
  calls: number
  cost: number
  tokens: number
}
interface Usage {
  today: Totals | null
  week: Totals | null
  month: Totals | null
  byModel: { model: string; calls: number; cost: number; tokens: number }[]
  /** What the calls were for (B20): chat, lookup, plan, review, nudge… */
  byKind?: { kind: string; calls: number; cost: number }[]
  recent: { at: string; model: string; kind: string | null; prompt: number | null; completion: number | null; cost: number | null }[]
  credits: { total: number; used: number; left: number } | null
  budget?: { budget: number; spent: number; tier: 'normal' | 'save' | 'minimal' }
}

const TIER_TEXT = {
  normal: 'Normal: your models, the strong one for plans and reviews.',
  save: 'Near the limit: Ben uses the cheaper chat model, no thinking model.',
  minimal: 'Used up: Ben is in basic mode in the chat (logs, done, focus and tasks without AI; the rest waits, or ask the AI anyway). Nudges and letters use their fixed text.'
} as const

/** The monthly AI budget: spent so far, the limit, and what Ben does near it. */
function BudgetRow({ b, onSave }: { b: NonNullable<Usage['budget']>; onSave: (usd: number) => void }) {
  const [v, setV] = useState(String(b.budget))
  useEffect(() => setV(String(b.budget)), [b.budget])
  const pct = b.budget > 0 ? Math.min(100, (b.spent / b.budget) * 100) : 0
  return (
    <div className={`brain-budget tier-${b.tier}`}>
      <div className="row">
        <small className="brain-sub">Monthly budget</small>
        <b>
          {usd(b.spent)} of {b.budget > 0 ? usd(b.budget) : 'no limit'}
        </b>
      </div>
      {b.budget > 0 && <i className="brain-budget-bar" style={{ ['--p' as string]: `${pct}%` }} />}
      <p className="hint small">{TIER_TEXT[b.tier]}</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(Number(v))
        }}
      >
        <label className="sr-only" htmlFor="ai-budget">
          Monthly AI budget in USD
        </label>
        <input id="ai-budget" className="input small" type="number" min={0} max={1000} step={1} value={v} onChange={(e) => setV(e.target.value)} style={{ width: 90 }} />
        <span className="hint small">USD a month (0 = no limit)</span>
        <button className="btn small" type="submit" disabled={Number(v) === b.budget}>
          Save
        </button>
      </form>
    </div>
  )
}

const call = async <T,>(body: object): Promise<T> => {
  const r = await fetch('/api/ai', { method: 'POST', headers: { Authorization: `Bearer ${currentSession() ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `AI ${r.status}`)
  return j as T
}

export const usd = (n: number | null | undefined, small = false) =>
  n == null ? '—' : n === 0 ? '$0' : small && n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(small ? 3 : 2)}` : `$${n.toFixed(2)}`
const per1M = (n: number | null) => (n == null ? '?' : n === 0 ? 'free' : `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 0)}`)
const shortId = (id: string | null) => (id ? id.replace(/^[^/]+\//, '') : 'automatic')
const ctx = (n: number | null) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`)

/** The dropdown: search every OpenRouter model, with its price per 1M tokens. */
export function ModelPicker({ value, auto, models, onPick, label }: { value: string | null; auto: string | null; models: ModelInfo[]; onPick: (id: string | null) => void; label: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'tools' | 'cheap' | 'free'>('all')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])
  const cur = models.find((m) => m.id === value)
  const shown = useMemo(() => {
    const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return models
      .filter((m) => (filter === 'tools' ? m.tools : filter === 'cheap' ? (m.in ?? 99) <= 1 && (m.out ?? 99) <= 4 : filter === 'free' ? m.in === 0 && m.out === 0 : true))
      .filter((m) => w.every((x) => `${m.id} ${m.name}`.toLowerCase().includes(x)))
      .slice(0, 120)
  }, [models, q, filter])
  return (
    <div className="mp" ref={box}>
      <small className="mp-label">{label}</small>
      <button className={`mp-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mp-cur">
          <b>{cur?.name ?? (value ? shortId(value) : auto ? `Automatic · ${shortId(auto)}` : 'Automatic')}</b>
          <small>{cur ? `${per1M(cur.in)} in · ${per1M(cur.out)} out per 1M tokens${cur.context ? ` · ${ctx(cur.context)} context` : ''}` : value ? value : 'The app picks one for you'}</small>
        </span>
        <span className="mp-caret">▾</span>
      </button>
      {open && (
        <div className="mp-pop" role="listbox">
          <input autoFocus className="mp-search" placeholder="Search 300+ models: claude, gpt, gemini, deepseek…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mp-filters">
            {(['all', 'tools', 'cheap', 'free'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'tools' ? 'Can use tools' : f === 'cheap' ? 'Cheap' : 'Free'}
              </button>
            ))}
          </div>
          <div className="mp-list">
            <button className={`mp-row ${value == null ? 'on' : ''}`} onClick={() => (onPick(null), setOpen(false))}>
              <span>
                <b>Automatic</b>
                <small>{auto ? `${shortId(auto)} · ` : ''}cheap and fast</small>
              </span>
            </button>
            {shown.map((m) => (
              <button key={m.id} className={`mp-row ${m.id === value ? 'on' : ''}`} onClick={() => (onPick(m.id), setOpen(false))} title={m.id}>
                <span>
                  <b>{m.name}</b>
                  <small>
                    {m.id}
                    {m.context ? ` · ${ctx(m.context)}` : ''}
                    {m.tools ? ' · tools' : ''}
                    {m.reasoning ? ' · thinks' : ''}
                  </small>
                </span>
                <em className={m.in === 0 && m.out === 0 ? 'free' : ''}>
                  {m.in === 0 && m.out === 0 ? 'free' : `${per1M(m.in)} / ${per1M(m.out)}`}
                </em>
              </button>
            ))}
            {!shown.length && <p className="hint mp-none">No model matches “{q}”.</p>}
          </div>
          <small className="mp-foot">Prices per 1M tokens, in / out (OpenRouter). A message to Ben is about 6–10k tokens in.</small>
        </div>
      )}
    </div>
  )
}

interface EvalRun {
  model: string
  passed: number
  total: number
  cost: number | null
  calls: number
  at: string
  results?: { id: string; say: string; want: string; ok: boolean; trace: string; ms: number; error?: string }[]
}
const RUNS = 'ls.benTests'
const readRuns = (): EvalRun[] => {
  try {
    return JSON.parse(localStorage.getItem(RUNS) || '[]')
  } catch {
    return []
  }
}

/** Test Ben: the same 20 messages with any model, on throwaway data; compare runs. */
function TestBen({ models, current }: { models: ModelInfo[]; current: string | null }) {
  const toast = useToast()
  const [pick, setPick] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [runs, setRuns] = useState<EvalRun[]>(readRuns)
  const [open, setOpen] = useState<EvalRun | null>(null)
  const run = async () => {
    setBusy(true)
    try {
      const r = await call<EvalRun>({ op: 'eval', model: pick ?? current ?? undefined })
      const done = { ...r, at: new Date().toISOString() }
      setOpen(done)
      const next = [{ ...done, results: undefined }, ...runs].slice(0, 12)
      setRuns(next)
      try {
        localStorage.setItem(RUNS, JSON.stringify(next))
      } catch {
        /* fine */
      }
      toast(`${shortId(r.model)}: ${r.passed}/${r.total} right · ${usd(r.cost, true)}`, r.passed >= r.total * 0.8 ? 'good' : 'info')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="bt">
      <p className="hint block" title="Log money, book a block, move one, finish a task, remember a person…">20 messages you'd really send, run on made-up data (never yours). Compare models before you pick one.</p>
      <div className="bt-row">
        <ModelPicker label="Model to test" value={pick} auto={current} models={models} onPick={setPick} />
        <button className="btn primary" disabled={busy} onClick={() => void run()}>
          {busy ? 'Testing… (up to a minute)' : '▶ Run test'}
        </button>
      </div>
      {runs.length > 0 && (
        <div className="bt-runs">
          {runs.map((r, i) => (
            <div key={i} className="bt-run">
              <span>{shortId(r.model)}</span>
              <i style={{ ['--p' as string]: `${(r.passed / r.total) * 100}%` }} />
              <b>
                {r.passed}/{r.total}
              </b>
              <em>{usd(r.cost, true)}</em>
            </div>
          ))}
        </div>
      )}
      {open?.results && (
        <ul className="bt-cases">
          {open.results.map((c) => (
            <li key={c.id} className={c.ok ? 'ok' : 'bad'}>
              <details>
                <summary>
                  <span>{c.ok ? '✓' : '✗'}</span> “{c.say}” <small>{c.ok ? '' : `wanted: ${c.want}`}</small>
                </summary>
                <pre>{c.error ? `Error: ${c.error}\n` : ''}{c.trace || '(nothing happened)'}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Plain names for what an AI call was for (B20). */
const KIND_NAME: Record<string, string> = { chat: 'Chat', 'chat-deep': 'Chat (thinking)', lookup: 'Looking things up', retry: 'Fixing a correction', repair: 'Fixing a failed action', media: 'Photos and voice', plan: 'Morning plan', 'plan-names': 'Plan names', review: 'Evening review', weekly: 'Sunday review', letter: 'Weekly letter', 'self-review': "Ben's self-review", story: 'Story so far', nudge: 'Nudges', area: 'Task areas', eval: 'Test Ben', deep: 'Thinking' }

export function BrainPanel() {
  const toast = useToast()
  const [status, setStatus] = useState<Status | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [usage, setUsage] = useState<Usage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = () => {
    call<Status>({ op: 'status' }).then(setStatus).catch((e) => setErr(e.message))
    call<Usage>({ op: 'usage' }).then(setUsage).catch(() => {})
  }
  useEffect(() => {
    load()
    call<{ models: ModelInfo[] }>({ op: 'models' }).then((r) => setModels(r.models)).catch(() => {})
  }, [])
  const save = async (chat: string | null, deep: string | null) => {
    try {
      const r = await call<{ chosen: Status['chosen'] }>({ op: 'setModels', chat, deep })
      setStatus((s) => (s ? { ...s, chosen: r.chosen } : s))
      toast(`Ben now thinks with ${shortId(r.chosen.chat ?? status?.auto.chat ?? null)}${r.chosen.deep && r.chosen.deep !== r.chosen.chat ? `, plans with ${shortId(r.chosen.deep)}` : ''}`, 'good')
      window.dispatchEvent(new CustomEvent('life-brain-changed'))
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const chosen = status?.chosen ?? { chat: null, deep: null }
  // A month at the last 7 days' pace.
  const monthPace = usage?.week ? (usage.week.cost / 7) * 30 : null
  const maxModel = Math.max(0.000001, ...(usage?.byModel ?? []).map((m) => m.cost))
  return (
    <>
    <section className="panel brain">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Ben's brain
        </h2>
        <button className="icon-btn" onClick={load} aria-label="Refresh" title="Refresh">
          <Icon name="refresh" size={15} />
        </button>
      </header>
      {err && <p className="hint block">{err}</p>}
      <p className="hint block">Any model on OpenRouter. A stronger one understands and plans better, and costs more. You see the real cost of every call here.</p>
      <div className="brain-pickers">
        <ModelPicker label="Talks with you (chat, Telegram, nudges)" value={chosen.chat} auto={status?.auto.chat ?? null} models={models} onPick={(id) => void save(id, chosen.deep)} />
        <ModelPicker label="Thinks hard (morning plan, reviews, weekly letter)" value={chosen.deep} auto={chosen.chat ?? status?.auto.deep ?? null} models={models} onPick={(id) => void save(chosen.chat, id)} />
      </div>
      {(status?.newer?.chat || status?.newer?.deep) && (
        <p className="hint block brain-newer">
          A newer model is available{status.newer.chat ? `: ${status.newer.chat} for chat` : ''}
          {status.newer.chat && status.newer.deep ? ',' : ''}
          {status.newer.deep ? ` ${status.newer.chat ? '' : ': '}${status.newer.deep} for hard thinking` : ''}. Ben keeps his current one until you pick it above (try it with "Test Ben" first).
        </p>
      )}


      {usage && !(usage.month?.calls || usage.week?.calls || usage.today?.calls) ? (
        <p className="brain-empty">No AI calls yet. What Ben costs shows up here after his first reply.{usage.credits ? ` OpenRouter balance: ${usd(usage.credits.left)}.` : ''}</p>
      ) : (
      <div className="brain-usage">
        {(
          [
            ['Today', usage?.today],
            ['7 days', usage?.week],
            ['30 days', usage?.month]
          ] as const
        ).map(([l, t]) => (
          <div key={l} className="brain-card">
            <small>{l}</small>
            <b>{usd(t?.cost ?? null)}</b>
            <em>
              {t ? `${t.calls} calls · ${Math.round(t.tokens / 1000)}k tokens` : '—'}
            </em>
          </div>
        ))}
        <div className="brain-card">
          <small>OpenRouter balance</small>
          <b>{usage?.credits ? usd(usage.credits.left) : '—'}</b>
          <em>{monthPace != null ? `≈ ${usd(monthPace)} a month at this pace` : 'no calls yet'}</em>
        </div>
      </div>
      )}

      {usage?.budget && (
        <BudgetRow
          b={usage.budget}
          onSave={(n) =>
            void call<{ budget: NonNullable<Usage['budget']> }>({ op: 'setBudget', usd: n })
              .then((r) => {
                setUsage((u) => (u ? { ...u, budget: r.budget } : u))
                toast(n > 0 ? `Ben's AI budget: ${usd(n)} a month` : 'No AI budget limit', 'good')
              })
              .catch((e) => toast((e as Error).message, 'bad'))
          }
        />
      )}

      {usage && usage.byModel.length > 0 && (
        <div className="brain-models">
          <small className="brain-sub">By model · 30 days</small>
          {usage.byModel.map((m) => (
            <div key={m.model} className="brain-model">
              <span>{shortId(m.model)}</span>
              <i style={{ ['--p' as string]: `${(m.cost / maxModel) * 100}%` }} />
              <em>
                {usd(m.cost, true)} · {m.calls}
              </em>
            </div>
          ))}
        </div>
      )}

      {usage && !!usage.byKind?.length && (
        <div className="brain-models">
          <small className="brain-sub">What it was for · 30 days</small>
          {usage.byKind.map((k) => (
            <div key={k.kind} className="brain-model">
              <span>{KIND_NAME[k.kind] ?? k.kind}</span>
              <i style={{ ['--p' as string]: `${(k.cost / Math.max(0.000001, ...usage.byKind!.map((x) => x.cost))) * 100}%` }} />
              <em>
                {usd(k.cost, true)} · {k.calls}
              </em>
            </div>
          ))}
        </div>
      )}

      {usage && usage.recent.length > 0 && (
        <details className="brain-recent">
          <summary>{usage.recent.length === 1 ? 'The last call' : `The last ${usage.recent.length} calls`}</summary>
          <table>
            <tbody>
              {usage.recent.map((r, i) => (
                <tr key={i}>
                  <td>{new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{shortId(r.model)}</td>
                  <td>{r.kind ?? ''}</td>
                  <td>{r.prompt != null ? `${Math.round(((r.prompt ?? 0) + (r.completion ?? 0)) / 100) / 10}k` : ''}</td>
                  <td>{r.cost == null ? 'free' : usd(r.cost, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="check" /> Test Ben
        </h2>
      </header>
      <TestBen models={models} current={chosen.chat ?? status?.auto.chat ?? null} />
    </section>
    </>
  )
}
