// Custom Center: where your widgets sit. Drag a widget into the island pill,
// the open island or the app home (or back to "Not shown"). Without a mouse:
// focus a widget and use ←/→ to move it between places and ↑/↓ to reorder;
// on a phone, tap a widget, then tap the place to put it.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { nudgeWidget, placeWidget, SLOT_LABEL, SLOT_MAX, SLOTS, slotOf, type Layout, type Slot, type Widget } from '@core/custom'

type Place = Slot | 'none'
const PLACE_LABEL: Record<Place, string> = { none: 'Not shown', ...SLOT_LABEL }

export function LayoutBoard({ widgets, layout, onChange, onFull }: { widgets: Widget[]; layout: Layout; onChange: (l: Layout, said: string) => void; onFull: (slot: Slot) => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const [over, setOver] = useState<Place | null>(null)
  // The widget moved by the keyboard keeps the focus after it lands in its new place.
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    const id = refocus.current
    if (!id) return
    refocus.current = null
    ;(document.querySelector(`[data-chip="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus()
  }, [layout])
  const byId = new Map(widgets.map((w) => [w.id, w]))
  const unplaced = widgets.filter((w) => !slotOf(layout, w.id)).map((w) => w.id)
  const ids = (p: Place) => (p === 'none' ? unplaced : layout[p])

  const put = (id: string, to: Place, index?: number) => {
    const r = placeWidget(layout, id, to === 'none' ? null : to, index)
    if (r.full && to !== 'none') return onFull(to)
    if (JSON.stringify(r.layout) !== JSON.stringify(layout)) onChange(r.layout, `${byId.get(id)?.title ?? 'Widget'} → ${PLACE_LABEL[to]}`)
    setPicked(null)
  }

  const onKey = (e: KeyboardEvent, id: string) => {
    const dir = ({ ArrowLeft: 'prevSlot', ArrowRight: 'nextSlot', ArrowUp: 'up', ArrowDown: 'down' } as const)[e.key as 'ArrowLeft']
    if (!dir) return
    e.preventDefault()
    const next = nudgeWidget(layout, id, dir)
    const to = slotOf(next, id)
    if (to && to.slot !== slotOf(layout, id)?.slot && layout[to.slot].length >= SLOT_MAX[to.slot]) return onFull(to.slot)
    if (JSON.stringify(next) !== JSON.stringify(layout)) {
      refocus.current = id
      onChange(next, `${byId.get(id)?.title ?? 'Widget'} → ${PLACE_LABEL[to?.slot ?? 'none']}`)
    }
  }

  const drop = (e: DragEvent, to: Place, index?: number) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain')
    if (byId.has(id)) put(id, to, index)
  }

  return (
    <div className="cc-board" data-testid="cc-board">
      <p className="hint block">Drag widgets into place. Keyboard: focus one, then ←/→ to change place and ↑/↓ to reorder. On a phone: tap a widget, then tap a place.</p>
      <div className="cc-zones">
        {(['none', ...SLOTS] as Place[]).map((p) => {
          const list = ids(p)
          const full = p !== 'none' && list.length >= SLOT_MAX[p]
          return (
            <section
              key={p}
              className={`cc-zone ${over === p ? 'is-over' : ''} ${picked ? 'is-target' : ''}`}
              data-zone={p}
              aria-label={`${PLACE_LABEL[p]}${p !== 'none' ? `, ${list.length} of ${SLOT_MAX[p]}` : ''}`}
              onDragOver={(e) => (e.preventDefault(), setOver(p))}
              onDragLeave={() => setOver((o) => (o === p ? null : o))}
              onDrop={(e) => drop(e, p)}
            >
              <header>
                <b>{PLACE_LABEL[p]}</b>
                {p !== 'none' && <small className={full ? 'cc-full' : ''}>{list.length}/{SLOT_MAX[p]}</small>}
              </header>
              <div className="cc-chips">
                {list.map((id, i) => {
                  const w = byId.get(id)
                  if (!w) return null
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`cc-chip ${picked === id ? 'is-picked' : ''}`}
                      data-chip={id}
                      draggable
                      aria-pressed={picked === id}
                      aria-label={`${w.title}, in ${PLACE_LABEL[p]}. Arrow keys move it.`}
                      onDragStart={(e) => (e.dataTransfer.setData('text/plain', id), (e.dataTransfer.effectAllowed = 'move'))}
                      onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), setOver(p))}
                      onDrop={(e) => drop(e, p, i)}
                      onKeyDown={(e) => onKey(e, id)}
                      onClick={() => setPicked((x) => (x === id ? null : id))}
                      style={w.color ? { ['--cc-w' as string]: w.color } : undefined}
                    >
                      <span aria-hidden="true">{w.icon}</span> {w.title}
                    </button>
                  )
                })}
                {!list.length && <span className="cc-zone-empty">{p === 'none' ? 'Every widget is placed' : 'Empty'}</span>}
              </div>
              {picked && slotOf(layout, picked)?.slot !== p && !(p === 'none' && !slotOf(layout, picked)) && (
                <button type="button" className="btn cc-put" onClick={() => put(picked, p)} disabled={full}>
                  {full ? 'Full' : 'Put here'}
                </button>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
