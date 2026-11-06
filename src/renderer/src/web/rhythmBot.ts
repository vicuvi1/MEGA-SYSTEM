// The coach's daily rhythm (core/rhythm.ts holds the pure rules): it proposes
// the day, puts an approved plan into your calendar and Todoist, writes the
// evening and Sunday reviews, and the water and training nudges. Used by the
// tick on the server (Telegram, Mega) and by the app (Today, Coach).
import { behindMove, weeklyGoalLines } from '@core/goalsBen'
import { checkModelPlan, estimateMinutes, packDay, relinkAlso, type PlanTask } from '@core/dayPacker'
import { waterToday } from './coachStatus'
import { withTimeout } from '@core/ai'
import { addDays, dayKey } from '@core/dates'
import { progressReport, financeSpending } from '@core/progress'
import { sharedView, sportToday } from '@core/sportShared'
import { isStarred, type TodoTask } from '@core/todoist'
import {
  RHYTHM,
  RHYTHM_PREFS,
  cleanPrefs,
  cleanProposal,
  nameAndRank,
  dayScore,
  focusName,
  readLines,
  rhythmFor,
  suggestWeekFocus,
  weakest,
  type DayProposal,
  type DayResult,
  type RhythmPrefs,
  type RhythmState, blocksKept, editPlan, lightenForSleep, draftFits, bookBig3, fromMin, toMin } from '@core/rhythm'
import { getSetting, setSetting, readSetting } from '../../../main/settings'
import { COACH_SELFREVIEW, COACH_STORY, financeStateFrom, lifeContext, loadFeedback, loadLog, loadMemory, loadMind, loadProfile, loadStory, pickFacts, saveLetter, saveMind, sportState, loadStyle, saveStyle } from './botBrain'
import { REMINDERS, promiseLine, promiseStats } from '@core/coachKit'
import { deskPrompt, deskView } from './benDesk'
import { notesForBen } from '@core/notebook'
import { todayMode } from './extrasContext'
import { moodReviewLine, weekTimeFor } from './lifeExtras'
import { weekOf } from '@core/benStakes'
import type { CalEvent } from '@core/dayTime'
import { listNotes } from './notes'
import { applyMind } from '@core/coachMind'
import { mindText, weekSoFar } from '@core/coachMind'
import { COACH_HISTORY, bump, cleanHistory, impactVerdict, mondayOf, recordDay, scorecard, type CoachDay } from '@core/coachImpact'
import { bookBlocks, isGoalBlock, planGoal, planLine, type GoalPlan } from '@core/goalPlan'
import type { Mirror } from './mirror'
import type { AskModel, CalendarLike, TodoistLike } from './webBots'
import type { WebServices } from './webServices'
import { benNote, writeJournal } from './notes'
import { nightMinutes } from '@core/readiness'
import { dayLog, dayLogLine, recentDayLogs } from './dayLog'
import { bestHours, historyFacts, latestHour, moveLateStudy } from '@core/bestHours'
import { localDay } from '@core/dayTime'

/** LT4: a log entry's time on your clock (the log keeps UTC; the app day is dayKey). */
const localHm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)

export interface RhythmDeps {
  mirror: Mirror
  services: WebServices
  todoist: TodoistLike | null
  calendar: CalendarLike | null
  ai: AskModel | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const hmNow = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const quarterNow = (d = new Date()) => {
  const m = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15
  return `${pad(Math.min(23, Math.floor(m / 60)))}:${pad(m % 60)}`
}

function readJson<T>(db: any, key: string, fallback: T): T {
  try {
    return JSON.parse(getSetting(db, key) || 'null') ?? fallback
  } catch {
    return fallback
  }
}

export function createRhythm({ mirror, services, todoist, calendar, ai }: RhythmDeps) {
  const load = (db: any, today: string): RhythmState => rhythmFor(readJson(db, RHYTHM, null), today)
  const save = (db: any, s: RhythmState) => setSetting(db, RHYTHM, JSON.stringify(s))
  const dayBounds = () => {
    const s = new Date()
    s.setHours(0, 0, 0, 0)
    return [s.toISOString(), new Date(s.getTime() + 86400000).toISOString()] as const
  }

  // ---- The coach's history (for the scorecard) ----
  const history = (db: any, day: string, patch: Partial<CoachDay>) => setSetting(db, COACH_HISTORY, JSON.stringify(recordDay(cleanHistory(readJson(db, COACH_HISTORY, null)), day, patch)))
  const countPromise = (db: any, day: string, key: 'kept' | 'broken' | 'ignored') => setSetting(db, COACH_HISTORY, JSON.stringify(bump(cleanHistory(readJson(db, COACH_HISTORY, null)), day, key)))

  // ---- Goals planned backward from their deadlines ----
  const BOOKING = 'goal_booking'
  /** Every open focus goal with its plan (minutes a day, milestones, what a miss costs). */
  async function goalPlans(): Promise<GoalPlan[]> {
    return mirror.read((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today()
      const f = svc.focus.state()
      return f.goals.map((g) => {
        const todayMin = f.todaySessions.filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0)
        return planGoal(g, today, todayMin)
      })
    })
  }

  /**
   * Books each goal's blocks for the next 7 days in free time (today from now).
   * Our future blocks for those goals are removed first, so a missed day is
   * spread again over the days left (the deadline holds).
   */
  async function bookGoals(goalIds?: number[]): Promise<{ ok: boolean; lines: string[] }> {
    if (!calendar?.remove) return { ok: false, lines: ['⚠️ Connect Google Calendar (Settings) to book goal blocks'] }
    const all = await goalPlans()
    const plans = all.filter((p) => (!goalIds?.length || goalIds.includes(p.goalId)) && p.leftMin > 0 && p.daysLeft > 0)
    if (!plans.length) return { ok: false, lines: ['No open goal with a deadline to plan. Add one: title, subject, deadline, hours.'] }
    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const events = await calendar.events(start.toISOString(), new Date(start.getTime() + 8 * 86400000).toISOString())
    // Future blocks of ours for these goals go (they're replaced); started ones stay.
    const stale = events.filter((e) => plans.some((p) => isGoalBlock(e, p)) && Date.parse(e.start) > now.getTime())
    for (const e of stale) await calendar.remove(e.calendarId, e.id).catch(() => null)
    const keep = events.filter((e) => !stale.includes(e))
    const today = await mirror.read((db) => services.services(db).wallet.today())
    const blocks = bookBlocks(plans, keep, today, quarterNow(now), 7)
    let made = 0
    for (const b of blocks) {
      const s = new Date(`${b.day}T${b.start}:00`)
      const ok = await calendar.create({ title: b.title, start: s.toISOString(), end: new Date(s.getTime() + b.minutes * 60000).toISOString(), description: 'Goal plan from your coach in Life System (moves by itself when you miss a day)' }).then(() => true).catch(() => false)
      if (ok) made++
    }
    await mirror.write((db) => {
      const cur = readJson<{ goalIds: number[] }>(db, BOOKING, { goalIds: [] })
      setSetting(db as any, BOOKING, JSON.stringify({ goalIds: [...new Set([...(cur.goalIds ?? []), ...plans.map((p) => p.goalId)])], at: new Date().toISOString() }))
    })
    const lines = plans.map((p) => {
      const mine = blocks.filter((b) => b.goalId === p.goalId)
      const min = mine.reduce((t, b) => t + b.minutes, 0)
      const want = p.todayLeftMin + p.perDayMin * Math.min(6, Math.max(0, p.daysLeft - 1))
      return `🗓 ${p.title}: ${mine.length} blocks, ${(min / 60).toFixed(1)}h this week${min + 20 < want ? ` (⚠️ only room for ${(min / 60).toFixed(1)} of ${(want / 60).toFixed(1)}h)` : ''}`
    })
    return { ok: made > 0 || !blocks.length, lines: [...lines, ...(stale.length ? [`↻ Replaced ${stale.length} old block${stale.length === 1 ? '' : 's'}`] : [])] }
  }

