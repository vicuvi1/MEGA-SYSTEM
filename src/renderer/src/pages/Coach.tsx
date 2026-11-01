// Coach: one chat with your coach (the same brain and memory as the Telegram
// bots, so the conversation continues wherever you are), what it remembers
// about you (edit or delete), and the goals & rules it holds you to.
import { useCallback, useEffect, useRef, useState } from 'react'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useAction } from '../ui'

type Entry = { role: 'me' | 'coach'; bot: string; via: string; text: string; done?: string[]; at: string; pending?: boolean }
type Profile = { about: string; goals: string[]; rules: string[] }

const BOT_LABEL: Record<string, string> = { mega: 'Mega', finance: 'Finance', waky: 'Waky', sport: 'Sport' }
const QUICK = [
  'What should I focus on right now?',
  'Plan my afternoon around my calendar',
  'How was my week, honestly?',
  "I'm procrastinating. Push me.",
  'Block 2 hours tomorrow for my most urgent task'
]
const timeOf = (iso: string) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toTimeString().slice(0, 5) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toTimeString().slice(0, 5)
}

export function Coach({ onWallet }: { onWallet: () => void }) {
  const act = useAction()
  const [log, setLog] = useState<Entry[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [facts, setFacts] = useState<{ t: string; at: string }[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!life.coach) return setLog([])
    const [l, m, p] = await Promise.all([life.coach.log().catch(() => []), life.coach.memory().catch(() => ({ facts: [] })), life.coach.profile().catch(() => null)])
    setLog(l)
    setFacts(m.facts)
    if (p) setProfile(p)
  }, [])
  useEffect(() => {
    void load()
    life.coach?.model().then(setModel).catch(() => {})
  }, [load])
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [log])

  const send = async (msg = text) => {
    const t = msg.trim()
    if (!t || busy || !life.coach) return
    setText('')
    setBusy(true)
    const now = new Date().toISOString()
    setLog((l) => [...(l ?? []), { role: 'me', bot: 'mega', via: 'app', text: t, at: now }, { role: 'coach', bot: 'mega', via: 'app', text: '', at: now, pending: true }])
    try {
      const r = await life.coach.chat(t)
      setLog((l) => [...(l ?? []).filter((x) => !x.pending), { role: 'coach', bot: 'mega', via: 'app', text: r.reply, done: r.done, at: new Date().toISOString() }])
      if (r.done.length) onWallet()
      void life.coach.memory().then((m) => setFacts(m.facts)).catch(() => {})
    } catch (e) {
      setLog((l) => [...(l ?? []).filter((x) => !x.pending), { role: 'coach', bot: 'mega', via: 'app', text: `I couldn't answer: ${(e as Error).message}`, at: new Date().toISOString() }])
    }
    setBusy(false)
  }

  const saveFacts = async (next: { t: string; at: string }[]) => {
    setFacts(next)
    await act(() => life.coach!.setFacts(next))
  }
  const saveProfile = async (next: Profile) => {
    setProfile(next)
    const r = await act(() => life.coach!.saveProfile(next), 'Saved: the coach will push you on this')
    if (r) setProfile(r)
  }

  return (
    <div className="co">
      <section className="panel co-chat">
        <header className="co-head">
          <h2>
            <Icon name="spark" /> Your coach
          </h2>
          <span className="hint">{model ? `Thinking with ${model.replace(/^.*\//, '')}` : 'Same coach as your Telegram bots'}</span>
        </header>
        <div className="co-stream">
          {log === null && <p className="hint">Loading your conversation…</p>}
          {log?.length === 0 && (
            <div className="co-empty">
              <p>Ask anything about your day, your goals, money, sleep or training. The coach sees your real data, your calendar and Todoist, and can act: log things, plan blocks, add tasks.</p>
            </div>
          )}
          {log?.map((m, i) => (
            <div key={i} className={`co-msg ${m.role} ${m.pending ? 'pending' : ''}`}>
              <div className="co-meta">
                {m.role === 'me' ? 'You' : `Coach${m.bot && m.bot !== 'mega' ? ` · ${BOT_LABEL[m.bot] ?? m.bot}` : ''}`}
                <span> · {m.via === 'app' ? 'app' : 'Telegram'} · {timeOf(m.at)}</span>
              </div>
              <div className="co-bubble">
                {m.pending ? (
                  <span className="co-typing">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  m.text
                )}
                {!!m.done?.length && (
                  <ul className="co-done">
                    {m.done.map((d, k) => (
                      <li key={k}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="co-quick">
          {QUICK.map((q) => (
            <button key={q} className="wp-chip" disabled={busy} onClick={() => void send(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="co-input"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Talk to your coach… (Enter to send, Shift+Enter for a new line)"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button className="btn primary" disabled={busy || !text.trim()}>
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </form>
      </section>

      <aside className="co-side">
        {profile && <GoalsRules profile={profile} onSave={saveProfile} />}
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="list" /> What the coach remembers
            </h2>
          </header>
          <p className="hint small">Picked up from your conversations. Edit or delete anything that's wrong or old.</p>
          <FactList facts={facts} onSave={saveFacts} />
        </section>
      </aside>
    </div>
  )
}

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [v, setV] = useState('')
  return (
    <div className="co-list">
      {items.map((it, i) => (
        <div key={`${i}:${it}`} className="co-item">
          <input
            defaultValue={it}
            onBlur={(e) => {
              const t = e.target.value.trim()
              if (t !== it) onChange(t ? items.map((x, k) => (k === i ? t : x)) : items.filter((_, k) => k !== i))
            }}
          />
          <button className="ta-act" aria-label="Remove" title="Remove" onClick={() => onChange(items.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <form
        className="co-item add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!v.trim()) return
          onChange([...items, v.trim()])
          setV('')
        }}
      >
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
        <button className="ta-act" aria-label="Add" title="Add">
          ＋
        </button>
      </form>
    </div>
  )
}

function GoalsRules({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const [about, setAbout] = useState(profile.about)
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="trophy" /> Goals & rules
        </h2>
      </header>
      <h3 className="co-sub">Long-term goals</h3>
      <p className="hint small">The coach pushes you toward these in every answer and message.</p>
      <ListEditor items={profile.goals} onChange={(goals) => onSave({ ...profile, goals })} placeholder="e.g. Get a cyber security internship by summer" />
      <h3 className="co-sub">My rules</h3>
      <p className="hint small">Rules you want to be held to. Tough love: it calls you out when you break one.</p>
      <ListEditor items={profile.rules} onChange={(rules) => onSave({ ...profile, rules })} placeholder="e.g. No phone in bed · 2 focus blocks every weekday" />
      <h3 className="co-sub">About me</h3>
      <textarea className="co-about" value={about} onChange={(e) => setAbout(e.target.value)} onBlur={() => about !== profile.about && onSave({ ...profile, about })} rows={3} placeholder="Anything the coach should always know: your schedule, what motivates you, what doesn't work…" />
    </section>
  )
}

function FactList({ facts, onSave }: { facts: { t: string; at: string }[]; onSave: (f: { t: string; at: string }[]) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <ListEditor
      items={facts.map((f) => f.t)}
      onChange={(next) => onSave(next.map((t) => facts.find((f) => f.t === t) ?? { t, at: today }))}
      placeholder="Add something it should remember…"
    />
  )
}
