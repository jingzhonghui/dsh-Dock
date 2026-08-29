import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../../src/main/detector', () => ({
  probeEndpoint: vi.fn(),
  sleep: vi.fn()
}))

import { probeEndpoint } from '../../src/main/detector'
import { choosePort, pickFreePort } from '../../src/main/localDsh'

const mockProbe = vi.mocked(probeEndpoint)

beforeEach(() => {
  mockProbe.mockReset()
})

describe('pickFreePort', () => {
  it('returns a usable loopback port', async () => {
    const port = await pickFreePort()
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65536)
  })
})

describe('choosePort', () => {
  it('keeps the preferred port when it serves DSH', async () => {
    mockProbe.mockResolvedValue({ ok: true, isDsh: true, status: 200 })
    expect(await choosePort(3080)).toBe(3080)
  })

  it('moves to a free port when 3080 is occupied by a stranger', async () => {
    mockProbe.mockResolvedValue({ ok: true, isDsh: false, status: 200 })
    const port = await choosePort(3080)
    expect(port).not.toBe(3080)
  })

  it('keeps the preferred port when nothing answers', async () => {
    mockProbe.mockResolvedValue({ ok: false, isDsh: false })
    expect(await choosePort(3080)).toBe(3080)
  })
})
