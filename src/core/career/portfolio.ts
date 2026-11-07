// The proof-of-work portfolio log (CR2). Pure and tested.
//
// Every finished CTF writeup, Rust crate, lab or app feature becomes a short
// entry you could show a recruiter: the problem, what you did, the skills,
// a link. It exports as markdown (for a GitHub README) or a clean page.
// Unlike the Cyber path log, which only counts, these entries are kept whole.
import type { LearnEntry } from '../learnPath'

export type ProofKind = 'ctf' | 'crate' | 'lab' | 'feature' | 'writing' | 'other'
export const PROOF_KINDS: ProofKind[] = ['ctf', 'crate', 'lab', 'feature', 'writing', 'other']
export const PROOF_LABEL: Record<ProofKind, string> = { ctf: 'CTF writeup', crate: 'Rust crate', lab: 'Lab', feature: 'App feature', writing: 'Writing', other: 'Other' }
export const PROOF_ICON: Record<ProofKind, string> = { ctf: '🚩', crate: '🦀', lab: '🧪', feature: '🛠️', writing: '✍️', other: '📌' }
const SECTION: Record<ProofKind, string> = { ctf: 'CTF writeups', crate: 'Rust crates', lab: 'Labs', feature: 'App features', writing: 'Writing', other: 'Other work' }

export interface Proof {
  id: string
  kind: ProofKind
  title: string
  problem: string
  did: string
  skills: string[]
  link: string | null
  day: string
  /** Left out of the export when false. */
  pub: boolean
  /** The Cyber path entry it came from, if any. */
  from?: string
}

