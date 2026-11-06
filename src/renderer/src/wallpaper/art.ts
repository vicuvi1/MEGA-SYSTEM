// The wallpaper pictures as URLs the page can show (Vite copies each SVG into
// the build, so they are cached for offline use like the rest of the app).
const files = import.meta.glob('./art/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const byId: Record<string, string> = {}
for (const [path, url] of Object.entries(files)) {
  const id = path.split('/').pop()!.replace(/\.svg$/, '')
  byId[id] = url
}

/** The picture for a wallpaper id, or null (none, your own picture, or unknown). */
export function artUrl(id: string): string | null {
  return byId[id] ?? null
}
