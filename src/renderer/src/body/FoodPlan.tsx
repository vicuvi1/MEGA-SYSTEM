// Food counter → Plan: cheap protein (grams of protein per leu, prices you can
// edit), the 7-day shopping list and the Sunday meal prep, both copyable.
import { useState } from 'react'
import { life } from '../bridge'
import { useAction, useToast } from '../ui'
import type { FoodView } from '../../../main/food'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

function CopyBlock({ title, text, hint, cls }: { title: string; text: string; hint: string; cls: string }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  const copy = async () => {
    const ok = await copyText(text)
    setDone(ok)
    toast(ok ? `${title} copied.` : 'Could not copy. Select the text and copy it.', ok ? 'good' : 'bad')
  }
  return (
    <div className={`fd-plan-block ${cls}`}>
      <div className="fd-row">
        <b>{title}</b>
        <button type="button" className="btn small fd-copy-plan" onClick={copy}>
          {done ? 'Copied' : 'Copy text'}
        </button>
      </div>
      <small className="muted">{hint}</small>
      <pre className="fd-plan-text">{text}</pre>
    </div>
  )
}

export function FoodPlan({ v, onView, day }: { v: FoodView; onView: (v: FoodView) => void; day?: string }) {
  const api = life.coach!.food!
  const act = useAction()
  const setPrice = async (name: string, raw: string) => {
    const n = raw.trim() === '' ? null : Number(raw.replace(',', '.'))
    const next = await act(() => api.prices({ [name]: n != null && Number.isFinite(n) && n > 0 ? n : null }, day), 'Price saved')
    if (next) onView(next)
  }
  return (
    <div className="fd-plan">
      <section className="fd-plan-block fd-cheap" aria-label="Cheap protein">
        <b>Cheap protein</b>
        <small className="muted">Grams of protein per leu (MDL). Prices are rough guesses per kg: type your own and the list, the shopping list and "Next" follow.</small>
        <ul className="fd-cheap-list">
          {v.cheap.map((r, i) => (
            <li key={r.name} className={r.edited ? 'edited' : ''}>
              <span className="fd-cheap-rank">{i + 1}</span>
              <span className="fd-cheap-name">
                <b>{r.name}</b>
                <small className="muted">
                  {r.p} g protein per 100 g{r.own ? ' · yours' : ''}
                </small>
              </span>
              <b className="fd-cheap-val num">{r.gPerLei} g / leu</b>
              <label className="fd-cheap-price">
                <input type="number" inputMode="decimal" min="1" defaultValue={r.mdlKg} aria-label={`Price of ${r.name} in MDL per kg`} onBlur={(e) => Number(e.target.value) !== r.mdlKg && setPrice(r.name, e.target.value)} />
                <small className="muted">MDL/kg</small>
              </label>
            </li>
          ))}
        </ul>
        {v.unpriced.length > 0 && (
          <div className="fd-unpriced">
            <small className="muted">Your foods with no price yet:</small>
            {v.unpriced.map((o) => (
              <label key={o.name} className="fd-cheap-price">
                <span>{o.name}</span>
                <input type="number" inputMode="decimal" min="1" placeholder="MDL/kg" aria-label={`Price of ${o.name} in MDL per kg`} onBlur={(e) => e.target.value && setPrice(o.name, e.target.value)} />
              </label>
            ))}
          </div>
        )}
      </section>
      <CopyBlock title={`Shopping list, ${v.shopping.days} days`} text={v.shopping.text} hint={`From your protein goal and the foods you eat. About ${fmt(v.shopping.mdl)} MDL.`} cls="fd-shop" />
      <CopyBlock title="Sunday meal prep, 3 days" text={v.prep.text} hint={`${v.prep.boxes} boxes: ${v.prep.box.protein.grams} g + ${v.prep.box.carb.grams} g + ${v.prep.box.veg.grams} g, about ${v.prep.box.macros.protein} g protein each.`} cls="fd-prep" />
    </div>
  )
}
