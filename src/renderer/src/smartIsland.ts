// Smart island, the app window's side (desktop only). The desktop sends small
// title-free events (desktop:activity); this keeps about two hours of them in
// memory, works out the moment, picks at most one suggestion (suggest.ts),
// runs your recipes (recipes.ts, safe actions only) and logs what they did
// with a 10-minute Undo. Every switch is in Settings → Ben on this PC → Smart
// island, all off by default. Nothing here logs a habit, water or a reward by
// itself: suggestions start timers and open things; logging stays a tap.
import type { IslandAction, IslandAlert, IslandBlock } from '@core/islandModel'
import { pushEvent, sessionize, type ActivityEvent } from '@core/activityStream'
import { addContextRule, CONTEXT_ICON, CONTEXT_LABEL, type ContextKind } from '@core/activityContext'
import { answerSuggestion, cleanSuggestState, markShown, pausedKinds, pickSuggestion, resetSuggestKind, suggestAlert, type SuggestState, type SuggestStats, type Suggestion } from '@core/suggest'
import { backToBlock, bedtimeFromClose, comeBack, contextPicker, emailBox, gamingBedtime, meetingNote, nextMustdo, spendAfterBank, startFromOpened } from '@core/smartSuggest'
import { cleanRecipes, evaluate, recipeText, safeLink, type Recipe, type RecipeEvent, type SafeAction } from '@core/recipes'
import { blockKey, blockReality, callNow, realityLine, workNow } from '@core/islandSmart'
import type { PcPrefs } from '@core/pcActivity'
import { calendarDay } from '@core/dates'
import { life } from './bridge'
import { canUndo, logAutomation, markUndone, readAutoLog, type UndoOp } from './islandLog'
import { eyesSuggestion, startEyes } from './islandEyes'

const STATE = 'ls.suggest'
const STATS = 'ls.suggestStats'
const FIRED = 'ls.recipeFired'
const SHOWN = 'ls.suggestShown'
const AWAY = 'ls.smartAway'
const BEN_SEEN = 'ls.benRecipesSeen'

const get = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const put = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}
const dayOf = (t: number) => calendarDay(new Date(t))

// ---- what the desktop says ----
let events: ActivityEvent[] = []
let doing: { label: string; context: ContextKind; conf: number; detail?: string; at: number } | null = null
let lastSwitchAt = 0
let bankLeftAt: number | null = null
let prefs: PcPrefs | null = null
let prefsAt = 0
let recipes: Recipe[] = []
let recipesAt = 0
/** A recipe's first run waiting for your answer; a meeting note offer; the "what is it?" picker. */
let ask: { recipe: Recipe; acts: SafeAction[]; at: number } | null = null
let note: { endedAt: number; title: string } | null = null
let picker: { app: string; now: ContextKind } | null = null
let prev = { runningAt: 0 as number, block: '', meeting: false }
let changed: () => void = () => {}

export const smartOn = () => !!prefs?.smart && !!prefs.activeApp
const suggestOn = () => smartOn() && !!prefs?.smartSuggest
const recipesOn = () => !!prefs?.smartRecipes && !!window.desktop?.islandState

/** Listen to the desktop once; `onChange` asks the island for a fresh picture. */
export function startSmart(onChange: () => void) {
  changed = onChange
  const desk = window.desktop
  // Island eyes (off until you turn them on): their offers join the same queue.
  startEyes(() => changed())
  desk?.onActivity?.((e) => {
    if (!e || typeof e !== 'object' || typeof (e as ActivityEvent).at !== 'number') return
    events = pushEvent(events, e)
    if (e.t === 'app') {
      const ctxChanged = doing?.context !== e.context
      doing = { label: e.label, context: e.context, conf: e.conf, ...(e.detail ? { detail: e.detail } : {}), at: e.at }
      lastSwitchAt = e.at
      if (ctxChanged) {
        void runRecipes({ t: 'context', at: e.at, ctx: e.context, conf: e.conf })
        changed()
      }
    } else if (e.t === 'bank:left') {
      bankLeftAt = e.at
      changed()
    }
  })
  void refresh(true)
}

