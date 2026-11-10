// Settings → Ben → AI cost: what reading meal photos (and scale screenshots)
// cost this month. The server records the real token counts of every read;
// `/api/ai {op:'photoCost'}` sums them with the month's photo count, and
// core/aiCost.ts turns them into money with the prices set here (synced
// setting ai_cost; Gemini 3.5 Flash at $1.50 / $9 per million tokens by default).
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { life } from './bridge'
import { currentSession } from './web/session'
import { DEFAULT_COST, costReport, usdText, type CostPrefs, type PhotoUsage } from '@core/aiCost'
import './ai-cost.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

async function loadUsage(): Promise<PhotoUsage | null> {
  try {
    const r = await fetch('/api/ai', { method: 'POST', headers: { Authorization: `Bearer ${currentSession() ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'photoCost' }), signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return null
    const j = await r.json()
    return j && typeof j.month === 'string' && Array.isArray(j.rows) ? (j as PhotoUsage) : null
  } catch {
    return null
  }
}

export function AiCostPanel() {
  const api = life.coach?.food
  const [prefs, setPrefs] = useState<CostPrefs>(DEFAULT_COST)
  const [form, setForm] = useState({ model: DEFAULT_COST.model, inPerM: String(DEFAULT_COST.inPerM), outPerM: String(DEFAULT_COST.outPerM) })
  const [usage, setUsage] = useState<PhotoUsage | null | 'loading'>('loading')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    api?.costPrefs?.().then((p) => (setPrefs(p), setForm({ model: p.model, inPerM: String(p.inPerM), outPerM: String(p.outPerM) }))).catch(() => {})
    void loadUsage().then(setUsage)
  }, [api])
  const rep = usage && usage !== 'loading' ? costReport(usage, prefs) : null
  const save = async () => {
    if (!api?.setCostPrefs) return
    const next = await api.setCostPrefs({ model: form.model, inPerM: Number(form.inPerM), outPerM: Number(form.outPerM) }).catch(() => null)
    if (next) {
      setPrefs(next)
      setForm({ model: next.model, inPerM: String(next.inPerM), outPerM: String(next.outPerM) })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    }
  }
  return (
    <section className="panel ai-cost" aria-label="AI cost">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> AI cost
        </h2>
        {rep && <span className="chip">{usdText(rep.usd)} this month</span>}
      </header>
      <p className="hint block">Meal photos read this month and what they cost, from the real token counts the server records for each read, at your model's prices.</p>
      {usage === 'loading' ? (
        <p className="hint">Loading…</p>
      ) : !rep ? (
        <p className="hint ai-cost-off">The cost can't be loaded right now (offline, or the server isn't set up). Your prices are kept.</p>
      ) : (
        <div className="ai-cost-meter" role="group" aria-label={rep.line}>
          <div className="ai-cost-nums">
            <span>
              <b className="num ai-cost-photos">{fmt(rep.photos)}</b>
              <small>photos read</small>
            </span>
            <span>
              <b className="num ai-cost-usd">{usdText(rep.usd)}</b>
              <small>estimated</small>
            </span>
            <span>
              <b className="num">{rep.perPhoto != null ? usdText(rep.perPhoto) : '—'}</b>
              <small>a photo</small>
            </span>
          </div>
          <small className="hint">
            {fmt(rep.inTokens)} input and {fmt(rep.outTokens)} output tokens ({rep.reads} reads{rep.secondLooks ? `, ${rep.secondLooks} careful second looks` : ''}{rep.scale ? `, ${rep.scale} scale screenshots` : ''}) in {rep.month}. Thinking counts as output.
          </small>
        </div>
      )}
      <div className="ai-cost-form">
        <label className="field">
          <span>Model</span>
          <input className="ai-cost-model" value={form.model} maxLength={40} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        </label>
        <label className="field">
          <span>$ per 1M input tokens</span>
          <input className="ai-cost-in" type="number" min={0} step={0.01} inputMode="decimal" value={form.inPerM} onChange={(e) => setForm({ ...form, inPerM: e.target.value })} />
        </label>
        <label className="field">
          <span>$ per 1M output tokens</span>
          <input className="ai-cost-out" type="number" min={0} step={0.01} inputMode="decimal" value={form.outPerM} onChange={(e) => setForm({ ...form, outPerM: e.target.value })} />
        </label>
      </div>
      <div className="row">
        <button type="button" className="btn small ai-cost-save" onClick={save}>
          {saved ? 'Saved' : 'Save prices'}
        </button>
        <button type="button" className="btn ghost small" onClick={() => setForm({ model: DEFAULT_COST.model, inPerM: String(DEFAULT_COST.inPerM), outPerM: String(DEFAULT_COST.outPerM) })}>
          Gemini 3.5 Flash prices
        </button>
      </div>
    </section>
  )
}
