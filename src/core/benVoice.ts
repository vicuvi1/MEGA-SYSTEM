// Ben's own words for the messages he sends by himself: the water, training
// and "you've gone quiet" nudges and the "I moved your block" note start as
// fixed lines with true numbers; the model rewrites them for this moment of
// your day (what's next, what's open), short and with one next step. If the
// model fails or writes something odd, the fixed line goes out instead.

export type VoiceKind = 'water' | 'training' | 'idle' | 'moved'

/** Which nudge this is (null: not one Ben rewrites, e.g. plans, reviews, your reminders). */
export function voiceKind(html: string): VoiceKind | null {
  const p = html.replace(/<[^>]+>/g, '').trimStart()
  if (/^💧/u.test(p)) return 'water'
  if (/^💪/u.test(p)) return 'training'
  if (/^(😤|🎯|🙂|😐)\s*Nothing done/u.test(p)) return 'idle'
  if (/^🔁/u.test(p)) return 'moved'
  return null
}

export interface VoiceContext {
  time: string
  focusMin: number
  mustDos: string[]
  nextEvent: string | null
  tasks: string[]
  water: string | null
  tone: number
}

export function voicePrompt(kind: VoiceKind, template: string, c: VoiceContext): string {
  const plain = template.replace(/<[^>]+>/g, '')
  return [
    `You are Ben, Victor's personal coach, writing him ONE Telegram message right now (${c.time}).`,
    `What to say (the facts and numbers are true, keep them): "${plain}"`,
    'His day right now:',
    `- focus so far: ${c.focusMin} min`,
    c.mustDos.length ? `- open must-dos: ${c.mustDos.join('; ')}` : '- no open must-dos',
    c.nextEvent ? `- next in his calendar: ${c.nextEvent}` : '- nothing more in his calendar today',
    c.tasks.length ? `- Todoist today: ${c.tasks.join('; ')}` : '',
    c.water ? `- water: ${c.water}` : '',
    `Write it like a real coach who knows his day: 1–2 short sentences, specific (name the task or the gap before the next event), ONE concrete next step he can do in the next minutes. ${c.tone >= 4 ? 'Be direct and push.' : 'Warm but firm, no guilt-tripping.'}`,
    `Start with the same emoji as the original. Keep every number from it true; invent no facts. English. Plain text, <b>bold</b> allowed. No quotes, no lists, max 260 characters. Answer with the message only.`
  ]
    .filter(Boolean)
    .join('\n')
}

/** The model's text, if it's safe and sensible to send; else null (the fixed line goes). */
export function cleanVoice(out: string, template: string): string | null {
  let t = String(out ?? '').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
  if (!t || t.length > 420 || /^\{/.test(t)) return null
  // Only <b>/<i> survive (Telegram HTML); anything else is dropped.
  t = t.replace(/<(?!\/?(b|i)>)[^>]*>/g, '')
  // A lone "<" or "&" ("x < 5", "<3", "R&D") breaks Telegram's HTML: escape it (T6).
  t = t.replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/<(?!\/?(b|i)>)/g, '&lt;')
  const emoji = template.replace(/<[^>]+>/g, '').trimStart().match(/^\p{Extended_Pictographic}️?/u)?.[0]
  if (emoji && !t.startsWith(emoji)) t = `${emoji} ${t.replace(/^\p{Extended_Pictographic}️?\s*/u, '')}`
  // Every number in the original must still be there (no made-up figures).
  const nums = (s: string) => (s.replace(/<[^>]+>/g, '').match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'))
  const have = new Set(nums(t))
  if (nums(template).some((n) => !have.has(n))) return null
  return t
}
