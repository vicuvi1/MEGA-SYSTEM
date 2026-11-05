// Island 2 on the open panel: the clipboard tray (IN42), the file shelf
// (IN48) and the mini calendar (IN46). The desktop keeps the clipboard items
// in memory only, and the shelf holds references to files (their paths),
// never copies. Moving a focus block goes through the calendar's own path
// (the "push" tap), so it moves in Google Calendar like Push +15 does.
import { useEffect, useRef, useState } from 'react'
import type { IslandAction, IslandSnapshot } from '@core/islandModel'
import { dayStrip, dragMinutes, stripRange, type ClipItem, type ShelfItem } from '@core/islandKitExtras'
import { tp } from './islandTap'
import type { KitState } from './IslandTiles'

const desk = () => (typeof window !== 'undefined' ? window.desktop : undefined)
const kitOp = (op: string, arg?: unknown): Promise<any> => {
  try {
    return Promise.resolve(desk()?.islandKit?.(op, arg)).catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}
type Tap = (a: IslandAction, lbl?: string) => void

const short = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

export function ClipTray({ k, tap }: { k: KitState; tap: Tap }) {
  if (!k.kit.clipboard) return null
  const list: ClipItem[] = k.clips
  return (
    <section className="di-kit di-clips" aria-label="Clipboard tray">
      <div className="di-kit-head">
        <b>📋 Copied lately</b>
        {!!list.length && <button className="di-kit-edit" {...tp('clip:clear', () => void kitOp('clipClear'))}>Clear</button>}
      </div>
      {!list.length ? (
        <p className="di-kit-hint">Copy some text and it shows here (never from password managers, banks or private windows).</p>
      ) : (
        <ul className="di-kit-list">
          {list.map((c, i) => (
            <li key={`${c.at}:${i}`} className={c.pinned ? 'pinned' : ''}>
              <span title={c.text}>{short(c.text)}</span>
              <button title="Copy again" aria-label="Copy again" {...tp(`clip:copy:${i}`, () => void kitOp('clipCopy', c.text))}>⧉</button>
              <button title={c.pinned ? 'Unpin' : 'Pin'} aria-label={c.pinned ? 'Unpin' : 'Pin'} {...tp(`clip:pin:${i}`, () => void kitOp('clipPin', { text: c.text, on: !c.pinned }))}>{c.pinned ? '📌' : '📍'}</button>
              <button title="Make it a task" aria-label="Make it a task" {...tp(`clip:task:${i}`, () => tap({ kind: 'clipSave', to: 'task', text: c.text.slice(0, 300), alertId: 'clip:tray' }))}>➕</button>
              <button title="Into the notebook" aria-label="Into the notebook" {...tp(`clip:note:${i}`, () => tap({ kind: 'clipSave', to: 'note', text: c.text.slice(0, 300), alertId: 'clip:tray' }))}>📓</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- IN48: the file shelf ----

let shelfCache: ShelfItem[] = []
const shelfSubs = new Set<(l: ShelfItem[]) => void>()
const setShelf = (l: unknown) => {
  if (!Array.isArray(l)) return
  shelfCache = l as ShelfItem[]
  shelfSubs.forEach((f) => f(shelfCache))
}
/** A file dropped on the island: kept on the shelf (its path). True when it went there. */
export async function shelfDrop(files: FileList | File[]): Promise<boolean> {
  const paths = [...files].map((f) => desk()?.islandFilePath?.(f) ?? '').filter(Boolean)
  if (!paths.length) return false
  for (const p of paths.slice(0, 12)) setShelf(await kitOp('shelfAdd', p))
  return true
}

export function FileShelf({ k, tap }: { k: KitState; tap: Tap }) {
  const [list, setList] = useState<ShelfItem[]>(shelfCache)
  const [err, setErr] = useState('')
  useEffect(() => {
    shelfSubs.add(setList)
    if (k.kit.shelf) void kitOp('shelf').then(setShelf)
    return () => void shelfSubs.delete(setList)
  }, [k.kit.shelf])
  if (!k.kit.shelf) return null
  const attach = (f: ShelfItem, to: 'task' | 'note') => tap({ kind: 'clipSave', to, text: `📎 ${f.name} (${f.path})`.slice(0, 300), alertId: 'shelf' })
  return (
    <section className="di-kit di-shelf" aria-label="File shelf">
      <div className="di-kit-head">
        <b>🗂 File shelf</b>
        {!!list.length && <button className="di-kit-edit" {...tp('shelf:clear', () => void kitOp('shelfClear').then(setShelf))}>Clear all</button>}
      </div>
      {!list.length ? (
        <p className="di-kit-hint">Drop a file on the island to keep it here for later (only where it is, never a copy).</p>
      ) : (
        <ul className="di-kit-list">
          {list.map((f) => (
            <li key={f.path}>
              <span title={f.path}>📄 {short(f.name, 40)}</span>
              <button title="Open" aria-label="Open" {...tp(`shelf:open:${f.path}`, () => void kitOp('shelfOpen', f.path).then((r) => setErr(typeof r === 'string' ? r : '')))}>↗</button>
              <button title="Show in its folder" aria-label="Show in its folder" {...tp(`shelf:show:${f.path}`, () => void kitOp('shelfShow', f.path))}>📁</button>
              <button title="Attach to a new task" aria-label="Attach to a new task" {...tp(`shelf:task:${f.path}`, () => attach(f, 'task'))}>➕</button>
              <button title="Into the notebook" aria-label="Into the notebook" {...tp(`shelf:note:${f.path}`, () => attach(f, 'note'))}>📓</button>
              <button title="Take it off the shelf" aria-label="Take it off the shelf" {...tp(`shelf:del:${f.path}`, () => void kitOp('shelfRemove', f.path).then(setShelf))}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="di-kit-warn">{err}</p>}
    </section>
  )
}

// ---- IN46: the mini calendar ----

const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)

export function MiniCalendar({ s, tap, now }: { s: IslandSnapshot; tap: Tap; now: number }) {
  const blocks = s.day ?? []
  const bar = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ key: string; dx: number } | null>(null)
  if (!blocks.length) return null
  const { from, to } = stripRange(blocks, now)
  const items = dayStrip(blocks, from, to, now)
  if (!items.length) return null
  const span = to - from
  const nowAt = (now - from) / span
  const ticks = Array.from({ length: 8 }, (_, i) => from + i * 3600_000)
  return (
    <section className="di-kit di-minical" aria-label="Today">
      <div className="di-kit-head">
        <b>🗓 Today</b>
        <small>{drag ? `${dragMinutes(drag.dx, bar.current?.clientWidth ?? 1, span) >= 0 ? '+' : ''}${dragMinutes(drag.dx, bar.current?.clientWidth ?? 1, span)} min` : 'Drag a focus block to move it'}</small>
      </div>
      <div className="di-minical-bar" ref={bar}>
        {ticks.map((t) => (
          <i key={t} className="di-minical-tick" style={{ left: `${((t - from) / span) * 100}%` }}>{hm(t).slice(0, 2)}</i>
        ))}
        {items.map((it) => {
          const key = `${it.block.start}:${it.block.title}`
          const dx = drag?.key === key ? drag.dx : 0
          return (
            <span
              key={key}
              className={`di-minical-b ${it.movable ? 'movable' : ''} ${it.now ? 'now' : ''} ${it.block.call ? 'call' : ''}`}
              style={{ left: `${it.left * 100}%`, width: `${it.width * 100}%`, transform: dx ? `translateX(${dx}px)` : undefined }}
              title={`${it.block.title} · ${hm(it.block.start)}–${hm(it.block.end)}${it.movable ? ' (drag to move)' : ''}`}
              onPointerDown={(e) => {
                if (!it.movable || e.button !== 0) return
                e.stopPropagation()
                const x0 = e.clientX
                const el = e.currentTarget
                try { el.setPointerCapture(e.pointerId) } catch { /* fine */ }
                const move = (ev: PointerEvent) => setDrag({ key, dx: ev.clientX - x0 })
                const up = (ev: PointerEvent) => {
                  el.removeEventListener('pointermove', move)
                  el.removeEventListener('pointerup', up)
                  el.removeEventListener('pointercancel', up)
                  setDrag(null)
                  const m = dragMinutes(ev.clientX - x0, bar.current?.clientWidth ?? 1, span)
                  if (m && ev.type === 'pointerup') tap({ kind: 'push', block: it.block, minutes: m })
                }
                el.addEventListener('pointermove', move)
                el.addEventListener('pointerup', up)
                el.addEventListener('pointercancel', up)
              }}
            >
              {it.block.title}
            </span>
          )
        })}
        {nowAt >= 0 && nowAt <= 1 && <i className="di-minical-now" style={{ left: `${nowAt * 100}%` }} aria-hidden />}
      </div>
    </section>
  )
}
