import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, dirname } from 'node:path'
import { promisify } from 'node:util'

import { probeEndpoint } from './detector'

const execFileAsync = promisify(execFile)

export interface DshInvocation {
  command: string
  args: string[]
  /** Windows npm shims need a shell. */
  shell?: boolean
}

export interface StartLocalOptions {
  /** Preferred port; when omitted, 3080 unless occupied by a non-DSH service. */
  port?: number
  /** Timeout waiting for the web UI to answer the health check (ms). */
  readyTimeoutMs?: number
  /** Called with raw stdout/stderr chunks from the dsh child process. */
  onOutput?: (chunk: string) => void
  /** Called if the spawned process exits (after readiness too, for crash detection). */
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
}

export interface StartLocalResult {
  url: string
  port: number
  /** true when an already-running dsh was found on the port and nothing was spawned. */
  alreadyRunning: boolean
}

const DSH_PKG_DIR = join('@deepseek-ai', 'dsh')
const DSH_PKG_JSON_REL = join(DSH_PKG_DIR, 'package.json')

/** Locate a command on PATH (no shell). Returns the first resolvable match or null. */
export async function findOnPath(command: string): Promise<string | null> {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(cmd, [command], { timeout: 5000 })
    const line = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    return line && existsSync(line) ? line : null
  } catch {
    return null
  }
}

/** Locate the system `node` executable (no shell involved). */
export async function findNodeExecutable(): Promise<string | null> {
  const envCandidates = [process.env.npm_node_execpath, process.env.NODE].filter(
    (c): c is string => !!c
  )
  for (const c of envCandidates) {
    if (existsSync(c)) return c
  }
  return await findOnPath('node')
}

/**
 * npm global root, resolved deterministically via `node <npm-cli> root -g`
 * (no shell), falling back to invoking `npm` itself.
 */
export async function npmGlobalRoot(): Promise<string | null> {
  const nodePath = await findNodeExecutable()
  if (nodePath) {
    const cli = join(dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(cli)) {
      try {
        const { stdout } = await execFileAsync(nodePath, [cli, 'root', '-g'], { timeout: 15000 })
        const root = stdout.trim()
        if (root) return root
      } catch {
        /* fall through to `npm` */
      }
    }
  }
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      timeout: 15000,
      shell: process.platform === 'win32'
    })
    const root = stdout.trim()
    return root || null
  } catch {
    return null
  }
}

/**
 * pnpm global root (e.g. ~/AppData/Local/pnpm/global/<n>/node_modules).
 * pnpm installs packages in its own prefix, invisible to `npm root -g`.
 */
export async function pnpmGlobalRoot(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('pnpm', ['root', '-g'], {
      timeout: 15000,
      shell: process.platform === 'win32'
    })
    const root = stdout.trim()
    return root || null
  } catch {
    return null
  }
}

/** All global install roots to search, across the package managers we support. */
async function candidateGlobalRoots(): Promise<string[]> {
  const roots = new Set<string>()
  for (const r of [await npmGlobalRoot(), await pnpmGlobalRoot()]) {
    if (r) roots.add(r)
  }
  return [...roots]
}

/** The global install dir where @deepseek-ai/dsh is (or would be) installed. */
export async function dshInstallDir(): Promise<string | null> {
  for (const root of await candidateGlobalRoots()) {
    const pkgJson = join(root, DSH_PKG_JSON_REL)
    if (existsSync(pkgJson)) return join(root, DSH_PKG_DIR)
  }
  return null
}

/** Whether a usable dsh installation exists on this machine. */
export async function isDshInstalled(): Promise<boolean> {
  if (await dshInstallDir()) return true
  // Fallback: any package manager (yarn, corepack, …) that put a `dsh` launcher
  // on PATH counts as installed — the process manager boots it via that shim.
  return (await findOnPath('dsh')) !== null
}

/**
 * Build the command line to boot the dsh web profile without opening a
 * browser. Prefers `node <npmRoot>/@deepseek-ai/dsh/lib/bin.js` (no PATH/shim
 * dependence), falls back to the `dsh` command on PATH.
 */
