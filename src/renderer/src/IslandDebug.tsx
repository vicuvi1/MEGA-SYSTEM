// Island debug (IC13): Settings → Desktop island → Debug (this PC only, off by
// itself after 30 minutes). Drawn over the island window:
// - green boxes: where the island page takes clicks; red dashed boxes: where
//   the desktop thinks they are; a green dot (the pointer as the page sees
//   it) and a red ring (as the desktop sees it);
// - a status card: CLICKS TAKEN / PASS-THROUGH, the view, zoom and screen
//   scale, smoothness (frames, long tasks, redraws, snapshots, animations),
//   the last click (what the press, the release and the click hit), the last
//   tap's round trip;
// - "Click test": five targets across the peek's width;
// - "Copy report": the last 60 seconds as JSON (no titles, no messages).
import { useEffect, useRef, useState } from 'react'
import type { IslandDebugSample } from '../../shared/desktop'
import type { Rect } from '@core/islandClicks'
import { tapStats, tp } from './islandTap'

/** What the island page knows, written by DesktopIsland as it happens (no re-render). */
export const dbg = {
  target: [] as Rect[],
  ptr: null as { x: number; y: number; at: number } | null,
  take: false,
  view: 'compact',
  place: 'top',
  cssScale: 1,
  snaps: 0,
  beats: 0,
  commits: 0,
  lastTap: null as null | { id?: string; kind: string; sentAt: number; rtt?: number; took?: number; ok?: boolean },
  events: [] as { t: number; e: string; [k: string]: unknown }[]
}
/** One line for the report (kept 60 s). */
export function dbgEvent(e: string, data: Record<string, unknown> = {}) {
  const t = Date.now()
  dbg.events.push({ t, e, ...data })
  while (dbg.events.length && t - dbg.events[0].t > 60_000) dbg.events.shift()
  if (dbg.events.length > 600) dbg.events.splice(0, dbg.events.length - 600)
}

let sample: IslandDebugSample | null = null
const samples: { t: number; [k: string]: unknown }[] = []
let listening = false
/** Listens for the desktop's samples (once per window; the bridge can't remove listeners). */
export function listenDebug() {
  if (listening) return
  listening = true
  window.desktop?.onIslandDebug?.((d) => {
    sample = d
  })
}

const r1 = (n: number) => Math.round(n * 10) / 10
const rect = (r: Rect) => ({ x: r1(r.x), y: r1(r.y), w: r1(r.w), h: r1(r.h) })

