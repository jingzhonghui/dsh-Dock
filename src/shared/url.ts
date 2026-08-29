/**
 * URL helpers shared by main (detector / localDsh) and renderer (form input).
 * Pure functions, no dependencies.
 */

// A real scheme must be followed by `//` (authority); `localhost:8080` or
// `192.168.1.10:3080` are host:port and must get http:// prepended.
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/** Trim, default to http:// when no scheme, strip trailing slash, validate. */
export function normalizeUrl(raw: string): string | null {
  let s = (raw ?? '').trim()
  if (!s) return null
  // Strip common accidental whitespace / brackets users paste from terminals.
  s = s.replace(/^[\[\]'"]+|[\[\]'"]+$/g, '')
  if (!SCHEME_RE.test(s)) s = `http://${s}`
  let parsed: URL
  try {
    parsed = new URL(s)
  } catch {
    return null
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null
  // Drop the trailing slash for canonical form (http://127.0.0.1:3080/)
  let out = parsed.toString()
  if (out.endsWith('/') && parsed.pathname === '/') out = out.slice(0, -1)
  return out
}

export function isAllowedUrl(u: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(u).protocol)
  } catch {
    return false
  }
}

export function isLoopback(u: string): boolean {
  try {
    const hostname = new URL(u).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
  } catch {
    return false
  }
}

export function hostAndPort(u: string): string {
  try {
    const p = new URL(u)
    return p.host
  } catch {
    return u
  }
}
