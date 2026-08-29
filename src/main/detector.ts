import { normalizeUrl, isAllowedUrl } from '../shared/url'
import type { ProbeResult } from '../shared/ipc'

/**
 * Markers that identify the DeepSeek Harness web UI on a served root page.
 * The web bundle injects these before any module script runs; a plain 200 on
 * the root is NOT enough (any service could own the port).
 */
const DSH_MARKERS = ['__DSH_BOOT__', '__ModuleLoader__', 'DeepSeek Harness']

/** Max bytes of the root page we read before judging — enough for the HTML shell. */
const MAX_PROBE_BYTES = 256 * 1024

export function isDshResponse(contentType: string | null, body: string): boolean {
  if (!body) return false
  if (contentType && !contentType.includes('text/html')) return false
  return DSH_MARKERS.some((m) => body.includes(m))
}

/** Read the response body with a hard cap (the root page is ~15 KB). */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return await res.text()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
      if (total >= MAX_PROBE_BYTES) break
    }
  }
  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder().decode(buf)
}

/**
 * Probe an endpoint and decide whether a DeepSeek Harness web UI is served.
 * Returns ok=false for unreachable / invalid URLs; ok=true + isDsh=false for
 * a reachable service that is not the DSH UI.
 */
export async function probeEndpoint(rawUrl: string, timeoutMs = 3000): Promise<ProbeResult> {
  const url = normalizeUrl(rawUrl)
  if (!url || !isAllowedUrl(url)) return { ok: false, isDsh: false }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml,*/*' }
    })
    const body = await readCapped(res)
    return { ok: res.ok, isDsh: isDshResponse(res.headers.get('content-type'), body), status: res.status }
  } catch {
    return { ok: false, isDsh: false }
  } finally {
    clearTimeout(timer)
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
