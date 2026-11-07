// QA3 on the page: basic mode. When you're offline, Ben's AI doesn't answer,
// or the month's AI budget is used up, the Coach page does the simple things
// itself, at once and without AI (the bots' own rules, the focus timer, your
// must-dos), queues a task for Todoist, and keeps any other message in a small
// queue (this device, localStorage) that goes to Ben when he's back.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { basicReason, enqueue, freshQueue, matchMustDo, readBasic, type BasicReason, type Queued } from '@core/offlineMode'

const QKEY = 'ls.benQueue'
const AI_DOWN_MS = 2 * 60_000

export function readQueue(): Queued[] {
  try {
    return freshQueue(JSON.parse(localStorage.getItem(QKEY) || '[]'))
  } catch {
    return []
  }
}
function saveQueue(q: Queued[]): void {
  try {
    localStorage.setItem(QKEY, JSON.stringify(q))
  } catch {
    /* private window: the queue lives until the page closes */
  }
  window.dispatchEvent(new Event('life-ben-queue'))
}
export function queueAdd(text: string, to: Queued['to']): void {
  saveQueue(enqueue(readQueue(), { text, to }))
}

/** Does one message in basic mode. Returns Ben's line and whether it waits in the queue. */
export async function runBasic(text: string, reason: BasicReason, opts: { queue?: boolean } = {}): Promise<{ reply: string; queued: boolean; done?: string[] } | null> {
  const queue = opts.queue ?? true
  const c = readBasic(text)
  const offline = reason === 'offline'
  try {
    if (c.k === 'focus') {
      await life.focus.start(c.subject, c.minutes, null)
      return { reply: `⏱ Focus started: ${c.subject} · ${c.minutes} min.`, queued: false, done: [`⏱ Focus: ${c.subject} · ${c.minutes} min`] }
    }
    if (c.k === 'stop') {
      await life.focus.stop()
      return { reply: '⏹ Focus stopped and logged.', queued: false }
    }
    if (c.k === 'done') {
      const st = await life.focus.state()
      const i = matchMustDo(st.plan.items, c.what)
      if (i >= 0) {
        await life.focus.togglePlan(i)
        return { reply: `✅ Done: ${st.plan.items[i].text}.`, queued: false, done: [`✅ ${st.plan.items[i].text}`] }
      }
    }
    if (c.k === 'task') {
      if (!offline && life.todoist?.quickAdd) {
        const t = await life.todoist.quickAdd(c.text).catch(() => null)
        if (t) return { reply: `📝 Added to Todoist: ${t.content}.`, queued: false, done: [`📝 ${t.content}`] }
      }
      if (!queue) return null
      queueAdd(c.text, 'task')
      return { reply: `📝 "${c.text}" is saved and goes to Todoist as soon as it can be reached.`, queued: true }
    }
    // Water, reps, money, sleep…: the bots' own rules, on this device's copy (synced later).
    const q = c.k === 'quick' || c.k === 'done' ? await life.coach?.quick?.(text).catch(() => ({ unknown: true as const })) : null
    if (q && !('unknown' in q)) return { reply: q.reply, queued: false, done: q.ok ? [q.reply.split('\n')[0]] : [] }
  } catch (e) {
    return { reply: `⚠️ ${(e as Error)?.message || 'That did not work'}`, queued: false }
  }
  if (!queue) return null
  queueAdd(text, 'ben')
  return { reply: reason === 'budget' ? "That needs the AI, and this month's budget is used up. It's saved: ask the AI anyway, or it waits." : "That needs Ben's AI. It's saved and goes to him as soon as he's back.", queued: true }
}

/** Basic mode's state on the Coach page. */
export function useBasicMode() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const [aiDownUntil, setAiDownUntil] = useState(0)
  const [budgetUsedUp, setBudgetUsedUp] = useState(false)
  const [override, setOverride] = useState(false)
  const [queue, setQueue] = useState<Queued[]>(() => (typeof localStorage === 'undefined' ? [] : readQueue()))
  const [, tick] = useState(0)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    const q = () => setQueue(readQueue())
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    window.addEventListener('life-ben-queue', q)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      window.removeEventListener('life-ben-queue', q)
    }
  }, [])
  // The AI-down window ends by itself.
  useEffect(() => {
    if (aiDownUntil <= Date.now()) return
    const t = setTimeout(() => tick((n) => n + 1), aiDownUntil - Date.now() + 50)
    return () => clearTimeout(t)
  }, [aiDownUntil])
  // The budget, once when the page opens and then every 10 minutes.
  useEffect(() => {
    let gone = false
    const read = () =>
      life.coach
        ?.budget?.()
        .then((b) => !gone && setBudgetUsedUp(!!b && b.tier === 'minimal'))
        .catch(() => null)
    read()
    const t = setInterval(read, 10 * 60_000)
    return () => {
      gone = true
      clearInterval(t)
    }
  }, [])
  const reason = basicReason({ online, aiDownUntil, budgetUsedUp, override })
  const aiDown = useCallback(() => setAiDownUntil(Date.now() + AI_DOWN_MS), [])
  const take = useCallback(() => {
    const q = readQueue()
    saveQueue([])
    return q
  }, [])
  return { reason, online, queue, aiDown, aiBack: () => setAiDownUntil(0), setBudgetUsedUp, override, setOverride, take }
}
