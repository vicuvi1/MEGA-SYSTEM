// Plugins: small add-ons compiled into the app (no code is loaded at run
// time). Each one lives in src/plugins/<id>/index.ts and can add a line to
// what Ben knows, actions Ben may take, Telegram commands, daily jobs on the
// server and read-only tools for the MCP agent. Its Today card lives in a
// separate card.tsx (see cards.tsx) so the server bundle never pulls React.
import type { DB } from '../main/db'

export type PluginDb = DB

/** What a plugin action or command gets: the database copy (inside one change) and the time. */
export interface PluginActCtx {
  db: PluginDb
  now: Date
}

export interface PluginAction<A = any> {
  /** One line for Ben's prompt: how to write it ("steps: <number> [| YYYY-MM-DD]"). */
  help: string
  /** The text after "verb:" → the arguments, or null when it isn't valid. */
  parse(arg: string): A | null
  /** Does it; returns the line shown under Ben's reply (null: nothing happened). */
  run(ctx: PluginActCtx, args: A): { line: string; undo?: unknown } | null
  /** Takes it back (gets the `undo` that run returned). */
  undo?(ctx: PluginActCtx, data: unknown): string
}

export interface PluginCommand {
  help: string
  /** Reads only: the reply (HTML allowed: <b>, <i>, <code>). */
  run(ctx: PluginActCtx, arg: string): string | null
}

/** A server job's helpers (the tick in src/server/telegramBot.ts gives them). */
export interface PluginJobCtx {
  now: Date
  /** A setting from the database (settings table). */
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  /** A server environment variable (only on the server; never sent to devices). */
  env(name: string): string | undefined
  fetch: typeof fetch
  /** A cheap model call, when an AI key is set. */
  ai?: (prompt: string) => Promise<string>
  /** Your Google sign-in (access token + granted scopes), when connected. */
  google?: { token(): Promise<string>; scopes: string[] } | null
}

export interface PluginJobResult {
  /** A message for Telegram (HTML). */
  message?: string
  /** One line for Settings → Plugins ("Updated: 4–11°C, rain at 17:00"). */
  note?: string
  /** Things still missing ("GITHUB_TOKEN", "a city"). */
  need?: string[]
}

export type PluginJob = (ctx: PluginJobCtx) => Promise<PluginJobResult | void>

export interface McpTool {
  name: string
  description: string
  /** JSON schema of the arguments. */
  inputSchema: Record<string, unknown>
  /** Read-only: returns plain data. */
  run(ctx: PluginActCtx, args: Record<string, unknown>): unknown
}

export interface PluginField {
  key: string
  label: string
  hint?: string
  placeholder?: string
  /** list: comma or new-line separated words. */
  kind?: 'text' | 'list'
}

export interface PluginFile {
  /** True when this plugin reads this kind of file. */
  accepts(name: string, mime: string): boolean
  /** Reads the file in memory (never stored) and says what happened. */
  run(ctx: PluginActCtx, text: string, name: string): string
}

export interface Plugin {
  id: string
  title: string
  /** An icon name from src/renderer/src/Icon.tsx. */
  icon: string
  /** One plain line for Settings. */
  about: string
  settings?: {
    /** Server environment variable NAMES it needs (values live in Vercel). */
    env?: string[]
    /** Its own settings (stored in the settings table under plugin_<id>). */
    fields?: PluginField[]
    /** Only works in the Windows app. */
    desktopOnly?: boolean
  }
  /** A line for what Ben knows right now (lifeContext), or null. */
  context?(db: PluginDb, now: Date): string | null
  actions?: Record<string, PluginAction>
  commands?: Record<string, PluginCommand>
  /** Server jobs: morning (once a day after 05:00), tick (every `tickEvery` minutes), evening (once after 19:00). */
  jobs?: { morning?: PluginJob; tick?: PluginJob; evening?: PluginJob; tickEvery?: number }
  /** Read-only tools for the MCP agent. */
  mcpTools?: McpTool[]
  file?: PluginFile
}

export const definePlugin = (p: Plugin): Plugin => p
