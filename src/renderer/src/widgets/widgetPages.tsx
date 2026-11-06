// PL1 / PL5 / PL6: the island's widget pages (Home, PC, Fun). Each shows the
// widgets you put on it (Settings → Widgets) and your script tiles. Only the
// page you see is mounted, so the other pages' widgets don't run at all.
import { useEffect, useMemo } from 'react'
import { cleanGrants, widgetData } from '@core/widgets/bridge'
import { cleanScripts } from '@core/widgets/scripts'
import { cleanWidgets } from '@core/widgets/settings'
import { tp } from '../islandTap'
import { registerIslandPage, type IslandPageCtx } from './islandPages'
import { MANIFESTS } from './registry'
import { runNow, unslow, useScriptTiles } from './scriptRunner'
import { WidgetFrame } from './WidgetFrame'
import { confirmShown, islandCall, themeVars, useConfirmAsk } from './widgetHost'
import './widgets.css'

/** Add / No for a widget's or script's ask, drawn by the island itself. */
export function ConfirmCard() {
  const a = useConfirmAsk()
  useEffect(() => {
    confirmShown(true)
    return () => confirmShown(false)
  }, [])
  if (!a) return null
  return (
    <div className="wg-confirm" role="alertdialog" aria-label={`${a.who} wants to ${a.what}`}>
      <p>
        <b>{a.who}</b> wants to {a.what}:
      </p>
      <q>{a.text}</q>
      <div>
        <button type="button" className="primary" {...tp('wg:yes', () => a.answer(true))}>Add</button>
        <button type="button" {...tp('wg:no', () => a.answer(false))}>No</button>
      </div>
    </div>
  )
}

function WidgetGrid({ page, ctx }: { page: string; ctx: IslandPageCtx }) {
  const setting = useMemo(() => cleanWidgets(ctx.snap.widgets, MANIFESTS), [JSON.stringify(ctx.snap.widgets ?? null)])
  const scripts = cleanScripts(setting.scripts).filter((s) => s.on && s.page === page)
  const results = useScriptTiles()
  const theme = useMemo(() => themeVars(), [])
  // Data for widgets moves by the minute (their own refresh rate decides when it's sent).
  const minute = Math.floor(ctx.now / 60_000)
  const here = setting.installed.filter((w) => w.page === page && MANIFESTS[w.id])
  if (!here.length && !scripts.length)
    return (
      <div className="ip-empty">
        <b>Nothing here yet</b>
        <small>Add widgets in Settings → Widgets in the app, or a script tile (“show X when Y”).</small>
      </div>
    )
  return (
    <>
      <ConfirmCard />
      <div className="wg-grid">
        {here.map((w) => {
          const m = MANIFESTS[w.id]
          const grants = cleanGrants(m, w.grants)
          return <WidgetFrame key={`${w.id}:${w.sha256}`} manifest={m} sha256={w.sha256} grants={grants} config={w.config} data={widgetData(ctx.snap, minute * 60_000, grants)} onCall={islandCall(w.id, m.name)} theme={theme} />
        })}
        {scripts.map((s) => {
          const r = results[s.id]
          if (r?.slowed)
            return (
              <div key={s.id} className="wf wf-1x1 wf-msg wf-slowed">
                <b>{s.name} · slowed down</b>
                <small>{r.slowed}.</small>
                <button type="button" {...tp(`sc:retry:${s.id}`, () => (unslow(s.id), void runNow(s, ctx.snap)))}>Try again</button>
              </div>
            )
          // "Show X when Y": no show() this time → no tile.
          if (!r?.show && !r?.error) return null
          return (
            <div key={s.id} className={`wf wf-1x1 wg-script ${r.error ? 'has-error' : ''}`} title={r.error ? `${s.name}: ${r.error}` : s.name}>
              <i>{r.show?.icon || s.icon}</i>
              <span>{r.show?.text ?? r.error}</span>
              <small>{s.name}</small>
            </div>
          )
        })}
      </div>
    </>
  )
}

registerIslandPage({ id: 'home', title: 'Home', icon: '🏠', order: 20, render: (ctx) => <WidgetGrid page="home" ctx={ctx} /> })
registerIslandPage({ id: 'pc', title: 'PC', icon: '💻', order: 30, render: (ctx) => <WidgetGrid page="pc" ctx={ctx} /> })
registerIslandPage({ id: 'fun', title: 'Fun', icon: '🎲', order: 40, render: (ctx) => <WidgetGrid page="fun" ctx={ctx} /> })
