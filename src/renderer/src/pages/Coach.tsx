// Coach: one chat with your coach (the same brain and memory as the Telegram
// bots, so the conversation continues wherever you are), what it remembers
// about you (edit or delete), and the goals & rules it holds you to.
import { useCallback, useEffect, useRef, useState } from 'react'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useAction } from '../ui'
import { useLive } from '../live'
import type { CoachMind } from '@core/coachMind'

type Entry = { role: 'me' | 'coach'; bot: string; via: string; text: string; done?: string[]; at: string; pending?: boolean; steps?: string[] }
type Profile = { about: string; goals: string[]; rules: string[] }

const BOT_LABEL: Record<string, string> = { mega: 'Mega', finance: 'Finance', waky: 'Waky', sport: 'Sport' }
const CARDS: { title: string; sub: string; ask: string }[] = [
  { title: 'What now?', sub: 'The one thing that matters most right now', ask: 'What should I focus on right now? Be specific.' },
  { title: 'Plan my day', sub: 'Blocks in my free time, from my calendar', ask: 'Plan the rest of my day around my calendar and put the blocks in it.' },
  { title: 'Honest week review', sub: 'Where I improved, where I slipped', ask: 'How was my week, honestly? What should I change next week?' },
  { title: 'Push me', sub: "I'm procrastinating. Tough love, one step", ask: "I'm procrastinating right now. Push me and give me one step to start." }
]
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
  const [mind, setMind] = useState<CoachMind | null>(null)
  const end = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!life.coach) return setLog([])
    const [l, m, p] = await Promise.all([life.coach.log().catch(() => []), life.coach.memory().catch(() => ({ facts: [] })), life.coach.profile().catch(() => null)])
    setLog(l)
    setFacts(m.facts)
    if (p) setProfile(p)
    life.coach.mind?.().then(setMind).catch(() => {})
  }, [])
  useEffect(() => {
    void load()
    life.coach?.model().then(setModel).catch(() => {})
  }, [load])
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [log?.length])
  // Live: what you and the coach say on Telegram appears here as it happens.
  const busyRef = useRef(false)
  busyRef.current = busy
  useLive(() => {
    if (busyRef.current || !life.coach) return
    life.coach
      .log()
      .then((l) => setLog((cur) => (busyRef.current || (cur && cur.length === l.length && cur[cur.length - 1]?.at === l[l.length - 1]?.at) ? cur : l)))
      .catch(() => {})
    life.coach.memory().then((m) => setFacts(m.facts)).catch(() => {})
    life.coach.mind?.().then(setMind).catch(() => {})
  })

  const send = async (msg = text) => {
    const t = msg.trim()
    if (!t || busy || !life.coach) return
    setText('')
    setBusy(true)
    const now = new Date().toISOString()
    setLog((l) => [...(l ?? []), { role: 'me', bot: 'mega', via: 'app', text: t, at: now }, { role: 'coach', bot: 'mega', via: 'app', text: '', at: now, pending: true }])
    try {
      const seen: string[] = []
      const r = await life.coach.chat(t, (st) => {
        if (seen.includes(st)) return
        seen.push(st)
        setLog((l) => (l ?? []).map((x) => (x.pending ? { ...x, steps: [...seen] } : x)))
      })
      setLog((l) => [...(l ?? []).filter((x) => !x.pending), { role: 'coach', bot: 'mega', via: 'app', text: r.reply, done: r.done, at: new Date().toISOString(), steps: seen.filter((x) => !/^Reading your day$/.test(x)) }])
      if (r.done.length) onWallet()
      void life.coach.memory().then((m) => setFacts(m.facts)).catch(() => {})
      void life.coach.mind?.().then(setMind).catch(() => {})
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
          <span className="co-model" title="Same coach and memory as your Telegram bots">
            <i /> {model ? model.replace(/^.*\//, '') : 'Same coach as your bots'}
          </span>
        </header>
        <div className="co-stream">
          {log === null && <p className="hint">Loading your conversation…</p>}
          {log?.length === 0 && (
            <div className="co-hero">
              <span className="co-avatar">✦</span>
              <h3>What's on your mind?</h3>
              <p>Your coach sees your day, calendar, Todoist, sleep, training and money, and can act: log things, plan blocks, add tasks. Honest, direct, on your side.</p>
              <div className="co-cards">
                {CARDS.map((c) => (
                  <button key={c.title} className="co-card" disabled={busy} onClick={() => void send(c.ask)}>
                    <b>{c.title}</b>
                    <small>{c.sub}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {log?.map((m, i) => (
            <div key={i} className={`co-row ${m.role}`}>
            {m.role === 'coach' && <span className="co-avatar">✦</span>}
            <div className={`co-msg ${m.role} ${m.pending ? 'pending' : ''}`}>
              <div className="co-meta">
                {m.role === 'me' ? 'You' : `Coach${m.bot && m.bot !== 'mega' ? ` · ${BOT_LABEL[m.bot] ?? m.bot}` : ''}`}
                <span> · {m.via === 'app' ? 'app' : 'Telegram'} · {timeOf(m.at)}</span>
              </div>
              <div className="co-bubble">
                {m.pending ? (
                  <div className="co-thinking">
                    <span className="co-typing">
                      <i />
                      <i />
                      <i />
                    </span>
                    {!!m.steps?.length && (
                      <ul className="co-steps live">
                        {m.steps.map((st, k) => (
                          <li key={k} className={k === m.steps!.length - 1 ? 'now' : 'ok'}>
                            {st}
                            {k === m.steps!.length - 1 ? '…' : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <>
                    {!!m.steps?.length && <div className="co-steps-done">{m.steps.join(' · ')}</div>}
                    {m.text}
                  </>
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
            </div>
          ))}
          <div ref={end} />
        </div>
        {!!log?.length && <div className="co-quick">
          {QUICK.map((q) => (
            <button key={q} className="wp-chip" disabled={busy} onClick={() => void send(q)}>
              {q}
            </button>
          ))}
        </div>}
        <form
          className="co-composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(180, e.target.scrollHeight)}px`
            }}
            placeholder="Message your coach…"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <button className="co-send" disabled={busy || !text.trim()} aria-label="Send" title="Send (Enter)">
            {busy ? '…' : '↑'}
          </button>
        </form>
      </section>

      <aside className="co-side">
        {profile && <GoalsRules profile={profile} onSave={saveProfile} />}
        {mind && (
          <Learning
            mind={mind}
            onSave={async (next) => {
              setMind(next)
              await act(() => life.coach!.setMind!(next))
            }}
          />
        )}
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

/** What the coach is learning about you: goals it tracks, what works, patterns. Delete what's wrong. */
function Learning({ mind, onSave }: { mind: CoachMind; onSave: (m: CoachMind) => void }) {
  const empty = !mind.goals.length && !mind.works.length && !mind.fails.length && !mind.patterns.length
  const today = new Date().toISOString().slice(0, 10)
  const left = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000)
  const row = (key: string, text: string, sub: string, remove: () => void) => (
    <li key={key} className="co-learn-row">
      <span>
        {text}
        {sub && <small>{sub}</small>}
      </span>
      <button className="ta-act" aria-label="Forget" title="Forget this" onClick={remove}>
        ✕
      </button>
    </li>
  )
  const group = (title: string, items: React.ReactNode[]) =>
    items.length ? (
      <div className="co-learn-group">
        <h3>{title}</h3>
        <ul>{items}</ul>
      </div>
    ) : null
  return (
    <section className="panel co-learn">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> What the coach is learning
        </h2>
      </header>
      {empty ? (
        <p className="hint small">Nothing yet. Tell it a goal with a date ("pass algebra by 15 Dec, 6h a week") and it tracks it; it also notes what works for you and patterns in your data.</p>
      ) : (
        <>
          {group(
            'Goals it tracks',
            mind.goals.map((g, i) =>
              row(`g${i}`, g.title, [g.deadline ? (left(g.deadline) >= 0 ? `${left(g.deadline)} days left` : `${-left(g.deadline)} days late`) : '', g.weekly ? `${g.weekly} a week` : ''].filter(Boolean).join(' · '), () => onSave({ ...mind, goals: mind.goals.filter((_, k) => k !== i) }))
            )
          )}
          {group('What works for you', mind.works.map((x, i) => row(`w${i}`, x.t, '', () => onSave({ ...mind, works: mind.works.filter((_, k) => k !== i) }))))}
          {group("What doesn't", mind.fails.map((x, i) => row(`f${i}`, x.t, '', () => onSave({ ...mind, fails: mind.fails.filter((_, k) => k !== i) }))))}
          {group('Patterns', mind.patterns.map((x, i) => row(`p${i}`, x.t, '', () => onSave({ ...mind, patterns: mind.patterns.filter((_, k) => k !== i) }))))}
        </>
      )}
    </section>
  )
}
