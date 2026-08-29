import { randomUUID } from 'node:crypto'

import type { Busy, LandingReason, LogEntry, ShellState, TabKind, TabState } from '../shared/ipc'

const MAX_LOG_LINES = 300

/**
 * Tab store for the shell UI. Electron-free so it is unit-testable; the main
 * process drives it via createTab / patchTab / closeTab and pushes logs.
 * Replaces the old single-phase ShellStateMachine: every dsh connection now
 * lives in its own tab, and the active tab decides what the window shows.
 */
export class TabStore {
  private tabs: TabState[] = []
  private activeTabId = ''
  private bootTabId = ''
  private busy: Busy = 'none'
  private installed?: boolean
  private landingReason?: LandingReason
  private message?: string
  private logs: LogEntry[] = []

  private readonly listeners = new Set<(state: ShellState) => void>()
  private readonly logListeners = new Set<(entry: LogEntry) => void>()

  snapshot(): ShellState {
    return {
      tabs: this.tabs.map((t) => ({ ...t })),
      activeTabId: this.activeTabId,
      bootTabId: this.bootTabId,
      busy: this.busy,
      installed: this.installed,
      landingReason: this.landingReason,
      message: this.message,
      logs: [...this.logs]
    }
  }

  onChange(cb: (state: ShellState) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onLog(cb: (entry: LogEntry) => void): () => void {
    this.logListeners.add(cb)
    return () => this.logListeners.delete(cb)
  }

  private emit(): void {
    const snap = this.snapshot()
    for (const cb of this.listeners) cb(snap)
  }

  /** Create a tab and make it active. The first boot tab is recorded as bootTabId. */
  createTab(kind: TabKind): TabState {
    const tab: TabState = {
      id: randomUUID(),
      kind,
      phase: kind === 'boot' ? 'probing' : 'new'
    }
    this.tabs.push(tab)
    if (kind === 'boot' && !this.bootTabId) this.bootTabId = tab.id
    this.activeTabId = tab.id
    this.emit()
    return tab
  }

  getTab(id: string): TabState | undefined {
    return this.tabs.find((t) => t.id === id)
  }

  setActive(id: string): boolean {
    if (!this.getTab(id)) return false
    if (this.activeTabId === id) return true
    this.activeTabId = id
    this.emit()
    return true
  }

  patchTab(id: string, patch: Partial<TabState>): TabState | undefined {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return undefined
    this.tabs[idx] = { ...this.tabs[idx], ...patch }
    this.emit()
    return this.tabs[idx]
  }

  /** Remove a tab. Refuses the boot tab. Returns what was removed / active switch. */
  closeTab(id: string): { tab?: TabState; activeChanged: boolean } {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return { activeChanged: false }
    const tab = this.tabs[idx]
    if (tab.id === this.bootTabId) return { activeChanged: false }

    this.tabs.splice(idx, 1)
    let activeChanged = false
    if (this.activeTabId === id) {
      // Prefer the tab now at idx (the one that followed), else the previous.
      const next = this.tabs[idx] ?? this.tabs[idx - 1]
      this.activeTabId = next?.id ?? ''
      activeChanged = true
    }
    this.emit()
    return { tab, activeChanged }
  }

  /**
   * A connected / connecting tab already targeting this exact URL (for dedupe).
   * URLs must be canonicalized by the caller (normalizeUrl). The boot tab is
   * eligible like any other.
   */
  findTabByUrl(url: string, excludeId?: string): TabState | undefined {
    return this.tabs.find(
      (t) =>
        t.id !== excludeId &&
        (t.phase === 'connected' || t.phase === 'connecting') &&
        t.url === url
    )
  }

  /** Update the global (boot-flow) fields without touching tabs. */
  setGlobal(
    patch: Partial<Pick<ShellState, 'busy' | 'installed' | 'landingReason' | 'message'>>
  ): void {
    if (patch.busy !== undefined) this.busy = patch.busy
    if (patch.installed !== undefined) this.installed = patch.installed
    if (patch.landingReason !== undefined) this.landingReason = patch.landingReason
    if (patch.message !== undefined) this.message = patch.message
    this.emit()
  }

  log(entry: Omit<LogEntry, 'ts'>): void {
    const full: LogEntry = { ...entry, ts: Date.now() }
    const logs = [...this.logs, full]
    this.logs = logs.length > MAX_LOG_LINES ? logs.slice(logs.length - MAX_LOG_LINES) : logs
    for (const cb of this.logListeners) cb(full)
    // Also broadcast the fresh snapshot so the renderer sees new log lines via
    // the regular StateChanged push (which includes `logs`).
    this.emit()
  }
}
