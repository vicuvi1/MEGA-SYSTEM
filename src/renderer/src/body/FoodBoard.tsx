// Sport Track → Body & Food → Food, the top of the page (the approved design,
// docs/design/sport-track/BodyFood.dc.html): four numbers (protein left with a food idea,
// calories, weight, quick log), step 1 "Copy the food prompt" (the one fixed
// FOOD_PASTE_PROMPT, with Copy and Show all), step 2 "Paste the AI's answer" (the
// LIFE-FOOD reader with a live preview, Log all and Save as repeat meal: FoodPaste.tsx)
// and Repeat meals as photo tiles (double-click logs it again, no AI call). Below it
// the food counter keeps today's meals and its More section. The Dashboard's
// "Paste from AI ›" lands on step 2 (the one-shot flag `life_food_open`). Logging food pays no points.
import { useCallback, useEffect, useRef, useState } from 'react'
import { FOOD_PASTE_PROMPT } from '@core/foodPaste'
import { totalsOf } from '@core/foodSaved'
import { life } from '../bridge'
import { useAction, useToast } from '../ui'
import { useBodyComp } from './progress/BodyCompPanel'
import { copyText } from './FoodPlan'
import { FoodPaste } from './FoodPaste'
import { MealTileImage } from './MealPhoto'
import type { FoodView } from '../../../main/food'
import './food-board.css'

