// The desktop's quick-add window (the global shortcut). It holds no data: the
// preview reads the context the app window sent, Enter sends the line to the
// app window, and the answer comes back as a small Undo toast.
import { useEffect, useState } from 'react'
import type { QItem } from '@core/quickQueue'
import type { Route, RouteCtx } from '@core/quickRoute'
import { QuickBox } from './QuickBox'
import { QuickToasts, visibleToasts } from './QuickToasts'

const canUndo = (r: Route) => r.kind !== 'money' && r.kind !== 'ask'

export function QuickWindow() {
  const q = window.desktop?.quickWin
  const [mode, setMode] = useState<'box' | 'toast'>('box')
  const [ctx, setCtx] = useState<RouteCtx | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [items, setItems] = useState<QItem<Route>[]>([])
  const [mine, setMine] = useState<string[]>([])
  const [say, setSay] = useState('')
  const [open, setOpen] = useState(0)

  useEffect(() => {
    document.documentElement.classList.add('qa-win')
    if (!q) return
    q.onShow(() => {
      setMode('box')
      setSay('')
      setOpen((n) => n + 1)
    })
    q.onMsg((m) => {
      if (m.op === 'ctx') {
        setCtx(m.ctx)
        setHistory(m.history)
      } else if (m.op === 'item') {
        if (m.item) {
          const it = m.item
          setItems((list) => [...list.filter((i) => i.id !== it.id), it].slice(-6))
          setMine([it.id])
          setMode('toast')
        } else {
          setSay(m.say || 'Not saved')
          setMode('box')
        }
      } else if (m.op === 'update') {
        setItems((list) => {
          const byId = new Map(list.map((i) => [i.id, i]))
          for (const i of m.items) if (byId.has(i.id)) byId.set(i.id, i)
          return [...byId.values()]
        })
      }
    })
  }, [q])

  // The toast leaves by itself once there is nothing left to show.
  useEffect(() => {
    if (mode !== 'toast' || !q) return
    const t = setInterval(() => {
      if (!visibleToasts(items.filter((i) => mine.includes(i.id)), Date.now()).length) q.hide()
    }, 500)
    return () => clearInterval(t)
  }, [mode, items, mine, q])

  if (!q) return null
  if (mode === 'toast')
    return (
      <div className="qa-win-toast">
        <QuickToasts items={items} only={mine} canUndo={canUndo} onUndo={(id) => q.undo(id)} onRetry={() => {}} onDismiss={() => q.hide()} />
      </div>
    )
  return (
    <div className="qa-win-box">
      <QuickBox
        key={open}
        bare
        ctx={ctx}
        history={history}
        onClose={() => q.hide()}
        onSubmit={(line, r, index) => q.submit(line, !!r.confirm, index)}
      />
      {say && <div className="qa-win-say">{say}</div>}
    </div>
  )
}
