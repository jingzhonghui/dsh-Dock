import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { normalizeUrl } from '../shared/url'
import type { Endpoint, EndpointStoreData } from '../shared/ipc'

const DEFAULT_STORE: EndpointStoreData = {
  version: 1,
  defaultLocalUrl: 'http://127.0.0.1:3080',
  endpoints: []
}

/**
 * Persists the connection-manager data (saved endpoints + default local URL)
 * as JSON under the app's userData directory. Mutations are serialized through
 * an internal promise chain so concurrent read-modify-write calls cannot
 * clobber each other.
 */
export class EndpointStore {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  /** Run a mutating operation one at a time, keeping the chain alive on errors. */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn)
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async load(): Promise<EndpointStoreData> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const data = JSON.parse(raw) as Partial<EndpointStoreData>
      return {
        version: 1,
        defaultLocalUrl:
          typeof data.defaultLocalUrl === 'string' && data.defaultLocalUrl
            ? data.defaultLocalUrl
            : DEFAULT_STORE.defaultLocalUrl,
        endpoints: Array.isArray(data.endpoints)
          ? data.endpoints.filter(isValidEndpoint)
          : []
      }
    } catch {
      return { ...DEFAULT_STORE, endpoints: [] }
    }
  }

  async save(data: EndpointStoreData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await writeFile(this.file, JSON.stringify(data, null, 2), 'utf8')
    // Best-effort cleanup of the temp file.
    await import('node:fs/promises').then((m) => m.rm(tmp, { force: true }).catch(() => {}))
  }

  /** Add or update an endpoint by URL; returns the fresh store. */
  upsertEndpoint(label: string, rawUrl: string): Promise<EndpointStoreData> {
    return this.serialized(async () => {
      const url = normalizeUrl(rawUrl)
      if (!url) throw new Error('URL 无效')
      const store = await this.load()
      const existing = store.endpoints.find((e) => e.url === url)
      if (existing) {
        existing.label = label.trim() || existing.label
        existing.lastConnectedAt = new Date().toISOString()
      } else {
        store.endpoints.unshift({
          id: randomUUID(),
          label: label.trim() || url,
          url,
          lastConnectedAt: new Date().toISOString()
        })
      }
      await this.save(store)
      return store
    })
  }

  removeEndpoint(id: string): Promise<EndpointStoreData> {
    return this.serialized(async () => {
      const store = await this.load()
      store.endpoints = store.endpoints.filter((e) => e.id !== id)
      await this.save(store)
      return store
    })
  }

  touchEndpoint(url: string): Promise<EndpointStoreData> {
    return this.serialized(async () => {
      const store = await this.load()
      const ep = store.endpoints.find((e) => e.url === url)
      if (ep) {
        ep.lastConnectedAt = new Date().toISOString()
        await this.save(store)
      }
      return store
    })
  }

  setDefaultLocalUrl(url: string): Promise<EndpointStoreData> {
    return this.serialized(async () => {
      const normalized = normalizeUrl(url)
      if (!normalized) throw new Error('URL 无效')
      const store = await this.load()
      store.defaultLocalUrl = normalized
      await this.save(store)
      return store
    })
  }
}

function isValidEndpoint(e: unknown): e is Endpoint {
  if (typeof e !== 'object' || e === null) return false
  const o = e as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    typeof o.url === 'string' &&
    normalizeUrl(o.url) !== null
  )
}
