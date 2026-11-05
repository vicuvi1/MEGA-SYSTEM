// MC16 Notes from Obsidian (Windows app: pick your vault folder) and,
// optionally, Notion (NOTION_TOKEN on the server, read-only). Titles,
// headings and a few lines show in the Notebook as "From your vault", and
// Ben can see them. Nothing is ever written back to your notes.
import { definePlugin, type PluginJobCtx } from '../types'
import { readData } from '../store'
import { getSetting } from '../../main/settings'
import { notesLine, notionTitle, type NotionData, type VaultData } from './vault'

export const NOTES = 'notes'
export const NOTION_KEY = 'plugin_notes_notion'

async function notionJob(ctx: PluginJobCtx) {
  const token = (ctx.env('NOTION_TOKEN') || '').trim()
  if (!token) return { note: 'Notion is off (no NOTION_TOKEN); the Obsidian vault still works' }
  const cfg = JSON.parse((await ctx.get(`plugin_${NOTES}`)) || '{}') as { notionDb?: string }
  const dbId = String(cfg.notionDb ?? '').replace(/[^a-f0-9]/gi, '')
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }
  const res = dbId
    ? await ctx.fetch(`https://api.notion.com/v1/databases/${dbId}/query`, { method: 'POST', headers, body: JSON.stringify({ page_size: 25, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] }), signal: AbortSignal.timeout(10_000) })
    : await ctx.fetch('https://api.notion.com/v1/search', { method: 'POST', headers, body: JSON.stringify({ page_size: 25, filter: { value: 'page', property: 'object' }, sort: { direction: 'descending', timestamp: 'last_edited_time' } }), signal: AbortSignal.timeout(10_000) })
  if (res.status === 401) throw new Error('Notion refused NOTION_TOKEN')
  if (!res.ok) throw new Error(`Notion ${res.status}`)
  const j: any = await res.json()
  const pages = (j.results ?? []).slice(0, 25).map((p: any) => ({ title: notionTitle(p), edited: String(p.last_edited_time ?? ''), url: String(p.url ?? '') }))
  const data: NotionData = { at: ctx.now.toISOString(), pages }
  await ctx.set(NOTION_KEY, JSON.stringify(data))
  return { note: `Notion: ${pages.length} pages` }
}

export default definePlugin({
  id: NOTES,
  title: 'Obsidian and Notion notes',
  icon: 'book',
  about: 'Your Obsidian vault (Windows app) and optionally Notion: titles and a few lines, read-only, in the Notebook. Ben can see them.',
  settings: {
    env: ['NOTION_TOKEN'],
    fields: [{ key: 'notionDb', label: 'Notion database id (optional)', placeholder: '32 letters and digits from the database link', hint: 'Empty: the pages shared with your Notion connection' }]
  },
  context(db) {
    const notion = (() => {
      try {
        return JSON.parse(getSetting(db, NOTION_KEY) || 'null') as NotionData | null
      } catch {
        return null
      }
    })()
    return notesLine(readData<VaultData>(db, NOTES), notion)
  },
  jobs: { morning: notionJob },
  mcpTools: [
    {
      name: 'notes_list',
      description: 'Titles, headings and first lines of the notes synced from the Obsidian vault and Notion (read-only).',
      inputSchema: { type: 'object', properties: {} },
      run: ({ db }) => ({ vault: readData<VaultData>(db, NOTES), notion: JSON.parse(getSetting(db, NOTION_KEY) || 'null') })
    }
  ]
})
