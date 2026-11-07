// CR3 + CR12: the evening shift study kit (tonight's pack, started as a
// focus timer, and its queue of CTF hints and readings) and the essay and
// assignment planner (due date + words → outline / draft / edit / submit,
// sent to Todoist so Ben's day planner places them).
import { useState } from 'react'
import { life } from '../bridge'
import { PACK_ICON, PACK_SUBJECT, QUEUE_LABEL, type QueueKind } from '@core/career/studyPack'
import { stepTask, type Essay } from '@core/career/essays'
import type { CareerView } from '../web/career'
import { Select } from '../Select'
import { useAction } from '../ui'
import { dayText, Empty, hm, shortDay, type Run } from './ui'

const STATE: Record<string, string> = { done: 'Done', 'on track': 'On track', behind: 'Behind', late: 'Late' }

export function StudyTab({ v, run }: { v: CareerView; run: Run }) {
  const c = life.career!
  const act = useAction()
  const st = v.study
  const [qKind, setQKind] = useState<QueueKind>('ctf')
  const [qText, setQText] = useState('')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [words, setWords] = useState('1500')
  const start = async () => {
    if (await act(() => life.focus.start(PACK_SUBJECT, st.pack.minutes), `Study pack started · ${st.pack.minutes} min. It counts as focus time.`)) window.dispatchEvent(new CustomEvent('life-focus-changed'))
  }
  const send = async (e: Essay) => {
    const td = life.todoist
    if (!td?.quickAdd) return
    const tasks: Record<string, string> = {}
    for (const s of e.steps.filter((x) => !x.done && !x.taskId)) {
      const t = await td.quickAdd(stepTask(e, s)).catch(() => null)
      if (t?.id) {
        tasks[s.id] = String(t.id)
        await td.update?.(String(t.id), { due: s.day, duration: s.minutes }).catch(() => null)
      }
    }
    await run(() => c.setStepTasks(e.id, tasks), Object.keys(tasks).length ? `${Object.keys(tasks).length} steps are in Todoist: Ben's day plan will place them` : 'Todoist did not take them: try again later')
  }
  return (
    <div className="cr-study">
      <section className={`cr-card cr-kit${st.shift?.now ? ' live' : ''}`} aria-label="Shift study kit">
        <header>
          <div>
            <h3>Shift study kit</h3>
            <p className="hint">{st.shift ? (st.shift.mode === 'off' ? 'No shift tonight.' : `Tonight's shift ${st.shift.from}–${st.shift.to}${st.shift.now ? ' · on now: a quiet moment?' : ''}. Ben offers a pack on the island and Telegram once it starts.`) : 'Set your work window in Settings → Ben → My life, and Ben offers packs during your shift.'}</p>
          </div>
          <span className="cr-pill">{st.packsWeek.count ? `${st.packsWeek.count} pack${st.packsWeek.count === 1 ? '' : 's'} · ${hm(st.packsWeek.minutes)} this week` : 'No packs yet this week'}</span>
        </header>
        <ul className="cr-pack">
          {st.pack.items.map((i, n) => (
            <li key={n}>
              <span aria-hidden>{PACK_ICON[i.kind]}</span>
              <span>{i.link ? <a href={i.link} target="_blank" rel="noreferrer noopener">{i.text}</a> : i.text}</span>
              <small>{i.minutes} min</small>
            </li>
          ))}
        </ul>
        <div className="cr-form-foot">
          <button className="btn small primary" onClick={() => void start()}>
            ▶ Start {st.pack.minutes} min pack
          </button>
          <button className="btn small ghost" onClick={() => void run(() => c.nextPack())}>
            Another pack
          </button>
        </div>
        <form
          className="cr-form-row cr-queue-add"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => c.addQueue({ kind: qKind, text: qText }), 'Queued for a pack').then(() => setQText(''))
          }}
        >
          <Select value={qKind} onChange={(e) => setQKind(e.target.value as QueueKind)} aria-label="Kind">
            {(['ctf', 'reading', 'other'] as QueueKind[]).map((k) => (
              <option key={k} value={k}>
                {QUEUE_LABEL[k]}
              </option>
            ))}
          </Select>
          <input value={qText} onChange={(e) => setQText(e.target.value)} placeholder={qKind === 'ctf' ? 'A challenge to try a hint on' : 'Something short to read'} maxLength={160} aria-label="Add to the pack queue" />
          <button className="btn small ghost" disabled={!qText.trim()}>
            Queue
          </button>
        </form>
        {st.queue.filter((q) => !q.done).length > 0 && (
          <ul className="cr-queue">
            {st.queue
              .filter((q) => !q.done)
              .slice(0, 5)
              .map((q) => (
                <li key={q.id}>
                  <small className="cr-tag">{QUEUE_LABEL[q.kind]}</small>
                  <span>{q.text}</span>
                  <button className="cr-x" onClick={() => void run(() => c.doneQueue(q.id), 'Done')} title="Done" aria-label={`Done: ${q.text}`}>
                    ✓
                  </button>
                  <button className="cr-x" onClick={() => void run(() => c.removeQueue(q.id))} title="Remove" aria-label={`Remove ${q.text}`}>
                    🗑
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
      <section className="cr-card cr-essays" aria-label="Essays and assignments">
        <h3>Essays and assignments</h3>
        <form
          className="cr-form-row"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => c.addEssay({ title, due, words: Number(words) || 1000 }), `Planned backward from ${due}`).then(() => {
              setTitle('')
              setDue('')
            })
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Essay or lab report" maxLength={100} aria-label="Title" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" min={v.today} />
          <input type="number" value={words} onChange={(e) => setWords(e.target.value)} min={100} max={20000} step={100} aria-label="Words" className="cr-num" />
          <button className="btn small primary" disabled={!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(due)}>
            Plan it
          </button>
        </form>
        {st.essays.length ? (
          <div className="cr-essay-list">
            {st.essays.slice(0, 2).map(({ essay: e, status: s }) => (
              <article key={e.id} className={`cr-essay st-${s.state.replace(' ', '-')}`}>
                <header>
                  <b>{e.title}</b>
                  <span className="cr-badge">{STATE[s.state]}</span>
                  <small className="hint">
                    {e.words.toLocaleString('en-US')} words · due {dayText(e.due)}
                    {s.state !== 'done' && ` · ${hm(s.minutesLeft)} left`}
                    {e.tight && ' · tight'}
                  </small>
                </header>
                <ol className="cr-steps">
                  {e.steps.map((x) => (
                    <li key={x.id} className={`${x.done ? 'done' : ''}${!x.done && x.day < v.today ? ' late' : ''}${x.day === v.today ? ' today' : ''}`}>
                      <label>
                        <input type="checkbox" checked={x.done} onChange={(ev) => void run(() => c.tickStep(e.id, x.id, ev.target.checked), ev.target.checked ? `${x.label} done` : undefined)} />
                        <b>{x.label}</b>
                      </label>
                      <small>
                        {x.day === v.today ? 'today' : shortDay(x.day)} · {x.minutes}m{x.taskId ? ' · in Todoist' : ''}
                      </small>
                    </li>
                  ))}
                </ol>
                <div className="cr-form-foot">
                  {s.state === 'behind' && (
                    <button className="btn small primary" onClick={() => void run(() => c.replanEssay(e.id), 'Replanned from today')}>
                      Replan from today
                    </button>
                  )}
                  {life.todoist?.quickAdd && s.state !== 'done' && e.steps.some((x) => !x.done && !x.taskId) && (
                    <button className="btn small ghost" onClick={() => void send(e)}>
                      Send to my planner
                    </button>
                  )}
                  <button className="cr-x" onClick={() => void run(() => c.removeEssay(e.id), 'Removed')} title="Remove" aria-label={`Remove ${e.title}`}>
                    🗑
                  </button>
                </div>
              </article>
            ))}
            {st.essays.length > 2 && <p className="hint">+{st.essays.length - 2} more, due later: they move up as these get done.</p>}
          </div>
        ) : (
          <Empty title="Nothing due">Add an essay or report: it's split backward into outline, draft, edit and submit, and Ben warns you early if you fall behind.</Empty>
        )}
      </section>
    </div>
  )
}
