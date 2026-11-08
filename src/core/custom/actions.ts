// Custom Center: the action runner contract. An action is a short list of
// whitelisted steps (model.ts ActionStep). This file turns it into a plan the
// app's runner carries out with the app's own operations, one by one:
//
//   focus      → the focus timer (life.focus.start), like the island's Start
//   stopFocus  → stops it (logs only the minutes really done)
//   music      → the music player's station (the event the automations use)
//   quiet      → the island's quiet time for N minutes (desktop)
//   dnd        → opens Windows' Do Not Disturb page (desktop)
//   mode       → switches your Custom Center mode
//   open       → opens a page of the app (closed list)
//   count      → adds to one of your counters (through its route: a real log
//                or the custom number; never points by itself)
//
// No code, no shell, no links, no network. Pure: plain data in and out.
import type { ActionStep, CustomAction, CustomSetup, StepKind } from './model'

export const STEP_LABEL: Record<StepKind, string> = {
  focus: 'Start a focus timer',
  stopFocus: 'Stop the focus timer',
  music: 'Play music',
  quiet: 'Quiet the island',
  dnd: 'Do Not Disturb',
  mode: 'Switch mode',
  open: 'Open a page',
  count: 'Add to a counter'
}
/** Steps that only do something in the desktop app. */
export const DESKTOP_ONLY: StepKind[] = ['quiet', 'dnd']

/** One line for a step ("Focus 50 min: Study"). */
export function stepText(s: ActionStep, setup?: Pick<CustomSetup, 'modes' | 'widgets'>): string {
  switch (s.do) {
    case 'focus':
      return `Focus ${s.minutes} min: ${s.subject}`
    case 'stopFocus':
      return 'Stop the focus timer'
    case 'music':
      return `Music: ${s.station}`
    case 'quiet':
      return `Quiet ${s.minutes} min`
    case 'dnd':
      return 'Do Not Disturb'
    case 'mode':
      return `Mode: ${setup?.modes.find((m) => m.id === s.mode)?.name ?? s.mode}`
    case 'open':
      return `Open ${s.page}`
    case 'count': {
      const w = setup?.widgets.find((x) => x.id === s.widget)
      return `${s.amount > 0 ? '+' : ''}${s.amount} ${w?.title ?? 'counter'}`
    }
  }
}

export interface PlannedStep {
  step: ActionStep
  label: string
  /** Why it will be skipped here, or null to run it. */
  skip: string | null
}

/**
 * What running an action will do on this device: each step with its label,
 * or why it is skipped (a desktop-only step on the website, a second focus
 * timer while one runs, a mode or counter that is gone).
 */
export function planAction(a: CustomAction, ctx: { desktop: boolean; focusRunning: boolean; setup: Pick<CustomSetup, 'modes' | 'widgets'> }): PlannedStep[] {
  let running = ctx.focusRunning
  return a.steps.map((step) => {
    let skip: string | null = null
    if (DESKTOP_ONLY.includes(step.do) && !ctx.desktop) skip = 'Only in the desktop app'
    else if (step.do === 'focus' && running) skip = 'A focus timer is already running'
    else if (step.do === 'mode' && !ctx.setup.modes.some((m) => m.id === step.mode)) skip = 'That mode is gone'
    else if (step.do === 'count' && !ctx.setup.widgets.some((w) => w.id === step.widget && w.kind === 'counter')) skip = 'That counter is gone'
    if (step.do === 'focus' && !skip) running = true
    if (step.do === 'stopFocus') running = false
    return { step, label: stepText(step, ctx.setup), skip }
  })
}

/** One plain sentence for what an action did ("Did: Focus 50 min: Study, Music: Lo-fi. Skipped: Quiet 50 min (only in the desktop app)"). */
export function runSummary(planned: PlannedStep[], failed: string[] = []): string {
  const did = planned.filter((p) => !p.skip && !failed.includes(p.label)).map((p) => p.label)
  const skipped = planned.filter((p) => p.skip).map((p) => `${p.label} (${p.skip!.toLowerCase()})`)
  const parts = [did.length ? `Did: ${did.join(', ')}` : 'Nothing ran']
  if (skipped.length) parts.push(`Skipped: ${skipped.join(', ')}`)
  if (failed.length) parts.push(`Didn't work: ${failed.join(', ')}`)
  return parts.join('. ')
}
