import type { LogEntry, ShellState } from '../shared/ipc'

const MAX_LOG_LINES = 300

/**
 * Minimal state machine for the shell UI. Electron-free (node:events only) so
 * it is unit-testable; the main process calls `transition` and pushes logs.
 */
export class ShellStateMachine {
  private state: ShellState = {
    phase: 'probing',
    busy: 'none',
    logs: []
  }

  private readonly listeners = new Set<(state: ShellState) => void>()
  private readonly logListeners = new Set<(entry: LogEntry) => void>()

  snapshot(): ShellState {
    return { ...this.state, logs: [...this.state.logs] }
  }

  onChange(cb: (state: ShellState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onLog(cb: (entry: LogEntry) => void): () => void {
    this.logListeners.add(cb)
    return () => this.logListeners.delete(cb)
  }

  transition(patch: Partial<ShellState>): ShellState {
    this.state = { ...this.state, ...patch, logs: this.state.logs }
    const snap = this.snapshot()
    for (const cb of this.listeners) cb(snap)
    return snap
  }

  log(entry: Omit<LogEntry, 'ts'>): void {
    const full: LogEntry = { ...entry, ts: Date.now() }
    const logs = [...this.state.logs, full]
    this.state.logs = logs.length > MAX_LOG_LINES ? logs.slice(logs.length - MAX_LOG_LINES) : logs
    for (const cb of this.logListeners) cb(full)
  }
}
