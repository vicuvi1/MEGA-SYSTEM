// The Season page (LF1, LF4–LF6, LF12, LF15, LF18): your current 12-week arc
// with its boss, the vision board, identity votes, the wins wall, side-quest
// adventures and the life wheel, one tab each. Ben's path opens from the
// season tab. One sidebar entry for all of it.
import { useEffect, useState } from 'react'
import { PageTabs, TabPanel, usePageTab } from '../PageTabs'
import { PageSkeleton } from '../blocks'
import { useSaga } from '../saga/useSaga'
import { SeasonTab } from '../saga/SeasonTab'
import { VisionTab } from '../saga/VisionTab'
import { IdentityTab } from '../saga/IdentityTab'
import { WinsTab } from '../saga/WinsTab'
import { AdventuresTab } from '../saga/AdventuresTab'
import { WheelTab } from '../saga/WheelTab'
import { ArcSheet, SeasonIntro, SeasonRecapSheet } from '../saga/Cinematics'
import '../saga/saga.css'

const TABS = ['season', 'vision', 'identity', 'wins', 'adventures', 'wheel']

export function Season() {
  const { v, error } = useSaga()
  const [tab, setTab] = usePageTab('season', TABS, 'season')
  const [intro, setIntro] = useState(false)
  const [recap, setRecap] = useState(false)
  const [arc, setArc] = useState(false)
  // "Open your wins" from the island, and the intro for a season that just began.
  useEffect(() => {
    const wins = () => setTab('wins')
    const intro = () => {
      setTab('season')
      setIntro(true)
    }
    window.addEventListener('life-open-wins', wins)
    window.addEventListener('life-season-intro', intro)
    return () => {
      window.removeEventListener('life-open-wins', wins)
      window.removeEventListener('life-season-intro', intro)
    }
  }, [setTab])
  useEffect(() => {
    if (!v?.arcNew) return
    setArc(true)
  }, [v?.arcNew?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return error ? <p className="sg-muted" style={{ padding: 24 }}>{error}</p> : <PageSkeleton />
  return (
    <div className="sg">
      <PageTabs
        page="season"
        label="Season views"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'season', label: 'Season', count: v.current ? `${Math.max(1, v.current.progress.week)}/8` : null },
          { id: 'vision', label: 'Vision', count: v.vision.cards.length || null },
          { id: 'identity', label: 'Identity', count: v.votes.reduce((t, x) => t + x.week, 0) || null, title: 'Votes this week' },
          { id: 'wins', label: 'Wins', count: v.wins.length || null },
          { id: 'adventures', label: 'Adventures', count: v.sideStatus === 'open' && v.sidePick ? '1 new' : v.sideStats.total || null },
          { id: 'wheel', label: 'Life wheel', count: v.wheelDue.due ? '!' : null, title: v.wheelDue.due ? 'This quarter is not rated yet' : undefined }
        ]}
      />
      <TabPanel page="season" id="season" value={tab}>
        <SeasonTab v={v} onIntro={() => setIntro(true)} onRecap={() => setRecap(true)} onArc={() => setArc(true)} onTab={setTab} />
      </TabPanel>
      <TabPanel page="season" id="vision" value={tab}>
        <VisionTab v={v} />
      </TabPanel>
      <TabPanel page="season" id="identity" value={tab}>
        <IdentityTab v={v} />
      </TabPanel>
      <TabPanel page="season" id="wins" value={tab}>
        <WinsTab v={v} />
      </TabPanel>
      <TabPanel page="season" id="adventures" value={tab}>
        <AdventuresTab v={v} />
      </TabPanel>
      <TabPanel page="season" id="wheel" value={tab}>
        <WheelTab v={v} onSeason={() => setTab('season')} />
      </TabPanel>
      {intro && <SeasonIntro v={v} onClose={() => setIntro(false)} />}
      {recap && <SeasonRecapSheet v={v} onClose={() => setRecap(false)} onNext={() => setTab('wheel')} />}
      {arc && <ArcSheet v={v} onClose={() => setArc(false)} />}
    </div>
  )
}
