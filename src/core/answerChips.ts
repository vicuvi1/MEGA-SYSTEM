// CH2: the quick action chips under each of Ben's answers (pure, tested).
// One small, consistent set, picked by what kind of answer it is:
// - a plan  → Approve · Change · Make it lighter
// - a draft (email/message) → Shorter · More formal · Copy
// - a long answer → Shorter
// - a quick answer to a big question → Think harder
// - always → Copy (last)
// The chips are only suggestions: a tap sends a plain message to Ben (or copies),
// so everything still goes through the normal paths.

export type AnswerKind = 'plan' | 'draft' | 'verdict' | 'review' | 'list' | 'chat' | 'done' | 'short'

export type ChipId = 'approve' | 'change' | 'lighter' | 'shorter' | 'harder' | 'formal' | 'tasks' | 'copy'

export interface AnswerChip {
  id: ChipId
  label: string
  /** What a tap sends to Ben ('' = done on the page: approve, copy). */
  say: string
  /** Shown first and filled (the main next step). */
  primary?: boolean
}

export interface ChipInput {
  text: string
  /** Cards or widgets under the reply ('plan', 'day', 'tasks', …). */
  show?: string[]
  /** What Ben did (✅ lines). */
  done?: string[]
  /** Ben's own chips ("Think harder" when the quick model answered for the thinking one). */
  chips?: string[]
  /** The plan waits for your OK (approve makes sense). */
  planWaiting?: boolean
  /** A live plan card already has its own Approve: no second one. */
  planCardShown?: boolean
}

const LABEL: Record<ChipId, string> = {
  approve: 'Approve',
  change: 'Change',
  lighter: 'Make it lighter',
  shorter: 'Shorter',
  harder: 'Think harder',
  formal: 'More formal',
  tasks: 'Turn into tasks',
  copy: 'Copy'
}
const SAY: Record<ChipId, string> = {
  approve: '',
  change: 'Change the plan: ',
  lighter: 'Make the plan lighter: fewer blocks, more breaks.',
  shorter: 'Say that again, shorter.',
  harder: 'Think harder',
  formal: 'Make it more formal.',
  tasks: 'Turn that into tasks.',
  copy: ''
}

/** "Subject: …" then a body: an email or message draft. */
export const looksLikeDraft = (text: string) => /^\s*(subject|subiect|тема)\s*:/im.test(text) && text.split('\n').length >= 3

/** What kind of answer this is. */
export function answerKind(i: ChipInput): AnswerKind {
  const t = String(i.text ?? '')
  if ((i.show ?? []).includes('plan')) return 'plan'
  if (looksLikeDraft(t)) return 'draft'
  // The money coach's verdict (🟢 / 🟡 / 🔴 and its numbers): nothing to shorten or turn into tasks.
  if (/^\s*(🟢|🟡|🔴)/u.test(t)) return 'verdict'
  if ((i.done ?? []).some((d) => !d.startsWith('⚠️')) && t.length < 160) return 'done'
  if (/\b(review|this week so far|yesterday)\b/i.test(t) && t.length > 240) return 'review'
  if ((t.match(/^\s*(?:[-•*]|\d+[.)])\s+/gm) ?? []).length >= 3) return 'list'
  if (t.length < 90) return 'short'
  return 'chat'
}

const words = (t: string) => (t.match(/\S+/g) ?? []).length

/** The chips for one answer, in order (at most 4, Copy always last). */
export function chipsFor(i: ChipInput): AnswerChip[] {
  const kind = answerKind(i)
  const ids: ChipId[] = []
  if (kind === 'plan') {
    if (i.planWaiting && !i.planCardShown) ids.push('approve', 'change')
    ids.push('lighter')
  } else if (kind === 'draft') ids.push('shorter', 'formal')
  else if (kind === 'list') ids.push('tasks')
  if (kind !== 'draft' && kind !== 'done' && kind !== 'short' && kind !== 'verdict' && words(i.text) > 70) ids.push('shorter')
  if ((i.chips ?? []).some((c) => /^think harder$/i.test(c.trim()))) ids.unshift('harder')
  const out = [...new Set(ids)].slice(0, 3)
  out.push('copy')
  return out.map((id, k) => ({ id, label: LABEL[id], say: SAY[id], ...(k === 0 && id !== 'copy' ? { primary: true } : {}) }))
}

/** Text to put on the clipboard: the reply without markdown stars, plus what was done. */
export function copyText(text: string, done: string[] = []): string {
  const body = String(text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
  const ok = done.filter((d) => !d.startsWith('⚠️'))
  return ok.length ? `${body}\n\n${ok.join('\n')}` : body
}
