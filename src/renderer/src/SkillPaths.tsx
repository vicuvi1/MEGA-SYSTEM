// Calisthenics skill paths on the Body page: where you are on each ladder
// and the test that unlocks the next move (log it as "push-ups 3x12").
import type { BodyState } from '@shared/api'

export function SkillPaths({ state }: { state: BodyState }) {
  const paths = state.skills ?? []
  if (!paths.length) return null
  return (
    <section className="card sk-card">
      <header className="card-head">
        <h2>Skill paths</h2>
        <span className="hint small">pass the test to unlock the next move</span>
      </header>
      <div className="sk-grid">
        {paths.map((p) => (
          <div key={p.id} className="sk-path">
            <div className="sk-top">
              <b>{p.title}</b>
              <small>
                {Math.min(p.level, p.total)}/{p.total}
              </small>
            </div>
            <div className="sk-steps" aria-hidden="true">
              {Array.from({ length: p.total }, (_, i) => (
                <i key={i} className={i < p.level ? 'on' : i === p.level ? 'now' : ''} />
              ))}
            </div>
            {p.done ? (
              <p>🏆 Path complete: {p.current.name}</p>
            ) : (
              <p>
                Now: <b>{p.current.name}</b>
                <small>
                  Test: {p.current.sets}×{p.current.reps}
                  {p.next ? ` → unlocks ${p.next.name}` : ' → path complete'}
                </small>
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
