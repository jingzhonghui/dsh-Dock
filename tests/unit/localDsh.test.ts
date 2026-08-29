import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn()
}))

vi.mock('../../src/main/detector', () => ({
  probeEndpoint: vi.fn(),
  sleep: vi.fn()
}))

import { execFile, spawn } from 'node:child_process'
import { probeEndpoint } from '../../src/main/detector'
import { DshProcessManager } from '../../src/main/localDsh'

const mockSpawn = vi.mocked(spawn)
const mockExecFile = vi.mocked(execFile)
const mockProbe = vi.mocked(probeEndpoint)

const PORT = 31234

/** ChildProcess with a mocked kill that reports an immediate exit. */
interface FakeChild extends ChildProcess {
  kill: ReturnType<typeof vi.fn>
}

function makeFakeChild(): FakeChild {
  const emitter = new EventEmitter()
  const child = emitter as unknown as FakeChild
  ;(child as unknown as { exitCode: number | null }).exitCode = null
  ;(child as unknown as { kill: (signal?: NodeJS.Signals | number) => boolean }).kill = vi.fn(
    (_signal?: NodeJS.Signals | number) => {
      ;(child as unknown as { exitCode: number | null }).exitCode = 0
      emitter.emit('exit', 0, null)
      return true
    }
  )
  return child
}

let fakeChild: FakeChild

beforeEach(() => {
  mockProbe.mockReset()
  mockSpawn.mockReset()
  mockExecFile.mockReset()
  // All dsh-command resolution fails → resolveDshInvocation falls back to the `dsh` shim.
  mockExecFile.mockImplementation(((_file: string, ...rest: unknown[]) => {
    const cb = rest[rest.length - 1] as ((err?: Error) => void) | undefined
    cb?.(new Error('mocked execFile'))
  }) as never)
  fakeChild = makeFakeChild()
  mockSpawn.mockReturnValue(fakeChild)
})

/** Probe pattern: port free first (forces the spawn path), DSH up afterwards. */
function mockProbeSpawnThenReady(): void {
  let calls = 0
  mockProbe.mockImplementation(async () => {
    calls += 1
    if (calls === 1) return { ok: false, isDsh: false }
    return { ok: true, isDsh: true, status: 200 }
  })
}

describe('DshProcessManager.start', () => {
  it('spawns dsh with --profile web --no-open --port so no browser opens', async () => {
    mockProbeSpawnThenReady()

    const manager = new DshProcessManager()
    const res = await manager.start({ port: PORT })

    expect(res).toEqual({ url: `http://127.0.0.1:${PORT}`, port: PORT, alreadyRunning: false })
    expect(mockSpawn).toHaveBeenCalledTimes(1)

    const [command, args] = mockSpawn.mock.calls[0]
    expect(command).toBe('dsh') // fallback invocation in the mocked environment
    const profileIdx = args.indexOf('--profile')
    expect(profileIdx).toBeGreaterThanOrEqual(0)
    expect(args.slice(profileIdx)).toEqual(['--profile', 'web', '--no-open', '--port', String(PORT)])
  })

  it('reuses an already-running DSH on the port without spawning', async () => {
    mockProbe.mockResolvedValue({ ok: true, isDsh: true, status: 200 })

    const manager = new DshProcessManager()
    const res = await manager.start({ port: PORT })

    expect(res.alreadyRunning).toBe(true)
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('stop() terminates the spawned child with SIGTERM', async () => {
    mockProbeSpawnThenReady()

    const manager = new DshProcessManager()
    await manager.start({ port: PORT })

    expect(fakeChild.kill).not.toHaveBeenCalled()
    await manager.stop()
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
