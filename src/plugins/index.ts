// The one list of plugins, used by the app in the browser and by the server
// bundle (api/_bot/bot.mjs). No React here: Today cards and Settings panels
// are in cards.tsx, which only the browser imports.
import type { McpTool, Plugin, PluginAction, PluginActCtx, PluginCommand, PluginDb } from './types'
import { isOn } from './store'
import weather from './weather'
import github from './github'
import gmail from './gmail'
import bank from './bank'
import health from './health'
import notes from './notes'

export const PLUGINS: Plugin[] = [weather, github, gmail, bank, health, notes]

export const pluginById = (id: string) => PLUGINS.find((p) => p.id === id) ?? null

/** Lines for what Ben knows, from the plugins that are on (a broken plugin never breaks Ben). */
export function pluginContext(db: PluginDb, now: Date): string[] {
  const out: string[] = []
  for (const p of PLUGINS) {
    if (!p.context || !isOn(db, p.id)) continue
    try {
      const line = p.context(db, now)
      if (line) out.push(line)
    } catch {
      /* skip it */
    }
  }
  return out
}

export interface PluginActionCall {
  kind: 'plugin'
  plugin: string
  verb: string
  args: unknown
}

/** "steps: 8000" → a plugin action, or null (readAction then tries the built-ins). */
export function readPluginAction(line: string): PluginActionCall | null {
  const m = /^\s*([a-z][a-z0-9_]{1,24})\s*:\s*([\s\S]+)$/i.exec(line)
  if (!m) return null
  const verb = m[1].toLowerCase()
  for (const p of PLUGINS) {
    const a: PluginAction | undefined = p.actions?.[verb]
    if (!a) continue
    const args = a.parse(m[2].trim().slice(0, 400))
    return args == null ? null : { kind: 'plugin', plugin: p.id, verb, args }
  }
  return null
}

/**
 * Honest numbers: a plugin action runs only when every number in it (dates
 * aside) is one he wrote himself; Ben suggesting "walk 8000 steps" logs nothing.
 */
export function pluginActionInText(text: string, call: PluginActionCall): boolean {
  const nums = JSON.stringify(call.args ?? null).replace(/"\d{4}-\d{2}-\d{2}"/g, '').match(/\d+(?:\.\d+)?/g) ?? []
  const mine = String(text ?? '').replace(/(\d)[\s,.](?=\d{3}\b)/g, '$1').match(/\d+(?:[.,]\d+)?/g)?.map((m) => m.replace(',', '.')) ?? []
  return nums.every((n) => mine.includes(n))
}

/** Every plugin verb (so readAction knows a line is a plugin's, even when its arguments are wrong). */
export const pluginVerbs = (): string[] => PLUGINS.flatMap((p) => Object.keys(p.actions ?? {}))

/** Runs a plugin action inside a database change; the line for the reply and its undo. */
export function runPluginAction(ctx: PluginActCtx, call: PluginActionCall): { line: string; undo?: unknown } | null {
  const p = pluginById(call.plugin)
  const a = p?.actions?.[call.verb]
  if (!p || !a) return null
  if (!isOn(ctx.db, p.id)) return { line: `⚠️ The ${p.title} plugin is off (Settings → Plugins)` }
  return a.run(ctx, call.args)
}

export function undoPluginAction(ctx: PluginActCtx, plugin: string, verb: string, data: unknown): string {
  const a = pluginById(plugin)?.actions?.[verb]
  return a?.undo ? a.undo(ctx, data) : '⚠️ That one can’t be undone'
}

/** The plugin actions for Ben's prompt (one line each). */
export function pluginActionsHelp(): string {
  const lines = PLUGINS.flatMap((p) => Object.values(p.actions ?? {}).map((a) => `- ${a.help}`))
  return lines.length ? `Plugin actions (only when that plugin's data shows below):\n${lines.join('\n')}` : ''
}

/** "/weather" → the plugin command, when that plugin is on. */
export function findPluginCommand(db: PluginDb, text: string): { plugin: Plugin; cmd: PluginCommand; arg: string } | null {
  const m = /^\/([a-z][a-z0-9_]{1,30})(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const name = m[1].toLowerCase()
  for (const p of PLUGINS) {
    const cmd = p.commands?.[name]
    if (cmd && isOn(db, p.id)) return { plugin: p, cmd, arg: (m[2] ?? '').trim() }
  }
  return null
}

/** The plugin that reads this file (a bank CSV…), when it's on. */
export function pluginForFile(db: PluginDb, name: string, mime: string): Plugin | null {
  return PLUGINS.find((p) => p.file && isOn(db, p.id) && p.file.accepts(name, mime)) ?? null
}

/** Read-only tools for the MCP agent, named "<plugin>.<tool>"-free (tool names are unique). */
export function pluginMcpTools(db: PluginDb): (McpTool & { plugin: string })[] {
  return PLUGINS.filter((p) => isOn(db, p.id)).flatMap((p) => (p.mcpTools ?? []).map((t) => ({ ...t, plugin: p.id })))
}

export type { Plugin } from './types'
