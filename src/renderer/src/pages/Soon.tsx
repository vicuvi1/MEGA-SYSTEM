import { Icon } from '../Icon'
import type { ModuleDef } from '../modules'

export function Soon({ module }: { module: ModuleDef }) {
  return (
    <section className="panel soon-panel" style={{ ['--c' as string]: module.color }}>
      <div className="soon-icon">
        <Icon name={module.icon} size={34} />
      </div>
      <h2>{module.label} unlocks in phase {module.phase}</h2>
      <p>{module.blurb}.</p>
      <p className="hint">Its point rules already work from Today's Quick log, so you can start earning now.</p>
    </section>
  )
}