export async function resolveDshInvocation(): Promise<DshInvocation | null> {
  const installDir = await dshInstallDir()
  if (installDir) {
    const nodePath = await findNodeExecutable()
    if (nodePath) {
      return { command: nodePath, args: [join(installDir, 'lib', 'bin.js')] }
    }
  }
  // Fallback: rely on the `dsh` shim on PATH.
  return { command: 'dsh', args: [], shell: process.platform === 'win32' }
}

/** Ask the OS for a currently-free loopback port. */
export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Decide which port to boot dsh on. Returns 3080 unless it is occupied by a
 * service that is NOT the DSH UI, in which case a free port is chosen.
 */
export async function choosePort(preferred = 3080): Promise<number> {
  const existing = await probeEndpoint(`http://127.0.0.1:${preferred}`, 1500)
  if (existing.ok) {
    if (existing.isDsh) return preferred // someone already serves DSH here
    return await pickFreePort() // occupied by a stranger — move away
  }
  return preferred
}

/**
 * Owns the local dsh child process so the shell can stop it on quit and can
 * detect a crash. All discovery helpers above are pure and unit-testable.
 */
export class DshProcessManager {
  private child: ChildProcess | null = null
  private port: number | null = null
  private url: string | null = null
  private onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null

  get runningUrl(): string | null {
    return this.url
  }

  get runningPort(): number | null {
    return this.port
  }

  /** true when we spawned a live child process. */
  get hasSpawnedChild(): boolean {
    return this.child !== null
  }

  /** true when the manager is attached to a live DSH (spawned by us or found running). */
  get isLive(): boolean {
    return this.url !== null
  }

  setExitHandler(handler: ((code: number | null, signal: NodeJS.Signals | null) => void) | null): void {
    this.onExit = handler
  }

  /**
   * Start (or reuse) a local dsh. If an already-running DSH answers the health
   * check on the chosen port, returns it without spawning.
   */
  async start(opts: StartLocalOptions = {}): Promise<StartLocalResult> {
    if (this.isLive) {
      return { url: this.url!, port: this.port!, alreadyRunning: false }
    }

    const port = opts.port ?? (await choosePort())
    const url = `http://127.0.0.1:${port}`

    // Someone already runs DSH on the port — connect without spawning.
    const pre = await probeEndpoint(url, 1500)
    if (pre.ok && pre.isDsh) {
      this.url = url
      this.port = port
      return { url, port, alreadyRunning: true }
    }

    const invocation = await resolveDshInvocation()
    if (!invocation) {
      throw new Error('未找到可用的 dsh 安装：请先安装 @deepseek-ai/dsh，或手动输入 DSH 的 URL。')
    }

    const child = spawn(
      invocation.command,
      [...invocation.args, '--profile', 'web', '--no-open', '--port', String(port)],
      {
        shell: invocation.shell,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env }
      }
    )
    this.child = child
    this.port = port
    this.url = url

    const onOutput = opts.onOutput ?? (() => {})
    child.stdout?.on('data', (d: Buffer) => onOutput(d.toString()))
    child.stderr?.on('data', (d: Buffer) => onOutput(d.toString()))
    child.on('exit', (code, signal) => {
      this.child = null
      this.url = null
      this.port = null
      this.onExit?.(code, signal)
      opts.onExit?.(code, signal)
    })

    const timeoutMs = opts.readyTimeoutMs ?? 90_000
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const r = await probeEndpoint(url, 2000)
      if (r.ok && r.isDsh) return { url, port, alreadyRunning: false }
      if (child.exitCode !== null) {
        throw new Error(`dsh 进程提前退出（exit code ${child.exitCode}）。请查看下方日志。`)
      }
      if (Date.now() > deadline) {
        child.kill()
        throw new Error('等待 dsh Web UI 就绪超时（' + Math.round(timeoutMs / 1000) + 's）。首次启动可能较慢，请重试或查看日志。')
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  /** Terminate the spawned child (SIGTERM, escalate to SIGKILL). No-op when we did not spawn it. */
  async stop(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      this.child = null
      return
    }
    const exited = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }, 5000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
    await exited
    this.child = null
  }
}
