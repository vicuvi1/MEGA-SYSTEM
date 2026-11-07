// CR2: the proof-of-work log: entries you could show a recruiter (problem,
// what you did, skills, link), drafts from the Cyber path, the skills they
// prove, and an export as markdown or a clean page.
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { life } from '../bridge'
import { PROOF_ICON, PROOF_KINDS, PROOF_LABEL, portfolioHtml, portfolioMarkdown, type Proof, type ProofKind } from '@core/career/portfolio'
import type { CareerView } from '../web/career'
import { Select } from '../Select'
import { useToast } from '../ui'
import { Empty, saveFile, shortDay, type Run } from './ui'

type Form = { id: string | null; kind: ProofKind; title: string; problem: string; did: string; skills: string; link: string; pub: boolean; from?: string }
const blank: Form = { id: null, kind: 'ctf', title: '', problem: '', did: '', skills: '', link: '', pub: true }

export function PortfolioTab({ v, run }: { v: CareerView; run: Run }) {
  const c = life.career!
  const [f, setF] = useState<Form>(blank)
  const [exp, setExp] = useState<'md' | 'page' | null>(null)
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }))
  const save = async () => {
    if (f.id) await run(() => c.editProof(f.id!, { kind: f.kind, title: f.title, problem: f.problem, did: f.did, skillsText: f.skills, link: f.link || null, pub: f.pub }), 'Entry saved')
    else await run(() => c.addProof({ kind: f.kind, title: f.title, problem: f.problem, did: f.did, skills: f.skills, link: f.link || null, pub: f.pub, from: f.from }), `In your portfolio: ${f.title}`)
    setF(blank)
  }
  const edit = (p: Proof) => setF({ id: p.id, kind: p.kind, title: p.title, problem: p.problem, did: p.did, skills: p.skills.join(', '), link: p.link ?? '', pub: p.pub })
  return (
    <div className="cr-port">
      <div className="cr-port-list">
        <div className="cr-port-top">
          <div className="cr-skills" aria-label="Skills your entries prove">
            {v.skills.slice(0, 10).map((s) => (
              <span key={s.skill}>
                {s.skill} <small>{s.n}</small>
              </span>
            ))}
            {!v.skills.length && <small className="hint">Skills show up here as you add entries.</small>}
          </div>
          <div className="cr-exp-btns">
            <button className="btn small ghost" onClick={() => setExp('md')} disabled={!v.proofs.length}>
              Export markdown
            </button>
            <button className="btn small ghost" onClick={() => setExp('page')} disabled={!v.proofs.length}>
              Clean page
            </button>
          </div>
        </div>
        {v.proofs.length ? (
          <div className="cr-proofs">
            {v.proofs.slice(0, 6).map((p) => (
              <article key={p.id} className={`cr-proof${p.pub ? '' : ' private'}`}>
                <header>
                  <span className="cr-kind">
                    {PROOF_ICON[p.kind]} {PROOF_LABEL[p.kind]}
                  </span>
                  <small className="hint">
                    {shortDay(p.day)}
                    {!p.pub && ' · private'}
                  </small>
                </header>
                <h3>{p.title}</h3>
                {p.problem && (
                  <p>
                    <b>Problem.</b> {p.problem}
                  </p>
                )}
                {p.did && (
                  <p>
                    <b>What I did.</b> {p.did}
                  </p>
                )}
                <footer>
                  <span className="cr-chips">
                    {p.skills.map((s) => (
                      <i key={s}>{s}</i>
                    ))}
                  </span>
                  {p.link && (
                    <a href={p.link} target="_blank" rel="noreferrer noopener">
                      Link ↗
                    </a>
                  )}
                  <button className="cr-x" onClick={() => edit(p)} aria-label={`Edit ${p.title}`} title="Edit">
                    ✎
                  </button>
                  <button className="cr-x" onClick={() => void run(() => c.removeProof(p.id), 'Removed')} aria-label={`Remove ${p.title}`} title="Remove">
                    🗑
                  </button>
                </footer>
              </article>
            ))}
            {v.proofs.length > 6 && <p className="hint">+{v.proofs.length - 6} older entries are in the export.</p>}
          </div>
        ) : (
          <Empty title="No entries yet">Finished a CTF, a crate, a lab or a feature? Write it up while it's fresh: 5 minutes now saves an hour before an interview.</Empty>
        )}
      </div>
      <aside className="cr-port-side">
        <form
          className="cr-card cr-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <h3>{f.id ? 'Edit entry' : 'New entry'}</h3>
          <div className="cr-form-row">
            <Select value={f.kind} onChange={(e) => set({ kind: e.target.value as ProofKind })} aria-label="Kind">
              {PROOF_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROOF_ICON[k]} {PROOF_LABEL[k]}
                </option>
              ))}
            </Select>
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="Title" maxLength={120} aria-label="Title" />
          </div>
          <textarea value={f.problem} onChange={(e) => set({ problem: e.target.value })} placeholder="The problem (1–2 sentences)" rows={2} maxLength={600} aria-label="Problem" />
          <textarea value={f.did} onChange={(e) => set({ did: e.target.value })} placeholder="What I did and how" rows={3} maxLength={1200} aria-label="What I did" />
          <div className="cr-form-row">
            <input value={f.skills} onChange={(e) => set({ skills: e.target.value })} placeholder="Skills: Rust, SQL injection…" maxLength={300} aria-label="Skills" />
            <input value={f.link} onChange={(e) => set({ link: e.target.value })} placeholder="Link (GitHub, blog)" maxLength={300} aria-label="Link" />
          </div>
          <div className="cr-form-foot">
            <label className="cr-check">
              <input type="checkbox" checked={f.pub} onChange={(e) => set({ pub: e.target.checked })} /> Show in the export
            </label>
            {f.id && (
              <button type="button" className="btn small ghost" onClick={() => setF(blank)}>
                Cancel
              </button>
            )}
            <button className="btn small primary" disabled={!f.title.trim()}>
              {f.id ? 'Save' : 'Add to portfolio'}
            </button>
          </div>
        </form>
        {v.drafts.length > 0 && (
          <section className="cr-card cr-drafts">
            <h3>
              From your Cyber path <small className="hint">not written up yet</small>
            </h3>
            <ul>
              {v.drafts.slice(0, 4).map((d) => (
                <li key={d.from}>
                  <span>
                    {PROOF_ICON[d.kind]} {d.title}
                  </span>
                  <button className="btn small ghost" onClick={() => setF({ ...blank, kind: d.kind, title: d.title, skills: d.skills.join(', '), link: d.link ?? '', from: d.from })}>
                    Write it up
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
      {exp && <ExportSheet kind={exp} list={v.proofs} onClose={() => setExp(null)} />}
    </div>
  )
}

function ExportSheet({ kind, list, onClose }: { kind: 'md' | 'page'; list: Proof[]; onClose: () => void }) {
  const toast = useToast()
  const [title, setTitle] = useState('Proof of work')
  const md = useMemo(() => portfolioMarkdown(list, { title }), [list, title])
  const pub = list.filter((p) => p.pub).sort((a, b) => b.day.localeCompare(a.day))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md)
      toast('Copied')
    } catch {
      toast('Copy is blocked here: use Download')
    }
  }
  return createPortal(
    <div className="cr-scrim" role="presentation" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="cr-sheet" role="dialog" aria-modal="true" aria-label={kind === 'md' ? 'Markdown export' : 'Clean page export'} onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{kind === 'md' ? 'Markdown for a README or blog' : 'A clean page you can share'}</h3>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" maxLength={60} />
          <button className="cr-x" onClick={onClose} aria-label="Close" autoFocus>
            ✕
          </button>
        </header>
        {kind === 'md' ? (
          <pre className="cr-md">{md}</pre>
        ) : (
          <div className="cr-page-prev">
            <h1>{title || 'Proof of work'}</h1>
            {pub.map((p) => (
              <article key={p.id}>
                <small>
                  {PROOF_LABEL[p.kind]} · {shortDay(p.day)}
                </small>
                <h2>{p.title}</h2>
                {p.problem && (
                  <p>
                    <b>Problem.</b> {p.problem}
                  </p>
                )}
                {p.did && (
                  <p>
                    <b>What I did.</b> {p.did}
                  </p>
                )}
                <p className="cr-chips">
                  {p.skills.map((s) => (
                    <i key={s}>{s}</i>
                  ))}
                </p>
              </article>
            ))}
          </div>
        )}
        <footer>
          <small className="hint">Only entries marked "show in the export" ({pub.length}). Private ones stay in the app.</small>
          {kind === 'md' ? (
            <>
              <button className="btn small ghost" onClick={() => void copy()}>
                Copy
              </button>
              <button className="btn small primary" onClick={() => saveFile('portfolio.md', md, 'text/markdown')}>
                Download .md
              </button>
            </>
          ) : (
            <button className="btn small primary" onClick={() => saveFile('portfolio.html', portfolioHtml(list, { title }), 'text/html')}>
              Download page
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body
  )
}
