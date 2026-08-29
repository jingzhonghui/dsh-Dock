import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { promisify } from 'node:util'

import { findNodeExecutable } from './localDsh'

const execFileAsync = promisify(execFile)

export interface InstallResult {
  ok: boolean
  code: number | null
  /** Human-readable failure hint (permissions, network…). */
  hint?: string
}

export interface InstallOptions {
  /** Package spec; defaults to @deepseek-ai/dsh@latest. */
  spec?: string
  /** Called with each line of npm output. */
  onOutput?: (line: string) => void
  /** Abort to terminate the npm child process (user pressed "stop"). */
  signal?: AbortSignal
}

const PERMISSION_HINTS: Array<[RegExp, string]> = [
  [/EACCES|EPERM|permission denied/i, '权限不足：macOS/Linux 的全局 npm 安装通常需要 sudo。请改用终端执行 `sudo npm install -g @deepseek-ai/dsh`，或为当前用户配置可写的 npm 全局目录。'],
  [/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|TLS|certificate/i, '网络错误：无法访问 npm registry，请检查网络/代理后重试。'],
  [/ENOENT|not found/i, '找不到 npm 或 Node.js：请先安装 Node.js（https://nodejs.org），再重试安装。']
]

/** Resolve an npm invocation: prefer `node <npm-cli>`, else `npm` on PATH. */
async function resolveNpmInvocation(): Promise<{ command: string; args: string[]; shell: boolean }> {
  const nodePath = await findNodeExecutable()
  if (nodePath) {
    const cli = join(dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(cli)) return { command: nodePath, args: [cli], shell: false }
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [], shell: process.platform === 'win32' }
}

/**
 * Install (or update) dsh globally via npm. Streams npm output line by line.
 * Never pins a version — `@latest` keeps the shell update-transparent.
 */
export async function installDshGlobal(opts: InstallOptions = {}): Promise<InstallResult> {
  const spec = opts.spec ?? '@deepseek-ai/dsh@latest'
  const { command, args, shell } = await resolveNpmInvocation()
  const onOutput = opts.onOutput ?? (() => {})

  return await new Promise<InstallResult>((resolve) => {
    const child = spawn(command, [...args, 'install', '-g', spec], {
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let buffer = ''
    let hint: string | undefined

    const handle = (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) onOutput(line)
      }
      if (!hint) {
        for (const [re, text] of PERMISSION_HINTS) {
          if (re.test(buffer)) {
            hint = text
            break
          }
        }
      }
    }
    child.stdout?.on('data', handle)
    child.stderr?.on('data', handle)

    child.on('error', (err) => {
      resolve({ ok: false, code: null, hint: `无法启动 npm：${err.message}` })
    })
    child.on('close', (code) => {
      if (buffer.trim()) onOutput(buffer.trim())
      resolve({ ok: code === 0, code, hint: code === 0 ? undefined : hint })
    })

    // Registered after the close listener so an already-aborted signal that
    // kills the child synchronously still resolves through 'close'.
    const onAbort = (): void => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort()
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true })
      }
    }
  })
}

/** Convenience for the rare case where npm global root is needed synchronously. */
export async function npmVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
      timeout: 10000,
      shell: process.platform === 'win32'
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}