/** Your Smart island switches (from the desktop) and your recipes, at most once a minute. */
export async function refresh(force = false): Promise<void> {
  const now = Date.now()
  if (force || now - prefsAt > 60_000) {
    prefsAt = now
    const p = await window.desktop?.pcGetPrefs?.().catch(() => null)
    if (p) prefs = p.prefs
    if (!smartOn()) {
      doing = null
      events = []
    }
  }
  if (force || now - recipesAt > 60_000) {
    recipesAt = now
    const list = await life.recipes?.list().catch(() => null)
    if (list) recipes = cleanRecipes(list)
  }
}

/** SI2: your goals and subjects are the only words a detail can be: the desktop gets them when they change. */
export function shareGoalWords(words: string[]) {
  if (!prefs?.smart || !window.desktop?.pcSetPrefs) return
  const clean = [...new Set(words.map((w) => w.trim()).filter((w) => w.length >= 3 && w.length <= 40))].slice(0, 40)
  if (clean.join('|') === (prefs.goalWords ?? []).join('|')) return
  prefs = { ...prefs, goalWords: clean }
  void window.desktop.pcSetPrefs({ goalWords: clean }).catch(() => {})
}

export const spans = (now = Date.now()) => sessionize(events, now)
/** AU2: the last two hours of events (app names only), for the "last hour" summary. */
export const recentEvents = () => events.slice()

/** SI1: what you're doing, for the island's chip (a kind and the app's friendly name). */
export function doingNow(): NonNullable<import('@core/islandModel').IslandSnapshot['doing']> | null {
  if (!smartOn() || !doing || doing.context === 'idle') return null
  return { ctx: doing.context, label: CONTEXT_LABEL[doing.context], icon: CONTEXT_ICON[doing.context], ...(doing.detail ? { detail: doing.detail } : {}), app: doing.label, conf: doing.conf }
}

/** SI12: what you're doing, and whether you just switched apps (a natural pause). */
export function doingForBreaks(now: number): { ctx: string; pause: boolean } | null {
  if (!smartOn() || !doing) return null
  return { ctx: doing.context, pause: now - lastSwitchAt < 60_000 }
}

/** SI10: "You were coding 38 of 45 min." for a block that just ended. */
export function realityOf(b: { start: number; end: number }): string {
  if (!smartOn()) return ''
  return realityLine(blockReality(spans(), b))
}

/** SI20: the PC was away for a long time (closed late): keep it for a bedtime suggestion. Returns true when it takes over from logging by itself. */
export function noteAway(w: { from: string; to: string }): boolean {
  if (!suggestOn()) return false
  put(AWAY, { from: Date.parse(w.from), to: Date.parse(w.to) })
  return true
}

/**
 * Focus, blocks and meetings, as the app window sees them (every build):
 * the changes become events for the stream and the recipes.
 */
export function smartTick(o: { now: number; running: { startedAt: number } | null; blocks: IslandBlock[] }) {
  if (!smartOn() && !recipesOn()) return
  const add = (e: ActivityEvent) => {
    events = pushEvent(events, e)
  }
  const runAt = o.running?.startedAt ?? 0
  if (runAt !== prev.runningAt) {
    if (prev.runningAt) add({ t: 'focus:end', at: o.now })
    if (runAt) add({ t: 'focus:start', at: runAt, subject: '' })
    void runRecipes({ t: runAt ? 'focus:start' : 'focus:end', at: o.now })
  }
  const b = workNow(o.blocks, o.now)
  const bk = b ? blockKey(b) : ''
  if (bk !== prev.block) {
    if (b) {
      add({ t: 'block:start', at: b.start, title: b.title })
      void runRecipes({ t: 'block:start', at: o.now })
    } else add({ t: 'block:end', at: o.now, title: '' })
  }
  const call = callNow(o.blocks, o.now)
  const meeting = !!call
  if (meeting !== prev.meeting) {
    add({ t: meeting ? 'meeting:start' : 'meeting:end', at: o.now })
    void runRecipes({ t: meeting ? 'meeting:start' : 'meeting:end', at: o.now })
    if (!meeting) {
      const ended = o.blocks.filter((x) => x.call && x.end <= o.now + 60_000).sort((x, y) => y.end - x.end)[0]
      lastMeeting = ended ? { endedAt: o.now, title: ended.title } : { endedAt: o.now, title: 'The meeting' }
    }
  }
  prev = { runningAt: runAt, block: bk, meeting }
  // The desktop reads what you do better with the block's name and the meeting (your words only).
  window.desktop?.pcSmartState?.({ block: b?.title ?? null, meeting })
  void runRecipes({ t: 'tick', at: o.now })
}
let lastMeeting: { endedAt: number; title: string } | null = null

