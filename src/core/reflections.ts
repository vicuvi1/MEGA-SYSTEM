// MN14: short evening reflections, kept in one Notebook note ("Reflections").
// Newest entries go at the top, under a dated heading.

export const REFLECTION_TITLE = 'Reflections'

export const REFLECTION_PROMPTS = [
  'What helped you stay on track today?',
  'When was today hardest, and what did you do?',
  'What will you do differently tomorrow?',
  'What are you proud of today?',
  'What drained you today, and what gave you energy?',
  'What would make tomorrow a good day?',
  'Which trigger showed up today, and how did you handle it?'
] as const

/** The same question all day, a different one each day. */
export function reflectionPrompt(day: string): string {
  const n = day.split('-').reduce((a, x) => a + Number(x), 0)
  return REFLECTION_PROMPTS[n % REFLECTION_PROMPTS.length]
}

const HEAD = `# ${REFLECTION_TITLE}\n\nShort notes from the Discipline page. Newest first.\n`

/** The note's body with one more entry on top. */
export function addReflection(body: string | null | undefined, day: string, prompt: string, text: string): string {
  const entry = `\n## ${day}\n_${prompt}_\n\n${text.trim()}\n`
  const b = (body ?? '').trim()
  if (!b) return `${HEAD}${entry}`
  const i = b.indexOf('\n## ')
  return i < 0 ? `${b}\n${entry}` : `${b.slice(0, i)}\n${entry}${b.slice(i)}\n`
}

/** The newest entries, for the card ("2026-11-04", the text). */
export function lastReflections(body: string | null | undefined, n = 3): { day: string; text: string }[] {
  const parts = (body ?? '').split('\n## ').slice(1)
  return parts.slice(0, n).map((p) => {
    const [day, ...rest] = p.split('\n')
    const text = rest.filter((l) => l.trim() && !/^_.*_$/.test(l.trim())).join(' ').trim()
    return { day: day.trim(), text }
  })
}
