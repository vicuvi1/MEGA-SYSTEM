// The notebook, like Obsidian: your notes and Ben's, in Markdown. Write what
// Ben should always know in "About me"; he adds dated lines as he learns
// things and a journal page each evening. [[Title]] links notes (click to
// open, or to create it); each note lists what links to it.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { backlinks, linksOf, noteKey, searchNotes, type Note } from '@core/notebook'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useLive } from '../live'
import { timeAgo, useToast } from '../ui'
import { usePluginData } from '../../../plugins/usePluginData'
import { syncVault } from '../../../plugins/notes/settings'
import type { NotionData, VaultData } from '../../../plugins/notes/vault'

type Filter = 'all' | 'me' | 'ben' | 'journal'

/** Inline Markdown: **bold**, *italic*, `code`, [[links]]. */
function inline(text: string, open: (title: string) => void, known: (title: string) => boolean): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[\[[^\]]+\]\])/g
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('[[')) {
      const [title, label] = t.slice(2, -2).split('|')
      out.push(
        <button key={i++} className={`nb-link ${known(title) ? '' : 'new'}`} onClick={() => open(title.split('#')[0].trim())} title={known(title) ? `Open ${title}` : `Create ${title}`}>
          {(label ?? title).trim()}
        </button>
      )
    } else if (t.startsWith('**') || t.startsWith('__')) out.push(<b key={i++}>{t.slice(2, -2)}</b>)
    else if (t.startsWith('`')) out.push(<code key={i++}>{t.slice(1, -1)}</code>)
    else out.push(<i key={i++}>{t.slice(1, -1)}</i>)
    last = m.index! + t.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Block Markdown: headings, lists, checkboxes, quotes, paragraphs. */