// ---- recipes ----

async function runRecipes(e: RecipeEvent) {
  if (!recipesOn() || !recipes.length) return
  const fired = get<Record<string, number>>(FIRED, {})
  const hits = evaluate(recipes, e, { running: prev.runningAt > 0, fired })
  if (!hits.length) return
  put(FIRED, { ...Object.fromEntries(Object.entries(fired).slice(-60)), ...Object.fromEntries(hits.map((h) => [h.recipe.id, e.at])) })
  for (const h of hits) {
    if (h.ask) {
      // The first run (or "ask me first"): Always / Just now / Turn off.
      ask = { recipe: h.recipe, acts: h.acts, at: e.at }
      changed()
    } else await runSafe(h.acts, h.recipe.name, h.recipe.id)
  }
}

/** The whitelist, done: each action and how to take it back (10 min). */
export async function runSafe(acts: SafeAction[], why: string, recipeId?: string): Promise<string> {
  const did: string[] = []
  const undo: UndoOp[] = []
  const desk = window.desktop
  const quiet = (minutes: number) => {
    desk?.islandQuiet?.(minutes)
    undo.push({ op: 'quietOff' })
    did.push(`island quiet ${minutes} min`)
  }
  const sitesAway = async () => {
    const p = await desk?.pcGetPrefs?.().catch(() => null)
    if (p && !p.prefs.blockSites) {
      await desk?.pcSetPrefs?.({ blockSites: true })
      undo.push({ op: 'pcPrefs', patch: { blockSites: false } })
    }
    did.push('distracting sites kept away')
  }
  for (const a of acts) {
    try {
      switch (a.do) {
        case 'focus': {
          const f = await life.focus.start(a.subject, a.minutes, null)
          window.dispatchEvent(new Event('life-focus-changed'))
          if (f?.running) undo.push({ op: 'stopFocus', startedAt: Date.parse(f.running.startedAt) })
          did.push(`focus “${a.subject}” ${a.minutes} min`)
          break
        }
        case 'stopFocus':
          // Stopping logs the minutes you really did (a real session), nothing more.
          await life.focus.stop()
          window.dispatchEvent(new Event('life-focus-changed'))
          did.push('focus stopped')
          break
        case 'blockSites':
          await sitesAway()
          break
        case 'dnd':
          await desk?.pcDnd?.()
          did.push('Do Not Disturb page opened')
          break
        case 'quiet':
          quiet(a.minutes)
          break
        case 'focusPack': {
          // SI19: Windows has no public switch for Focus Assist / Do Not Disturb,
          // so the pack opens its page; the rest is ours.
          await sitesAway()
          await desk?.pcDnd?.()
          did.push('Do Not Disturb page opened')
          const run = await life.focus.state().catch(() => null)
          const left = run?.running ? Math.max(5, Math.round((Date.parse(run.running.startedAt) + run.running.planned * 60000 - Date.now()) / 60000)) : a.minutes ?? 50
          quiet(left)
          const music = safeLink(prefs?.musicLink)
          if (music) {
            window.open(music, '_blank', 'noopener')
            did.push('music opened')
          }
          break
        }
        case 'note': {
          const notes = await life.notes!.list()
          const inbox = notes.find((n) => n.title.toLowerCase() === 'inbox')
          const line = `- ${a.text} _(${dayOf(Date.now())})_`
          const saved = await life.notes!.save(inbox ? { id: inbox.id, title: inbox.title, body: `${inbox.body.replace(/\s*$/, '')}\n${line}\n` } : { title: 'Inbox', body: `# Inbox\n\nThings you saved from the island.\n\n${line}\n` })
          if (!inbox && saved?.id) undo.push({ op: 'deleteNote', id: saved.id })
          did.push('a line in Notebook → Inbox')
          break
        }
        case 'task':
          await life.todoist!.quickAdd(a.text)
          did.push(`task “${a.text}”`)
          break
        case 'open':
          window.dispatchEvent(new CustomEvent('life-open-page', { detail: a.page }))
          did.push(`opened ${a.page}`)
          break
        case 'link': {
          const url = safeLink(a.url)
          if (url) {
            window.open(url, '_blank', 'noopener')
            did.push(`opened ${new URL(url).hostname}`)
          }
          break
        }
        case 'windDown':
          await desk?.notify?.({ id: 'recipe:winddown', title: '🌇 Wind down', body: "Tomorrow's top 3 → close the day → screens off." }).catch(() => false)
          did.push('wind-down reminder')
          break
        case 'offerNote':
          note = lastMeeting ?? { endedAt: Date.now(), title: 'The meeting' }
          did.push('offered a meeting note')
          break
      }
    } catch (err) {
      did.push(`⚠ ${a.do}: ${(err as Error)?.message || 'did not work'}`)
    }
  }
  logAutomation({ id: `${recipeId ?? 'safe'}:${Date.now()}`, at: Date.now(), why, did, undo })
  changed()
  return did.join(', ')
}

