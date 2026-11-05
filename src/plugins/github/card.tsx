// Today: commits this week and the next CTF.
import { Icon } from '../../renderer/src/Icon'
import { usePluginData } from '../usePluginData'
import { daysBetween, type GithubData } from './github'

export function GithubCard() {
  const d = usePluginData<GithubData>('plugin_github_data')
  if (!d) return null
  const since = d.lastCommit ? daysBetween(d.lastCommit, new Date().toLocaleDateString('sv-SE')) : null
  const ctf = d.ctfs[0]
  return (
    <section className="pl-card" aria-label="GitHub">
      <div className="pl-card-head">
        <Icon name="bolt" size={14} />
        <b>GitHub</b>
        <span className="pl-spacer" />
        <span>{d.week} commits this week</span>
      </div>
      <div className="pl-line">{since == null ? 'No commits seen lately.' : since === 0 ? 'You committed today.' : `${since} day${since === 1 ? '' : 's'} without a commit.`}</div>
      {ctf && (
        <div className="pl-muted">
          Next CTF:{' '}
          <a href={ctf.url} target="_blank" rel="noreferrer">
            {ctf.title}
          </a>{' '}
          · {new Date(ctf.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          {ctf.format ? ` · ${ctf.format}` : ''}
        </div>
      )}
    </section>
  )
}
