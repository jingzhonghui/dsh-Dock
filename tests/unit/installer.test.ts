import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn()
}))

vi.mock('../../src/main/localDsh', () => ({
  findNodeExecutable: vi.fn().mockResolvedValue(null)
}))

import { spawn } from 'node:child_process'
import { installDshGlobal } from '../../src/main/installer'

const mockSpawn = vi.mocked(spawn)

interface FakeChild extends ChildProcess {
  kill: ReturnType<typeof vi.fn>
}

function makeFakeChild(): FakeChild {
  const emitter = new EventEmitter()
  const child = emitter as unknown as FakeChild
  ;(child as unknown as { exitCode: number | null }).exitCode = null
  ;(child as unknown as { kill: (signal?: NodeJS.Signals | number) => boolean }).kill = vi.fn(
    (_signal?: NodeJS.Signals | number) => {
      ;(child as unknown as { exitCode: number | null }).exitCode = 1
      emitter.emit('close', 1)
      return true
    }
  )
  ;(child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter()
  ;(child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter()
  return child
}

/** Let the async spawn inside installDshGlobal get past resolveNpmInvocation. */
const nextTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  mockSpawn.mockReset()
})

describe('installDshGlobal', () => {
  it('runs npm install -g and resolves ok on exit 0', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const p = installDshGlobal()
    await nextTick()
    ;(child as unknown as { exitCode: number | null }).exitCode = 0
    child.emit('close', 0)
    const res = await p

    expect(res.ok).toBe(true)
    expect(mockSpawn).toHaveBeenCalledTimes(1)
    const [command, args] = mockSpawn.mock.calls[0]
    expect(command).toBe('npm.cmd')
    expect(args).toContain('install')
    expect(args).toContain('-g')
  })

  it('kills the npm child when the signal aborts', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const ac = new AbortController()
    const p = installDshGlobal({ signal: ac.signal })
    await nextTick()
    ac.abort()
    const res = await p

    expect(child.kill).toHaveBeenCalled()
    expect(res.ok).toBe(false)
  })

  it('kills immediately if the signal is already aborted', async () => {
    const child = makeFakeChild()
    mockSpawn.mockReturnValue(child)

    const ac = new AbortController()
    ac.abort()
    const p = installDshGlobal({ signal: ac.signal })
    await nextTick()
    const res = await p

    expect(child.kill).toHaveBeenCalled()
    expect(res.ok).toBe(false)
  })
})