/** Settings → Island log: take back what a recipe did (10 minutes). */
export async function undoAutomation(id: string): Promise<boolean> {
  const e = readAutoLog().find((x) => x.id === id)
  if (!e || !canUndo(e)) return false
  for (const u of e.undo) {
    try {
      if (u.op === 'stopFocus') {
        const f = await life.focus.state()
        // Only the timer this recipe started, and without logging it.
        if (f.running && Date.parse(f.running.startedAt) === u.startedAt) await life.focus.cancel()
        window.dispatchEvent(new Event('life-focus-changed'))
      } else if (u.op === 'pcPrefs') await window.desktop?.pcSetPrefs?.(u.patch as Partial<PcPrefs>)
      else if (u.op === 'quietOff') window.desktop?.islandQuiet?.(null)
      else if (u.op === 'deleteNote') await life.notes?.remove(u.id)
    } catch {
      /* best effort */
    }
  }
  markUndone(id)
  return true
}

// ---- the moment: at most one suggestion ----

export interface SmartMoment {
  now: number
  blocks: IslandBlock[]
  running: boolean
  mustdos: { text: string; done: boolean }[]
  goals: string[]
  windDown: { bedAt: string; minutesLeft: number } | null
  last: { subject: string; endedAt: number } | null
  bedLogged: boolean
  /** SI27: blocks of today not checked off yet (closing the day). */
  unfinished: IslandBlock[]
}

const ctxNow = () => doing?.context ?? null

