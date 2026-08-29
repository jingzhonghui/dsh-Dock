import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EndpointStore } from '../../src/main/endpoints'

let dir: string
let store: EndpointStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-dock-test-'))
  store = new EndpointStore(join(dir, 'endpoints.json'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('EndpointStore', () => {
  it('starts empty with the default local URL', async () => {
    const data = await store.load()
    expect(data.defaultLocalUrl).toBe('http://127.0.0.1:3080')
    expect(data.endpoints).toEqual([])
  })

  it('persists across instances', async () => {
    await store.upsertEndpoint('我的服务器', 'http://10.0.0.5:3080')
    const reloaded = new EndpointStore(join(dir, 'endpoints.json'))
    const data = await reloaded.load()
    expect(data.endpoints).toHaveLength(1)
    expect(data.endpoints[0].label).toBe('我的服务器')
    expect(data.endpoints[0].url).toBe('http://10.0.0.5:3080')
    expect(data.endpoints[0].lastConnectedAt).toBeTruthy()
  })

  it('dedupes by normalized URL and bumps lastConnectedAt', async () => {
    await store.upsertEndpoint('a', 'http://10.0.0.5:3080/')
    await store.upsertEndpoint('b', '10.0.0.5:3080')
    const data = await store.load()
    expect(data.endpoints).toHaveLength(1)
    expect(data.endpoints[0].label).toBe('b')
  })

  it('rejects invalid URLs', async () => {
    await expect(store.upsertEndpoint('x', 'not a url at all')).rejects.toThrow()
  })

  it('removes an endpoint by id', async () => {
    await store.upsertEndpoint('a', 'http://a.example:3080')
    await store.upsertEndpoint('b', 'http://b.example:3080')
    const data = await store.load()
    // upsert unshifts, so the newest (b) is first
    expect(data.endpoints[0].url).toBe('http://b.example:3080')
    await store.removeEndpoint(data.endpoints[0].id)
    const after = await store.load()
    expect(after.endpoints).toHaveLength(1)
    expect(after.endpoints[0].url).toBe('http://a.example:3080')
  })

  it('touch updates only the matching endpoint', async () => {
    await store.upsertEndpoint('a', 'http://a.example:3080')
    await store.upsertEndpoint('b', 'http://b.example:3080')
    const before = await store.load()
    const b0 = before.endpoints.find((e) => e.url === 'http://b.example:3080')!
    await new Promise((r) => setTimeout(r, 5))
    await store.touchEndpoint('http://a.example:3080')
    const after = await store.load()
    const a = after.endpoints.find((e) => e.url === 'http://a.example:3080')!
    const b = after.endpoints.find((e) => e.url === 'http://b.example:3080')!
    expect(a.lastConnectedAt).toBeTruthy()
    expect(b.lastConnectedAt).toBe(b0.lastConnectedAt)
  })

  it('tolerates a corrupted file', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'endpoints.json'), '{not json', 'utf8')
    const data = await store.load()
    expect(data.endpoints).toEqual([])
  })

  it('is safe against concurrent save calls', async () => {
    await Promise.all([
      store.upsertEndpoint('a', 'http://a.example:3080'),
      store.upsertEndpoint('b', 'http://b.example:3080'),
      store.upsertEndpoint('c', 'http://c.example:3080')
    ])
    const data = await store.load()
    expect(data.endpoints).toHaveLength(3)
  })
})
