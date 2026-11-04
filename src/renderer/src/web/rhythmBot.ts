// The coach's daily rhythm (core/rhythm.ts holds the pure rules): it proposes
// the day, puts an approved plan into your calendar and Todoist, writes the
// evening and Sunday reviews, and the water and training nudges. Used by the
// tick on the server (Telegram, Mega) and by the app (Today, Coach).
import { addDays } from '@core/dates'
import { progressReport, financeSpending } from '@core/progress'
import { sharedView, sportToday } from '@core/sportShared'
import { isStarred, type TodoTask } from '@core/todoist'
import {
  RHYTHM,
  RHYTHM_PREFS,
  cleanPrefs,
  cleanProposal,
  dayScore,
  focusName,
  localProposal,
  readLines,
  rhythmFor,
  suggestWeekFocus,
  weakest,
  type DayProposal,
  type DayResult,
  type RhythmPrefs,
  type RhythmState
} from '@core/rhythm'
import { getSetting, setSetting } from '../../../main/settings'
import { COACH_SELFREVIEW, financeStateFrom, lifeContext, loadFeedback, loadLog, loadMind, loadProfile, saveLetter, saveMind, sportState } from './botBrain'
import { applyMind } from '@core/coachMind'
import { mindText, weekSoFar } from '@core/coachMind'
import { COACH_HISTORY, bump, cleanHistory, impactVerdict, mondayOf, recordDay, scorecard, type CoachDay } from '@core/coachImpact'
import { bookBlocks, isGoalBlock, planGoal, planLine, type GoalPlan } from '@core/goalPlan'
import type { Mirror } from './mirror'
import type { AskModel, CalendarLike, TodoistLike } from './webBots'
import type { WebServices } from './webServices'
import { writeJournal } from './notes'
import { dayLog, dayLogLine } from './dayLog'

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

  /** Context for the model: the same picture the coach sees in chat. */
  async function contextFor(events: any[] | null, todoToday: TodoTask[] | null, upcoming: TodoTask[] | null) {
    return mirror.read((db) => {
      const svc = services.services(db)
      return [lifeContext(svc, db, { finance: financeStateFrom(db, null), todoToday, upcoming, events }), (() => {
        const inp = svc.progress.input(null)
        const today = svc.wallet.today()
        return mindText(loadMind(db), today, weekSoFar(today, inp.focus, inp.workouts, inp.todoist))
      })(), `His goals: ${loadProfile(db).goals.join('; ')}`].filter(Boolean).join('\n')
    })
  }

  /** A plan for today (a new version when you ask to change or redo it). */
  async function propose(note = ''): Promise<{ plan: DayProposal; version: number }> {
    const now = new Date()
    const [events, tasks, upcoming] = await Promise.all([
      calendar ? calendar.events(...dayBounds()).catch(() => []) : Promise.resolve([]),
      todoist ? todoist.today().catch(() => [] as TodoTask[]) : Promise.resolve([] as TodoTask[]),
      todoist?.upcoming ? todoist.upcoming(7).catch(() => null) : Promise.resolve(null)
    ])
    const base = await mirror.read((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today(now)
      const st = load(db, today)
      const sport = sportState(db)
      const water = sport ? sharedView(sport, sportToday()).water.target : 2700
      const workoutDone = (svc.wallet.summary(now).todayRules ?? []).includes('body.workout_done') || !!svc.body.state(now).restToday
      return { today, st, water, workoutDone }
    })
    const plans = await goalPlans().catch(() => [] as GoalPlan[])
    // Goal blocks already in today's calendar are busy time; only the rest still needs a slot.
    const bookedToday = (p: GoalPlan) => events.some((e) => isGoalBlock(e, p))
    const goalItems = plans.filter((p) => p.todayLeftMin >= 20 && !bookedToday(p)).map((p) => ({ title: `${p.subject}: ${p.title}`, minutes: Math.min(90, p.todayLeftMin) }))
    const fallback = localProposal({
      goals: goalItems,
      today: base.today,
      now: hmNow(now),
      events,
      tasks: tasks.map((t) => ({ content: t.content, starred: isStarred(t), priority: t.priority, due: t.due })),
      top3: base.st.tomorrow?.day === base.today ? base.st.tomorrow.top3 : [],
      waterTarget: base.water,
      workoutDone: base.workoutDone
    })
    let plan = fallback
    if (ai) {
      try {
        const context = await contextFor(events, tasks, upcoming)
        const prev = base.st.briefing?.plan
        const prompt = [
          "You are BEN, Victor's best friend and coach. Plan his day: what makes today a win for his goals. Tough love, realistic.",
          `It is ${hmNow(now)}. Only plan from now on, never over calendar events, with 10-minute breaks between blocks. 1–3 must-dos (the ones that matter most; last night's top 3 first if given). Focus blocks 25–90 min. A training slot if he hasn't trained today. Water goal in ml.`,
          'Big picture first: blocks must move his tracked goals and nearest deadlines forward (see his goals, deadlines and weekly targets below); say which goal in the block title when it fits ("Algebra set (exam 15 Dec)").',
          'headline: one short line with numbers ("3 must-dos · 2h40 focus · gym 18:00").',
          note ? `He asked to change the previous plan: "${note}". Previous plan: ${JSON.stringify(prev ?? null)}` : prev ? `He asked for a different plan than: ${JSON.stringify(prev)}` : '',
          plans.length ? `Goals planned backward from their deadlines (today's minutes are a MUST; booked ones are already in the calendar):\n${plans.map((p) => `- ${planLine(p)}${bookedToday(p) ? ' (booked today)' : ''}`).join('\n')}` : '',
          `A simple starting point (improve it): ${JSON.stringify(fallback)}`,
          'Answer ONLY with JSON: {"headline": string, "mustdos": string[], "blocks": [{"title": string, "start": "HH:MM", "minutes": number}], "training": {"time": "HH:MM", "what": string} | null, "waterMl": number}',
          '',
          '== Victor right now ==',
          context
        ]
          .filter(Boolean)
          .join('\n')
        const raw = await ai(prompt, { json: true, think: true, strong: true })
        const json = String(raw).match(/\{[\s\S]*\}/)?.[0]
        plan = cleanProposal(json ? JSON.parse(json) : null, fallback, events, hmNow(now))
      } catch {
        plan = fallback
      }
    }
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
      const items = [...p.blocks.map((b) => ({ title: b.title, start: b.start, minutes: b.minutes })), ...(p.training ? [{ title: `💪 ${p.training.what}`, start: p.training.time, minutes: Number(/(\d+)\s*min/.exec(p.training.what)?.[1]) || 45 }] : [])].filter((b) => new Date(`${p.day}T${b.start}:00`).getTime() + b.minutes * 60000 > Date.now())
      for (const b of items) {
        const start = new Date(`${p.day}T${b.start}:00`)
        const ok = await calendar
          .create({ title: b.title, start: start.toISOString(), end: new Date(start.getTime() + b.minutes * 60000).toISOString(), description: 'Planned with your coach in Life System' })
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
      const sport = sportState(db)
      const water = sport ? sharedView(sport, sportToday()).water : { ml: 0, target: 2700 }
      const blocks = st.briefing?.status === 'approved' ? st.briefing.plan.blocks : []
      return {
        mustdosDone: plan.items.filter((x) => x.done).length,
        mustdosTotal: plan.items.length,
        focusMin: f.todayMin,
        plannedFocusMin: blocks.reduce((t, b) => t + b.minutes, 0),
        blocksDone: 0,
        blocksPlanned: 0,
        waterMl: water.ml,
        waterTarget: water.target,
        workoutDone: (svc.wallet.summary().todayRules ?? []).includes('body.workout_done') || !!svc.body.state().restToday,
        trainingPlanned: !!st.briefing?.plan.training
      }
    })
  }

  /** The evening review: the score, one lesson, tomorrow's top 3 (saved for the morning plan). */
  async function evening(): Promise<{ result: DayResult; score: number; lesson: string; top3: string[]; goals: string[]; rebooked: string[] }> {
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
        const raw = await ai(
          [
            "You are BEN, Victor's best friend and coach. It's his evening review. Be honest and short.",
            `Today: score ${score}/100. ${JSON.stringify(result)}. Open must-dos: ${open.join('; ') || 'none'}. Due tomorrow in Todoist: ${nextUp.join('; ') || 'nothing'}.`,
            islandLine ? `From the desktop island: ${islandLine}.` : '',
            'lesson: ONE sentence: what to do differently tomorrow, concrete, tied to his numbers or patterns. top3: tomorrow\'s 3 most important things (short, as tasks).',
            'Answer ONLY with JSON: {"lesson": string, "top3": string[]}',
            '',
            context
          ].join('\n'),
          { json: true, think: true, strong: true }
        )
        const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? '{}')
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
    return { result, score, lesson, top3, goals: goals.map(planLine), rebooked }
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
      return `Is the coach working? ${label}${v.verdict === 'too early' ? '' : ` (${v.lines.join('; ')})`}`
    })
    const goalLines = (await goalPlans().catch(() => [] as GoalPlan[])).filter((p) => p.status !== 'done').map((p) => `🎯 ${planLine(p)}`)
    const lines = [...report.metrics.map((m) => `${m.label}: ${m.text}${m.target ? ` of ${m.targetText}` : ''} (${m.trend})`), ...goalLines, coachCheck]
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
        const raw = await ai(
          [
            "You are BEN, Victor's best friend and coach. Sunday review of his week. Honest, short, numbers.",
            `Week score ${report.score}/100 (last week ${report.prevScore}). ${lines.join('; ')}.`,
            'win: the best thing this week (with its number). leak: the biggest leak (with its number). focus: next week\'s ONE area, one of focus|wake|sport|clean|todoist|spend|mustdo. note: his target in a few words ("up at 7:00 every day"). big3: the 3 big tasks for next week (from his deadlines and goals).',
            'Answer ONLY with JSON: {"win": string, "leak": string, "focus": string, "note": string, "big3": string[]}',
            '',
            context
          ].join('\n'),
          { json: true, think: true, strong: true }
        )
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
      const raw = await ai(
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
        { json: true, think: true, strong: true }
      )
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
    const data = await mirror.read((db) => {
      const today = services.services(db).wallet.today()
      const log = loadLog(db).filter((e) => e.at.slice(0, 10) === today).slice(-40)
      const fb = loadFeedback(db).filter((f) => f.at.slice(0, 10) === today)
      return {
        today,
        chat: log.map((e) => `${e.at.slice(11, 16)} ${e.role === 'me' ? 'Victor' : 'Ben'}${e.proactive ? ' (on his own)' : ''}: ${e.text.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n'),
        feedback: fb.map((f) => `${f.kind}: "${f.text.slice(0, 100)}"`).join('\n')
      }
    })
    if (!data.chat) return null
    try {
      const raw = await ai(
        [
          "You are BEN, Victor's coach, reviewing YOUR OWN coaching today, honestly. What helped him act? What did he ignore? Where were you too long, too generic, wrong, or too soft/hard? What should you do differently tomorrow?",
          'Answer ONLY with JSON: {"notes": string[] (2–4 short concrete notes to yourself for tomorrow, e.g. "Ask about the lab report before 10:00, he ignored it after lunch"), "works": string (one thing that worked with him, or ""), "fails": string (one thing that did not, or "")}',
          '',
          `== Today (${data.today}) ==`,
          data.chat,
          data.feedback ? `\n== His feedback today ==\n${data.feedback}` : ''
        ].join('\n'),
        { json: true, think: true }
      )
      const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? '{}')
      const notes = (Array.isArray(j.notes) ? j.notes : []).map((x: any) => String(x).trim().slice(0, 200)).filter(Boolean).slice(0, 4)
      if (!notes.length) return null
      await mirror.write((db) => {
        setSetting(db as any, COACH_SELFREVIEW, JSON.stringify({ day: data.today, notes }))
        let m = loadMind(db)
        if (String(j.works ?? '').trim()) m = applyMind(m, { kind: 'works', text: String(j.works).trim().slice(0, 160) }, data.today).mind
        if (String(j.fails ?? '').trim()) m = applyMind(m, { kind: 'fails', text: String(j.fails).trim().slice(0, 160) }, data.today).mind
        saveMind(db, m)
      })
      return notes
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
      save(db, { ...st, water: [...st.water, hmNow()] })
      const glasses = Math.max(1, Math.ceil((w.target - w.ml) / w.glass / 3))
      return `💧 Water ${(w.ml / 1000).toFixed(1)} of ${(w.target / 1000).toFixed(1)} L and the day is going. Drink ${glasses} glass${glasses === 1 ? '' : 'es'} now. Send "water 250" after each.`
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

  return { state, setPrefs, propose, approve, dayResult, evening, setTop3, weekly, applyWeekly, waterLine, trainingLine, letter, selfReview, goalPlans, bookGoals, rebookGoals, countPromise: (day: string, key: 'kept' | 'broken' | 'ignored') => mirror.write((db) => countPromise(db, day, key)) }
}

export type Rhythm = ReturnType<typeof createRhythm>
