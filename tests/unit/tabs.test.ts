import { describe, expect, it } from 'vitest'
import { TabStore } from '../../src/main/tabs'

describe('TabStore', () => {
  it('createTab boot becomes the boot tab and is active in probing phase', () => {
    const store = new TabStore()
    const boot = store.createTab('boot')
    const s = store.snapshot()
    expect(boot.phase).toBe('probing')
    expect(s.bootTabId).toBe(boot.id)
    expect(s.activeTabId).toBe(boot.id)
    expect(s.tabs).toHaveLength(1)
    expect(s.busy).toBe('none')
    expect(s.logs).toEqual([])
  })

  it('createTab manual is a fresh new tab and becomes active', () => {
    const store = new TabStore()
    const boot = store.createTab('boot')
    const manual = store.createTab('manual')
    const s = store.snapshot()
    expect(manual.phase).toBe('new')
    expect(manual.kind).toBe('manual')
    expect(s.activeTabId).toBe(manual.id)
    expect(s.bootTabId).toBe(boot.id)
    expect(s.tabs).toHaveLength(2)
  })

  it('closeTab refuses to close the boot tab', () => {
    const store = new TabStore()
    const boot = store.createTab('boot')
    const res = store.closeTab(boot.id)
    expect(res.tab).toBeUndefined()
    expect(store.snapshot().tabs).toHaveLength(1)
  })

  it('closeTab removes a manual tab and falls back to the neighbour when it was active', () => {
    const store = new TabStore()
    store.createTab('boot')
    const a = store.createTab('manual')
    const b = store.createTab('manual')
    expect(store.snapshot().activeTabId).toBe(b.id)

    const res = store.closeTab(b.id)
    expect(res.tab?.id).toBe(b.id)
    expect(res.activeChanged).toBe(true)
    // a was just before b in the array, so it takes over
    expect(store.snapshot().activeTabId).toBe(a.id)
    expect(store.getTab(b.id)).toBeUndefined()
  })

  it('closeTab of a non-active tab keeps the active one', () => {
    const store = new TabStore()
    store.createTab('boot')
    const a = store.createTab('manual')
    const b = store.createTab('manual')
    store.setActive(a.id)
    store.closeTab(b.id)
    expect(store.snapshot().activeTabId).toBe(a.id)
  })

  it('setActive ignores unknown ids', () => {
    const store = new TabStore()
    store.createTab('boot')
    expect(store.setActive('nope')).toBe(false)
    expect(store.snapshot().activeTabId).not.toBe('nope')
  })

  it('patchTab merges partial updates and notifies listeners', () => {
    const store = new TabStore()
    const boot = store.createTab('boot')
    const seen: string[] = []
    store.onChange((s) => seen.push(s.tabs[0]!.phase))

    const patched = store.patchTab(boot.id, { phase: 'connected', url: 'http://127.0.0.1:3080', source: 'local-spawned' })
    expect(patched?.phase).toBe('connected')
    expect(patched?.url).toBe('http://127.0.0.1:3080')
    expect(patched?.source).toBe('local-spawned')
    expect(seen).toEqual(['connected'])
  })

  it('findTabByUrl dedupes against connected/connecting tabs and ignores the caller', () => {
    const store = new TabStore()
    store.createTab('boot')
    const a = store.createTab('manual')
    const b = store.createTab('manual')
    store.patchTab(a.id, { phase: 'connected', url: 'http://10.0.0.1:3080' })
    store.patchTab(b.id, { phase: 'new' })

    expect(store.findTabByUrl('http://10.0.0.1:3080', b.id)?.id).toBe(a.id)
    expect(store.findTabByUrl('http://10.0.0.1:3080', a.id)).toBeUndefined()
    expect(store.findTabByUrl('http://10.0.0.2:3080', b.id)).toBeUndefined()
  })

  it('caps the log ring buffer', () => {
    const store = new TabStore()
    for (let i = 0; i < 400; i++) {
      store.log({ source: 'shell', level: 'info', text: `line ${i}` })
    }
    expect(store.snapshot().logs).toHaveLength(300)
    expect(store.snapshot().logs[0]!.text).toBe('line 100')
  })

  it('streams logs to subscribers with timestamps', () => {
    const store = new TabStore()
    const entries: string[] = []
    store.onLog((e) => entries.push(e.text))
    store.log({ source: 'npm', level: 'error', text: 'boom' })
    expect(entries).toEqual(['boom'])
    expect(store.snapshot().logs[0]!.source).toBe('npm')
    expect(store.snapshot().logs[0]!.level).toBe('error')
    expect(typeof store.snapshot().logs[0]!.ts).toBe('number')
  })

  it('unsubscribes cleanly', () => {
    const store = new TabStore()
    let count = 0
    const off = store.onChange(() => count++)
    store.setGlobal({ busy: 'starting' })
    off()
    store.setGlobal({ busy: 'none' })
    expect(count).toBe(1)
  })

  it('setGlobal updates global fields without touching tabs', () => {
    const store = new TabStore()
    store.createTab('boot')
    store.setGlobal({ busy: 'installing', installed: false, landingReason: 'not-installed', message: 'hi' })
    const s = store.snapshot()
    expect(s.busy).toBe('installing')
    expect(s.installed).toBe(false)
    expect(s.landingReason).toBe('not-installed')
    expect(s.message).toBe('hi')
  })
})
