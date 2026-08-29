import { afterEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { probeEndpoint, isDshResponse } from '../../src/main/detector'
import { closeAll, createFakeDshServer, createPlainServer } from '../integration/fake-dsh-server'
import { pickFreePort } from '../../src/main/localDsh'

const servers: Server[] = []
afterEach(async () => {
  await closeAll(servers)
  servers.length = 0
})

describe('isDshResponse', () => {
  it('recognises the DSH markers', () => {
    expect(isDshResponse('text/html', '<script>window.__DSH_BOOT__={}</script>')).toBe(true)
    expect(isDshResponse('text/html; charset=utf-8', '<title>DeepSeek Harness</title>')).toBe(true)
    expect(isDshResponse('text/html', 'window.__ModuleLoader__')).toBe(true)
  })

  it('rejects plain pages and non-html bodies', () => {
    expect(isDshResponse('text/html', '<html><body>hello</body></html>')).toBe(false)
    expect(isDshResponse('application/json', '{"__DSH_BOOT__":1}')).toBe(false)
    expect(isDshResponse('text/html', '')).toBe(false)
  })
})

describe('probeEndpoint (integration)', () => {
  it('detects a real DSH-like server on a random port', async () => {
    const fake = await createFakeDshServer()
    servers.push(fake.server)
    const r = await probeEndpoint(fake.url)
    expect(r.ok).toBe(true)
    expect(r.isDsh).toBe(true)
    expect(r.status).toBe(200)
  })

  it('does not mistake a plain HTML server for DSH', async () => {
    const plain = await createPlainServer()
    servers.push(plain.server)
    const r = await probeEndpoint(plain.url)
    expect(r.ok).toBe(true)
    expect(r.isDsh).toBe(false)
  })

  it('returns ok=false for an unreachable port', async () => {
    const port = await pickFreePort() // closed right after; race is negligible
    const r = await probeEndpoint(`http://127.0.0.1:${port}`, 1000)
    expect(r.ok).toBe(false)
    expect(r.isDsh).toBe(false)
  })

  it('returns ok=false for invalid input', async () => {
    const r = await probeEndpoint('javascript:alert(1)')
    expect(r.ok).toBe(false)
    expect(r.isDsh).toBe(false)
  })
})
