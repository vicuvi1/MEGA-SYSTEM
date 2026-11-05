// MC8 Gmail deadline digest (read-only): uses your Google sign-in with the
// extra gmail.readonly permission ("Connect Gmail" in Settings → Plugins).
// Each morning the server reads unread mail from senders and labels you
// allowed (subject + snippet only), picks out deadlines, exam changes and
// bills, and Ben proposes tasks or events. Nothing is added until you say
// yes, and Life System never sends email.
import { definePlugin, type PluginJobCtx } from '../types'
import { listOf, readData } from '../store'
import { GMAIL_SCOPE, digestPrompt, gmailLine, gmailQuery, heuristicDigest, itemText, parseDigest, readMessage, type GmailData, type MailMsg } from './gmail'

export const GMAIL = 'gmail'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const dayOf = (d: Date) => d.toLocaleDateString('sv-SE')
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function job(ctx: PluginJobCtx) {
  const cfg = JSON.parse((await ctx.get(`plugin_${GMAIL}`)) || '{}') as { senders?: unknown; labels?: unknown }
  const q = gmailQuery(listOf(cfg.senders), listOf(cfg.labels))
  if (!q) return { need: ['senders or labels to read (Settings → Plugins → Gmail)'] }
  if (!ctx.google) return { need: ['Google connected (Settings → Connections)'] }
  if (!ctx.google.scopes.includes(GMAIL_SCOPE)) return { need: ['the Connect Gmail button (read-only permission)'] }
  const token = await ctx.google.token()
  const get = async (path: string) => {
    const r = await ctx.fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
    if (r.status === 403) throw new Error('Gmail refused: is the Gmail API on in Google Cloud, and did you press Connect Gmail?')
    if (!r.ok) throw new Error(`Gmail ${r.status}`)
    return r.json() as Promise<any>
  }
  const list = await get(`/messages?maxResults=15&q=${encodeURIComponent(q)}`)
  const msgs: MailMsg[] = []
  for (const m of (list.messages ?? []).slice(0, 15)) {
    msgs.push(readMessage(await get(`/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`)))
  }
  const today = dayOf(ctx.now)
  let items = msgs.length ? heuristicDigest(msgs, today) : []
  if (msgs.length && ctx.ai) {
    try {
      items = parseDigest(await ctx.ai(digestPrompt(msgs, today)))
    } catch {
      /* the word rules' list stays */
    }
  }
  const prev = JSON.parse((await ctx.get(`plugin_${GMAIL}_data`)) || 'null') as GmailData | null
  const data: GmailData = { day: today, at: ctx.now.toISOString(), checked: msgs.length, items }
  await ctx.set(`plugin_${GMAIL}_data`, JSON.stringify(data))
  // Only new things are worth a message.
  const seen = new Set((prev?.items ?? []).map((x) => x.title))
  const fresh = items.filter((x) => !seen.has(x.title))
  const message = fresh.length
    ? `📬 <b>From your mail</b>\n${items.map((x, i) => `${i + 1}) ${esc(itemText(x))}`).join('\n')}\n\nSay <i>"add 1"</i> and I'll put it in Todoist or your calendar. I only read; I never send email.`
    : undefined
  return { note: `${msgs.length} unread checked · ${items.length} worth a look`, message }
}

export default definePlugin({
  id: GMAIL,
  title: 'Gmail deadline digest',
  icon: 'bell',
  about: 'Reads subjects of unread mail from senders you allow, finds deadlines, exam changes and bills. Ben proposes; you approve. Never sends email.',
  settings: {
    fields: [
      { key: 'senders', label: 'Senders to read', kind: 'list', placeholder: 'uni.example, bank.example', hint: 'Email addresses or domains, separated by commas' },
      { key: 'labels', label: 'Gmail labels to read', kind: 'list', placeholder: 'University', hint: 'Optional' }
    ]
  },
  context(db, now) {
    const d = readData<GmailData>(db, GMAIL)
    return d ? gmailLine(d, dayOf(now), dayOf(new Date(now.getTime() - 86400_000))) : null
  },
  jobs: { morning: job },
  mcpTools: [
    {
      name: 'mail_deadlines',
      description: "Deadlines, exam changes and bills found in today's allowlisted unread mail (subjects only).",
      inputSchema: { type: 'object', properties: {} },
      run: ({ db }) => readData<GmailData>(db, GMAIL)
    }
  ]
})
