// Settings → Ben: pick Ben's look and set your own photo for the chat.
import { useRef, useState } from 'react'
import { Icon } from './Icon'
import { useAction } from './ui'
import { BEN_LOOKS } from '@core/coachLooks'
import { BenAvatar, MeAvatar, avatarFromFile, useCoachLooks } from './BenAvatar'

export function CoachLooksPanel() {
  const act = useAction()
  const [looks, save] = useCoachLooks(true)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const pick = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    await act(async () => {
      const url = await avatarFromFile(f)
      if (!(await save({ me: url }))) throw new Error('Could not save your photo')
    }, 'Your photo is in the chat')
    setBusy(false)
  }
  return (
    <section className="panel lk-panel">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Faces in the chat
        </h2>
      </header>
      <p className="hint block">Pick how Ben looks, and add your own photo. Both show on every device.</p>
      <div className="lk-grid" role="radiogroup" aria-label="Ben's look">
        {BEN_LOOKS.map((l) => (
          <button key={l.id} type="button" role="radio" aria-checked={looks.ben === l.id} className={`lk-opt ${looks.ben === l.id ? 'on' : ''}`} onClick={() => void act(() => save({ ben: l.id }))}>
            <BenAvatar look={l.id} size={64} ring={looks.ben === l.id} />
            <b>{l.label}</b>
            <small>{l.hint}</small>
          </button>
        ))}
      </div>
      <div className="lk-me">
        <MeAvatar size={64} onPick={() => file.current?.click()} />
        <div>
          <b>Your photo</b>
          <small>Cropped to a square and made small on this device before it is saved.</small>
          <div className="row">
            <button className="btn" type="button" disabled={busy} onClick={() => file.current?.click()}>
              {busy ? 'Saving…' : looks.me ? 'Change photo' : 'Upload a photo'}
            </button>
            {looks.me && (
              <button className="btn ghost" type="button" disabled={busy} onClick={() => void act(() => save({ me: null }), 'Photo removed')}>
                Remove
              </button>
            )}
          </div>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0]).then(() => (e.target.value = ''))} />
      </div>
    </section>
  )
}