/** The Smart island's alert now: the fix-it picker, a recipe asking, Ben's recipe idea, or the best suggestion. */
export function smartSuggestion(m: SmartMoment): IslandAlert | null {
  if (picker) {
    const p = contextPicker(picker.app, picker.now)
    return { id: `ctxfix:${picker.app}`, kind: 'suggest', title: p.title, text: p.text, face: '🤔', actions: [...p.options.map((o) => ({ label: o.label, action: { kind: 'ctxFix' as const, ctx: o.ctx, app: picker!.app } })), { label: 'Cancel', action: { kind: 'ctxFix' as const, app: '' } }] }
  }
  if (ask && m.now - ask.at < 15 * 60_000) {
    const r = ask.recipe
    return {
      id: `recipe:${r.id}:${ask.at}`,
      kind: 'suggest',
      title: `Run “${r.name}”?`,
      text: recipeText(r),
      face: '🧩',
      actions: [
        { label: 'Always', action: { kind: 'recipeAnswer', recipeId: r.id, answer: 'always', acts: ask.acts }, primary: true },
        { label: 'Just now', action: { kind: 'recipeAnswer', recipeId: r.id, answer: 'now', acts: ask.acts } },
        { label: 'Turn off', action: { kind: 'recipeAnswer', recipeId: r.id, answer: 'off', acts: [] } }
      ]
    }
  }
  // SI24: a recipe Ben proposed (saved off): turn it on?
  const seen = get<string[]>(BEN_SEEN, [])
  const idea = recipes.find((r) => r.byBen && !r.on && !seen.includes(r.id))
  if (idea && recipesOn()) {
    const id = `benrecipe:${idea.id}`
    return { id, kind: 'suggest', title: `Ben's idea: ${idea.name}`, text: recipeText(idea), face: '🧩', actions: [{ label: 'Turn it on', action: { kind: 'recipeAdd', recipe: idea, answer: 'add', alertId: id }, primary: true }, { label: 'No thanks', action: { kind: 'recipeAdd', recipe: idea, answer: 'no', alertId: id } }] }
  }
  // Island eyes have their own switch: their offer can come even with the other suggestions off.
  const eyesCand = eyesSuggestion({ now: m.now, running: m.running })
  if (!suggestOn() && !eyesCand) return null
  const sp = spans(m.now)
  const d = doing ? { ctx: doing.context, ...(doing.detail ? { detail: doing.detail } : {}), conf: doing.conf } : null
  const base = { now: m.now, blocks: m.blocks, running: m.running, spans: sp, doing: d }
  const away = get<{ from: number; to: number } | null>(AWAY, null)
  const unfinished = m.unfinished.length && (m.windDown || new Date(m.now).getHours() >= 22) && !m.running
  const cands: (Suggestion | null)[] = !suggestOn() ? [eyesCand] : [
    bedtimeFromClose({ now: m.now, away, bedLogged: m.bedLogged }),
    note ? meetingNote({ now: m.now, endedAt: note.endedAt, title: note.title }) : null,
    backToBlock(base),
    gamingBedtime({ ...base, windDown: m.windDown }),
    unfinished
      ? {
          id: `closeday:${dayOf(m.now)}`,
          sk: 'closeDay',
          title: 'Close the day in one go?',
          text: `${m.unfinished.length} block${m.unfinished.length === 1 ? '' : 's'} not checked off (${m.unfinished.slice(0, 2).map((b) => b.title).join(', ')}). Move ${m.unfinished.length === 1 ? 'it' : 'them'} to tomorrow, and I'll draft tonight's note.`,
          face: '🌇',
          accept: { label: '→ Tomorrow', action: { kind: 'closeAll', blocks: 'move' } },
          extra: { label: 'Drop them', action: { kind: 'closeAll', blocks: 'drop' } },
          laterMin: 30
        }
      : null,
    spendAfterBank({ now: m.now, bankLeftAt }),
    startFromOpened({ ...base, goals: m.goals }),
    emailBox(base),
    comeBack({ ...base, last: m.last }),
    nextMustdo({ ...base, mustdos: m.mustdos }),
    eyesCand
  ]
  const day = dayOf(m.now)
  let st = cleanSuggestState(get<SuggestState | null>(STATE, null), day)
  const stats = get<SuggestStats>(STATS, {})
  const hour = new Date(m.now).getHours()
  const pick = pickSuggestion(cands, st, { now: m.now, hour, ctx: ctxNow(), budget: prefs?.suggestBudget ?? 6, stats })
  // SI6: one that was up for 2+ minutes and went away unanswered counts as ignored.
  const shown = get<{ id: string; sk: string; at: number } | null>(SHOWN, null)
  if (shown && shown.id !== pick?.s.id && m.now - shown.at >= 2 * 60_000) {
    const r = answerSuggestion(st, stats, shown, 'ignored', { now: m.now, hour, ctx: ctxNow() })
    st = r.state
    put(STATS, r.stats)
    put(SHOWN, null)
  } else if (shown && shown.id !== pick?.s.id) put(SHOWN, null)
  if (!pick) {
    put(STATE, st)
    return null
  }
  if (!st.offered[pick.s.id]) put(SHOWN, { id: pick.s.id, sk: pick.s.sk, at: m.now, ...(pick.s.laterMin ? { laterMin: pick.s.laterMin } : {}) })
  st = markShown(st, pick.s, m.now)
  put(STATE, st)
  return suggestAlert(pick.s, pick.dot)
}

/** A notice to show once (learning stopped a kind, SI6). */
let notice: { text: string; at: number } | null = null
export function smartNotice(now: number): IslandAlert | null {
  if (!notice || now - notice.at > 10 * 60_000) return null
  const id = `notice:${notice.at}`
  return { id, kind: 'suggest', title: 'Fewer suggestions', text: notice.text, face: '🤫', actions: [{ label: 'OK', action: { kind: 'dismiss', id }, primary: true }] }
}

