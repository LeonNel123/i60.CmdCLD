import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'
import type { RelayState } from './types'

// The queue must survive app restarts (CMDCLD-REQ-001 point 3); the log is
// the audit trail behind the per-session relay UI. Same JSON-on-disk shape
// as Store/Settings.

const LOG_CAP = 200
const INBOX_CAP = 100

export class RelayStore {
  private state: RelayState

  constructor(private filePath: string) {
    this.state = this.loadFromDisk()
  }

  private loadFromDisk(): RelayState {
    try {
      if (existsSync(this.filePath)) {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        if (raw && Array.isArray(raw.queue) && Array.isArray(raw.log)) {
          // inbox arrived after queue/log; older files simply lack it.
          return { queue: raw.queue, log: raw.log, inbox: Array.isArray(raw.inbox) ? raw.inbox : [] }
        }
      }
    } catch {
      // corrupted file — start clean; the log is advisory, queued relays
      // are recoverable by re-sending.
    }
    return { queue: [], log: [], inbox: [] }
  }

  load(): RelayState {
    return this.state
  }

  save(state: RelayState): void {
    this.state = {
      queue: state.queue,
      log: state.log.slice(-LOG_CAP),
      inbox: state.inbox.slice(-INBOX_CAP),
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2))
    } catch {}
  }
}
