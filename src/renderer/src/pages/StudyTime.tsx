// Study Time: a time tracker in the style of Focus To-Do, built for the
// desktop window. Timer tab: two halves (the big ring timer and today's
// sessions on the left; the quick add bar and your blocks on the right).
// Stats tab: the full window. Sessions tab: add or fix a session.
// Rules: src/core/studyTime.ts, studyPlan.ts, studyInsights.ts; the database
// side: src/main/studyTime.ts; the island: studyTimeIslandFeed.ts.
import { useEffect, useState } from 'react'
import { addDays, dayKey } from '@core/dates'
import { filterBlocks, hmText, weekStart } from '@core/studyTime'
import { PageTabs, TabPanel, usePageTab } from '../PageTabs'
import { useStudy } from '../study/studyData'
import { TimerPane } from '../study/TimerPane'
import { BlocksPane } from '../study/BlocksPane'
import { StatsTab } from '../study/StatsTab'
import { LogTab } from '../study/LogTab'
import '../study/study.css'

export function StudyTime() {
  const { store, sessions, run, ready } = useStudy()
  const [tab, setTab] = usePageTab('study', ['timer', 'stats', 'log'], 'timer')
  const today = dayKey(new Date())
  const todayMin = sessions.filter((s) => s.day === today).reduce((t, s) => t + s.minutes, 0)
  const weekMin = sessions.filter((s) => s.day >= weekStart(today) && s.day <= today).reduce((t, s) => t + s.minutes, 0)
  // The block the timer shows before you start (the running one, a row you picked, or the first for today).
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => {
    if (run?.blockId) setPicked(run.blockId)
  }, [run?.blockId])
  const selected = store.blocks.find((b) => b.id === picked && !b.done) ?? filterBlocks(store.blocks, { kind: 'today' }, today)[0] ?? null
  return (
    <div className="sy">
      <header className="sy-top">
        <div className="sy-today" aria-label="Studied today">
          <b className="num" data-testid="study-today">
            {hmText(todayMin)}
          </b>
          <small>studied today</small>
          <span className="sy-week num">· {hmText(weekMin)} this week</span>
        </div>
        <PageTabs
          page="study"
          label="Study Time views"
          tabs={[
            { id: 'timer', label: 'Timer', title: 'The timer and your blocks (1)' },
            { id: 'stats', label: 'Stats', title: 'Where your time goes (2)' },
            { id: 'log', label: 'Sessions', title: 'Add or fix a session (3)', count: sessions.filter((s) => s.day >= addDays(today, -6)).length || null }
          ]}
          value={tab}
          onChange={setTab}
        />
      </header>
      <TabPanel page="study" id="timer" value={tab}>
        {ready && (
          <div className="sy-split">
            <TimerPane store={store} sessions={sessions} run={run} today={today} selected={selected} onSelect={setPicked} />
            <BlocksPane store={store} sessions={sessions} run={run} today={today} selected={selected?.id ?? null} onSelect={setPicked} />
          </div>
        )}
      </TabPanel>
      <TabPanel page="study" id="stats" value={tab}>
        {ready && <StatsTab store={store} sessions={sessions} today={today} />}
      </TabPanel>
      <TabPanel page="study" id="log" value={tab}>
        {ready && <LogTab store={store} sessions={sessions} today={today} />}
      </TabPanel>
    </div>
  )
}
