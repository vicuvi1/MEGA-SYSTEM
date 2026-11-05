// MC7 GitHub and CTF progress (read-only): your recent commits from the
// GitHub REST API (a fine-grained read-only token in GITHUB_TOKEN on the
// server; your user name is a setting) and the next online CTFs from
// CTFtime's public API. Ben sees "3 days without a commit" and suggests a CTF.
import { definePlugin, type PluginJobCtx } from '../types'
import { readData } from '../store'
import { commitStats, ctftimeUrl, eventsUrl, githubLine, pickCtfs, validUser, type CtfEvent, type GithubData } from './github'

export const GITHUB = 'github'
const dayOf = (d: Date) => d.toLocaleDateString('sv-SE')

async function job(ctx: PluginJobCtx) {
  const cfg = JSON.parse((await ctx.get(`plugin_${GITHUB}`)) || '{}') as { user?: string }
  const user = String(cfg.user ?? '').trim().replace(/^@/, '')
  if (!user || !validUser(user)) return { need: ['your GitHub user name in Settings → Plugins'] }
  const token = (ctx.env('GITHUB_TOKEN') || '').trim()
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'life-system', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const res = await ctx.fetch(eventsUrl(user), { headers, signal: AbortSignal.timeout(10_000) })
  if (res.status === 401 || res.status === 403) throw new Error(`GitHub refused the token (HTTP ${res.status}): check GITHUB_TOKEN`)
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  const stats = commitStats(await res.json(), dayOf(ctx.now))
  // CTFtime is a bonus: when it's down, the commits still count.
  let ctfs: CtfEvent[] = []
  try {
    const c = await ctx.fetch(ctftimeUrl(ctx.now), { headers: { 'User-Agent': 'life-system', Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
    if (c.ok) ctfs = pickCtfs(await c.json(), ctx.now)
  } catch {
    /* keep going */
  }
  const data: GithubData = { user, at: ctx.now.toISOString(), ...stats, ctfs }
  await ctx.set(`plugin_${GITHUB}_data`, JSON.stringify(data))
  return { note: `Last commit ${stats.lastCommit ?? 'not seen'} · ${stats.week} this week · ${ctfs.length} CTFs coming`, ...(token ? {} : { need: ['GITHUB_TOKEN (only public activity is seen without it)'] }) }
}

export default definePlugin({
  id: GITHUB,
  title: 'GitHub and CTFs',
  icon: 'bolt',
  about: 'Your recent commits and the next online CTFs (read-only). Ben notices a streak break and suggests a CTF.',
  settings: { env: ['GITHUB_TOKEN'], fields: [{ key: 'user', label: 'GitHub user name', placeholder: 'your-user-name' }] },
  context(db, now) {
    const d = readData<GithubData>(db, GITHUB)
    return d ? githubLine(d, dayOf(now)) : null
  },
  commands: {
    github: {
      help: 'Commits this week and the next CTFs',
      run({ db, now }) {
        const d = readData<GithubData>(db, GITHUB)
        return d ? `💻 ${githubLine(d, dayOf(now)).replace(/ Nudge him:.*?\.| Suggest one.*$/g, '')}` : '💻 No GitHub data yet. Set your user name in Settings → Plugins.'
      }
    }
  },
  jobs: { morning: job, tick: job, tickEvery: 240 },
  mcpTools: [
    {
      name: 'github_progress',
      description: 'Last commit day, commits in the last 7 days, repos touched and the next online CTFs.',
      inputSchema: { type: 'object', properties: {} },
      run: ({ db }) => readData<GithubData>(db, GITHUB)
    }
  ]
})
