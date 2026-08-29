import { describe, it, expect } from 'vitest'
import { isAllowedUrl, isLoopback, normalizeUrl } from '../../src/shared/url'

describe('normalizeUrl', () => {
  it('adds http:// when no scheme', () => {
    expect(normalizeUrl('192.168.1.10:3080')).toBe('http://192.168.1.10:3080')
    expect(normalizeUrl('localhost:8080')).toBe('http://localhost:8080')
  })

  it('keeps explicit https', () => {
    expect(normalizeUrl('https://dsh.example.com')).toBe('https://dsh.example.com')
  })

  it('strips trailing slash on root path', () => {
    expect(normalizeUrl('http://127.0.0.1:3080/')).toBe('http://127.0.0.1:3080')
  })

  it('rejects non-http(s) schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeUrl('ftp://x')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
    expect(normalizeUrl('http://')).toBeNull()
  })

  it('trims surrounding quotes/brackets users paste from terminals', () => {
    expect(normalizeUrl('"http://127.0.0.1:3080"')).toBe('http://127.0.0.1:3080')
    expect(normalizeUrl("'http://127.0.0.1:3080'")).toBe('http://127.0.0.1:3080')
  })
})

describe('isAllowedUrl / isLoopback', () => {
  it('allows http/https only', () => {
    expect(isAllowedUrl('http://a')).toBe(true)
    expect(isAllowedUrl('https://a')).toBe(true)
    expect(isAllowedUrl('file://a')).toBe(false)
  })

  it('detects loopback hosts', () => {
    expect(isLoopback('http://127.0.0.1:3080')).toBe(true)
    expect(isLoopback('http://localhost:3080')).toBe(true)
    expect(isLoopback('http://[::1]:3080')).toBe(true)
    expect(isLoopback('http://192.168.1.10:3080')).toBe(false)
  })
})