  /** Every evening: goals with booked blocks are spread again over the days left. */
  async function rebookGoals(): Promise<string[]> {
    const ids = await mirror.read((db) => readJson<{ goalIds: number[] }>(db, BOOKING, { goalIds: [] }).goalIds ?? [])
    if (!ids.length || !calendar?.remove) return []
    const open = (await goalPlans()).filter((p) => ids.includes(p.goalId) && p.leftMin > 0 && p.daysLeft > 0).map((p) => p.goalId)
    if (!open.length) return []
    return (await bookGoals(open).catch(() => ({ lines: [] as string[] }))).lines
  }

  async function state(): Promise<{ state: RhythmState; prefs: RhythmPrefs }> {
    return mirror.read((db) => {
      const today = services.services(db).wallet.today()
      return { state: load(db, today), prefs: cleanPrefs(readJson(db, RHYTHM_PREFS, null)) }
    })
  }

  async function setPrefs(p: Partial<RhythmPrefs>): Promise<RhythmPrefs> {
    return mirror.write((db) => {
      const next = cleanPrefs({ ...cleanPrefs(readJson(db, RHYTHM_PREFS, null)), ...p })
      setSetting(db as any, RHYTHM_PREFS, JSON.stringify(next))
      return next
    })
  }

  /**
   * Context for the model: the same picture the coach sees in chat, plus what
   * he said today, his promises, what Ben remembers and his notebook (B6), so
   * the reviews quote his real words instead of sounding generic.
   */
  async function contextFor(events: any[] | null, todoToday: TodoTask[] | null, upcoming: TodoTask[] | null) {
    return mirror.read((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today()
      const safe = (f: () => string) => {
        try {
          return f()
        } catch {
          return ''
        }
      }
      return [
        lifeContext(svc, db, { finance: financeStateFrom(db, null), todoToday, upcoming, events }),
        (() => {
          const inp = svc.progress.input(null)
          return mindText(loadMind(db), today, weekSoFar(today, inp.focus, inp.workouts, inp.todoist))
        })(),
        `His goals: ${loadProfile(db).goals.join('; ')}`,
        safe(() => {
          const story = loadStory(db)
          return story ? `== Your story so far about him ==\n${story.text}` : ''
        }),
        safe(() => {
          const chat = loadLog(db).filter((e) => dayKey(e.at) === today).slice(-14)
          return chat.length ? `== What you two said today ==\n${chat.map((e) => `${localHm(e.at)} ${e.role === 'me' ? 'Victor' : 'Ben'}: ${e.text.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')}` : ''
        }),
        safe(() => promiseLine(promiseStats(readSetting(db as any, REMINDERS)))),
        safe(() => {
          const facts = pickFacts(loadMemory(db).facts, `${today} ${(loadProfile(db).goals ?? []).join(' ')}`, 12)
          return facts.length ? `== What you remember about him ==\n${facts.map((f) => `- ${f.t}`).join('\n')}` : ''
        }),
        safe(() => deskPrompt(svc, financeStateFrom(db, null))),
        safe(() => {
          const n = notesForBen(listNotes(db as any), 'review week goals')
          return n ? `== His notebook ==\n${n}` : ''
        })
      ]
        .filter(Boolean)
        .join('\n')
    })
  }

  /** Ben's notes to himself (from the evening or the late self-review). */
  async function saveSelfNotes(day: string, j: any): Promise<string[]> {
    const notes = (Array.isArray(j?.notes) ? j.notes : []).map((x: any) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 4)
    if (!notes.length) return []
    await mirror.write((db) => {
      setSetting(db as any, COACH_SELFREVIEW, JSON.stringify({ day, notes }))
      let m = loadMind(db)
      if (String(j.works ?? '').trim()) m = applyMind(m, { kind: 'works', text: String(j.works).trim().slice(0, 160) }, day).mind
      if (String(j.fails ?? '').trim()) m = applyMind(m, { kind: 'fails', text: String(j.fails).trim().slice(0, 160) }, day).mind
      saveMind(db, m)
    })
    return notes
  }

  /** Today's chat and feedback, for reviewing Ben's own coaching. */
  async function todayTalk(since?: string) {
    return mirror.read((db) => {
      const today = services.services(db).wallet.today()
      const log = loadLog(db).filter((e) => dayKey(e.at) === today && (!since || e.at > since)).slice(-40)
      const fb = loadFeedback(db).filter((f) => dayKey(f.at) === today && (!since || f.at > since))
      return {
        today,
        n: log.length,
        chat: log.map((e) => `${localHm(e.at)} ${e.role === 'me' ? 'Victor' : 'Ben'}${e.proactive ? ' (on his own)' : ''}: ${e.text.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n'),
        feedback: fb.map((f) => `${f.kind}: "${f.text.slice(0, 100)}"`).join('\n')
      }
    })
  }

  /** A plan for today (a new version when you ask to change or redo it). */
  async function propose(note = ''): Promise<{ plan: DayProposal; version: number }> {
    const now = new Date()
    // B22: "move gym to 19", "drop the reading block": changed in code, no AI call.
    if (note.trim()) {
      const edited = await mirror.write((db) => {
        const today = services.services(db).wallet.today(now)
        const st = load(db, today)
        const cur = st.briefing
        if (!cur || cur.plan.day !== today) return null
        const edited = editPlan(cur.plan, note)
        if (!edited) return null
        const plan = relinkAlso(edited)
        const version = (cur.version ?? 0) + 1
        save(db, { ...st, briefing: { status: 'proposed', sentAt: new Date().toISOString(), plan, version } })
        return { plan, version }
      })
      if (edited) return edited
    }
    const [events, tasks, upcoming] = await Promise.all([
      calendar ? calendar.events(...dayBounds()).catch(() => []) : Promise.resolve([]),
      todoist ? todoist.today().catch(() => [] as TodoTask[]) : Promise.resolve([] as TodoTask[]),
      todoist?.upcoming ? todoist.upcoming(7).catch(() => null) : Promise.resolve(null)
    ])
    const base = await mirror.read((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today(now)
      const st = load(db, today)
      const water = waterToday(db, svc, now).target
      const workoutDone = (svc.wallet.summary(now).todayRules ?? []).includes('body.workout_done') || !!svc.body.state(now).restToday
      // W5: last night's sleep. W4: yesterday's journal (score, lesson) and Ben's notes to himself.
      const night = db.prepare('SELECT bed_time, wake_time FROM sleep_logs WHERE day = ?').get(today) as { bed_time?: string; wake_time?: string } | undefined
      const slept = nightMinutes({ bedTime: night?.bed_time ?? null, wakeTime: night?.wake_time ?? null } as any)
      const yday = (() => {
        try {
          const j = listNotes(db as any).find((n: any) => n.title === `Journal/${addDays(today, -1)}`)
          const self = JSON.parse(getSetting(db as any, COACH_SELFREVIEW) || 'null')
          return [j ? String(j.body ?? '').replace(/\s+/g, ' ').slice(0, 300) : '', self?.day === addDays(today, -1) ? `Your notes: ${(self.notes ?? []).join(' / ')}` : ''].filter(Boolean).join(' ')
        } catch {
          return ''
        }
      })()
      // SI25: last week's real activity (only what he shares from the desktop): best hours, when he never studies.
      let past: ReturnType<typeof recentDayLogs> = []
      try {
        past = recentDayLogs(db, today, 7)
      } catch {
        past = []
      }
      const hist = { focus: past.flatMap((x) => x.d.focus ?? []), hours: past.map((x) => x.d.hours).filter((h): h is NonNullable<typeof h> => !!h && Object.keys(h).length > 0) }
      // DP1: goals behind pace (the Goals page) deserve time today.
      let behind: { title: string; minutes: number }[] = []
      try {
        behind = svc.goals
          .cards(now, financeStateFrom(db, null))
          .map((c) => ({ c, move: behindMove(c) }))
          .filter((x) => x.move && x.move.do.startsWith('focus:'))
          .slice(0, 2)
          .map((x) => ({ title: `Goal: ${x.c.goal.title}`.slice(0, 60), minutes: Number(x.move!.do.split(':')[1]) || 25 }))
      } catch {
        behind = []
      }
      return { today, st, water, workoutDone, slept, yday, mode: todayMode(db, today), hist, behind }
    })
    const histFacts = base.hist.hours.length >= 3 || base.hist.focus.length >= 3 ? historyFacts(base.hist) : ''
    const plans = await goalPlans().catch(() => [] as GoalPlan[])
    // Goal blocks already in today's calendar are busy time; only the rest still needs a slot.
    const bookedToday = (p: GoalPlan) => events.some((e) => isGoalBlock(e, p))
    const allGoalItems = plans.filter((p) => p.todayLeftMin >= 20 && !bookedToday(p)).map((p) => ({ title: `${p.subject}: ${p.title}`, minutes: Math.min(90, p.todayLeftMin) }))
    // A life mode (FT4): sick = no study blocks, travel = one short one, exam week = longer ones.
    const mode = base.mode
    const goalItems = !mode ? allGoalItems : mode.kind === 'sick' ? [] : mode.kind === 'travel' ? allGoalItems.slice(0, 1).map((g) => ({ ...g, minutes: Math.min(45, g.minutes) })) : allGoalItems.map((g) => ({ ...g, minutes: Math.min(90, Math.round((g.minutes * mode.focus) / 5) * 5) }))
    // DP1: ALL of today's work (due today, overdue, starred), packed around the calendar's fixed events.
    const planTasks: PlanTask[] = tasks.map((t) => ({ id: t.id, content: t.content, starred: isStarred(t), priority: t.priority, due: t.due, dueTime: t.dueTime, project: t.section ?? t.project, duration: t.duration ?? null }))
    const behindGoals = !mode || mode.kind === 'exam' ? base.behind.filter((g) => !goalItems.some((x) => x.title.toLowerCase().includes(g.title.slice(6).toLowerCase()))) : []
    const packed = packDay({
      goals: [...goalItems, ...behindGoals],
      today: base.today,
      now: hmNow(now),
      events,
      tasks: planTasks,
      top3: base.st.tomorrow?.day === base.today ? base.st.tomorrow.top3 : [],
      waterTarget: base.water,
      workoutDone: base.workoutDone,
      sleptMin: base.slept,
      best: base.hist.focus.length >= 3 ? bestHours(base.hist.focus) : []
    })
    // A life mode: sick = no blocks (the list stays), travel = one short block.
    const fallback = !mode
      ? packed
      : mode.kind === 'sick'
        ? relinkAlso({ ...packed, blocks: [], why: 'Sick day: rest first. Your tasks are on the list for when you feel better.' })
        : mode.kind === 'travel'
          ? relinkAlso({ ...packed, blocks: packed.blocks.slice(0, 1).map((b) => ({ ...b, minutes: Math.min(45, b.minutes) })), why: 'Travel day: one short block, the rest on the list.' })
          : packed
    let plan = fallback
    // W18: tomorrow's plan was drafted last night: used as it is when nothing new clashes (no AI call).
    const draft = !note && base.st.tomorrow?.day === base.today ? base.st.tomorrow.plan : undefined
    const useDraft = !!draft && draft.blocks.length > 0 && draftFits(draft, events) && draft.blocks.every((b) => b.start >= hmNow(now))
    if (useDraft) plan = { ...draft!, headline: `Planned last night: ${draft!.headline}`.slice(0, 160) }
    // No change asked: the rules' plan, named and ranked by a quick AI call (N6:
    // never times out; 15 s at most, else the rules' plan as it is).
    if (ai && !note && !useDraft) {
      try {
        const raw = await withTimeout(
          ai(
            [
              "You are BEN, Victor's coach. His day plan is built (times fixed) from ALL of today's tasks. Only: name each block in a few words tied to his goal (a block with several tasks names what they share), rank the must-dos (most important first, use the exact words), and write one short headline with numbers.",
              `Plan: ${JSON.stringify({ blocks: fallback.blocks.map((b) => ({ start: b.start, minutes: b.minutes, title: b.title, tasks: b.tasks })), mustdos: fallback.mustdos, training: fallback.training, alsoToday: (fallback.also ?? []).length })}`,
              plans.length ? `Goals: ${plans.map((p) => planLine(p)).join(' | ')}` : '',
              base.yday ? `Yesterday (use it: the headline names what went well or slipped and how today fixes it, e.g. "Yesterday 2/3, focus slipped after lunch, so the hard block is first"): ${base.yday}` : '',
              histFacts ? `His last week, from real activity: ${histFacts}.` : '',
              'Answer ONLY with JSON: {"headline": string, "mustdos": string[], "names": string[]} (names: one per block, same order).'
            ]
              .filter(Boolean)
              .join('\n'),
            { json: true, kind: 'plan-names' } as any
          ),
          15_000
        )
        const json = String(raw).match(/\{[\s\S]*\}/)?.[0]
        const named = nameAndRank(fallback, json ? JSON.parse(json) : null)
        // Quick-task blocks keep their plain name (the list is what matters there).
        plan = { ...named, blocks: named.blocks.map((b, i) => (b.kind === 'quick' ? fallback.blocks[i] : b)) }
      } catch {
        plan = fallback
      }
    } else if (ai) {
      try {
        const context = await contextFor(events, tasks, upcoming)
        const prev = base.st.briefing?.plan
        const prompt = [
          "You are BEN, Victor's best friend and coach. Plan his day: what makes today a win for his goals. Tough love, realistic.",
          `It is ${hmNow(now)}. Only plan from now on, never over calendar events (classes, commutes and meetings are fixed: plan AROUND them, 10 minutes to get there), with 10-minute breaks between blocks and nothing after 22:00. Exactly 3 must-dos when there are 3+ tasks (the ones that matter most; last night's top 3 first if given): they are his daily points, keep them at 3. A training slot if he hasn't trained today. Water goal in ml.`,
          'Consider ALL of today\'s tasks below (due today and overdue), not only the must-dos. Pack the important ones into 3–5 focus blocks (25–90 min, sized from the estimates, hard work in his best hours) in the free time between events; batch small tasks (about 15 min) into ONE "Quick tasks" block (kind "quick"). Every task must be accounted for: in a block (its exact title in that block\'s "tasks"), in "also" (with minutes), or in "deferred" with a short reason. A short night means fewer or shorter blocks, never one tiny block when the day has free hours and many tasks. "why": one line on why the day is planned this way.',
          `Fixed events today: ${events.filter((e) => !e.allDay).map((e) => `${new Date(e.start).toTimeString().slice(0, 5)}–${new Date(e.end).toTimeString().slice(0, 5)} ${e.title}`).join('; ') || 'none'}`,
          `Today's tasks (${planTasks.length}, priority 1 = most urgent): ${JSON.stringify(planTasks.slice(0, 40).map((t) => ({ task: t.content, project: t.project, priority: 5 - (t.priority ?? 1), overdue: !!(t.due && t.due < base.today), minutes: estimateMinutes(t) })))}`,
          base.slept != null && base.slept < 360 ? `Short night: he slept ${Math.floor(base.slept / 60)}h${String(base.slept % 60).padStart(2, '0')}. Lighter, not empty.` : '',
          mode ? `LIFE MODE today: ${mode.label}. ${mode.kind === 'sick' ? 'Keep it tiny: rest, water, sleep; at most one easy must-do; no focus blocks unless he asks; training null.' : mode.kind === 'travel' ? 'A light plan: one or two small must-dos, at most one short block; training null.' : 'Exam week: more and longer study blocks for the exam goals; a short walk instead of a full workout is fine.'}` : '',
          'Big picture first: blocks must move his tracked goals and nearest deadlines forward (see his goals, deadlines and weekly targets below); say which goal in the block title when it fits ("Algebra set (exam 15 Dec)").',
          'headline: one short line with numbers ("3 must-dos · 2h40 focus · gym 18:00").',
          note ? `He asked to change the previous plan: "${note}". Previous plan: ${JSON.stringify(prev ?? null)}` : prev ? `He asked for a different plan than: ${JSON.stringify(prev)}` : '',
          plans.length ? `Goals planned backward from their deadlines (today's minutes are a MUST; booked ones are already in the calendar):\n${plans.map((p) => `- ${planLine(p)}${bookedToday(p) ? ' (booked today)' : ''}`).join('\n')}` : '',
          histFacts ? `His last week, from real activity (put hard blocks in his best hours; never plan study later than he ever does): ${histFacts}.` : '',
          `A simple starting point (improve it): ${JSON.stringify(fallback)}`,
          'Answer ONLY with JSON: {"headline": string, "why": string, "mustdos": string[], "blocks": [{"title": string, "start": "HH:MM", "minutes": number, "kind": "focus" | "quick" | "goal", "tasks": string[]}], "also": [{"task": string, "minutes": number}], "deferred": [{"task": string, "why": string}], "training": {"time": "HH:MM", "what": string} | null, "waterMl": number}',
          '',
          '== Victor right now ==',
          context
        ]
          .filter(Boolean)
          .join('\n')
        const raw = await withTimeout(ai(prompt, { json: true, think: true, strong: true, kind: 'plan' }), 35_000)
        const json = String(raw).match(/\{[\s\S]*\}/)?.[0]
        // DP1: checked: every task accounted for, and the packer's plan when the model gave too little.
        plan = checkModelPlan(cleanProposal(json ? JSON.parse(json) : null, fallback, events, hmNow(now)), fallback, planTasks)
      } catch {
        plan = fallback
      }
    }
    // A short night: a lighter plan (W5).
    plan = lightenForSleep(plan, base.slept)
    // SI25: a study block later than he ever studies moves to his best free hour (and the headline says so).
    if (base.hist.hours.length >= 3) {
      const minOfDay = (iso: string) => {
        const d = new Date(iso)
        return d.getHours() * 60 + d.getMinutes()
      }
      const busy = events.filter((e) => !e.allDay && localDay(e.start) === base.today).map((e) => ({ start: minOfDay(e.start), end: minOfDay(e.end) }))
      const words = [...plans.flatMap((p) => [p.subject, p.title]), 'study']
      const moved = moveLateStudy(plan.blocks, { lastHour: latestHour(base.hist.hours, 'study'), best: bestHours(base.hist.focus), now: hmNow(now), busy, words })
      if (moved.note) plan = { ...plan, blocks: moved.blocks, headline: `${plan.headline} · ${moved.note}`.slice(0, 200) }
    }
    plan = relinkAlso(plan)
    return mirror.write((db) => {
      const st = load(db, plan.day)
      const version = (st.briefing?.version ?? 0) + 1
      save(db, { ...st, briefing: { status: 'proposed', sentAt: new Date().toISOString(), plan, version } })
      history(db, plan.day, { plan: 'proposed' })
      return { plan, version }
    })
  }

  /** Approved: blocks and training into the calendar, must-dos on Today (starred in Todoist). */
  async function approve(): Promise<{ ok: boolean; done: string[]; plan?: DayProposal }> {
    const cur = await mirror.read((db) => load(db, services.services(db).wallet.today()).briefing)
    if (!cur) return { ok: false, done: ['No plan to approve yet'] }
    if (cur.status === 'approved') return { ok: true, done: ['Already approved'], plan: cur.plan }
    const p = cur.plan
    const done: string[] = []
    // Mark first so a double tap doesn't make the blocks twice.
    await mirror.write((db) => {
      const st = load(db, p.day)
      if (st.briefing) save(db, { ...st, briefing: { ...st.briefing, status: 'approved' } })
      history(db, p.day, { plan: 'approved' })
    })
    if (calendar) {
      let made = 0
      // Blocks that already ended (approved late) don't go into the calendar.
      const items: { title: string; start: string; minutes: number; tasks?: string[] }[] = [...p.blocks.map((b) => ({ title: b.title, start: b.start, minutes: b.minutes, tasks: b.tasks })), ...(p.training ? [{ title: `💪 ${p.training.what}`, start: p.training.time, minutes: Number(/(\d+)\s*min/.exec(p.training.what)?.[1]) || 45 }] : [])].filter((b) => new Date(`${p.day}T${b.start}:00`).getTime() + b.minutes * 60000 > Date.now())
      for (const b of items) {
        const start = new Date(`${p.day}T${b.start}:00`)
        const ok = await calendar
          .create({ title: b.title, start: start.toISOString(), end: new Date(start.getTime() + b.minutes * 60000).toISOString(), description: ['Planned with your coach in Life System', ...(b.tasks?.length ? ['', ...b.tasks.map((t) => `- ${t}`)] : [])].join('\n') })
          .then(() => true)
          .catch(() => false)
        if (ok) made++
      }
      if (items.length) done.push(made ? `🗓 ${made} block${made === 1 ? '' : 's'} in your calendar` : '⚠️ Calendar: blocks not added')
    } else if (p.blocks.length) done.push('⚠️ Connect Google Calendar to get the blocks in your calendar')
    if (p.mustdos.length) {
      const added = await mirror.write((db) => {
        const svc = services.services(db)
        const plan = svc.focus.plan(p.day)
        const have = new Set(plan.items.map((x) => x.text.toLowerCase()))
        const fresh = p.mustdos.filter((m) => !have.has(m.toLowerCase()))
        if (fresh.length) svc.focus.setPlan([...plan.items.map((x) => x.text), ...fresh])
        return fresh
      })
      if (todoist) {
        const tasks = await todoist.today().catch(() => [] as TodoTask[])
        for (const m of added) {
          const t = tasks.find((x) => x.content.trim().toLowerCase() === m.toLowerCase())
          if (t && todoist.update) await todoist.update(t.id, { labels: [...new Set([...(t.labels ?? []), 'today'])] }).catch(() => null)
          else if (!t) await todoist.quickAdd(`${m} today @today`).catch(() => null)
        }
      }
      done.push(`⭐ ${p.mustdos.length} must-do${p.mustdos.length === 1 ? '' : 's'} on Today`)
    }
    return { ok: true, done, plan: p }
  }

  /** Planned vs done today. */
  async function dayResult(): Promise<DayResult> {
    return mirror.read((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today()
      const st = load(db, today)
      const f = svc.focus.state()
      const plan = svc.focus.plan(today)
      const water = waterToday(db, svc)
      // An approved plan counts, and so does one you never approved (K8): ignoring it isn't free.
      const blocks = st.briefing ? st.briefing.plan.blocks : []
      return {
        mustdosDone: plan.items.filter((x) => x.done).length,
        mustdosTotal: plan.items.length,
        focusMin: f.todayMin,
        plannedFocusMin: blocks.reduce((t, b) => t + b.minutes, 0),
        blocksDone: blocksKept(blocks, f.todaySessions, today),
        blocksPlanned: blocks.length,
        planApproved: st.briefing ? st.briefing.status === 'approved' : null,
        waterMl: water.ml,
        waterTarget: water.target,
        workoutDone: (svc.wallet.summary().todayRules ?? []).includes('body.workout_done') || !!svc.body.state().restToday,
        trainingPlanned: !!st.briefing?.plan.training
      }
    })
  }

  /** The evening review: the score, one lesson, tomorrow's top 3 (saved for the morning plan). */
  async function evening(): Promise<{ result: DayResult; score: number; lesson: string; top3: string[]; goals: string[]; rebooked: string[]; money: string | null }> {
    const result = await dayResult()
    const score = dayScore(result)
    const [open, tomorrowTasks] = await Promise.all([
      mirror.read((db) => {
        const svc = services.services(db)
        return svc.focus.plan(svc.wallet.today()).items.filter((x) => !x.done).map((x) => x.text)
      }),
      todoist?.upcoming ? todoist.upcoming(2).catch(() => [] as TodoTask[]) : Promise.resolve([] as TodoTask[])
    ])
    const today = await mirror.read((db) => services.services(db).wallet.today())
    const tomorrow = addDays(today, 1)
    const nextUp = tomorrowTasks.filter((t) => t.due && t.due <= tomorrow).sort((a, b) => b.priority - a.priority).map((t) => t.content)
    const islandLine = await mirror.read((db) => dayLogLine(dayLog(db, today))).catch(() => '')
    let lesson = weakest(result)
    let top3 = [...new Set([...open, ...nextUp])].slice(0, 3)
    if (ai) {
      try {
        const context = await contextFor(null, null, tomorrowTasks)
        // One call does the review AND Ben's notes on his own coaching (B4; the 23:15 self-review then usually skips).
        const talk = await todayTalk()
        const raw = await withTimeout(ai(
          [
            "You are BEN, Victor's best friend and coach. It's his evening review. Be honest and short.",
            `Today: score ${score}/100. ${JSON.stringify(result)}. Open must-dos: ${open.join('; ') || 'none'}. Due tomorrow in Todoist: ${nextUp.join('; ') || 'nothing'}.`,
            islandLine ? `From the desktop island: ${islandLine}.` : '',
            'lesson: ONE sentence: what to do differently tomorrow, concrete, tied to his numbers, patterns or what he said today. top3: tomorrow\'s 3 most important things (short, as tasks).',
            talk.chat ? 'Also review YOUR OWN coaching today, honestly: notes = 2–4 short concrete notes to yourself for tomorrow (what helped him act, what he ignored, where you were too long/generic/soft/hard); works = one thing that worked with him (or ""); fails = one that did not (or "").' : '',
            `Answer ONLY with JSON: {"lesson": string, "top3": string[]${talk.chat ? ', "notes": string[], "works": string, "fails": string' : ''}}`,
            '',
            context,
            talk.feedback ? `\n== His feedback on your replies today ==\n${talk.feedback}` : ''
          ].join('\n'),
          { json: true, think: true, strong: true, kind: 'review' }
        ), 35_000)
        const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? '{}')
        if (talk.chat) await saveSelfNotes(today, j).catch(() => [])
        if (typeof j.lesson === 'string' && j.lesson.trim()) lesson = j.lesson.trim().slice(0, 240)
        const t = (Array.isArray(j.top3) ? j.top3 : []).map((x: any) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3)
        if (t.length) top3 = t
      } catch {
        /* the plain review */
      }
    }
    await mirror.write((db) => {
      const st = load(db, today)
      save(db, { ...st, evening: { sentAt: new Date().toISOString(), score, top3, lesson }, tomorrow: { day: tomorrow, top3 } })
      history(db, today, { score, mustdos: [result.mustdosDone, result.mustdosTotal] })
      // The day in his notebook (Journal/YYYY-MM-DD), so Ben can look back later.
      try {
        writeJournal(db as any, today, {
          score,
          result: `Must-dos ${result.mustdosDone}/${result.mustdosTotal} · focus ${result.focusMin}/${result.plannedFocusMin} min · blocks ${result.blocksDone}/${result.blocksPlanned} · water ${(result.waterMl / 1000).toFixed(1)}/${(result.waterTarget / 1000).toFixed(1)} L · training ${result.workoutDone ? 'done' : 'not done'}`,
          lesson,
          top3
        })
      } catch {
        /* the review still goes out */
      }
    })
    // Goals: today's misses are spread over the days left, and booked blocks move.
    const goals = (await goalPlans().catch(() => [] as GoalPlan[])).filter((p) => p.status !== 'done')
    const rebooked = await rebookGoals().catch(() => [] as string[])
    return { result, score, lesson, top3, goals: goals.map(planLine), rebooked, money: await moneyLine() }
  }

  /** W17: one money line when the week runs over your usual spending (else null). */
  async function moneyLine(): Promise<string | null> {
    return mirror
      .read((db) => {
        const v = deskView(services.services(db), financeStateFrom(db, null))
        // A regular charge due in the next 2 days.
        const today = services.services(db).wallet.today()
        const big = v.recurring?.find((r) => r.next >= today && r.next <= addDays(today, 2))
        const when = big ? (big.next === today ? 'today' : big.next === addDays(today, 1) ? 'tomorrow' : 'in 2 days') : ''
        return [v.spend?.line ?? '', big ? `${big.name} (${Math.round(big.amount / 100)} lei) usually comes out ${when}.` : ''].filter(Boolean).join(' ') || null
      })
      .catch(() => null)
  }

  /** W18: after you keep tomorrow's top 3, the plan for tomorrow is drafted now (ready when you wake). */
  async function planTomorrow(): Promise<DayProposal | null> {
    const today = await mirror.read((db) => services.services(db).wallet.today())
    const day = addDays(today, 1)
    const [events, tasks] = await Promise.all([
      calendar ? calendar.events(new Date(`${day}T00:00:00`).toISOString(), new Date(`${day}T23:59:59`).toISOString()).catch(() => []) : Promise.resolve([]),
      todoist?.upcoming ? todoist.upcoming(2).catch(() => [] as TodoTask[]) : Promise.resolve([] as TodoTask[])
    ])
    return mirror.write((db) => {
      const svc = services.services(db)
      const st = load(db, today)
      const top3 = st.tomorrow?.day === day ? st.tomorrow.top3 : []
      const plan = packDay({ today: day, now: '08:00', events, tasks: tasks.filter((t) => t.due === day).map((t) => ({ id: t.id, content: t.content, starred: isStarred(t), priority: t.priority, due: t.due, dueTime: t.dueTime, project: t.section ?? t.project, duration: t.duration ?? null })), top3, waterTarget: waterToday(db, svc).target, workoutDone: false })
      save(db, { ...st, tomorrow: { day, top3, plan } })
      return plan
    })
  }

  /** W14: Wednesday: where the week stands, rules only. */
  async function midweek(): Promise<string> {
    return mirror.write((db) => {
      const svc = services.services(db)
      const st = load(db, svc.wallet.today())
      save(db, { ...st, midweek: true })
      const plan = svc.weekPlan.active()
      const report = progressReport(svc.progress.input(financeSpending(financeStateFrom(db, null))))
      const m = plan ? report.metrics.find((x) => x.id === plan.focus) : null
      const lines = [
        '📊 <b>Midweek check</b>',
        m ? `Week focus (${focusName(plan!.focus)}): ${m.text}${m.target ? ` of ${m.targetText}` : ''}.` : '',
        plan?.big3?.length ? `Big 3: ${plan.big3.filter((b: any) => b.done).length} of ${plan.big3.length} done${plan.big3.some((b: any) => !b.done) ? ` · still open: ${plan.big3.filter((b: any) => !b.done).map((b: any) => b.text).join(', ')}` : ''}.` : '',
        ...report.metrics.filter((x) => x.target && x.id !== plan?.focus && x.id !== 'spend').slice(0, 3).map((x) => `${x.label}: ${x.text} of ${x.targetText}`)
      ].filter(Boolean)
      const open = plan?.big3?.filter((b: any) => !b.done) ?? []
      lines.push(open.length ? `Thu–Sat needs: one block for each open big task (${open.length}). Want them booked?` : 'On track. Keep the rhythm through the weekend.')
      return lines.join('\n')
    })
  }

  /** W13: the week's big 3 as blocks in free time, shown first (saved until you tap "Book them"). */
  async function bookingPreview(): Promise<{ title: string; day: string; start: string; end: string }[]> {
    const today = await mirror.read((db) => services.services(db).wallet.today())
    const days = Array.from({ length: 7 }, (_, k) => addDays(today, k + (new Date().getHours() >= 20 ? 1 : 0)))
    const events = calendar ? await calendar.events(new Date(`${days[0]}T00:00:00`).toISOString(), new Date(`${days[6]}T23:59:59`).toISOString()).catch(() => []) : []
    return mirror.write((db) => {
      const svc = services.services(db)
      const st = load(db, today)
      const big3 = (svc.weekPlan.active()?.big3 ?? []).filter((b: any) => !b.done).map((b: any) => b.text)
      const booking = bookBig3(big3, events, days, new Date().toISOString())
      save(db, { ...st, booking })
      return booking
    })
  }
  async function bookWeek(): Promise<string[]> {
    const list = await mirror.read((db) => load(db, services.services(db).wallet.today()).booking ?? [])
    if (!calendar || !list.length) return []
    const done: string[] = []
    for (const b of list) {
      const ok = await calendar.create({ title: b.title, start: new Date(`${b.day}T${b.start}:00`).toISOString(), end: new Date(`${b.day}T${b.end}:00`).toISOString(), description: 'Week plan · booked by Ben in Life System' }).then(() => true).catch(() => false)
      if (ok) done.push(`${b.day.slice(5)} ${b.start} ${b.title}`)
    }
    await mirror.write((db) => {
      const st = load(db, services.services(db).wallet.today())
      save(db, { ...st, booking: [] })
    })
    return done
  }

  /**
   * W20: when "is Ben helping?" says not working yet, Ben changes ONE thing
   * for next week (fewer nudges, the plan 30 minutes earlier, a gentler
   * tone), in turn, and says what he changed.
   */
  async function adaptIfNotWorking(verdict: string): Promise<string | null> {
    if (verdict !== 'not yet') return null
    return mirror.write((db) => {
      const today = services.services(db).wallet.today()
      const week = mondayOf(today)
      let done: { week: string; change: string }[] = []
      try {
        done = JSON.parse(getSetting(db as any, 'coach_adapt') || '[]')
      } catch {
        done = []
      }
      if (done.some((d) => d.week === week)) return null
      const order = ['fewer-nudges', 'earlier-plan', 'gentler']
      const change = order[done.length % order.length]
      let line = ''
      if (change === 'fewer-nudges') {
        const cur = JSON.parse(getSetting(db as any, 'coach_nudges') || '{}')
        setSetting(db as any, 'coach_nudges', JSON.stringify({ ...cur, max: 5 }))
        line = 'fewer nudges: 5 a day at most, so each one counts'
      } else if (change === 'earlier-plan') {
        const prefs = cleanPrefs(readJson(db, RHYTHM_PREFS, null))
        const at = fromMin(Math.max(toMin('06:30'), toMin(prefs.autopilot ?? '07:30') - 30))
        setSetting(db as any, RHYTHM_PREFS, JSON.stringify({ ...prefs, autopilot: at }))
        line = `your plan comes 30 minutes earlier (${at}), before the day runs away`
      } else {
        const tone = loadStyle(db).tone
        saveStyle(db, { tone: Math.max(2, tone - 1) })
        line = 'a gentler tone: smaller steps, less pressure'
      }
      setSetting(db as any, 'coach_adapt', JSON.stringify([...done, { week, change }].slice(-20)))
      return `🔧 It isn't working yet, so I'm changing one thing next week: ${line}.`
    })
  }

  async function setTop3(text: string): Promise<string[]> {
    const top3 = readLines(text)
    await mirror.write((db) => {
      const today = services.services(db).wallet.today()
      const st = load(db, today)
      save(db, { ...st, tomorrow: { day: addDays(today, 1), top3 } })
    })
    return top3
  }

  /** The Sunday review: the week in numbers, a win, a leak, next week's focus and big 3. */
  async function weekly(): Promise<{ score: number; prevScore: number; lines: string[]; win: string; leak: string; focus: string; note: string; big3: string[] }> {
    const { report, today } = await mirror.read((db) => {
      const svc = services.services(db)
      const input = svc.progress.input(financeSpending(financeStateFrom(db, null)))
      return { report: progressReport(input), today: svc.wallet.today() }
    })
    const coachCheck = await mirror.read((db) => {
      const svc = services.services(db)
      const rows = scorecard(cleanHistory(readJson(db, COACH_HISTORY, null)), svc.progress.input(null, new Date(), 70).focus, svc.wallet.today(), 8)
      const v = impactVerdict(rows)
      const label = { working: 'working, you are improving', mixed: 'mixed', 'not yet': 'not working yet, we change something', 'too early': 'too early to tell' }[v.verdict]
      return { text: `Is the coach working? ${label}${v.verdict === 'too early' ? '' : ` (${v.lines.join('; ')})`}`, verdict: v.verdict as string }
    })
    const adapt = await adaptIfNotWorking(coachCheck.verdict).catch(() => null)
    const money = await moneyLine()
    const goalLines = (await goalPlans().catch(() => [] as GoalPlan[])).filter((p) => p.status !== 'done').map((p) => `🎯 ${planLine(p)}`)
    // Measurable goals: this week's change and where each stands (Sunday review).
    goalLines.push(...(await mirror.read((db) => weeklyGoalLines(services.services(db).goals.cards(new Date(), financeStateFrom(db, null)), today)).catch(() => [] as string[])))
    // Planned vs real time per subject (FT10) and how mood moves with sleep and training (FT13).
    const monday = weekOf(today)
    const weekEvents = calendar ? await calendar.events(new Date(`${monday}T00:00:00`).toISOString(), new Date().toISOString()).catch(() => [] as CalEvent[]) : []
    const extraLines = await mirror
      .read((db) => {
        const svc = services.services(db)
        const fin = financeStateFrom(db, null)
        return [weekTimeFor(svc, weekEvents, today).line, moodReviewLine(svc, fin)].filter(Boolean)
      })
      .catch(() => [] as string[])
    const lines = [...report.metrics.map((m) => `${m.label}: ${m.text}${m.target ? ` of ${m.targetText}` : ''} (${m.trend})`), ...goalLines, ...extraLines, coachCheck.text, ...(adapt ? [adapt] : []), ...(money ? [`💸 ${money}`] : [])]
    const ranked = report.metrics.filter((m) => m.target && m.id !== 'spend').map((m) => ({ m, k: m.now / (m.target as number) })).sort((a, b) => b.k - a.k)
    const upcoming = todoist?.upcoming ? await todoist.upcoming(8).catch(() => [] as TodoTask[]) : []
    let out = {
      score: report.score,
      prevScore: report.prevScore,
      lines,
      win: ranked[0] ? `${ranked[0].m.label}: ${ranked[0].m.text}` : 'You showed up.',
      leak: ranked.length ? `${ranked[ranked.length - 1].m.label}: ${ranked[ranked.length - 1].m.text}${ranked[ranked.length - 1].m.target ? ` of ${ranked[ranked.length - 1].m.targetText}` : ''}` : 'Not enough data yet.',
      focus: suggestWeekFocus(report.metrics as any),
      note: '',
      big3: [...upcoming].sort((a, b) => b.priority - a.priority).slice(0, 3).map((t) => t.content)
    }
    if (ai) {
      try {
        const context = await contextFor(null, null, upcoming)
        const raw = await withTimeout(ai(
          [
            "You are BEN, Victor's best friend and coach. Sunday review of his week. Honest, short, numbers.",
            `Week score ${report.score}/100 (last week ${report.prevScore}). ${lines.join('; ')}.`,
            'win: the best thing this week (with its number). leak: the biggest leak (with its number). focus: next week\'s ONE area, one of focus|wake|sport|clean|todoist|spend|mustdo. note: his target in a few words ("up at 7:00 every day"). big3: the 3 big tasks for next week (from his deadlines and goals).',
            'Answer ONLY with JSON: {"win": string, "leak": string, "focus": string, "note": string, "big3": string[]}',
            '',
            context
          ].join('\n'),
          { json: true, think: true, strong: true, kind: 'weekly' }
        ), 35_000)
        const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? '{}')
        const big3 = (Array.isArray(j.big3) ? j.big3 : []).map((x: any) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3)
        out = {
          ...out,
          win: String(j.win ?? '').trim().slice(0, 200) || out.win,
          leak: String(j.leak ?? '').trim().slice(0, 200) || out.leak,
          focus: ['focus', 'wake', 'sport', 'clean', 'todoist', 'spend', 'mustdo'].includes(j.focus) ? j.focus : out.focus,
          note: String(j.note ?? '').trim().slice(0, 140),
          big3: big3.length ? big3 : out.big3
        }
      } catch {
        /* the plain review */
      }
    }
    await mirror.write((db) => {
      const st = load(db, today)
      save(db, { ...st, weekly: { day: today, focus: out.focus, note: out.note, big3: out.big3 } })
    })
    return out
  }

  /**
   * The weekly letter: the coach writes to you like a friend who watched your
   * week. What it noticed, what it's proud of or worried about, what it wants
   * next week. Saved (Coach → About you) and sent on Sundays.
   */
  async function letter(): Promise<string | null> {
    if (!ai) return null
    const today = await mirror.read((db) => services.services(db).wallet.today())
    const context = await contextFor(null, null, null)
    const extra = await mirror.read((db) => {
      const rows = scorecard(cleanHistory(readJson(db, COACH_HISTORY, null)), services.services(db).progress.input(null, new Date(), 70).focus, today, 4)
      return rows.map((r) => `week of ${r.week}: promises kept ${r.keptPct ?? '—'}%, day score ${r.avgScore ?? '—'}, focus ${(r.focusMin / 60).toFixed(1)}h, plans approved ${r.plansApproved}/${r.plansProposed}`).join('\n')
    })
    try {
      const raw = await withTimeout(ai(
        [
          "You are BEN, Victor's best friend and coach. Write him this week's letter.",
          'Like a real friend who watched his whole week: warm, honest, specific, a bit of humour, and tough where it is earned. Use his real numbers, names and things he told you. 120–180 words, 3 short paragraphs: (1) what you noticed this week, (2) what you are proud of and what worries you, (3) the one thing you want from him next week, concrete. Sign it "— Ben". Plain text, no markdown, at most 2 emoji. Write in English.',
          'Answer ONLY with JSON: {"letter": string}',
          '',
          '== His last weeks ==',
          extra,
          '',
          context
        ].join('\n'),
        { json: true, think: true, strong: true, kind: 'letter' }
      ), 35_000)
      const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? '{}')
      const text = String(j.letter ?? '').trim().slice(0, 2000)
      if (!text) return null
      const week = mondayOf(today)
      await mirror.write((db) => saveLetter(db, { week, text, at: new Date().toISOString() }))
      return text
    } catch {
      return null
    }
  }