/** The island's taps for the Smart island. Returns what to say, and an action to run (Accept). */
export async function smartAct(a: IslandAction): Promise<{ said?: string; run?: IslandAction } | null> {
  const now = Date.now()
  switch (a.kind) {
    case 'suggest': {
      const day = dayOf(now)
      const st = cleanSuggestState(get<SuggestState | null>(STATE, null), day)
      const r = answerSuggestion(st, get<SuggestStats>(STATS, {}), { id: a.sid, sk: a.sk, laterMin: a.laterMin }, a.answer, { now, hour: new Date(now).getHours(), ctx: ctxNow() })
      // Answered: it never comes back (offered stays; "Not now" hides it for a while, then it's still once).
      put(STATE, { ...r.state, offered: { ...r.state.offered, [a.sid]: now - 11 * 60_000 } })
      put(STATS, r.stats)
      put(SHOWN, null)
      events = pushEvent(events, { t: a.answer === 'accept' ? 'accept' : 'dismiss', at: now, sk: a.sk })
      if (r.notice) notice = { text: r.notice, at: now }
      if (a.sk === 'bedtime') put(AWAY, null)
      if (a.sk === 'note') note = null
      if (a.sk === 'spend') bankLeftAt = null
      return { said: a.answer === 'never' ? "OK: I won't suggest that again" : a.answer === 'later' ? 'Later' : undefined, run: a.answer === 'accept' ? a.run : undefined }
    }
    case 'ctxFix': {
      if (a.ctx && a.app && prefs && window.desktop?.pcSetPrefs) {
        const rules = addContextRule(prefs.contextRules ?? [], a.app, a.ctx)
        const p = await window.desktop.pcSetPrefs({ contextRules: rules })
        if (p) prefs = p
        if (doing && doing.label === a.app) doing = { ...doing, context: a.ctx, conf: 1 }
        picker = null
        return { said: `✓ ${a.app} = ${CONTEXT_LABEL[a.ctx].toLowerCase()} from now on` }
      }
      picker = a.app && doing ? { app: a.app, now: doing.context } : null
      return {}
    }
    case 'safe':
      return { said: `✓ ${await runSafe(a.acts, a.why, a.recipeId)}` }
    case 'recipeAnswer': {
      ask = null
      const list = cleanRecipes(await life.recipes!.list())
      const next = list.map((r) => (r.id !== a.recipeId ? r : a.answer === 'off' ? { ...r, on: false } : a.answer === 'always' ? { ...r, ranOnce: true, confirmFirst: false } : { ...r, ranOnce: true }))
      recipes = await life.recipes!.save(next)
      if (a.answer === 'off') return { said: 'Recipe turned off' }
      return { said: `✓ ${await runSafe(a.acts, list.find((r) => r.id === a.recipeId)?.name ?? 'Recipe', a.recipeId)}` }
    }
    case 'recipeAdd': {
      put(BEN_SEEN, [...get<string[]>(BEN_SEEN, []), (a.recipe as Recipe).id].slice(-40))
      const list = cleanRecipes(await life.recipes!.list())
      const id = (a.recipe as Recipe).id
      // Turning it on still asks on its first run (ranOnce false).
      recipes = await life.recipes!.save(a.answer === 'add' ? list.map((r) => (r.id === id ? { ...r, on: true } : r)) : list.filter((r) => r.id !== id))
      return { said: a.answer === 'add' ? '✓ Recipe on (it asks the first time)' : 'Dropped' }
    }
    default:
      return null
  }
}

/** Settings: the kinds that stopped (learning, or Never). */
export function pausedSuggestions(): string[] {
  return pausedKinds(cleanSuggestState(get<SuggestState | null>(STATE, null), dayOf(Date.now())), get<SuggestStats>(STATS, {}))
}
/** Settings: turn a kind back on (and learn it again from scratch). */
export function resumeSuggestion(sk: string) {
  const r = resetSuggestKind(cleanSuggestState(get<SuggestState | null>(STATE, null), dayOf(Date.now())), get<SuggestStats>(STATS, {}), sk)
  put(STATE, r.state)
  put(STATS, r.stats)
}
/** Settings: your recipes changed. */
export function setRecipes(list: Recipe[]) {
  recipes = cleanRecipes(list)
}
