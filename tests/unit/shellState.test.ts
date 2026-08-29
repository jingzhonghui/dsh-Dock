import { describe, expect, it } from 'vitest'
import { ShellStateMachine } from '../../src/main/shellState'

describe('ShellStateMachine', () => {
  it('starts in probing phase', () => {
    const sm = new ShellStateMachine()
    const s = sm.snapshot()
    expect(s.phase).toBe('probing')
    expect(s.busy).toBe('none')
    expect(s.logs).toEqual([])
  })

  it('notifies listeners on transition and merges patches', () => {
    const sm = new ShellStateMachine()
    const seen: string[] = []
    sm.onChange((s) => seen.push(s.phase))
    sm.transition({ phase: 'connected', connection: { source: 'local-spawned', url: 'http://127.0.0.1:3080' } })
    sm.transition({ busy: 'starting' })
    const s = sm.snapshot()
    expect(s.phase).toBe('connected')
    expect(s.busy).toBe('starting')
    expect(s.connection?.url).toBe('http://127.0.0.1:3080')
    // Listeners only fire on transitions, not on construction.
    expect(seen).toEqual(['connected', 'connected'])
  })

  it('caps the log ring buffer', () => {
    const sm = new ShellStateMachine()
    for (let i = 0; i < 400; i++) {
      sm.log({ source: 'shell', level: 'info', text: `line ${i}` })
    }
    expect(sm.snapshot().logs).toHaveLength(300)
    expect(sm.snapshot().logs[0].text).toBe('line 100')
  })

  it('streams logs to subscribers with timestamps', () => {
    const sm = new ShellStateMachine()
    const entries: string[] = []
    sm.onLog((e) => entries.push(e.text))
    sm.log({ source: 'npm', level: 'error', text: 'boom' })
    expect(entries).toEqual(['boom'])
    expect(sm.snapshot().logs[0].source).toBe('npm')
    expect(sm.snapshot().logs[0].level).toBe('error')
    expect(typeof sm.snapshot().logs[0].ts).toBe('number')
  })

  it('unsubscribes cleanly', () => {
    const sm = new ShellStateMachine()
    let count = 0
    const off = sm.onChange(() => count++)
    sm.transition({ busy: 'starting' })
    off()
    sm.transition({ busy: 'none' })
    expect(count).toBe(1)
  })
})