  /**
   * Ben's nightly self-review: he reads his own day (what he said, what Victor
   * answered or ignored, the feedback, promises) and writes notes to himself
   * for tomorrow, plus lessons for his long-term memory. Silent; shown in the
   * app (Coach → About you) and used in tomorrow's answers.
   */
  async function selfReview(): Promise<string[] | null> {
    if (!ai) return null
    // The evening review already wrote the notes (B4): only redo them after 4+ new messages or new feedback.
    const since = await mirror.read((db) => load(db, services.services(db).wallet.today()).evening?.sentAt)
    if (since) {
      const after = await todayTalk(since)
      if (after.n < 4 && !after.feedback) return null
    }
    const data = await todayTalk()
    if (!data.chat) return null
    try {
      const raw = await withTimeout(ai(
        [
          "You are BEN, Victor's coach, reviewing YOUR OWN coaching today, honestly. What helped him act? What did he ignore? Where were you too long, too generic, wrong, or too soft/hard? What should you do differently tomorrow?",
          'Answer ONLY with JSON: {"notes": string[] (2–4 short concrete notes to yourself for tomorrow, e.g. "Ask about the lab report before 10:00, he ignored it after lunch"), "works": string (one thing that worked with him, or ""), "fails": string (one thing that did not, or "")}',
          '',
          `== Today (${data.today}) ==`,
          data.chat,
          data.feedback ? `\n== His feedback today ==\n${data.feedback}` : ''
        ].join('\n'),
        { json: true, think: true, kind: 'self-review' }
      ), 35_000)
      const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? '{}')
      const notes = await saveSelfNotes(data.today, j)
      return notes.length ? notes : null
    } catch {
      return null
    }
  }

  /**
   * B5: every Sunday Ben rewrites his short "story so far" about Victor from
   * the week's chat, what he remembers, the journal and the last story. One
   * cheap call a week; the story then goes with every message.
   */
  async function writeStory(): Promise<string | null> {
    if (!ai) return null
    const data = await mirror.read((db) => {
      const today = services.services(db).wallet.today()
      const from = addDays(today, -7)
      const chat = loadLog(db)
        .filter((e) => e.at.slice(0, 10) >= from)
        .slice(-60)
        .map((e) => `${e.at.slice(5, 10)} ${e.role === 'me' ? 'Victor' : 'Ben'}: ${e.text.replace(/\s+/g, ' ').slice(0, 160)}`)
        .join('\n')
      const facts = loadMemory(db).facts.slice(-30).map((f) => `- ${f.t}`).join('\n')
      const journal = listNotes(db as any)
        .filter((n: any) => /^Journal\//.test(n.title ?? '') && String(n.title).slice(8) >= from)
        .map((n: any) => `${n.title}: ${String(n.body ?? '').replace(/\s+/g, ' ').slice(0, 200)}`)
        .join('\n')
      return { today, chat, facts, journal, story: loadStory(db)?.text ?? '' }
    })
    if (!data.chat && !data.facts) return null
    try {
      const raw = await withTimeout(ai(
        [
          "You are BEN, Victor's coach and friend. Rewrite your short STORY SO FAR about him: who he is now, what he is working toward, what stressed him and what went well lately, promises he made, what works with him and what doesn't. Keep what still matters from the old story, drop what is stale.",
          'At most 600 characters, plain sentences, dates where they matter. No advice, just the story. Answer ONLY with JSON: {"story": string}',
          '',
          data.story ? `== Your old story ==\n${data.story}` : '',
          data.facts ? `== What you remember ==\n${data.facts}` : '',
          data.journal ? `== His journal this week ==\n${data.journal}` : '',
          data.chat ? `== This week's chat ==\n${data.chat}` : ''
        ].join('\n'),
        { json: true, kind: 'story' }
      ), 30_000)
      const story = String(JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? '{}').story ?? '').trim().slice(0, 700)
      if (!story) return null
      await mirror.write((db) => setSetting(db as any, COACH_STORY, JSON.stringify({ week: data.today, text: story })))
      return story
    } catch {
      return null
    }
  }

  /** "Use this plan": next week's focus and big 3 (typed ones replace the suggestion). */
  async function applyWeekly(typed?: string): Promise<string> {
    return mirror.write((db) => {
      const svc = services.services(db)
      const st = load(db, svc.wallet.today())
      const w = st.weekly
      if (!w) throw new Error('No weekly review yet')
      const big3 = typed ? readLines(typed) : w.big3
      if (!big3.length) throw new Error('Give at least one big task')
      const plan = svc.weekPlan.save({ focus: w.focus as any, note: w.note, big3: big3.map((text) => ({ text, done: false })) })
      if (typed) save(db, { ...st, weekly: { ...w, big3 } })
      return `🗓 Next week: ${focusName(plan.focus)} · ${plan.big3.map((b) => b.text).join(' / ')}`
    })
  }

  /** Water behind pace: one line with the numbers and what to do. */
  async function waterLine(): Promise<string | null> {
    return mirror.write((db) => {
      const svc = services.services(db)
      const st = load(db, svc.wallet.today())
      const sport = sportState(db)
      if (!sport) return null
      const w = sharedView(sport, sportToday()).water
      const glasses = Math.max(1, Math.ceil((w.target - w.ml) / w.glass / 3))
      return `💧 Water ${(w.ml / 1000).toFixed(1)} of ${(w.target / 1000).toFixed(1)} L and the day is going. Drink ${glasses} glass${glasses === 1 ? '' : 'es'} now. Send "water 250" after each.`
    })
  }

  /** W6: the check-out list: today's must-dos and plan blocks. */
  async function checkoutStart(): Promise<{ items: string[]; marks: (null | 'k' | 'p' | 'x')[] }> {
    return mirror.write((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today()
      const st = load(db, today)
      const items = [...new Set([...svc.focus.plan(today).items.map((x) => x.text), ...(st.briefing?.plan.blocks ?? []).map((b) => b.title)])].slice(0, 8)
      const checkout = st.checkout && st.checkout.items.join('|') === items.join('|') ? st.checkout : { items, marks: items.map(() => null) }
      save(db, { ...st, checkout })
      return checkout
    })
  }
  async function checkoutMark(i: number, v: 'k' | 'p' | 'x'): Promise<{ items: string[]; marks: (null | 'k' | 'p' | 'x')[] }> {
    return mirror.write((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today()
      const st = load(db, today)
      const c = st.checkout ?? { items: [], marks: [] }
      if (!(i >= 0 && i < c.items.length)) return c
      const marks = c.marks.slice()
      marks[i] = v
      const next = { items: c.items, marks }
      save(db, { ...st, checkout: next })
      // All marked: one line in the journal. Never points.
      if (marks.every(Boolean)) {
        const sym: Record<string, string> = { k: '✅', p: '½', x: '✗' }
        try {
          benNote(db as any, `Journal/${today}`, `Check-out: ${c.items.map((t, k) => `${sym[marks[k]!]} ${t}`).join(' · ')}`, today)
        } catch {
          /* the marks are saved anyway */
        }
      }
      return next
    })
  }

  /** A water nudge really went out: only then it counts against the 5 a day (K2). */
  async function markWater(): Promise<void> {
    await mirror.write((db) => {
      const svc = services.services(db)
      const st = load(db, svc.wallet.today())
      save(db, { ...st, water: [...st.water, hmNow()] })
    })
  }

  /** No training yet by the evening (once a day). */
  async function trainingLine(): Promise<string> {
    return mirror.write((db) => {
      const svc = services.services(db)
      const st = load(db, svc.wallet.today())
      save(db, { ...st, training: true })
      const slot = st.briefing?.plan.training
      const body = svc.body.state()
      return `💪 No training today yet${slot ? ` (planned ${slot.time})` : ''}. Streak ${body.streak} day${body.streak === 1 ? '' : 's'}, ${body.workoutsThisWeek} this week. 20 minutes counts: start now.`
    })
  }

  return { state, setPrefs, propose, approve, dayResult, evening, setTop3, weekly, applyWeekly, writeStory, checkoutStart, checkoutMark, planTomorrow, midweek, bookingPreview, bookWeek, waterLine, markWater, trainingLine, letter, selfReview, goalPlans, bookGoals, rebookGoals, countPromise: (day: string, key: 'kept' | 'broken' | 'ignored') => mirror.write((db) => countPromise(db, day, key)) }
}

export type Rhythm = ReturnType<typeof createRhythm>
