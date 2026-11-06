// The widgets this app version knows: compiled in from the repo's widgets/
// folder (no code is downloaded at run time). Manifests and the gallery are
// small and loaded at once; each widget's code only when it is shown.
import { cleanGallery, matchesPin, type GalleryEntry } from '@core/widgets/gallery'
import { validateManifest, WIDGET_CODE_MAX, type WidgetManifest } from '@core/widgets/manifest'
import galleryJson from '../../../../widgets/gallery.json'

const manifestFiles = import.meta.glob('../../../../widgets/*/manifest.json', { eager: true, import: 'default' }) as Record<string, unknown>
const codeFiles = import.meta.glob('../../../../widgets/*/widget.js', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>
const shotFiles = import.meta.glob('../../../../widgets/*/screenshot.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const idOf = (path: string) => /widgets\/([^/]+)\//.exec(path)?.[1] ?? ''

/** Every valid manifest, by id (a widget with a bad manifest is left out). */
export const MANIFESTS: Record<string, WidgetManifest> = {}
for (const [path, raw] of Object.entries(manifestFiles)) {
  const r = validateManifest(raw)
  if (r.ok && r.manifest.id === idOf(path)) MANIFESTS[r.manifest.id] = r.manifest
}

/** The gallery (only widgets whose manifest is valid). */
export const GALLERY: GalleryEntry[] = cleanGallery(galleryJson).filter((e) => MANIFESTS[e.id])

/** A widget's screenshot, when the repo has one. */
export const screenshotOf = (id: string): string | null => Object.entries(shotFiles).find(([p]) => idOf(p) === id)?.[1] ?? null

/** Line endings never change the hash (a Windows checkout). */
const lf = (s: string) => s.replace(/\r\n/g, '\n')

/** The widget's code, only when it matches the hash you installed (null + why otherwise). */
export async function loadCode(id: string, pinned: string): Promise<{ code: string } | { error: string }> {
  const entry = Object.entries(codeFiles).find(([p]) => idOf(p) === id)
  if (!entry) return { error: 'This app version doesn’t have this widget. Update the app or remove it.' }
  const code = lf(await entry[1]())
  if (code.length > WIDGET_CODE_MAX) return { error: 'This widget is too big to run.' }
  if (!(await matchesPin(code, pinned))) return { error: 'This widget changed since you installed it. Reinstall it from the gallery to run the new version.' }
  return { code }
}
