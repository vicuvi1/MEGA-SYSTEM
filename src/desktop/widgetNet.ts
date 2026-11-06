// PL2: the widgets' network, made by the desktop for the app window (only
// that window may ask). Checked again here: https only, a public host on the
// list the app sent (the hosts you allowed that widget), no login in the
// address, no redirects, no cookies, GET only, 8 s, text only, 64 KB at most.
import { net } from 'electron'
import { checkUrl, fetchAnswer, FETCH_MAX } from '../core/widgets/bridge'

export async function widgetFetch(url: unknown, hosts: unknown): Promise<{ status: number; type: string; body: string }> {
  const list = Array.isArray(hosts) ? hosts.filter((h): h is string => typeof h === 'string').slice(0, 5) : []
  const u = checkUrl(url, list)
  if (!u.ok) throw new Error(u.error)
  const res = await net.fetch(u.url, { method: 'GET', redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json, text/plain;q=0.9, */*;q=0.1' }, signal: AbortSignal.timeout(8000), bypassCustomProtocolHandlers: true } as RequestInit)
  const reader = res.body?.getReader()
  let body = ''
  if (reader) {
    const dec = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      body += dec.decode(value, { stream: true })
      if (body.length > FETCH_MAX) {
        void reader.cancel()
        break
      }
    }
  }
  return fetchAnswer(res.status, res.headers.get('content-type') ?? '', body)
}
