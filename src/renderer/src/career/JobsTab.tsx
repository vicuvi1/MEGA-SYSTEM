// CR1: the job board (found → applied → interview → offer / no), the weekly
// quota with the last 8 weeks, follow-ups due, and a quick add line.
// Cards move with a button or by dragging them to another column.
import { useState } from 'react'
import { life } from '../bridge'
import { STAGES, STAGE_LABEL, type Job, type Stage } from '@core/career/jobs'
import type { CareerView } from '../web/career'
import { Select } from '../Select'
import { CrRing, shortDay, type Run } from './ui'

const NEXT: Partial<Record<Stage, Stage>> = { found: 'applied', applied: 'interview', interview: 'offer' }

export function JobsTab({ v, run }: { v: CareerView; run: Run }) {
  const c = life.career!
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [link, setLink] = useState('')
  const [stage, setStage] = useState<Stage>('found')
  const [over, setOver] = useState<Stage | null>(null)
  const w = v.week
  const add = async () => {
    await run(() => c.addJob({ company, role, link: link || null, stage }), stage === 'applied' ? `Applied: ${company || role} · ${w.sent + 1} of ${w.quota} this week` : `On the board: ${company || role}`)
    setCompany('')
    setRole('')
    setLink('')
  }
  const move = (j: Job, s: Stage) => run(() => c.moveJob(j.id, s), s === 'applied' ? `Applied to ${j.company}. Follow-up in a week.` : `${j.company}: ${STAGE_LABEL[s]}`)
  const max = Math.max(w.quota, ...w.history.map((h) => h.sent), 1)
  return (
    <div className="cr-jobs">
      <div className="cr-row3">
        <section className="cr-card cr-quota">
          <CrRing pct={w.quota ? (w.sent / w.quota) * 100 : 0} tone={w.sent >= w.quota ? 'good' : w.onPace ? 'calm' : 'warn'}>
            <b>
              {w.sent}/{w.quota}
            </b>
            <small>this week</small>
          </CrRing>
          <div className="cr-quota-txt">
            <h3>Weekly applications</h3>
            <p className="hint">
              {w.left ? `${w.left} to go · ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} left${w.onPace ? ' · on pace' : ` · you should be at ${w.paceNow}`}` : 'Quota made this week ✓'}
              {w.streak > 0 && ` · 🔥 ${w.streak} week${w.streak === 1 ? '' : 's'} in a row`}
            </p>
            <div className="cr-step" role="group" aria-label="Weekly quota">
              <button className="btn small ghost" aria-label="Lower the quota" onClick={() => void run(() => c.setQuota(w.quota - 1))} disabled={w.quota <= 0}>
                −
              </button>
              <span>{w.quota} a week</span>
              <button className="btn small ghost" aria-label="Raise the quota" onClick={() => void run(() => c.setQuota(w.quota + 1))}>
                +
              </button>
            </div>
          </div>
          <div className="cr-weeks" aria-label="Applications in the last 8 weeks">
            {w.history.map((h, i) => (
              <span key={h.monday} title={`Week of ${shortDay(h.monday)}: ${h.sent}`} className={`${h.sent >= w.quota && w.quota ? 'ok' : ''}${i === w.history.length - 1 ? ' now' : ''}`}>
                <i style={{ transform: `scaleY(${Math.max(0.06, h.sent / max)})` }} />
              </span>
            ))}
          </div>
        </section>
        <section className="cr-card cr-funnel">
          <h3>Your funnel</h3>
          <div className="cr-fun">
            <div>
              <b>{v.funnel.applied}</b>
              <small>applied</small>
            </div>
            <i aria-hidden>→</i>
            <div>
              <b>{v.funnel.interviews}</b>
              <small>interviews</small>
            </div>
            <i aria-hidden>→</i>
            <div>
              <b>{v.funnel.offers}</b>
              <small>offers</small>
            </div>
          </div>
          <p className="hint">{v.funnel.responseRate == null ? 'Send the first one: it gets easier.' : `${Math.round(v.funnel.responseRate * 100)}% of applications got an interview.`}</p>
        </section>
        <section className="cr-card cr-follow">
          <h3>
            Follow-ups <small className="hint">Ben reminds you on Telegram</small>
          </h3>
          {v.followUps.length ? (
            <ul>
              {v.followUps.slice(0, 3).map((j) => (
                <li key={j.id}>
                  <span>
                    <b>{j.company}</b> <small className="hint">{j.stage === 'interview' ? 'thank-you after the interview' : j.stage === 'offer' ? 'answer the offer' : `applied ${shortDay(j.applied ?? j.added)}`}</small>
                  </span>
                  <button className="btn small primary" onClick={() => void run(() => c.followedUp(j.id), `Followed up with ${j.company}`)}>
                    Done
                  </button>
                  <button className="btn small ghost" onClick={() => void run(() => c.snooze(j.id), 'In 3 days')}>
                    Later
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Nothing to chase today.</p>
          )}
        </section>
      </div>
      <form
        className="cr-add cr-card"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" maxLength={80} aria-label="Company" />
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role, e.g. SOC intern" maxLength={80} aria-label="Role" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link to the ad (optional)" maxLength={300} aria-label="Link" />
        <Select value={stage} onChange={(e) => setStage(e.target.value as Stage)} aria-label="Stage">
          <option value="found">Found it</option>
          <option value="applied">Applied already</option>
        </Select>
        <button className="btn small primary" disabled={!company.trim() && !role.trim()}>
          Add
        </button>
      </form>
      <div className="cr-board" role="list" aria-label="Job board">
        {STAGES.map((s) => {
          const list = v.jobs.jobs.filter((j) => j.stage === s)
          return (
            <section
              key={s}
              className={`cr-col s-${s}${over === s ? ' over' : ''}`}
              aria-label={STAGE_LABEL[s]}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(s)
              }}
              onDragLeave={() => setOver((o) => (o === s ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const id = e.dataTransfer.getData('text/x-job')
                const j = v.jobs.jobs.find((x) => x.id === id)
                if (j && j.stage !== s) void move(j, s)
              }}
            >
              <header>
                <b>{STAGE_LABEL[s]}</b>
                <small>{list.length}</small>
              </header>
              {list.slice(0, 8).map((j) => (
                <article key={j.id} className="cr-job" role="listitem" draggable onDragStart={(e) => e.dataTransfer.setData('text/x-job', j.id)}>
                  <b title={j.company}>{j.company}</b>
                  <span title={j.role}>{j.role}</span>
                  <small className="hint">
                    {j.applied ? `applied ${shortDay(j.applied)}` : `found ${shortDay(j.added)}`}
                    {j.followUp && ` · follow up ${shortDay(j.followUp)}`}
                  </small>
                  <div className="cr-job-act">
                    {NEXT[s] && (
                      <button className="btn small ghost" onClick={() => void move(j, NEXT[s]!)} title={`Move to ${STAGE_LABEL[NEXT[s]!]}`}>
                        {STAGE_LABEL[NEXT[s]!]} →
                      </button>
                    )}
                    {s !== 'no' && s !== 'offer' && (
                      <button className="cr-x" onClick={() => void move(j, 'no')} title="They said no" aria-label={`${j.company}: no`}>
                        ✕
                      </button>
                    )}
                    {j.link && (
                      <a className="cr-x" href={j.link} target="_blank" rel="noreferrer noopener" title="Open the ad" aria-label={`Open the ad for ${j.company}`}>
                        ↗
                      </a>
                    )}
                    {(s === 'no' || s === 'found') && (
                      <button className="cr-x" onClick={() => void run(() => c.removeJob(j.id), 'Removed')} title="Remove" aria-label={`Remove ${j.company}`}>
                        🗑
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {list.length > 8 && <small className="hint">+{list.length - 8} more</small>}
              {!list.length && <small className="cr-col-empty">{s === 'found' ? 'Jobs you want to apply to' : 'Drag a card here'}</small>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