/** The overlay. `peek`: the peek's box (page px) for the click test targets. */
export function IslandDebug({ peek }: { peek: Rect | null }) {
  const [, setTick] = useState(0)
  const fps = useRef({ frames: 0, value: 0 })
  const longTasks = useRef({ n: 0, value: 0 })
  const rates = useRef({ commits: 0, snaps: 0, at: performance.now(), commitsPs: 0, snapsPs: 0 })
  const [hits, setHits] = useState<number[]>([0, 0, 0, 0, 0])
  const [copied, setCopied] = useState('')
  useEffect(() => {
    listenDebug()
    let raf = 0
    const frame = () => {
      fps.current.frames++
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    let po: PerformanceObserver | null = null
    try {
      po = new PerformanceObserver((l) => (longTasks.current.n += l.getEntries().length))
      po.observe({ type: 'longtask', buffered: false })
    } catch {
      po = null
    }
    let lastSample = 0
    const t = window.setInterval(() => {
      const now = performance.now()
      const dt = (now - rates.current.at) / 1000
      if (dt >= 1) {
        fps.current.value = Math.round(fps.current.frames / dt)
        fps.current.frames = 0
        longTasks.current.value = Math.round(longTasks.current.n / dt)
        longTasks.current.n = 0
        rates.current.commitsPs = Math.round((dbg.commits - rates.current.commits) / dt)
        rates.current.snapsPs = r1((dbg.snaps - rates.current.snaps) / dt)
        rates.current.commits = dbg.commits
        rates.current.snaps = dbg.snaps
        rates.current.at = now
      }
      // Twice a second into the report.
      if (Date.now() - lastSample >= 500) {
        lastSample = Date.now()
        const s = sample
        samples.push({
          t: lastSample, view: dbg.view, pageTakes: dbg.take, ptr: dbg.ptr ? { x: r1(dbg.ptr.x), y: r1(dbg.ptr.y) } : null,
          mainPassThrough: s?.ignoring ?? null, mainCursor: s ? s.cursor : null, inWindow: s?.inWin ?? null, lagMs: s?.lag ?? null, pollJitterMs: s?.pollJitter ?? null,
          fps: fps.current.value, longTasksPs: longTasks.current.value, redrawsPs: rates.current.commitsPs, snapshotsPs: rates.current.snapsPs, animations: runningAnimations()
        })
        while (samples.length && lastSample - samples[0].t > 60_000) samples.shift()
      }
      setTick((x) => (x + 1) % 1e6)
    }, 200)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(t)
      po?.disconnect()
    }
  }, [])

  const s = sample && Date.now() - sample.at < 3000 ? sample : null
  const zoom = s?.zoom || 1
  const passThrough = s ? s.ignoring : !dbg.take
  const last = tapStats.last
  const tap = dbg.lastTap
  const copyReport = () => {
    const report = {
      what: 'Life System island debug report (no titles or messages)',
      at: new Date().toISOString(),
      window: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      desktop: s ? { bounds: s.bounds, scaleFactor: s.scaleFactor, pageZoom: s.zoom, decides: s.ctl, rects: s.rects.map(rect), passThrough: s.ignoring, flips: s.flips } : null,
      page: { view: dbg.view, place: dbg.place, sizeScale: dbg.cssScale, target: dbg.target.map(rect), takes: dbg.take },
      clicks: { presses: tapStats.downs, releases: tapStats.ups, clicks: tapStats.clicks, fired: tapStats.fired, releasesWithoutPress: tapStats.upNoDown, last },
      lastTap: tap,
      samples: samples.slice(),
      events: dbg.events.slice()
    }
    const text = JSON.stringify(report, null, 1)
    try {
      if (window.desktop?.islandCopy) window.desktop.islandCopy(text)
      else void navigator.clipboard?.writeText(text)
      setCopied('Copied: paste it in a message to us')
    } catch {
      setCopied('Could not copy')
    }
    window.setTimeout(() => setCopied(''), 4000)
  }
  return (
    <div className="dbg-layer" aria-hidden={false}>
      {dbg.target.map((r, i) => (
        <i key={`p${i}`} className="dbg-box page" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
      ))}
      {s?.rects.map((r, i) => (
        <i key={`m${i}`} className="dbg-box main" style={{ left: r.x / zoom, top: r.y / zoom, width: r.w / zoom, height: r.h / zoom }} />
      ))}
      {dbg.ptr && <i className="dbg-dot page" style={{ left: dbg.ptr.x, top: dbg.ptr.y }} />}
      {s && <i className="dbg-dot main" style={{ left: s.cursor.x / zoom, top: s.cursor.y / zoom }} />}
      {peek && (
        <div className="dbg-tests" style={{ left: peek.x, top: peek.y + peek.h + 52, width: peek.w }}>
          {hits.map((n, i) => (
            <button
              key={i}
              data-hot
              className={`dbg-target ${n ? 'hit' : ''}`}
              {...tp(`dbg:test${i}`, () => {
                setHits((h) => h.map((x, j) => (j === i ? x + 1 : x)))
                dbgEvent('click test', { target: i + 1 })
              })}
            >
              {i + 1}
              {n ? ` ✓${n}` : ''}
            </button>
          ))}
        </div>
      )}
      <div className="dbg-panel" data-hot>
        <div>
          <span className={`dbg-chip ${passThrough ? 'pass' : 'take'}`}>{passThrough ? 'PASS-THROUGH' : 'CLICKS TAKEN'}</span>
          <b>Island debug</b>
        </div>
        <div className="dbg-row">
          <span>view {dbg.view}</span>
          <span>page zoom {r1(zoom)}</span>
          <span>size ×{dbg.cssScale}</span>
          <span>screen scale {s ? s.scaleFactor : '?'} · dpr {r1(window.devicePixelRatio)}</span>
        </div>
        <div className="dbg-row">
          <span>decides: {s ? (s.ctl === 'page' ? 'island page' : 'desktop (old way)') : 'no desktop data'}</span>
          <span>pointer in window: {s ? (s.inWin == null ? '?' : s.inWin ? 'yes' : 'no') : '?'}</span>
        </div>
        <div className="dbg-row">
          <span>pointer page {dbg.ptr ? `${Math.round(dbg.ptr.x)},${Math.round(dbg.ptr.y)}` : 'none'}</span>
          <span>desktop {s ? `${Math.round(s.cursor.x)},${Math.round(s.cursor.y)}` : '?'}</span>
        </div>
        <div className="dbg-row">
          <span>{fps.current.value} frames/s</span>
          <span>{longTasks.current.value} long tasks/s</span>
          <span>{rates.current.commitsPs} redraws/s</span>
          <span>{rates.current.snapsPs} snapshots/s</span>
          <span>{runningAnimations()} animations</span>
        </div>
        <div className="dbg-row">
          <span>desktop lag {s ? `${s.lag} ms` : '?'}</span>
          <span>pointer check jitter {s ? `${s.pollJitter} ms` : '?'}</span>
          <span>switches {s?.flips ?? '?'}</span>
        </div>
        <div className="dbg-row">
          <span>presses {tapStats.downs}</span>
          <span>releases {tapStats.ups}</span>
          <span>clicks {tapStats.clicks}</span>
          <span>buttons fired {tapStats.fired}</span>
          <span>release without press {tapStats.upNoDown}</span>
        </div>
        {last && (
          <div className="dbg-row">
            <span>last: press {last.down || '-'}</span>
            <span>release {last.up || '-'}</span>
            <span>click {last.click || '-'}</span>
            <span>fired {last.fired || 'nothing'}</span>
          </div>
        )}
        <div className="dbg-row">
          <span>last tap {tap ? `${tap.kind}: ${tap.rtt != null ? `${tap.rtt} ms round trip` : 'waiting…'}${tap.took != null ? `, app took ${tap.took} ms` : ''}${tap.ok === false ? ', failed' : ''}` : 'none yet'}</span>
        </div>
        <div className="dbg-btns">
          <button data-hot {...tp('dbg:copy', copyReport)}>Copy report</button>
          <button data-hot {...tp('dbg:reset', () => setHits([0, 0, 0, 0, 0]))}>Reset click test</button>
        </div>
        {copied && <div className="dbg-row">{copied}</div>}
      </div>
    </div>
  )
}

function runningAnimations(): number {
  try {
    return document.getAnimations().filter((a) => a.playState === 'running').length
  } catch {
    return 0
  }
}
