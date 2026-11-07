// TL8: Ben drafts an email or a message for you (pure, tested). He writes it,
// you read it, copy it or open it in your mail app. Nothing is ever sent by
// Ben. This file reads the ask ("write an email to my teacher about…"), tells
// the model the shape, reads the draft back (subject + body) and builds the
// mailto: link. A plain template covers the times the AI is off.

export type Tone = 'formal' | 'friendly' | 'short'
export const TONES: { id: Tone; label: string; say: string }[] = [
  { id: 'formal', label: 'More formal', say: 'Rewrite the draft: more formal.' },
  { id: 'friendly', label: 'Friendlier', say: 'Rewrite the draft: friendlier and warmer.' },
  { id: 'short', label: 'Shorter', say: 'Rewrite the draft: shorter, same point.' }
]

export interface DraftAsk {
  kind: 'email' | 'message'
  /** Who it's for, as you said it ("my teacher", "the employer"). */
  to: string
  /** What it's about (may be empty). */
  about: string
  tone: Tone
}

/** "write an email to my teacher about missing class" → the ask; null when it isn't one. */
export function readDraftAsk(text: string): DraftAsk | null {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ')
  const m = /^(?:can you |could you |please |help me )*(?:write|draft|compose|prepare|make)(?: me)? (?:an? |the )?(?:(formal|polite|friendly|short|quick|casual) )?(email|e-mail|mail|message|letter|text|dm)\b(?: (?:to|for) (.+?))?(?: (?:about|regarding|re|saying|asking|that|to say|to ask) (.+))?[.!?]*$/i.exec(t)
  const ro = !m ? /^(?:scrie|redactează|redacteaza)(?:-mi)? (?:un |o )?(email|mail|mesaj|scrisoare) (?:către|catre|pentru) (.+?)(?: (?:despre|ca|că) (.+))?[.!?]*$/i.exec(t) : null
  if (!m && !ro) return null
  if (ro) return { kind: /mesaj/i.test(ro[1]) ? 'message' : 'email', to: ro[2].trim().slice(0, 80), about: (ro[3] ?? '').trim().slice(0, 300), tone: 'formal' }
  const kind: DraftAsk['kind'] = /message|text|dm/i.test(m![2]) ? 'message' : 'email'
  const w = (m![1] ?? '').toLowerCase()
  const tone: Tone = /friendly|casual/.test(w) ? 'friendly' : /short|quick/.test(w) ? 'short' : 'formal'
  return { kind, to: (m![3] ?? '').trim().slice(0, 80), about: (m![4] ?? '').trim().slice(0, 300), tone }
}

/** The note that tells Ben the draft's shape (added to his prompt). */
export function draftNote(a: DraftAsk): string {
  return [
    `He wants a ${a.kind === 'email' ? 'email' : 'message'} draft${a.to ? ` to ${a.to}` : ''}${a.about ? ` about: ${a.about}` : ''}. Tone: ${a.tone}.`,
    'Write it in his voice (first person, signed with his first name), in the language he wrote in, ready to send. Put the WHOLE draft in "reply", exactly in this shape:',
    a.kind === 'email' ? 'Subject: <subject line>\n\n<greeting>,\n\n<body: 2–5 short paragraphs>\n\n<sign-off>,\n<his first name>' : 'Subject: <3–6 word summary>\n\n<the message, 1–4 sentences>',
    'No other words before or after it, no actions. Never invent facts (dates, grades, reasons) he did not give: use [brackets] where he must fill something in. You never send it; he does.'
  ].join('\n')
}

export interface Draft {
  subject: string
  body: string
}

/** Reads "Subject: …" + body from Ben's reply; null when it isn't a draft. */
export function parseDraft(reply: string): Draft | null {
  const s = String(reply ?? '').replace(/\r/g, '')
  const m = /^\s*(?:\*\*)?(?:subject|subiect|тема)(?:\*\*)?\s*:\s*(.+)\n+([\s\S]+)$/im.exec(s)
  if (!m) return null
  const subject = m[1].replace(/\*\*/g, '').trim().slice(0, 200)
  const body = m[2].replace(/^\s*(?:\*\*)?(?:body|text)(?:\*\*)?\s*:\s*/i, '').trim()
  if (!subject || body.length < 8) return null
  return { subject, body }
}

/** The mail app link: To (if an address was given), subject and body, kept under ~1800 characters. */
export function mailtoLink(d: Draft, to = ''): string {
  const addr = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(to.trim()) ? to.trim() : ''
  const enc = (x: string) => encodeURIComponent(x).replace(/%20/g, '%20')
  let body = d.body
  // Some mail apps refuse very long links: the body is cut (Copy has the whole draft).
  while (`mailto:${addr}?subject=${enc(d.subject)}&body=${enc(body)}`.length > 1800 && body.length > 40) body = `${body.slice(0, Math.floor(body.length * 0.85)).trimEnd()}…`
  return `mailto:${addr}?subject=${enc(d.subject)}&body=${enc(body)}`
}

/** The whole draft as text to copy. */
export const draftText = (d: Draft) => `Subject: ${d.subject}\n\n${d.body}`

/** A plain draft when the AI is off (basic mode): honest placeholders to fill in. */
export function templateDraft(a: DraftAsk, name = 'Victor'): Draft {
  const who = a.to ? a.to.replace(/^(my|the)\s+/i, '') : ''
  const greet = a.tone === 'friendly' ? `Hi${who ? ` [${who}'s name]` : ''},` : `Dear${who ? ` [${who}'s name]` : ' [name]'},`
  const about = a.about || '[what it is about]'
  const subject = a.about ? a.about.replace(/^(that|to)\s+/i, '').slice(0, 60).replace(/^./, (c) => c.toUpperCase()) : '[Subject]'
  if (a.kind === 'message') return { subject, body: `${greet.replace(/,$/, '')}! ${about.replace(/^./, (c) => c.toUpperCase())}. [Anything to add]\n${name}` }
  const body = [greet, '', `I am writing about ${about}.`, '[One or two sentences with the details.]', a.tone === 'short' ? '' : 'Please let me know if you need anything else from me.', '', a.tone === 'friendly' ? 'Thanks a lot,' : 'Kind regards,', name]
    .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
    .join('\n')
  return { subject, body }
}