const EVENTS = ['life-body-changed', 'life-sport-changed', 'life-external-changed']
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const TINTS = ['#2a2418', '#1f2a1c', '#2b2716', '#1c2328', '#271c1c', '#241f2b']
const tintOf = (name: string) => TINTS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length]
const sign = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(d)}`

export function FoodBoard({ weight, onLogWeight }: { weight: number | null; onLogWeight: () => void }) {
  const api = life.coach?.food
  const toast = useToast()
  const act = useAction()
  const comp = useBodyComp()
  const [v, setV] = useState<FoodView | null>(null)
  const [copied, setCopied] = useState(false)
  const [all, setAll] = useState(false)
  const [pasteKey, setPasteKey] = useState(0)
  const [land, setLand] = useState(false)
  const step2 = useRef<HTMLElement>(null)
  const repeats = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!api) return
    const load = () => void api.view().then(setV).catch(() => {})
    load()
    for (const e of EVENTS) window.addEventListener(e, load)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, load)
    }
  }, [api])

  // The Dashboard's "Paste from AI ›": land on step 2 and put the cursor in the box.
  const landOnPaste = useCallback(() => {
    setLand(true)
    setPasteKey((k) => k + 1)
    window.setTimeout(() => step2.current?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }), 60)
  }, [])
  useEffect(() => {
    try {
      if (localStorage.getItem('life_food_open') === 'paste') {
        localStorage.removeItem('life_food_open')
        landOnPaste()
      }
    } catch {
      /* private window: the page opens at the top */
    }
  }, [landOnPaste])

  if (!api || !v) return null

  const t = v.totals
  const left = Math.max(0, Math.round(t.targets.protein - t.protein))
  const idea = v.next.ideas[0]?.text
  const four = comp?.fourWeeks ?? null
  const s = v.saved
  const meals = s.meals.map((m) => ({ id: m.id, name: m.name, photo: m.photo, ...totalsOf(s, m.items) }))

  const copy = async () => {
    const ok = await copyText(FOOD_PASTE_PROMPT)
    setCopied(ok)
    toast(ok ? 'AI prompt copied. Paste it with your meal photos into ChatGPT, Grok or Gemini, then paste the answer in step 2.' : 'Could not copy. Tap Show all of it, select the prompt and copy it.', ok ? 'good' : 'bad')
  }
  const logAgain = async (id: string) => {
    const m = meals.find((x) => x.id === id)
    const r = await act(() => api.logMeal(id, null))
    if (!r) return
    setV(r.view)
    if (r.ids.length)
      toast(`Logged: ${m?.name ?? 'meal'}`, 'good', {
        label: 'Undo',
        run: () => void act(() => api.undo(r.ids)).then((view) => view && setV(view))
      })
  }

  return (
    <div className="fdb" data-fb="board">
      <section className="fdb-kpis" aria-label="Today in numbers">
        <div className="fdb-kpi" data-fb="protein">
          <small>Protein today</small>
          <b className="num">
            {fmt(t.protein)} / {fmt(t.targets.protein)} g
          </b>
          <span className="acc">{left > 0 ? `${left} g left${idea ? ` · e.g. ${idea}` : ''}` : 'Protein goal reached'}</span>
        </div>
        <div className="fdb-kpi" data-fb="kcal">
          <small>Calories</small>
          <b className="num">{fmt(t.kcal)}</b>
          <span>of {fmt(t.targets.kcal)} kcal</span>
        </div>
        <div className="fdb-kpi" data-fb="weight">
          <small>Weight</small>
          <b className="num">{weight != null ? `${weight.toFixed(1)} kg` : '—'}</b>
          <span className={four ? 'acc' : ''}>{four ? `${sign(four.kg)} kg this month` : weight != null ? 'log again to see the month' : 'no weigh-in yet'}</span>
        </div>
        <div className="fdb-kpi log" data-fb="quick">
          <small>Log</small>
          <button type="button" className="fdb-mini" onClick={onLogWeight} data-fb="log-weight">
            + Weight
          </button>
          <button
            type="button"
            className="fdb-mini"
            onClick={() => {
              repeats.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
              repeats.current?.querySelector<HTMLButtonElement>('.fdb-tile')?.focus()
            }}
            data-fb="log-repeat"
          >
            + Repeat a meal
          </button>
        </div>
      </section>

      <div className="fdb-steps">
        <section className="fdb-card" aria-labelledby="fb-h1" data-fb="step1">
          <h2 id="fb-h1">
            <span className="fdb-n" aria-hidden="true">
              1
            </span>
            Copy the food prompt
          </h2>
          <p>Paste it once in ChatGPT, Grok or Gemini, then send all your food photos. It answers in a format this app reads.</p>
          <pre className={`fdb-prompt${all ? ' all' : ''}`} tabIndex={0} aria-label="The food prompt" data-fb="prompt">
            {FOOD_PASTE_PROMPT}
          </pre>
          <div className="fdb-row">
            <button type="button" className="bdy-btn primary big fdb-copy" onClick={() => void copy()} data-fb="copy">
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <button type="button" className="bdy-btn big" onClick={() => setAll((a) => !a)} aria-expanded={all} data-fb="show-all">
              {all ? 'Show less' : 'Show all of it'}
            </button>
          </div>
          <p className="fdb-tip">Tip: write &ldquo;lunch yesterday 13:30&rdquo; with the photo and the AI fills in the date and time.</p>
        </section>

        <section className="fdb-card" aria-labelledby="fb-h2" data-fb="step2" ref={step2}>
          <h2 id="fb-h2">
            <span className="fdb-n" aria-hidden="true">
              2
            </span>
            Paste the AI&rsquo;s answer
          </h2>
          <FoodPaste key={pasteKey} v={v} onView={setV} onDone={() => setPasteKey((k) => k + 1)} focus={land} />
        </section>
      </div>

      <section className="fdb-card fdb-repeats" aria-labelledby="fb-h3" data-fb="repeats" ref={repeats}>
        <div className="fdb-head">
          <h2 id="fb-h3">Repeat meals</h2>
          <span>Double-click to log again · no AI needed</span>
        </div>
        {meals.length ? (
          <div className="fdb-tiles" role="list">
            {meals.map((m) => (
              <button
                key={m.id}
                type="button"
                role="listitem"
                className="fdb-tile"
                onDoubleClick={() => void logAgain(m.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void logAgain(m.id)
                  }
                }}
                aria-label={`${m.name}, ${m.protein} g protein, ${fmt(m.kcal)} kcal. Double-click or press Enter to log it again`}
                data-meal={m.id}
              >
                {m.photo ? <MealTileImage ids={[m.photo]} /> : <span className="fdb-tint" aria-hidden="true" style={{ background: tintOf(m.name) }} />}
                <span className="fdb-tile-text">
                  <b>{m.name}</b>
                  <small>
                    {m.protein} g protein · {fmt(m.kcal)} kcal
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="fdb-empty">No repeat meals yet. Paste an AI answer and tap &ldquo;Save as repeat meal&rdquo;, or keep a meal you logged, and it shows here.</p>
        )}
      </section>
    </div>
  )
}
