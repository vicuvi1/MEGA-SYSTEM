// Links that act when the app opens (FT14 + FT15): the home-screen shortcuts
// ("+250 ml water", "Start 25 min focus", "Log spending", "Talk to Ben") and
// text or links shared to Life System from any phone app, which become a
// task, a note or an event.
import { useEffect, useRef, useState } from 'react'
import { life } from './bridge'
import { useToast } from './ui'
import type { PageId } from './modules'
import { DEEP_KEYS, findWhen, guessShare, readDeepLink, sharedText, type ShareAs } from '@core/deepLinks'
import { parseWhen } from '@core/whenParse'
import { capture } from './capture'
import { soundSuccess } from './soundKit'
import './lifeExtras.css'

/** Removes the action from the address, so a reload doesn't add the water twice. */
function clearLink() {
  try {
    const url = new URL(window.location.href)
    for (const k of DEEP_KEYS) url.searchParams.delete(k)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    /* an odd address: leave it */
  }
}

export function DeepLinks({ onGo }: { onGo: (p: PageId) => void }) {
  const toast = useToast()
  const done = useRef(false)
  const [share, setShare] = useState<{ title: string; text: string; url: string } | null>(null)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const link = readDeepLink(window.location.search)
    if (!link) return
    clearLink()
    if (link.kind === 'share') return setShare({ title: link.title, text: link.text, url: link.url })
    if (link.kind === 'water') {
      if (!life.coach?.water) return toast('Water needs the web app', 'bad')
      void life.coach
        .water(link.ml)
        .then((w) => {
          soundSuccess()
          toast(`💧 +${link.ml} ml · ${w.ml} of ${w.target} ml today`, 'good')
          window.dispatchEvent(new CustomEvent('life-body-changed'))
        })
        .catch((e) => toast((e as Error).message, 'bad'))
      return
    }
    if (link.kind === 'focus') {
      void life.focus
        .start(link.subject, link.minutes)
        .then(() => {
          toast(`⏱ Focus started: ${link.minutes} minutes`, 'good')
          window.dispatchEvent(new CustomEvent('life-focus-changed'))
        })
        .catch((e) => toast((e as Error).message, 'bad'))
      return
    }
    if (link.kind === 'spend') {
      onGo('today')
      setTimeout(() => window.dispatchEvent(new CustomEvent('life-open-spend')), 600)
      return
    }
    if (link.kind === 'ben') onGo('coach')
  }, [toast, onGo])
  if (!share) return null
  return <ShareSheet shared={share} onClose={() => setShare(null)} />
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (m: number) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

function ShareSheet({ shared, onClose }: { shared: { title: string; text: string; url: string }; onClose: () => void }) {
  const toast = useToast()
  const [as, setAs] = useState<ShareAs>(() => guessShare(shared))
  const [text, setText] = useState(() => sharedText(shared))
  const found = findWhen(sharedText(shared))
  const [when, setWhen] = useState(() => (found ? `${found.when.day} ${hhmm(found.when.start)}${found.when.end ? `-${hhmm(found.when.end)}` : ''}` : ''))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      if (as === 'task') {
        if (life.todoist) {
          const t = await life.todoist.quickAdd(body)
          toast(`Added to Todoist: ${t.content}`, 'good')
        } else {
          const c = await capture(body)
          toast(c.said, c.ok ? 'good' : 'bad')
        }
        window.dispatchEvent(new CustomEvent('life-external-changed'))
      } else if (as === 'note') {
        if (!life.notes) throw new Error('Notes need the web app')
        const title = (shared.title || body.replace(/https?:\/\/\S+/g, '').trim().split(/\s+/).slice(0, 6).join(' ') || 'Shared link').slice(0, 80)
        await life.notes.save({ title, body })
        toast(`Saved to your Notebook: ${title}`, 'good')
      } else {
        if (!life.google) throw new Error('Connect Google Calendar in Settings to add events')
        const w = parseWhen(when)
        if (!w) throw new Error('Type when, e.g. "fri 18:00" or "tomorrow 9-10:30"')
        const title = (findWhen(body)?.title ?? body).replace(/https?:\/\/\S+/g, '').trim().slice(0, 120) || 'Event'
        const start = new Date(`${w.day}T${hhmm(w.start)}:00`)
        const end = new Date(start.getTime() + ((w.end ?? w.start + 60) - w.start) * 60000)
        await life.google.create({ title, start: start.toISOString(), end: end.toISOString(), description: shared.url || undefined })
        toast(`Added to your calendar: ${title}, ${w.day} ${hhmm(w.start)}`, 'good')
        window.dispatchEvent(new CustomEvent('life-external-changed'))
      }
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sh-backdrop" role="dialog" aria-modal="true" aria-label="Shared to Life System" onClick={onClose}>
      <form
        className="sh-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <header>
          <b>Shared to Life System</b>
          <button type="button" className="btn small ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="sh-kinds" role="radiogroup" aria-label="Save as">
          {(['task', 'note', 'event'] as ShareAs[]).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={as === k} className={as === k ? 'on' : ''} onClick={() => setAs(k)}>
              {k === 'task' ? '✅ Task' : k === 'note' ? '📓 Note' : '📅 Event'}
            </button>
          ))}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="What was shared" />
        {as === 'event' && <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder='When: "fri 18:00", "tomorrow 9-10:30"' aria-label="When" />}
        <button className="btn primary" disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : as === 'task' ? 'Add task' : as === 'note' ? 'Save note' : 'Add event'}
        </button>
      </form>
    </div>
  )
}
