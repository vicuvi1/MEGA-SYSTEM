// "Go back one version": which release to go back to, and which version to
// skip afterwards (so the updater doesn't bring the broken one right back).
export interface ReleaseInfo { tag_name: string; draft?: boolean; prerelease?: boolean; assets: { name: string; url: string; browser_download_url?: string }[] }

const parts = (v: string) => v.replace(/^v/, '').split(/[.+-]/).slice(0, 3).map((n) => Number(n) || 0)
/** -1 / 0 / 1 like a sort compare, on major.minor.patch. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/** The newest published release older than `current`, with its Windows installer. */
export function previousRelease(list: ReleaseInfo[], current: string): { version: string; asset: { name: string; url: string } } | null {
  const older = list
    .filter((r) => !r.draft && !r.prerelease && compareVersions(r.tag_name, current) < 0)
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))
  for (const r of older) {
    const exe = r.assets.find((a) => /\.exe$/i.test(a.name) && !/blockmap/i.test(a.name) && !/uninstall/i.test(a.name))
    if (exe) return { version: r.tag_name.replace(/^v/, ''), asset: { name: exe.name, url: exe.url } }
  }
  return null
}

/** Whether an offered update is the version you went back from (skip it until a newer one). */
export const isSkipped = (offered: string | null, skipped: string | null) => !!offered && !!skipped && compareVersions(offered, skipped) <= 0