export function parseSkills(text: string): string[] {
  const out: string[] = []
  for (const s of String(text ?? '').split(/[,;#\n]+/)) {
    const t = s.trim().replace(/\s+/g, ' ').slice(0, 30)
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out.slice(0, 12)
}

const cleanLink = (x: unknown): string | null => (typeof x === 'string' && /^https?:\/\/\S{3,}$/i.test(x.trim()) ? x.trim().slice(0, 300) : null)

export function makeProof(p: { kind: ProofKind; title: string; problem?: string; did?: string; skills?: string[] | string; link?: string | null; pub?: boolean; from?: string }, today: string, id: string): Proof | null {
  const title = p.title.trim().slice(0, 120)
  if (!title) return null
  return {
    id,
    kind: PROOF_KINDS.includes(p.kind) ? p.kind : 'other',
    title,
    problem: (p.problem ?? '').trim().slice(0, 600),
    did: (p.did ?? '').trim().slice(0, 1200),
    skills: Array.isArray(p.skills) ? parseSkills(p.skills.join(',')) : parseSkills(p.skills ?? ''),
    link: cleanLink(p.link),
    day: today,
    pub: p.pub !== false,
    ...(p.from ? { from: p.from } : {})
  }
}

export function skillCounts(list: Proof[]): { skill: string; n: number }[] {
  const m = new Map<string, { skill: string; n: number }>()
  for (const p of list) for (const s of p.skills) {
    const k = s.toLowerCase()
    const cur = m.get(k) ?? { skill: s, n: 0 }
    cur.n++
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.skill.localeCompare(b.skill))
}

/** Cyber path entries that aren't in the portfolio yet: drafts to finish. */
export function fromLearn(learn: LearnEntry[], list: Proof[]): { kind: ProofKind; title: string; link: string | null; skills: string[]; from: string; day: string }[] {
  const have = new Set(list.map((p) => p.from).filter(Boolean))
  const titles = new Set(list.map((p) => p.title.toLowerCase()))
  return learn
    .filter((e) => !have.has(e.id) && !titles.has(e.title.toLowerCase()))
    .map((e) => ({ kind: (e.track === 'ctf' ? 'ctf' : e.track === 'rust' ? 'crate' : 'lab') as ProofKind, title: e.title, link: e.link, skills: parseSkills([e.track === 'ctf' ? 'CTF' : e.track === 'rust' ? 'Rust' : 'Cryptography', e.tag].join(',')), from: e.id, day: e.day }))
    .slice(0, 8)
}

const monthYear = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const sorted = (list: Proof[]) => list.filter((p) => p.pub).sort((a, b) => b.day.localeCompare(a.day) || a.title.localeCompare(b.title))

/** Markdown for a GitHub README or a blog: sections by kind, newest first, public entries only. */
export function portfolioMarkdown(list: Proof[], opts: { title?: string; intro?: string } = {}): string {
  const items = sorted(list)
  const md = (s: string) => s.replace(/([\\`*_[\]<>])/g, '\\$1')
  const out = [`# ${md(opts.title?.trim() || 'Proof of work')}`, '']
  if (opts.intro?.trim()) out.push(md(opts.intro.trim()), '')
  const skills = skillCounts(items).slice(0, 12)
  if (skills.length) out.push(`**Skills:** ${skills.map((s) => md(s.skill)).join(' · ')}`, '')
  for (const k of PROOF_KINDS) {
    const group = items.filter((p) => p.kind === k)
    if (!group.length) continue
    out.push(`## ${SECTION[k]}`, '')
    for (const p of group) {
      out.push(`### ${md(p.title)} (${monthYear(p.day)})`, '')
      if (p.problem) out.push(`**Problem:** ${md(p.problem)}`, '')
      if (p.did) out.push(`**What I did:** ${md(p.did)}`, '')
      if (p.skills.length) out.push(`**Skills:** ${p.skills.map(md).join(', ')}`, '')
      if (p.link) out.push(`[Link](${p.link.replace(/[()\s]/g, encodeURIComponent)})`, '')
    }
  }
  if (!items.length) out.push('_Nothing public yet._', '')
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

const h = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** A clean, standalone page (no scripts, inline styles) of the public entries. */
export function portfolioHtml(list: Proof[], opts: { title?: string; intro?: string } = {}): string {
  const items = sorted(list)
  const title = h(opts.title?.trim() || 'Proof of work')
  const cards = items
    .map(
      (p) => `<article><p class="k">${h(PROOF_LABEL[p.kind])} · ${h(monthYear(p.day))}</p><h2>${h(p.title)}</h2>${p.problem ? `<p><b>Problem.</b> ${h(p.problem)}</p>` : ''}${p.did ? `<p><b>What I did.</b> ${h(p.did)}</p>` : ''}${p.skills.length ? `<p class="s">${p.skills.map((s) => `<span>${h(s)}</span>`).join('')}</p>` : ''}${p.link ? `<p><a href="${h(p.link)}" rel="noopener noreferrer">${h(p.link.replace(/^https?:\/\//, ''))}</a></p>` : ''}</article>`
    )
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;background:#f7f8fa;color:#161a22}main{max-width:760px;margin:0 auto;padding:40px 16px}h1{font-size:30px;margin:0 0 6px}article{background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:18px 20px;margin:14px 0}h2{font-size:19px;margin:2px 0 8px}.k{margin:0;color:#5b6474;font-size:13px}.s span{display:inline-block;background:#eef1f6;border-radius:99px;padding:2px 10px;margin:0 6px 6px 0;font-size:13px}a{color:#2453c7}@media (prefers-color-scheme:dark){body{background:#0f131b;color:#e8ebf1}article{background:#151a24;border-color:#262d3b}.k{color:#9aa3b5}.s span{background:#1f2633}a{color:#8fb0ff}}</style></head>
<body><main><h1>${title}</h1>${opts.intro?.trim() ? `<p>${h(opts.intro.trim())}</p>` : ''}
${cards || '<p>Nothing public yet.</p>'}
</main></body></html>
`
}

export function cleanPortfolio(raw: unknown): Proof[] {
  if (!Array.isArray(raw)) return []
  const day = /^\d{4}-\d{2}-\d{2}$/
  return (raw as any[])
    .filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string' && day.test(p.day))
    .map((p) => ({
      id: p.id.slice(0, 40),
      kind: PROOF_KINDS.includes(p.kind) ? p.kind : 'other',
      title: p.title.slice(0, 120),
      problem: String(p.problem ?? '').slice(0, 600),
      did: String(p.did ?? '').slice(0, 1200),
      skills: Array.isArray(p.skills) ? parseSkills(p.skills.map(String).join(',')) : [],
      link: cleanLink(p.link),
      day: p.day,
      pub: p.pub !== false,
      ...(typeof p.from === 'string' ? { from: p.from.slice(0, 40) } : {})
    }))
    .slice(0, 500)
}
