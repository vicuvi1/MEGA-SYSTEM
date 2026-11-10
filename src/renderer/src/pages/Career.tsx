// Career: the future you're building, in one page with tabs. Jobs (the
// application board with a weekly quota and follow-ups), Portfolio (proof of
// work you can export), Cards (flashcards with spaced repetition), Study (the
// shift study kit and the essay planner), Money (emergency fund, pay
// yourself first, career fund, income target, the investing projection) and
// Review (Ben's monthly career letter). Nothing here pays points: focus time
// already pays for the work.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useLive } from '../live'
import { useAction } from '../ui'
import { PageSkeleton } from '../blocks'
import { PageTabs, TabPanel, usePageTab } from '../PageTabs'
import type { PageId } from '../modules'
import type { CareerView } from '../web/career'
import { JobsTab } from '../career/JobsTab'
import { PortfolioTab } from '../career/PortfolioTab'
import { CardsTab } from '../career/CardsTab'
import { StudyTab } from '../career/StudyTab'
import { MoneyTab } from '../career/MoneyTab'
import { ReviewTab } from '../career/ReviewTab'
import { hm, lei, type Run } from '../career/ui'
import '../career/career.css'

export const CAREER_TABS = ['jobs', 'portfolio', 'cards', 'study', 'money', 'review']

export function Career({ onGo }: { onGo?: (p: PageId) => void }) {
  const act = useAction()
  const [v, setV] = useState<CareerView | null>(null)
  const [tab, setTab] = usePageTab('career', CAREER_TABS, 'jobs')
  const load = useCallback(() => {
    life.career?.view().then(setV).catch(() => {})
  }, [])
  useEffect(load, [load])
  useLive(load)
  useEffect(() => {
    const on = () => load()
    window.addEventListener('life-career-changed', on)
    window.addEventListener('life-focus-changed', on)
    return () => {
      window.removeEventListener('life-career-changed', on)
      window.removeEventListener('life-focus-changed', on)
    }
  }, [load])
  const run: Run = useCallback(
    async (fn, success) => {
      const r = await act(fn, success)
      if (r) setV(r)
    },
    [act]
  )
  if (!life.career) return <p className="hint">Career needs the web app.</p>
  if (!v) return <PageSkeleton />
  const behind = v.study.essays.filter((e) => e.status.state === 'behind' || e.status.state === 'late').length
  return (
    <div className="cr">
      <header className="cr-hero">
        <div className="cr-hero-txt">
          <h1>Career</h1>
          <p className="hint">Applications, proof of work, study and money for the job you want.</p>
        </div>
        <div className="cr-hero-stats">
          <button className={`cr-chip${v.week.sent >= v.week.quota && v.week.quota ? ' ok' : ''}`} onClick={() => setTab('jobs')}>
            <b>
              {v.week.sent}/{v.week.quota}
            </b>
            <small>applications this week</small>
          </button>
          <button className={`cr-chip${v.cards.queue.length ? ' warn' : ' ok'}`} onClick={() => setTab('cards')}>
            <b>{v.cards.queue.length}</b>
            <small>cards due</small>
          </button>
          <button className="cr-chip" onClick={() => setTab('study')}>
            <b>{hm(v.hours.week)}</b>
            <small>career work this week</small>
          </button>
          <button className={`cr-chip${v.money.ef.full ? ' ok' : ''}`} onClick={() => setTab('money')}>
            <b>{v.money.ef.pct == null ? lei(v.money.ef.saved) : `${v.money.ef.pct}%`}</b>
            <small>emergency fund</small>
          </button>
          <button className="btn ghost small" onClick={() => onGo?.('coach')} title="Ben knows your career numbers: ask him">
            Talk to Ben
          </button>
        </div>
      </header>
      <PageTabs
        page="career"
        label="Career views"
        tabs={[
          { id: 'jobs', label: 'Jobs', count: v.followUps.length || undefined, title: 'The application board, weekly quota and follow-ups (1)' },
          { id: 'portfolio', label: 'Portfolio', count: v.proofs.length || undefined, title: 'Proof of work you can export (2)' },
          { id: 'cards', label: 'Cards', count: v.cards.queue.length || undefined, title: 'Flashcards with spaced repetition (3)' },
          { id: 'study', label: 'Study', count: behind || undefined, title: 'The shift study kit and the essay planner (4)' },
          { id: 'money', label: 'Money', count: v.money.asks.length || undefined, title: 'Emergency fund, pay yourself first, career fund, income and investing (5)' },
          { id: 'review', label: 'Review', count: v.letterDue ? 1 : undefined, title: "Ben's monthly career letter (6)" }
        ]}
        value={tab}
        onChange={setTab}
      />
      <TabPanel page="career" id="jobs" value={tab}>
        <JobsTab v={v} run={run} />
      </TabPanel>
      <TabPanel page="career" id="portfolio" value={tab}>
        <PortfolioTab v={v} run={run} />
      </TabPanel>
      <TabPanel page="career" id="cards" value={tab}>
        <CardsTab v={v} run={run} active={tab === 'cards'} />
      </TabPanel>
      <TabPanel page="career" id="study" value={tab}>
        <StudyTab v={v} run={run} />
      </TabPanel>
      <TabPanel page="career" id="money" value={tab}>
        <MoneyTab v={v} run={run} />
      </TabPanel>
      <TabPanel page="career" id="review" value={tab}>
        <ReviewTab v={v} run={run} />
      </TabPanel>
    </div>
  )
}