function Markdown({ body, title, open, known, onToggle }: { body: string; title?: string; open: (t: string) => void; known: (t: string) => boolean; onToggle: (line: number) => void }) {
  const lines = body.split('\n')
  // UI16: the title is already the page header: don't show it twice.
  const first = lines.findIndex((l) => l.trim())
  const skip = title && first >= 0 && /^#\s+/.test(lines[first]) && noteKey(lines[first].replace(/^#\s+/, '')) === noteKey(title) ? first : -1
  const out: ReactNode[] = []
  let list: { n: number; node: ReactNode }[] = []
  const flush = () => {
    if (list.length) out.push(<ul key={`l${out.length}`}>{list.map((x) => <Fragment key={x.n}>{x.node}</Fragment>)}</ul>)
    list = []
  }
  lines.forEach((raw, n) => {
    if (n === skip) return
    const l = raw.trimEnd()
    const h = /^(#{1,3})\s+(.*)$/.exec(l)
    const task = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(l)
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(l)
    if (h) {
      flush()
      const T = (`h${h[1].length + 1}` as 'h2' | 'h3' | 'h4')
      out.push(<T key={n}>{inline(h[2], open, known)}</T>)
    } else if (task) {
      list.push({
        n,
        node: (
          <li className={`nb-task ${task[1] !== ' ' ? 'done' : ''}`}>
            <button className="dl-check" onClick={() => onToggle(n)} aria-label="Tick">
              {task[1] !== ' ' ? '✓' : ''}
            </button>
            <span>{inline(task[2], open, known)}</span>
          </li>
        )
      })
    } else if (item) list.push({ n, node: <li>{inline(item[1], open, known)}</li> })
    else if (/^>\s?/.test(l)) {
      flush()
      out.push(<blockquote key={n}>{inline(l.replace(/^>\s?/, ''), open, known)}</blockquote>)
    } else if (!l.trim()) flush()
    else {
      flush()
      out.push(<p key={n}>{inline(l, open, known)}</p>)
    }
  })
  flush()
  return <div className="nb-md">{out}</div>
}

/** UI16: the first real line of a note, as plain text, for the list. */
function preview(n: Note): string {
  for (const raw of n.body.split('\n')) {
    const l = raw.trim()
    if (!l) continue
    const h = /^#{1,6}\s+(.*)$/.exec(l)
    if (h && noteKey(h[1]) === noteKey(n.title)) continue
    const text = l
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^(?:[-*]|\d+\.)(?:\s+|$)(?:\[( |x|X)\](?:\s+|$))?/, '')
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => (b ?? a).trim())
      .replace(/(\*\*|__|`)/g, '')
      .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
      .trim()
    if (text) return text
  }
  return ''
}

export function Notebook() {
  const toast = useToast()
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null)
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = useCallback(() => {
    life.notes
      ?.list()
      .then((l) => {
        setNotes(l)
        // Another page asked for a note by title (Coach → "Ben's profile of you").
        let want: string | null = null
        try {
          want = localStorage.getItem('ls.openNote')
          if (want) localStorage.removeItem('ls.openNote')
        } catch {
          want = null
        }
        const asked = want ? l.find((n) => n.title === want)?.id : undefined
        setSel((s) => asked ?? s ?? l.find((n) => n.pinned)?.id ?? l[0]?.id ?? null)
      })
      .catch((e) => toast((e as Error).message, 'bad'))
  }, [toast])
  useEffect(load, [load])
  useLive(() => !edit && load())

  const cur = notes?.find((n) => n.id === sel) ?? null
  useEffect(() => {
    setDraft(cur ? { title: cur.title, body: cur.body } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id])

  const save = async (next: { title: string; body: string }, quiet = true) => {
    if (!cur) return
    try {
      const n = await life.notes!.save({ id: cur.id, title: next.title, body: next.body })
      setNotes((l) => (l ? l.map((x) => (x.id === n.id ? n : x)) : l))
      if (!quiet) toast('Saved', 'good')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  // Saves by itself a moment after you stop typing.
  const change = (next: { title: string; body: string }) => {
    setDraft(next)
    if (saveT.current) clearTimeout(saveT.current)
    saveT.current = setTimeout(() => void save(next), 700)
  }
  const known = (t: string) => !!notes?.some((n) => noteKey(n.title) === noteKey(t))
  const open = async (title: string) => {
    const hit = notes?.find((n) => noteKey(n.title) === noteKey(title))
    if (hit) return (setSel(hit.id), setEdit(false))
    try {
      const n = await life.notes!.save({ title, body: `# ${title}\n\n` })
      setNotes((l) => [n, ...(l ?? [])])
      setSel(n.id)
      setEdit(true)
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const create = () => {
    let t = 'Untitled'
    for (let i = 2; known(t); i++) t = `Untitled ${i}`
    void open(t)
  }
  const toggleTask = (line: number) => {
    if (!draft) return
    const lines = draft.body.split('\n')
    lines[line] = lines[line].replace(/\[( |x|X)\]/, (m) => (m === '[ ]' ? '[x]' : '[ ]'))
    change({ ...draft, body: lines.join('\n') })
  }

  const shown = useMemo(() => {
    const list = searchNotes(notes ?? [], q)
    return list.filter((n) => (filter === 'me' ? n.author === 'me' && !/^journal\//i.test(n.title) : filter === 'ben' ? n.author === 'ben' && !/^journal\//i.test(n.title) : filter === 'journal' ? /^journal\//i.test(n.title) : true))
  }, [notes, q, filter])
  // UI16: a time only helps when the notes differ; "just now" on every note looks broken.
  const when = (n: Note) => (Number.isNaN(Date.parse(n.updatedAt)) ? '' : timeAgo(n.updatedAt))
  const showTimes = new Set((notes ?? []).map(when).filter(Boolean)).size > 1
  const back = cur && notes ? backlinks(notes, cur.title) : []
  const outLinks = draft ? linksOf(draft.body) : []

  return (
    <div className="nb">
      <aside className="nb-side">
        <div className="nb-side-head">
          <label className="st-search">
            <Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
          </label>
          <button className="btn small primary" onClick={create} title="New note">
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className="nb-filters">
          {(
            [
              ['all', 'All'],
              ['me', 'Mine'],
              ['ben', "Ben's"],
              ['journal', 'Journal']
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="nb-list">
          {!notes && <p className="hint">Loading…</p>}
          {shown.map((n) => (
            <button key={n.id} className={`nb-item ${n.id === sel ? 'on' : ''}`} onClick={() => (setSel(n.id), setEdit(false))}>
              <b>
                {n.pinned ? '📌 ' : ''}
                {n.title}
              </b>
              {preview(n) && <span className="nb-item-prev">{preview(n)}</span>}
              {(n.author === 'ben' || (showTimes && when(n))) && (
                <small>{[n.author === 'ben' ? 'Ben' : '', showTimes ? when(n) : ''].filter(Boolean).join(' · ')}</small>
              )}
            </button>
          ))}
          {notes && !shown.length && <p className="hint">Nothing matches.</p>}
        </div>
        <FromVault q={q} />
      </aside>

      <section className="nb-main">
        {cur && draft ? (
          <>
            <header className="nb-head">
              {edit ? (
                <input className="nb-title" value={draft.title} onChange={(e) => change({ ...draft, title: e.target.value })} aria-label="Title" />
              ) : (
                <h1 className="nb-title">{draft.title}</h1>
              )}
              <span className={`nb-chip ${cur.author === 'ben' ? 'ben' : ''}`}>{cur.author === 'ben' ? 'Started by Ben' : 'Yours'}</span>
              <div className="nb-actions">
                <button className={`btn small ${edit ? 'primary' : ''}`} onClick={() => (edit && saveT.current ? (clearTimeout(saveT.current), void save(draft, false)) : null, setEdit(!edit))}>
                  {edit ? '✓ Done' : '✎ Edit'}
                </button>
                <button className="btn small ghost" onClick={() => void life.notes!.save({ id: cur.id, title: draft.title, body: draft.body, pinned: !cur.pinned }).then(load)} title="Pinned notes are always read by Ben">
                  {cur.pinned ? 'Unpin' : '📌 Pin'}
                </button>
                <button
                  className="btn small ghost"
                  onClick={() =>
                    void life.notes!.remove(cur.id).then(() => {
                      setSel(null)
                      load()
                      toast(`Deleted “${cur.title}”`, 'good')
                    })
                  }
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </header>
            {edit ? (
              <textarea className="nb-edit" value={draft.body} onChange={(e) => change({ ...draft, body: e.target.value })} autoFocus spellCheck placeholder="Write in Markdown: # heading, - list, - [ ] task, **bold**, [[Another note]]" />
            ) : (
              <div className="nb-view" onDoubleClick={() => setEdit(true)}>
                <Markdown body={draft.body} title={draft.title} open={(t) => void open(t)} known={known} onToggle={toggleTask} />
              </div>
            )}
            <footer className="nb-foot">
              {cur.pinned && <span className="hint">📌 Ben reads this note before every answer.</span>}
              {outLinks.length > 0 && (
                <div>
                  <small>Links to</small>
                  {outLinks.map((t) => (
                    <button key={t} className={`nb-link ${known(t) ? '' : 'new'}`} onClick={() => void open(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
              {back.length > 0 && (
                <div>
                  <small>Linked from</small>
                  {back.map((n) => (
                    <button key={n.id} className="nb-link" onClick={() => setSel(n.id)}>
                      {n.title}
                    </button>
                  ))}
                </div>
              )}
            </footer>
          </>
        ) : (
          <div className="nb-empty">
            <p>Pick a note on the left, or make a new one.</p>
            <button className="btn primary" onClick={create}>
              + New note
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

/** MC16: notes from your Obsidian vault (and Notion), read-only; Ben sees them too. */
function FromVault({ q }: { q: string }) {
  const vault = usePluginData<VaultData>('plugin_notes_data')
  const notion = usePluginData<NotionData>('plugin_notes_notion')
  // The Windows app reads the vault again each time the Notebook opens.
  useEffect(() => {
    void syncVault(false).catch(() => null)
  }, [])
  const words = q.trim().toLowerCase()
  const match = (t: string) => !words || t.toLowerCase().includes(words)
  const vNotes = (vault?.notes ?? []).filter((n) => match(`${n.title} ${n.headings.join(' ')} ${n.lines.join(' ')}`))
  const nPages = (notion?.pages ?? []).filter((p) => match(p.title))
  if (!vault && !notion) return null
  return (
    <details className="nb-vault">
      <summary>
        From your vault <small>({vNotes.length + nPages.length}, read-only)</small>
      </summary>
      <div className="pl-vault">
        {vNotes.slice(0, 40).map((n) => (
          <div key={`${n.folder}/${n.title}`} className="pl-vault-note">
            <b>{n.title}</b>
            {n.headings.length > 0 && <small>{n.headings.join(' · ')}</small>}
            {n.lines.map((l, i) => (
              <small key={i}>{l}</small>
            ))}
            <small>
              {n.folder ? `${n.folder} · ` : ''}
              {timeAgo(n.edited)}
            </small>
          </div>
        ))}
        {nPages.slice(0, 25).map((p) => (
          <a key={p.url || p.title} className="pl-vault-note" href={p.url} target="_blank" rel="noreferrer">
            <b>{p.title}</b>
            <small>Notion · {p.edited ? timeAgo(p.edited) : ''}</small>
          </a>
        ))}
      </div>
    </details>
  )
}
