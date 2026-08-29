import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Settings } from '../shared/ipc'

const DEFAULT_SETTINGS: Settings = { keepDshRunning: false }

export class SettingsStore {
  constructor(private readonly file: string) {}

  async load(): Promise<Settings> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const data = JSON.parse(raw) as Partial<Settings>
      return { keepDshRunning: data.keepDshRunning === true }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  async save(settings: Settings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(settings, null, 2), 'utf8')
  }
}
