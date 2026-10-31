// Today → Todoist: your Todoist tasks for today (and late ones). Tick one
// off: it's completed in Todoist and pays coins once. The box adds a task the
// Todoist way ("call Leo tomorrow 17:00 p1 #University").
import { useCallback, useEffect, useState } from 'react'
import { pLabel, sortToday, type TodoTask } from '@core/todoist'
import { life } from './bridge'
import { Icon } from './Icon'
import { useToast } from './ui'

const P_COLOR: Record<number, string> = { 4: '#ff5c5c', 3: '#ffa53d', 2: '#5c9dff', 1: 'var(--muted)' }

export function TodoistPanel({ today, onWallet }: { today: string; onWallet: () => void }) {
  const toast = useToast()
  const [connected, setConnected] = useState<boolean | null>(null)
  const [tasks, setTasks] = useState<TodoTask[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!life.todoist) return setConnected(false)
    const { connected } = await life.todoist.status()
    setConnected(connected)
    if (!connected) return
    try {
      setTasks(await life.todoist.today())
    } catch (e) {
      toast((e as Error).message, 'bad')
      setTasks([])
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  if (connected === false) {
    return (
      <section className="panel todoist-panel">
        <header className="panel-head">
          <h2>
            <Icon name="check" /> Todoist
          </h2>
        </header>
        <p className="hint block">
          Connect your Todoist to see today's tasks here, tick them off for coins and use <code>/todo</code>, <code>/task</code> and <code>/done</code> in Telegram: add
          your Todoist API token (Todoist → Settings → Integrations → Developer) as <code>TODOIST_TOKEN</code> in Vercel.
        </p>
      </section>
    )
  }
  if (connected === null) return null

  const list = sortToday(tasks ?? [], today)

  const complete = async (t: TodoTask) => {
    setTasks((cur) => (cur ?? []).filter((x) => x.id !== t.id))
    try {
      const { paid } = await life.todoist!.complete(t)
      toast(paid ? `Done: ${t.content} · +8 coins` : `Done: ${t.content}`, 'good')
      if (paid) onWallet()
    } catch (e) {
      toast((e as Error).message, 'bad')
      void load()
    }
  }

  const add = async () => {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      const t = await life.todoist!.quickAdd(v)
      setText('')
      toast(`Added to Todoist: ${t.content || v}`, 'good')
      void load()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel todoist-panel">
      <header className="panel-head">
        <h2>
          <Icon name="check" /> Todoist today
        </h2>
        <span className="hint">{tasks == null ? 'Loading…' : `${list.length} left`}</span>
      </header>
      <form
        className="todoist-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task… e.g. call Leo tomorrow 17:00 p1 #University" maxLength={500} />
        <button className="btn small" disabled={!text.trim() || busy}>
          <Icon name="plus" size={13} /> Add
        </button>
      </form>
      {tasks != null && list.length === 0 && <div className="empty">Nothing left for today. Nice.</div>}
      <ul className="todoist-list">
        {list.map((t) => (
          <li key={t.id}>
            <button className="todoist-check" style={{ borderColor: P_COLOR[t.priority] ?? P_COLOR[1] }} aria-label={`Complete ${t.content}`} onClick={() => void complete(t)} />
            <span className="todoist-text">
              {t.content}
              <small>
                {t.due && t.due < today ? <b className="todoist-late">late · {t.due}</b> : null}
                {t.dueTime ? ` ${t.dueTime}` : ''}
                {t.priority > 1 ? ` · ${pLabel(t.priority)}` : ''}
                {t.project ? ` · #${t.project}` : ''}
                {t.recurring ? ' · repeats' : ''}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
