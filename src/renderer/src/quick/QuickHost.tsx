// Quick add inside the app window and on the website: the box (Ctrl+Space,
// the Log button) and the Undo toasts. On the desktop it also does what the
// global shortcut's own small window asks: that window only sends the line,
// this window (the one owner of your data) writes it.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { QItem } from '@core/quickQueue'
import { routeOptions, type Route, type RouteCtx } from '@core/quickRoute'
import { QuickBox } from './QuickBox'
import { QuickToasts } from './QuickToasts'
import { canUndo, quickContext, quickHistory, quickQueue, quickSubmit, restoreQuick } from './quickRun'

/** The desktop listener is added once per page (it can't be removed; StrictMode mounts twice in dev). */
let listening = false
let latestLoad: (() => Promise<RouteCtx | null>) | null = null

export function QuickHost({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<QItem<Route>[]>(() => quickQueue.items())
  const [ctx, setCtx] = useState<RouteCtx | null>(null)
  const ctxRef = useRef<RouteCtx | null>(null)

  const loadCtx = useCallback(async () => {
    const c = await quickContext().catch(() => null)
    if (c) {
      ctxRef.current = c
      setCtx(c)
    }
    return c
  }, [])

  useEffect(() => {
    restoreQuick()
    const off = quickQueue.subscribe(setItems)
    void loadCtx()
    const reload = () => void loadCtx()
    const evs = ['life-habits-changed', 'life-sport-changed', 'focus']
    evs.forEach((e) => window.addEventListener(e, reload))
    return () => {
      off()
      evs.forEach((e) => window.removeEventListener(e, reload))
    }
  }, [loadCtx])

  useEffect(() => {
    if (open) void loadCtx()
  }, [open, loadCtx])

  // Desktop: the global shortcut's window sends lines here and asks for the context.
  useEffect(() => {
    const d = window.desktop
    latestLoad = loadCtx
    if (!d?.onQuickRun || !d.quickReply || listening) return
    listening = true
    const loadCtxNow = () => (latestLoad ?? loadCtx)()
    d.onQuickRun(async (m) => {
      if (m.op === 'ctx') {
        const c = (await loadCtxNow()) ?? ctxRef.current
        return d.quickReply!({ op: 'ctx', ctx: c, history: quickHistory() })
      }
      if (m.op === 'undo') {
        const ok = await quickQueue.undo(m.id)
        return d.quickReply!({ op: 'item', item: quickQueue.items().find((i) => i.id === m.id) ?? null, ok })
      }
      // A line: read again here, with this window's fresh context (the one that counts).
      const c = (await loadCtxNow()) ?? ctxRef.current
      const opts = c ? routeOptions(m.line, c) : []
      const r = opts[m.pick] ?? opts[0] ?? null
      const it = r && r.kind !== 'ask' && !(r.confirm && !m.sure) ? quickSubmit(m.line, r) : null
      d.quickReply!({ op: 'item', item: it, ok: !!it, say: it ? undefined : r?.kind === 'ask' ? r.say : 'Not saved: try again in the app' })
    })
  }, [loadCtx])

  // The desktop window shows its own toast: keep it up to date as the write lands.
  useEffect(() => {
    const d = window.desktop
    if (!d?.quickReply) return
    const last = items[items.length - 1]
    if (last) d.quickReply({ op: 'update', items: items.slice(-4) })
  }, [items])

  return (
    <>
      {open && (
        <QuickBox
          ctx={ctx}
          history={quickHistory()}
          onClose={onClose}
          onSubmit={(line, r) => {
            quickSubmit(line, r)
            onClose()
          }}
        />
      )}
      <QuickToasts
        items={items}
        canUndo={canUndo}
        onUndo={(id) => void quickQueue.undo(id)}
        onRetry={(id) => quickQueue.retry(id)}
        onDismiss={(id) => quickQueue.dismiss(id)}
      />
    </>
  )
}
